/**
 * Characters API Routes (Global Library)
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { StorageService } from '../services/storage.js';
import { CharacterParser } from '../services/character-parser.js';
import { LorebookParser } from '../services/lorebook-parser.js';
import { ChubImporter } from '../services/chub-importer.js';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg'];
    if (!allowedTypes.includes(file.mimetype)) {
      cb(new AppError('Only PNG and JPEG images are allowed', 400));
    } else {
      cb(null, true);
    }
  },
});

// Initialize storage service
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new StorageService(req.app.locals.dataRoot);
  }
  next();
});

// ==================== Global Character Library ====================

// List all characters in global library
router.get('/', asyncHandler(async (req, res) => {
  const characters = await storage.listAllCharacters();

  // Load character data from JSON files
  const charactersWithData = await Promise.all(
    characters.map(async (char) => {
      try {
        const cardData = await storage.getCharacter(char.id);
        const hasImage = await storage.hasCharacterImage(char.id);

        return {
          id: char.id,
          name: cardData.data?.name || 'Unknown',
          description: cardData.data?.description || '',
          imageUrl: hasImage ? `/api/characters/${char.id}/image` : null,
        };
      } catch (error) {
        console.error(`Failed to load character ${char.id}:`, error);
        return {
          id: char.id,
          name: 'Unknown',
          description: 'Failed to load character data',
          imageUrl: null,
        };
      }
    })
  );

  res.json({ characters: charactersWithData });
}));

// Upload new character to global library (import PNG)
router.post('/import', upload.single('character'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const characterId = uuidv4();

  // Parse character card from PNG
  try {
    const cardData = await CharacterParser.parseCard(req.file.buffer);

    // Save character data as JSON and image separately
    await storage.saveCharacter(characterId, cardData, req.file.buffer);

    // Check for embedded lorebook (V2 character cards)
    let embeddedLorebook = null;
    if (cardData.data?.character_book && cardData.data.character_book.entries && cardData.data.character_book.entries.length > 0) {
      try {
        // Parse embedded lorebook
        const lorebookData = LorebookParser.parseEmbeddedLorebook(cardData.data.character_book);

        // Give it a name based on the character
        lorebookData.name = `${cardData.data.name}'s Lorebook`;
        lorebookData.description = lorebookData.description || `Lorebook for ${cardData.data.name}`;

        // Save to global lorebook library
        const lorebookId = uuidv4();
        await storage.saveLorebook(lorebookId, lorebookData);

        embeddedLorebook = {
          id: lorebookId,
          name: lorebookData.name,
          entryCount: lorebookData.entries.length
        };

        console.log(`Extracted embedded lorebook from ${cardData.data.name}: ${lorebookData.entries.length} entries`);
      } catch (error) {
        console.error('Failed to parse embedded lorebook:', error);
      }
    }

    res.status(201).json({
      id: characterId,
      name: cardData.data?.name || 'Unknown',
      description: cardData.data?.description || '',
      imageUrl: `/api/characters/${characterId}/image`,
      firstMessage: cardData.data?.first_mes || '',
      embeddedLorebook: embeddedLorebook // Will be null if no lorebook
    });
  } catch (error) {
    throw new AppError(`Invalid character card: ${error.message}`, 400);
  }
}));

// Create new character from scratch (no PNG import)
router.post('/', asyncHandler(async (req, res) => {
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
      creator_notes: 'Created in Úrscéal',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      character_book: null,
      tags: [],
      creator: '',
      character_version: '1.0',
      extensions: {}
    }
  };

  // Save character (no image)
  await storage.saveCharacter(characterId, characterData, null);

  res.status(201).json({
    id: characterId,
    name: characterData.data.name,
    description: characterData.data.description,
    imageUrl: null,
    firstMessage: characterData.data.first_mes,
  });
}));

// Create character with optional image
router.post('/create', upload.single('image'), asyncHandler(async (req, res) => {
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

  const { name, description, personality, scenario, first_mes, mes_example, system_prompt } = parsedData;

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
      creator_notes: 'Created in Úrscéal',
      system_prompt: system_prompt?.trim() || '',
      post_history_instructions: '',
      alternate_greetings: [],
      character_book: null,
      tags: [],
      creator: '',
      character_version: '1.0',
      extensions: {}
    }
  };

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
}));

// Import character from URL (CHUB, etc.)
router.post('/import-url', asyncHandler(async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    throw new AppError('URL is required', 400);
  }

  // Check if it's a CHUB URL
  if (!url.includes('chub.ai')) {
    throw new AppError('Only CHUB URLs are currently supported', 400);
  }

  try {
    // Import character from CHUB
    const { characterData, imageBuffer } = await ChubImporter.importFromUrl(url);

    const characterId = uuidv4();

    // Save character with image
    await storage.saveCharacter(characterId, characterData, imageBuffer);

    const hasImage = await storage.hasCharacterImage(characterId);

    res.status(201).json({
      id: characterId,
      name: characterData.data.name,
      description: characterData.data.description,
      imageUrl: hasImage ? `/api/characters/${characterId}/image` : null,
      firstMessage: characterData.data.first_mes,
    });
  } catch (error) {
    throw new AppError(`Failed to import character: ${error.message}`, 400);
  }
}));

// Get character image
router.get('/:characterId/image', asyncHandler(async (req, res) => {
  const { characterId } = req.params;
  const imageBuffer = await storage.getCharacterImage(characterId);

  if (!imageBuffer) {
    throw new AppError('Character has no image', 404);
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
  res.send(imageBuffer);
}));

// Get character data (JSON)
router.get('/:characterId/data', asyncHandler(async (req, res) => {
  const { characterId } = req.params;
  const cardData = await storage.getCharacter(characterId);

  res.json({ character: cardData });
}));

// Update character data
router.put('/:characterId', asyncHandler(async (req, res) => {
  const { characterId } = req.params;
  const { name, description, personality, scenario, first_mes, mes_example, system_prompt } = req.body;

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

  // Save updated data (keep existing image)
  await storage.saveCharacter(characterId, existingData, null);

  res.json({
    id: characterId,
    name: existingData.data.name,
    description: existingData.data.description,
  });
}));

// Update character with new image
router.put('/:characterId/update-with-image', upload.single('image'), asyncHandler(async (req, res) => {
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
  const { name, description, personality, scenario, first_mes, mes_example, system_prompt } = parsedData;

  if (name !== undefined) existingData.data.name = name.trim();
  if (description !== undefined) existingData.data.description = description.trim();
  if (personality !== undefined) existingData.data.personality = personality.trim();
  if (scenario !== undefined) existingData.data.scenario = scenario.trim();
  if (first_mes !== undefined) existingData.data.first_mes = first_mes.trim();
  if (mes_example !== undefined) existingData.data.mes_example = mes_example.trim();
  if (system_prompt !== undefined) existingData.data.system_prompt = system_prompt.trim();

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
}));

// Delete character from global library
router.delete('/:characterId', asyncHandler(async (req, res) => {
  const { characterId } = req.params;

  // Check if character is used in any stories
  const allStories = await storage.listStories();
  const storiesUsingChar = allStories.filter(story =>
    story.characterIds?.includes(characterId) ||
    story.personaCharacterId === characterId
  );

  if (storiesUsingChar.length > 0) {
    const storyTitles = storiesUsingChar.map(s => s.title).join(', ');
    throw new AppError(
      `Cannot delete character: Used in ${storiesUsingChar.length} story(ies): ${storyTitles}. Remove from stories first.`,
      409
    );
  }

  await storage.deleteCharacter(characterId);
  res.json({ success: true });
}));

export default router;
