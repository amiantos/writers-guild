/**
 * Lorebook API Routes
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';
import { LorebookParser } from '../services/lorebook-parser.js';
import { cacheAndRewriteLorebookImages } from '../services/image-cacher.js';
import { computeLorebookChecksum } from '../services/checksum-service.js';
import { AssetManager } from '../services/asset-manager.js';
import { safeFetch, readBodyWithLimit } from '../services/safe-fetch.js';
import { sseChannel } from '../utils/sse.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Lorebooks fetched by URL (import-url): bounded so a hostile or broken server
// cannot stall an import or fill memory. The size matches the JSON body limit.
const URL_IMPORT_TIMEOUT_MS = 30_000;
const URL_IMPORT_MAX_BYTES = 50 * 1024 * 1024; // 50MB

// Initialize storage service
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new SqliteStorageService(req.app.locals.dataRoot);
  }
  next();
});

/**
 * Reject a lorebook file we already hold, and give a fresh one a free name.
 *
 * Matching is on content — entries and scan settings — not the name, so
 * re-importing an export under a different filename is still caught, and so is a
 * file matching a lorebook that predates schema v9. A copy the user has edited
 * since importing does not block a fresh import.
 *
 * Returns the name to save under. Call before downloading images: a duplicate
 * should not cost a round of image caching.
 */
function resolveLorebookImport(lorebookData, originChecksum) {
  const existing = storage.findExistingLorebookForImport(originChecksum);

  if (existing) {
    throw new AppError(`"${existing.name}" has already been imported from this file.`, 409, {
      existingLorebookId: existing.id,
      existingLorebookName: existing.name,
    });
  }

  return storage.resolveUniqueLorebookName(lorebookData.name);
}

/**
 * Remove a partially-imported lorebook's cached assets.
 */
async function cleanupLorebookAssets(dataRoot, lorebookId) {
  try {
    await new AssetManager(dataRoot, 'lorebooks').deleteDir(lorebookId);
  } catch (error) {
    console.error(`Failed to clean up assets for lorebook ${lorebookId}:`, error);
  }
}

// ==================== Lorebook Library Operations ====================

/**
 * List all lorebooks in global library
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const lorebooks = await storage.listAllLorebooks();

    // Group characters by the lorebook they link to in one pass. Asking each
    // lorebook which characters point at it instead reads and parses every
    // character card once per lorebook.
    const charactersByLorebook = new Map();
    for (const char of storage.listCharacterSummaries()) {
      if (!char.lorebookId) continue;

      const imageUrl = char.hasImage ? `/api/characters/${char.id}/image` : null;
      const entry = {
        id: char.id,
        name: char.name,
        imageUrl,
        thumbnailUrl: char.hasThumbnail ? `/api/characters/${char.id}/thumbnail` : imageUrl,
      };

      const existing = charactersByLorebook.get(char.lorebookId);
      if (existing) {
        existing.push(entry);
      } else {
        charactersByLorebook.set(char.lorebookId, [entry]);
      }
    }

    // The stories each lorebook is attached to, grouped the same way
    const storyIdsByLorebook = new Map();
    for (const { storyId, lorebookId } of storage.listStoryLorebookLinks()) {
      const existing = storyIdsByLorebook.get(lorebookId);
      if (existing) existing.push(storyId);
      else storyIdsByLorebook.set(lorebookId, [storyId]);
    }

    res.json({
      lorebooks: lorebooks.map((lorebook) => ({
        ...lorebook,
        characters: charactersByLorebook.get(lorebook.id) ?? [],
        storyIds: storyIdsByLorebook.get(lorebook.id) ?? [],
      })),
    });
  }),
);

/**
 * Get specific lorebook with all entries
 */
router.get(
  '/:lorebookId',
  asyncHandler(async (req, res) => {
    const { lorebookId } = req.params;
    const lorebook = await storage.getLorebook(lorebookId);
    res.json({ lorebook });
  }),
);

/**
 * Import lorebook from JSON file
 */
router.post(
  '/import',
  upload.single('lorebook'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No lorebook file provided', 400);
    }

    const channel = sseChannel(req, res);
    const lorebookId = uuidv4();

    try {
      // Parse lorebook
      const parsed = LorebookParser.parseStandaloneLorebook(req.file.buffer);

      // The file as it arrived, before image URLs are rewritten to local paths.
      const originChecksum = computeLorebookChecksum(parsed);
      parsed.name = resolveLorebookImport(parsed, originChecksum);

      // Cache external images and rewrite URLs before saving, so the rewritten
      // local paths are what gets persisted.
      await cacheAndRewriteLorebookImages(
        lorebookId,
        parsed,
        req.app.locals.dataRoot,
        channel.send,
      );

      // Save to storage
      await storage.saveLorebook(lorebookId, parsed, { originChecksum });

      channel.finish({
        statusCode: 200,
        body: {
          id: lorebookId,
          name: parsed.name,
          description: parsed.description,
          entryCount: parsed.entries.length,
        },
      });
    } catch (error) {
      console.error('Failed to import lorebook:', error);
      await cleanupLorebookAssets(req.app.locals.dataRoot, lorebookId);
      if (res.headersSent) {
        channel.fail(`Failed to import lorebook: ${error.message}`);
        return;
      }
      throw error instanceof AppError
        ? error
        : new AppError(`Failed to import lorebook: ${error.message}`, 400);
    }
  }),
);

/**
 * Import lorebook from URL
 */
router.post(
  '/import-url',
  asyncHandler(async (req, res) => {
    const { url } = req.body ?? {};
    const channel = sseChannel(req, res);

    if (!url || typeof url !== 'string') {
      throw new AppError('URL is required', 400);
    }

    const lorebookId = uuidv4();

    try {
      // Fetch JSON from URL
      const response = await safeFetch(url, {
        signal: AbortSignal.timeout(URL_IMPORT_TIMEOUT_MS),
      });

      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        await response.body?.cancel();
        throw new Error('URL does not point to a JSON file');
      }

      const body = await readBodyWithLimit(response, URL_IMPORT_MAX_BYTES);
      const jsonData = JSON.parse(body.toString('utf8'));
      const buffer = Buffer.from(JSON.stringify(jsonData), 'utf8');

      // Parse lorebook
      const parsed = LorebookParser.parseStandaloneLorebook(buffer);

      // The file as it arrived, before image URLs are rewritten to local paths.
      const originChecksum = computeLorebookChecksum(parsed);
      parsed.name = resolveLorebookImport(parsed, originChecksum);

      // Cache external images and rewrite URLs before saving, so the rewritten
      // local paths are what gets persisted.
      await cacheAndRewriteLorebookImages(
        lorebookId,
        parsed,
        req.app.locals.dataRoot,
        channel.send,
      );

      // Save to storage
      await storage.saveLorebook(lorebookId, parsed, { originChecksum });

      channel.finish({
        statusCode: 200,
        body: {
          id: lorebookId,
          name: parsed.name,
          description: parsed.description,
          entryCount: parsed.entries.length,
        },
      });
    } catch (error) {
      console.error('Failed to import lorebook from URL:', error);
      await cleanupLorebookAssets(req.app.locals.dataRoot, lorebookId);
      if (res.headersSent) {
        channel.fail(`Failed to import lorebook from URL: ${error.message}`);
        return;
      }
      throw error instanceof AppError
        ? error
        : new AppError(`Failed to import lorebook from URL: ${error.message}`, 400);
    }
  }),
);

/**
 * Create new lorebook from scratch
 */
router.post(
  '/create',
  asyncHandler(async (req, res) => {
    const { name, description } = req.body ?? {};

    if (!name || !name.trim()) {
      throw new AppError('Lorebook name is required', 400);
    }

    const lorebookId = uuidv4();

    const lorebookData = {
      name: name.trim(),
      description: description || '',
      scanDepth: null, // Use global setting
      tokenBudget: null, // Use global setting
      recursiveScanning: true,
      entries: [],
      extensions: {},
    };

    await storage.saveLorebook(lorebookId, lorebookData);

    res.json({
      id: lorebookId,
      name: lorebookData.name,
      description: lorebookData.description,
      entryCount: 0,
    });
  }),
);

/**
 * Update lorebook metadata (name, description, settings)
 */
router.put(
  '/:lorebookId',
  asyncHandler(async (req, res) => {
    const { lorebookId } = req.params;
    const { name, description, scanDepth, tokenBudget, recursiveScanning } = req.body ?? {};

    // Get existing lorebook
    const existing = await storage.getLorebook(lorebookId);

    // Update fields
    const updated = {
      ...existing,
      ...(name !== undefined && { name: name.trim() }),
      ...(description !== undefined && { description }),
      ...(scanDepth !== undefined && { scanDepth }),
      ...(tokenBudget !== undefined && { tokenBudget }),
      ...(recursiveScanning !== undefined && { recursiveScanning }),
    };

    await storage.saveLorebook(lorebookId, updated);

    res.json({
      id: lorebookId,
      name: updated.name,
      description: updated.description,
      entryCount: updated.entries.length,
    });
  }),
);

/**
 * Delete lorebook from library
 */
router.delete(
  '/:lorebookId',
  asyncHandler(async (req, res) => {
    const { lorebookId } = req.params;
    await storage.deleteLorebook(lorebookId);

    // Clean up cached asset files so deleted lorebooks don't leak their gallery
    await cleanupLorebookAssets(req.app.locals.dataRoot, lorebookId);

    res.json({ success: true });
  }),
);

// ==================== Lorebook Entry Operations ====================

/**
 * Add new entry to lorebook
 */
router.post(
  '/:lorebookId/entries',
  asyncHandler(async (req, res) => {
    const { lorebookId } = req.params;
    const entryData = req.body ?? {};

    // Get existing lorebook
    const lorebook = await storage.getLorebook(lorebookId);

    // Generate unique entry ID
    const entryId =
      lorebook.entries.length > 0 ? Math.max(...lorebook.entries.map((e) => e.id || 0)) + 1 : 0;

    // Create new entry with defaults
    const newEntry = {
      id: entryId,
      keys: entryData.keys || [],
      secondaryKeys: entryData.secondaryKeys || [],
      content: entryData.content || '',
      comment: entryData.comment || '',
      enabled: entryData.enabled !== undefined ? entryData.enabled : true,
      constant: entryData.constant || false,
      selective: entryData.selective || false,
      selectiveLogic: entryData.selectiveLogic || 0,
      insertionOrder: entryData.insertionOrder !== undefined ? entryData.insertionOrder : 100,
      position: entryData.position || 1, // Default: after_char
      caseSensitive: entryData.caseSensitive || false,
      matchWholeWords: entryData.matchWholeWords || false,
      useRegex: entryData.useRegex || false,
      probability: entryData.probability !== undefined ? entryData.probability : 100,
      useProbability: entryData.useProbability || false,
      depth: entryData.depth || 4,
      scanDepth: entryData.scanDepth || null,
      group: entryData.group || '',
      preventRecursion: entryData.preventRecursion || false,
      delayUntilRecursion: entryData.delayUntilRecursion || false,
      displayIndex: entryData.displayIndex !== undefined ? entryData.displayIndex : entryId,
      extensions: entryData.extensions || {},
    };

    // Add to lorebook
    lorebook.entries.push(newEntry);

    // Save
    await storage.saveLorebook(lorebookId, lorebook);

    // Refetch to get actual entry ID from database
    const savedLorebook = await storage.getLorebook(lorebookId);
    const savedEntry = savedLorebook.entries[savedLorebook.entries.length - 1];

    res.json({ entry: savedEntry });
  }),
);

/**
 * Update specific entry
 */
router.put(
  '/:lorebookId/entries/:entryId',
  asyncHandler(async (req, res) => {
    const { lorebookId, entryId } = req.params;
    const updates = req.body ?? {};

    // Get existing lorebook
    const lorebook = await storage.getLorebook(lorebookId);

    // Find entry
    const entryIndex = lorebook.entries.findIndex((e) => e.id === parseInt(entryId));
    if (entryIndex === -1) {
      throw new AppError('Entry not found', 404);
    }

    // Update entry
    lorebook.entries[entryIndex] = {
      ...lorebook.entries[entryIndex],
      ...updates,
      id: parseInt(entryId), // Prevent ID from being changed
    };

    // Save
    await storage.saveLorebook(lorebookId, lorebook);

    res.json({ entry: lorebook.entries[entryIndex] });
  }),
);

/**
 * Delete entry from lorebook
 */
router.delete(
  '/:lorebookId/entries/:entryId',
  asyncHandler(async (req, res) => {
    const { lorebookId, entryId } = req.params;

    // Get existing lorebook
    const lorebook = await storage.getLorebook(lorebookId);

    // Remove entry
    lorebook.entries = lorebook.entries.filter((e) => e.id !== parseInt(entryId));

    // Save
    await storage.saveLorebook(lorebookId, lorebook);

    res.json({ success: true });
  }),
);

export default router;
