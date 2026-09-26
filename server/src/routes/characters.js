/**
 * Characters API Routes (Global Library)
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';
import { CharacterParser } from '../services/character-parser.js';
import { LorebookParser } from '../services/lorebook-parser.js';
import { ChubImporter } from '../services/chub-importer.js';
import { computeCharacterChecksum, computeLorebookChecksum } from '../services/checksum-service.js';
import { IMAGE_EXTENSIONS } from '../../../shared/regex-patterns.js';
import {
  cacheCharacterImages,
  cacheAndRewriteLorebookImages,
  rewriteCharacterImageUrls,
} from '../services/image-cacher.js';
import { AssetManager } from '../services/asset-manager.js';
import { sseChannel } from '../utils/sse.js';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/avif'];
    if (!allowedTypes.includes(file.mimetype)) {
      cb(new AppError('Only PNG, JPEG, WebP, and AVIF images are allowed', 400));
    } else {
      cb(null, true);
    }
  },
});

// Configure multer for JSON uploads (import-json route)
const jsonUpload = multer({ storage: multer.memoryStorage() });

// Initialize storage service
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new SqliteStorageService(req.app.locals.dataRoot);
  }
  next();
});

/**
 * Helper to cache external images and rewrite URLs in character card data.
 * Does NOT throw on failure — just logs warnings so imports still succeed.
 */
async function cacheCardImages(characterId, cardData, dataRoot, onProgress) {
  try {
    const imageMap = await cacheCharacterImages(characterId, cardData, dataRoot, { onProgress });
    if (imageMap.size > 0) {
      rewriteCharacterImageUrls(cardData, imageMap);
      console.log(
        `[cacheCardImages] Rewrote ${imageMap.size} image URL(s) for character ${characterId}`,
      );
    }
  } catch (error) {
    console.error(`[cacheCardImages] Failed to cache images for ${characterId}:`, error);
    // Non-fatal: continue with original URLs
  }
}

/**
 * Extract embedded lorebook from character data and save it to storage.
 * Also caches any external images found in the lorebook entry content.
 * Modifies cardData.data.extensions.ursceal_lorebook_id in place.
 * @returns {{ embeddedLorebook: object|null, lorebookId: string|null }}
 */
async function extractAndSaveEmbeddedLorebook(storageInstance, cardData, dataRoot, onProgress) {
  let embeddedLorebook = null;
  let lorebookId = null;
  let createdLorebookId = null;

  if (
    cardData.data?.character_book &&
    cardData.data.character_book.entries &&
    cardData.data.character_book.entries.length > 0
  ) {
    try {
      // Parse embedded lorebook
      const lorebookData = LorebookParser.parseEmbeddedLorebook(cardData.data.character_book);

      // Give it a name based on the character
      lorebookData.name = `${cardData.data.name}'s Lorebook`;
      lorebookData.description = lorebookData.description || `Lorebook for ${cardData.data.name}`;

      // A world book shipped with several characters is the same world book
      // every time, so link the existing one instead of importing another copy.
      // The checksum covers entries and scan settings, not the name — the name
      // above is derived from whichever character happened to carry it.
      const contentChecksum = computeLorebookChecksum(lorebookData);
      const existing = storageInstance.findExistingLorebookForImport(contentChecksum);

      if (existing) {
        lorebookId = existing.id;
        embeddedLorebook = {
          id: existing.id,
          name: existing.name,
          entryCount: lorebookData.entries.length,
          reused: true,
        };
        console.log(
          `Reusing lorebook "${existing.name}" for ${cardData.data.name} (identical content)`,
        );
      } else {
        lorebookId = uuidv4();
        createdLorebookId = lorebookId;

        // Cache external images and rewrite URLs before saving, so the
        // rewritten local paths are what gets persisted.
        await cacheAndRewriteLorebookImages(lorebookId, lorebookData, dataRoot, onProgress);

        // Save to global lorebook library. The origin checksum is the book as
        // the card carried it, so the next character shipping it matches even
        // though image caching has since rewritten this copy's URLs.
        lorebookData.name = storageInstance.resolveUniqueLorebookName(lorebookData.name);
        await storageInstance.saveLorebook(lorebookId, lorebookData, {
          originChecksum: contentChecksum,
        });

        embeddedLorebook = {
          id: lorebookId,
          name: lorebookData.name,
          entryCount: lorebookData.entries.length,
          reused: false,
        };

        console.log(
          `Extracted embedded lorebook from ${cardData.data.name}: ${lorebookData.entries.length} entries`,
        );
      }
    } catch (error) {
      console.error('Failed to parse embedded lorebook:', error);
    }
  }

  // Add lorebook association to character data
  if (!cardData.data.extensions) {
    cardData.data.extensions = {};
  }
  cardData.data.extensions.ursceal_lorebook_id = lorebookId;

  return { embeddedLorebook, lorebookId, createdLorebookId };
}

/**
 * Reject a card we have already imported.
 *
 * Matching is on the *origin* checksum — the source content, before local image
 * URLs are rewritten — so a card matches the copy it was imported from
 * regardless of what caching did to it afterwards.
 *
 * A stored copy the user has since edited does not block the import: they get a
 * clean copy alongside their edited one. `import_internal_checksum` is frozen at
 * import, so `current !== internal` is exactly "edited since import".
 *
 * Call this before downloading anything — a duplicate should cost nothing.
 */
function assertNotDuplicateCharacter(storageInstance, originChecksum) {
  const matches = storageInstance.findCharactersByOriginChecksum(originChecksum);
  const unmodified = matches.find((m) => m.current_checksum === m.import_internal_checksum);

  if (unmodified) {
    throw new AppError(`"${unmodified.name}" has already been imported from this card.`, 409, {
      existingCharacterId: unmodified.id,
      existingCharacterName: unmodified.name,
    });
  }
}

/**
 * Roll back what a failed import already wrote: cached asset directories, and
 * the lorebook row if this import is the one that created it.
 *
 * `createdLorebookId` is null when an existing lorebook was reused — deleting
 * that one would take assets and entries still in use by other characters.
 */
async function cleanupFailedImport(storageInstance, dataRoot, characterId, createdLorebookId) {
  try {
    await new AssetManager(dataRoot).deleteDir(characterId);
  } catch (error) {
    console.error(`Failed to clean up assets for character ${characterId}:`, error);
  }

  if (!createdLorebookId) return;

  try {
    await storageInstance.deleteLorebook(createdLorebookId);
    await new AssetManager(dataRoot, 'lorebooks').deleteDir(createdLorebookId);
  } catch (error) {
    console.error(`Failed to clean up lorebook ${createdLorebookId}:`, error);
  }
}

/**
 * The lorebook a character is about to strand, or null.
 *
 * Nothing is deleted here — the client asks the user, then calls
 * DELETE /api/lorebooks/:id if they say yes. Deleting it outright would be
 * inconsistent with this route refusing to delete a character that is still
 * used by a story.
 */
async function findLorebookLeftBehindBy(characterId) {
  let lorebookId;
  try {
    const cardData = await storage.getCharacter(characterId);
    lorebookId = cardData.data?.extensions?.ursceal_lorebook_id;
  } catch {
    return null;
  }
  if (!lorebookId) return null;

  // Characters link a lorebook through their card; stories attach lorebooks
  // directly. Either one still using it means it is not orphaned.
  const refs = storage.getLorebookReferences(lorebookId, characterId);
  if (refs.characters.length > 0 || refs.stories.length > 0) return null;

  try {
    const lorebook = await storage.getLorebook(lorebookId);
    return { id: lorebookId, name: lorebook.name };
  } catch {
    // Already gone.
    return null;
  }
}

// ==================== Global Character Library ====================

// List all characters in global library
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Total words per character, accumulated in one pass over the stories.
    // Filtering the whole story list once per character is quadratic, and this
    // list is fetched on every landing-page load.
    const wordsByCharacter = new Map();
    for (const story of await storage.listStories()) {
      const participants = new Set(story.characterIds ?? []);
      if (story.personaCharacterId) participants.add(story.personaCharacterId);

      for (const characterId of participants) {
        wordsByCharacter.set(
          characterId,
          (wordsByCharacter.get(characterId) ?? 0) + (story.wordCount || 0),
        );
      }
    }

    // `description` is deliberately absent: it is the bulk of this payload
    // (megabytes across a large library) and nothing renders it from the list.
    // CharacterDetail fetches the full card from GET /:characterId/data instead.
    const charactersWithData = storage.listCharacterSummaries().map((char) => {
      if (char.failed) {
        return {
          id: char.id,
          name: 'Unknown',
          tags: [],
          imageUrl: null,
          thumbnailUrl: null,
          thumbnailMediumUrl: null,
          created: null,
          totalWords: 0,
        };
      }

      // Full image, small thumbnail, and medium thumbnail URLs
      const imageUrl = char.hasImage ? `/api/characters/${char.id}/image` : null;

      return {
        id: char.id,
        name: char.name,
        tags: char.tags,
        imageUrl, // Full resolution
        thumbnailUrl: char.hasThumbnail ? `/api/characters/${char.id}/thumbnail` : imageUrl,
        thumbnailMediumUrl: char.hasThumbnailMedium
          ? `/api/characters/${char.id}/thumbnail-medium`
          : imageUrl,
        created: char.created,
        totalWords: wordsByCharacter.get(char.id) ?? 0,
      };
    });

    // Sort characters alphabetically by name (case-insensitive)
    charactersWithData.sort((a, b) => {
      const nameA = (a.name || 'Unknown').toLowerCase();
      const nameB = (b.name || 'Unknown').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    res.json({ characters: charactersWithData });
  }),
);

// Upload new character to global library (import PNG)
router.post(
  '/import',
  upload.single('character'),
  asyncHandler(async (req, res) => {
    const channel = sseChannel(req, res);

    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const characterId = uuidv4();
    let createdLorebookId = null;

    // Parse character card from PNG
    try {
      const cardData = await CharacterParser.parseCard(req.file.buffer);

      // Before any network work: the card as it arrived, so a re-import of the
      // same source matches however image caching later rewrites it.
      const originChecksum = computeCharacterChecksum(cardData);
      assertNotDuplicateCharacter(storage, originChecksum);

      // Cache external images and rewrite URLs
      await cacheCardImages(characterId, cardData, req.app.locals.dataRoot, channel.send);

      // Extract embedded lorebook if present
      const { embeddedLorebook, createdLorebookId: created } = await extractAndSaveEmbeddedLorebook(
        storage,
        cardData,
        req.app.locals.dataRoot,
        channel.send,
      );
      createdLorebookId = created;

      // Save character data as JSON and image separately
      await storage.saveCharacter(characterId, cardData, req.file.buffer, { originChecksum });

      channel.finish({
        statusCode: 201,
        body: {
          id: characterId,
          name: cardData.data?.name || 'Unknown',
          description: cardData.data?.description || '',
          imageUrl: `/api/characters/${characterId}/image`,
          firstMessage: cardData.data?.first_mes || '',
          embeddedLorebook: embeddedLorebook, // Will be null if no lorebook
        },
      });
    } catch (error) {
      await cleanupFailedImport(storage, req.app.locals.dataRoot, characterId, createdLorebookId);
      // Once the stream is open the status code is already sent, so the error
      // has to be delivered as an event instead of thrown.
      if (res.headersSent) {
        channel.fail(`Invalid character card: ${error.message}`);
        return;
      }
      // AppError already carries the right status and details (e.g. a 409 for a
      // duplicate); only unexpected failures become a generic 400.
      throw error instanceof AppError
        ? error
        : new AppError(`Invalid character card: ${error.message}`, 400);
    }
  }),
);

// Create new character from scratch (no PNG import)
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, description, personality, scenario, first_mes } = req.body;

    if (!name || !name.trim()) {
      throw new AppError('Character name is required', 400);
    }

    const characterId = uuidv4();

    // Create character data in V2 format
    const characterData = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: name.trim(),
        description: description?.trim() || '',
        personality: personality?.trim() || '',
        scenario: scenario?.trim() || '',
        first_mes: first_mes?.trim() || '',
        mes_example: '',
        creator_notes: 'Created in Writers Guild',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        character_book: null,
        tags: [],
        creator: '',
        character_version: '1.0',
        extensions: {},
      },
    };

    // Cache any external images in the card data, then save so the rewritten
    // local URLs are what gets persisted.
    await cacheCardImages(characterId, characterData, req.app.locals.dataRoot);

    // Save character (no image)
    await storage.saveCharacter(characterId, characterData, null);

    res.status(201).json({
      id: characterId,
      name: characterData.data.name,
      description: characterData.data.description,
      imageUrl: null,
      firstMessage: characterData.data.first_mes,
    });
  }),
);

// Create character with optional image
router.post(
  '/create',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const characterDataJson = req.body.characterData;

    if (!characterDataJson) {
      throw new AppError('Character data is required', 400);
    }

    let parsedData;
    try {
      parsedData = JSON.parse(characterDataJson);
    } catch (error) {
      throw new AppError('Invalid character data JSON', 400);
    }

    const { name, description, personality, scenario, first_mes, mes_example, system_prompt } =
      parsedData;

    if (!name || !name.trim()) {
      throw new AppError('Character name is required', 400);
    }

    const characterId = uuidv4();

    // Create character data in V2 format
    const characterData = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: name.trim(),
        description: description?.trim() || '',
        personality: personality?.trim() || '',
        scenario: scenario?.trim() || '',
        first_mes: first_mes?.trim() || '',
        mes_example: mes_example?.trim() || '',
        creator_notes: 'Created in Writers Guild',
        system_prompt: system_prompt?.trim() || '',
        post_history_instructions: '',
        alternate_greetings: [],
        character_book: null,
        tags: [],
        creator: '',
        character_version: '1.0',
        extensions: {},
      },
    };

    // Cache any external images in the card data, then save so the rewritten
    // local URLs are what gets persisted.
    await cacheCardImages(characterId, characterData, req.app.locals.dataRoot);

    // Save character with optional image
    const imageBuffer = req.file ? req.file.buffer : null;
    await storage.saveCharacter(characterId, characterData, imageBuffer);

    const hasImage = await storage.hasCharacterImage(characterId);

    res.status(201).json({
      id: characterId,
      name: characterData.data.name,
      description: characterData.data.description,
      imageUrl: hasImage ? `/api/characters/${characterId}/image` : null,
      firstMessage: characterData.data.first_mes,
    });
  }),
);

/**
 * Import character from JSON file (standalone .json character card)
 */
router.post(
  '/import-json',
  jsonUpload.single('character'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No character file provided', 400);
    }

    // Parse JSON from buffer
    const jsonString = req.file.buffer.toString('utf8');
    let cardData;
    try {
      cardData = JSON.parse(jsonString);
    } catch (e) {
      throw new AppError('Invalid JSON file: ' + e.message, 400);
    }

    // Normalize card data (handles V2 vs flat format)
    cardData = CharacterParser.normalizeCardData(cardData);

    if (!cardData.data || !cardData.data.name) {
      throw new AppError('Invalid character card: missing name or data field', 400);
    }

    const characterId = uuidv4();
    const channel = sseChannel(req, res);
    let createdLorebookId = null;

    try {
      // Before any network work — a duplicate should not cost a download.
      const originChecksum = computeCharacterChecksum(cardData);
      assertNotDuplicateCharacter(storage, originChecksum);

      // Cache external images and rewrite URLs
      await cacheCardImages(characterId, cardData, req.app.locals.dataRoot, channel.send);

      // Extract embedded lorebook if present
      const { embeddedLorebook, createdLorebookId: created } = await extractAndSaveEmbeddedLorebook(
        storage,
        cardData,
        req.app.locals.dataRoot,
        channel.send,
      );
      createdLorebookId = created;

      // Save character data (no image for JSON import)
      await storage.saveCharacter(characterId, cardData, null, { originChecksum });

      channel.finish({
        statusCode: 201,
        body: {
          id: characterId,
          name: cardData.data.name,
          description: cardData.data.description || '',
          imageUrl: null,
          firstMessage: cardData.data.first_mes || '',
          embeddedLorebook: embeddedLorebook,
        },
      });
    } catch (error) {
      await cleanupFailedImport(storage, req.app.locals.dataRoot, characterId, createdLorebookId);
      // Once the stream is open the status line is already sent, so the failure
      // has to reach the client as an event rather than a status code.
      if (res.headersSent) {
        channel.fail(`Failed to import character: ${error.message}`);
        return;
      }
      throw error;
    }
  }),
);

// Import character from URL (CHUB, or direct image URL)
router.post(
  '/import-url',
  asyncHandler(async (req, res) => {
    const { url } = req.body;
    const channel = sseChannel(req, res);

    if (!url || typeof url !== 'string') {
      throw new AppError('URL is required', 400);
    }

    const isImageUrl = IMAGE_EXTENSIONS.test(url);
    const characterId = uuidv4();
    let createdLorebookId = null;

    if (isImageUrl) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new AppError(`Failed to fetch image: ${response.statusText}`, 400);
        }

        const arrayBuffer = await response.arrayBuffer();
        const imageBuffer = Buffer.from(arrayBuffer);

        // Parse character card from PNG
        const rawCardData = await CharacterParser.parseCard(imageBuffer);
        const cardData = CharacterParser.normalizeCardData(rawCardData);

        const originChecksum = computeCharacterChecksum(cardData);
        assertNotDuplicateCharacter(storage, originChecksum);

        // Cache external images and rewrite URLs
        await cacheCardImages(characterId, cardData, req.app.locals.dataRoot, channel.send);

        // Extract embedded lorebook if present
        const { embeddedLorebook, createdLorebookId: created } =
          await extractAndSaveEmbeddedLorebook(
            storage,
            cardData,
            req.app.locals.dataRoot,
            channel.send,
          );
        createdLorebookId = created;

        // Save character data as JSON and image separately
        await storage.saveCharacter(characterId, cardData, imageBuffer, { originChecksum });

        channel.finish({
          statusCode: 201,
          body: {
            id: characterId,
            name: cardData.data?.name || 'Unknown',
            description: cardData.data?.description || '',
            imageUrl: `/api/characters/${characterId}/image`,
            firstMessage: cardData.data?.first_mes || '',
            embeddedLorebook: embeddedLorebook,
          },
        });
        return;
      } catch (error) {
        await cleanupFailedImport(storage, req.app.locals.dataRoot, characterId, createdLorebookId);
        if (res.headersSent) {
          channel.fail(`Failed to import image character: ${error.message}`);
          return;
        }
        throw error instanceof AppError
          ? error
          : new AppError(`Failed to import image character: ${error.message}`, 400);
      }
    }

    // Check if it's a CHUB URL
    if (!url.includes('chub.ai')) {
      throw new AppError(
        'Only CHUB URLs and direct image URLs (PNG, JPEG, WebP) are currently supported',
        400,
      );
    }

    try {
      // Import character from CHUB
      const { characterData, imageBuffer } = await ChubImporter.importFromUrl(url);

      const originChecksum = computeCharacterChecksum(characterData);
      assertNotDuplicateCharacter(storage, originChecksum);

      // Cache external images and rewrite URLs
      await cacheCardImages(characterId, characterData, req.app.locals.dataRoot, channel.send);

      // Extract embedded lorebook if present
      const { embeddedLorebook, createdLorebookId: created } = await extractAndSaveEmbeddedLorebook(
        storage,
        characterData,
        req.app.locals.dataRoot,
        channel.send,
      );
      createdLorebookId = created;

      // Save character with image
      await storage.saveCharacter(characterId, characterData, imageBuffer, { originChecksum });

      const hasImage = await storage.hasCharacterImage(characterId);

      channel.finish({
        statusCode: 201,
        body: {
          id: characterId,
          name: characterData.data.name,
          description: characterData.data.description,
          imageUrl: hasImage ? `/api/characters/${characterId}/image` : null,
          firstMessage: characterData.data.first_mes,
          embeddedLorebook: embeddedLorebook,
        },
      });
    } catch (error) {
      await cleanupFailedImport(storage, req.app.locals.dataRoot, characterId, createdLorebookId);
      if (res.headersSent) {
        channel.fail(`Failed to import character: ${error.message}`);
        return;
      }
      throw error instanceof AppError
        ? error
        : new AppError(`Failed to import character: ${error.message}`, 400);
    }
  }),
);

// Get character image
router.get(
  '/:characterId/image',
  asyncHandler(async (req, res) => {
    const { characterId } = req.params;
    const imageBuffer = await storage.getCharacterImage(characterId);

    if (!imageBuffer) {
      throw new AppError('Character has no image', 404);
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.send(imageBuffer);
  }),
);

// Get character thumbnail (96x96 optimized avatar)
router.get(
  '/:characterId/thumbnail',
  asyncHandler(async (req, res) => {
    const { characterId } = req.params;
    const thumbnailBuffer = await storage.getCharacterThumbnail(characterId);

    if (!thumbnailBuffer) {
      throw new AppError('Character has no thumbnail', 404);
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.send(thumbnailBuffer);
  }),
);

// Get character medium thumbnail (256x384, 2:3 — for picker cards / floating avatar)
router.get(
  '/:characterId/thumbnail-medium',
  asyncHandler(async (req, res) => {
    const { characterId } = req.params;
    const thumbnailBuffer = await storage.getCharacterThumbnailMedium(characterId);

    if (!thumbnailBuffer) {
      throw new AppError('Character has no medium thumbnail', 404);
    }

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.send(thumbnailBuffer);
  }),
);

// Get character data (JSON)
router.get(
  '/:characterId/data',
  asyncHandler(async (req, res) => {
    const { characterId } = req.params;
    const cardData = await storage.getCharacter(characterId);

    res.json({ character: cardData });
  }),
);

// Update character data
router.put(
  '/:characterId',
  asyncHandler(async (req, res) => {
    const { characterId } = req.params;
    const {
      name,
      description,
      personality,
      scenario,
      first_mes,
      mes_example,
      system_prompt,
      alternate_greetings,
      ursceal_lorebook_id,
    } = req.body;

    // Get existing character data
    const existingData = await storage.getCharacter(characterId);

    // Update fields
    if (name !== undefined) existingData.data.name = name.trim();
    if (description !== undefined) existingData.data.description = description.trim();
    if (personality !== undefined) existingData.data.personality = personality.trim();
    if (scenario !== undefined) existingData.data.scenario = scenario.trim();
    if (first_mes !== undefined) existingData.data.first_mes = first_mes.trim();
    if (mes_example !== undefined) existingData.data.mes_example = mes_example.trim();
    if (system_prompt !== undefined) existingData.data.system_prompt = system_prompt.trim();
    if (alternate_greetings !== undefined)
      existingData.data.alternate_greetings = alternate_greetings;

    // Update lorebook association
    if (ursceal_lorebook_id !== undefined) {
      if (!existingData.data.extensions) {
        existingData.data.extensions = {};
      }
      existingData.data.extensions.ursceal_lorebook_id = ursceal_lorebook_id || null;
    }

    // Cache any new external images in the updated fields, then save so the
    // rewritten local URLs are what gets persisted.
    await cacheCardImages(characterId, existingData, req.app.locals.dataRoot);

    // Save updated data (keep existing image)
    await storage.saveCharacter(characterId, existingData, null);

    res.json({
      id: characterId,
      name: existingData.data.name,
      description: existingData.data.description,
    });
  }),
);

// Update character with new image
router.put(
  '/:characterId/update-with-image',
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const { characterId } = req.params;
    const characterDataJson = req.body.characterData;

    if (!characterDataJson) {
      throw new AppError('Character data is required', 400);
    }

    let parsedData;
    try {
      parsedData = JSON.parse(characterDataJson);
    } catch (error) {
      throw new AppError('Invalid character data JSON', 400);
    }

    // Get existing character data
    const existingData = await storage.getCharacter(characterId);

    // Update fields
    const {
      name,
      description,
      personality,
      scenario,
      first_mes,
      mes_example,
      system_prompt,
      alternate_greetings,
      ursceal_lorebook_id,
    } = parsedData;

    if (name !== undefined) existingData.data.name = name.trim();
    if (description !== undefined) existingData.data.description = description.trim();
    if (personality !== undefined) existingData.data.personality = personality.trim();
    if (scenario !== undefined) existingData.data.scenario = scenario.trim();
    if (first_mes !== undefined) existingData.data.first_mes = first_mes.trim();
    if (mes_example !== undefined) existingData.data.mes_example = mes_example.trim();
    if (system_prompt !== undefined) existingData.data.system_prompt = system_prompt.trim();
    if (alternate_greetings !== undefined)
      existingData.data.alternate_greetings = alternate_greetings;

    // Update lorebook association
    if (ursceal_lorebook_id !== undefined) {
      if (!existingData.data.extensions) {
        existingData.data.extensions = {};
      }
      existingData.data.extensions.ursceal_lorebook_id = ursceal_lorebook_id || null;
    }

    // Cache any new external images in the updated fields, then save so the
    // rewritten local URLs are what gets persisted.
    await cacheCardImages(characterId, existingData, req.app.locals.dataRoot);

    // Save updated data with new image
    const imageBuffer = req.file ? req.file.buffer : null;
    await storage.saveCharacter(characterId, existingData, imageBuffer);

    const hasImage = await storage.hasCharacterImage(characterId);

    res.json({
      id: characterId,
      name: existingData.data.name,
      description: existingData.data.description,
      imageUrl: hasImage ? `/api/characters/${characterId}/image` : null,
    });
  }),
);

// Get stories that include this character
router.get(
  '/:characterId/stories',
  asyncHandler(async (req, res) => {
    const { characterId } = req.params;

    // Get all stories and filter for ones that include this character
    const allStories = await storage.listStories();
    const characterStories = allStories.filter(
      (story) =>
        story.characterIds?.includes(characterId) || story.personaCharacterId === characterId,
    );

    res.json({ stories: characterStories });
  }),
);

// A character's versions, oldest first: every change to its card is kept
router.get(
  '/:characterId/versions',
  asyncHandler(async (req, res) => {
    const { characterId } = req.params;
    const editedSinceImport = storage.characterEditedSinceImport(characterId);
    if (editedSinceImport === null) {
      throw new AppError('Character not found', 404);
    }
    res.json({ versions: storage.listCharacterVersions(characterId), editedSinceImport });
  }),
);

// Put a character's card back as it was at an earlier version, saved as a new version
router.post(
  '/:characterId/versions/:versionId/restore',
  asyncHandler(async (req, res) => {
    const { characterId } = req.params;
    const versionId = Number(req.params.versionId);
    const character = Number.isInteger(versionId)
      ? await storage.restoreCharacterVersion(characterId, versionId)
      : null;
    if (!character) {
      throw new AppError('Version not found', 404);
    }
    res.json({ character });
  }),
);

// Delete character from global library
router.delete(
  '/:characterId',
  asyncHandler(async (req, res) => {
    const { characterId } = req.params;

    // Check if character is used in any stories
    const allStories = await storage.listStories();
    const storiesUsingChar = allStories.filter(
      (story) =>
        story.characterIds?.includes(characterId) || story.personaCharacterId === characterId,
    );

    if (storiesUsingChar.length > 0) {
      const storyTitles = storiesUsingChar.map((s) => s.title).join(', ');
      throw new AppError(
        `Cannot delete character: Used in ${storiesUsingChar.length} story(ies): ${storyTitles}. Remove from stories first.`,
        409,
      );
    }

    // Work out whether this character's lorebook is about to be left behind,
    // before the character row (and its link) is gone.
    const orphanedLorebook = await findLorebookLeftBehindBy(characterId);

    await storage.deleteCharacter(characterId);

    // Clean up cached asset files
    try {
      const assetManager = new AssetManager(req.app.locals.dataRoot);
      await assetManager.deleteDir(characterId);
    } catch (error) {
      console.error(`Failed to clean up assets for character ${characterId}:`, error);
    }

    res.json({
      success: true,
      ...(orphanedLorebook ? { orphanedLorebook } : {}),
    });
  }),
);

export default router;
