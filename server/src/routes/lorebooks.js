/**
 * Lorebook API Routes
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { StorageService } from '../services/storage.js';
import { LorebookParser } from '../services/lorebook-parser.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize storage service
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new StorageService(req.app.locals.dataRoot);
  }
  next();
});

// ==================== Lorebook Library Operations ====================

/**
 * List all lorebooks in global library
 */
router.get('/', asyncHandler(async (req, res) => {
  const lorebooks = await storage.listAllLorebooks();

  // Get all characters to find which ones are associated with each lorebook
  const allCharacters = await storage.listAllCharacters();

  // Enrich lorebooks with associated character data
  const enrichedLorebooks = await Promise.all(
    lorebooks.map(async (lorebook) => {
      // Find characters that reference this lorebook
      const associatedCharacters = [];

      for (const char of allCharacters) {
        try {
          const characterData = await storage.getCharacter(char.id);
          const lorebookId = characterData.data?.extensions?.ursceal_lorebook_id;

          if (lorebookId === lorebook.id) {
            // Get character info
            const hasImage = await storage.hasCharacterImage(char.id);
            const hasThumbnail = await storage.hasCharacterThumbnail(char.id);
            const imageUrl = hasImage ? `/api/characters/${char.id}/image` : null;
            const thumbnailUrl = hasThumbnail ? `/api/characters/${char.id}/thumbnail` : imageUrl;

            associatedCharacters.push({
              id: char.id,
              name: characterData.data?.name || 'Unknown',
              imageUrl,
              thumbnailUrl
            });
          }
        } catch (error) {
          console.error(`Failed to check character ${char.id} for lorebook association:`, error);
        }
      }

      return {
        ...lorebook,
        characters: associatedCharacters
      };
    })
  );

  res.json({ lorebooks: enrichedLorebooks });
}));

/**
 * Get specific lorebook with all entries
 */
router.get('/:lorebookId', asyncHandler(async (req, res) => {
  const { lorebookId } = req.params;
  const lorebook = await storage.getLorebook(lorebookId);
  res.json({ lorebook });
}));

/**
 * Import lorebook from JSON file
 */
router.post('/import', upload.single('lorebook'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No lorebook file provided', 400);
  }

  try {
    // Parse lorebook
    const parsed = LorebookParser.parseStandaloneLorebook(req.file.buffer);

    // Generate unique ID
    const lorebookId = uuidv4();

    // Save to storage
    await storage.saveLorebook(lorebookId, parsed);

    res.json({
      id: lorebookId,
      name: parsed.name,
      description: parsed.description,
      entryCount: parsed.entries.length
    });
  } catch (error) {
    console.error('Failed to import lorebook:', error);
    throw new AppError(`Failed to import lorebook: ${error.message}`, 400);
  }
}));

/**
 * Import lorebook from URL
 */
router.post('/import-url', asyncHandler(async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    throw new AppError('URL is required', 400);
  }

  try {
    // Fetch JSON from URL
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new Error('URL does not point to a JSON file');
    }

    const jsonData = await response.json();
    const buffer = Buffer.from(JSON.stringify(jsonData), 'utf8');

    // Parse lorebook
    const parsed = LorebookParser.parseStandaloneLorebook(buffer);

    // Generate unique ID
    const lorebookId = uuidv4();

    // Save to storage
    await storage.saveLorebook(lorebookId, parsed);

    res.json({
      id: lorebookId,
      name: parsed.name,
      description: parsed.description,
      entryCount: parsed.entries.length
    });
  } catch (error) {
    console.error('Failed to import lorebook from URL:', error);
    throw new AppError(`Failed to import lorebook from URL: ${error.message}`, 400);
  }
}));

/**
 * Create new lorebook from scratch
 */
router.post('/create', asyncHandler(async (req, res) => {
  const { name, description } = req.body;

  if (!name || !name.trim()) {
    throw new AppError('Lorebook name is required', 400);
  }

  const lorebookId = uuidv4();

  const lorebookData = {
    name: name.trim(),
    description: description || '',
    scanDepth: null,  // Use global setting
    tokenBudget: null, // Use global setting
    recursiveScanning: true,
    entries: [],
    extensions: {}
  };

  await storage.saveLorebook(lorebookId, lorebookData);

  res.json({
    id: lorebookId,
    name: lorebookData.name,
    description: lorebookData.description,
    entryCount: 0
  });
}));

/**
 * Update lorebook metadata (name, description, settings)
 */
router.put('/:lorebookId', asyncHandler(async (req, res) => {
  const { lorebookId } = req.params;
  const { name, description, scanDepth, tokenBudget, recursiveScanning } = req.body;

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
    entryCount: updated.entries.length
  });
}));

/**
 * Delete lorebook from library
 */
router.delete('/:lorebookId', asyncHandler(async (req, res) => {
  const { lorebookId } = req.params;
  await storage.deleteLorebook(lorebookId);
  res.json({ success: true });
}));

// ==================== Lorebook Entry Operations ====================

/**
 * Add new entry to lorebook
 */
router.post('/:lorebookId/entries', asyncHandler(async (req, res) => {
  const { lorebookId } = req.params;
  const entryData = req.body;

  // Get existing lorebook
  const lorebook = await storage.getLorebook(lorebookId);

  // Generate unique entry ID
  const entryId = lorebook.entries.length > 0
    ? Math.max(...lorebook.entries.map(e => e.id || 0)) + 1
    : 0;

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
    extensions: entryData.extensions || {}
  };

  // Add to lorebook
  lorebook.entries.push(newEntry);

  // Save
  await storage.saveLorebook(lorebookId, lorebook);

  res.json({ entry: newEntry });
}));

/**
 * Update specific entry
 */
router.put('/:lorebookId/entries/:entryId', asyncHandler(async (req, res) => {
  const { lorebookId, entryId } = req.params;
  const updates = req.body;

  // Get existing lorebook
  const lorebook = await storage.getLorebook(lorebookId);

  // Find entry
  const entryIndex = lorebook.entries.findIndex(e => e.id === parseInt(entryId));
  if (entryIndex === -1) {
    throw new AppError('Entry not found', 404);
  }

  // Update entry
  lorebook.entries[entryIndex] = {
    ...lorebook.entries[entryIndex],
    ...updates,
    id: parseInt(entryId) // Prevent ID from being changed
  };

  // Save
  await storage.saveLorebook(lorebookId, lorebook);

  res.json({ entry: lorebook.entries[entryIndex] });
}));

/**
 * Delete entry from lorebook
 */
router.delete('/:lorebookId/entries/:entryId', asyncHandler(async (req, res) => {
  const { lorebookId, entryId } = req.params;

  // Get existing lorebook
  const lorebook = await storage.getLorebook(lorebookId);

  // Remove entry
  lorebook.entries = lorebook.entries.filter(e => e.id !== parseInt(entryId));

  // Save
  await storage.saveLorebook(lorebookId, lorebook);

  res.json({ success: true });
}));

export default router;
