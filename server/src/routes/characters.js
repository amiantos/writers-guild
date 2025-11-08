/**
 * Characters API Routes
 */

import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { StorageService } from '../services/storage.js';
import { CharacterParser } from '../services/character-parser.js';

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'image/png') {
      cb(new AppError('Only PNG files are allowed', 400));
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

// Get all characters for a story
router.get('/story/:storyId', asyncHandler(async (req, res) => {
  const characters = await storage.listStoryCharacters(req.params.storyId);

  // Parse character data from PNGs
  const charactersWithData = await Promise.all(
    characters.map(async (char) => {
      try {
        const pngBuffer = await storage.getCharacter(req.params.storyId, char.id);
        const cardData = await CharacterParser.parseCard(pngBuffer);
        return {
          id: char.id,
          storyId: char.storyId,
          name: cardData.data?.name || 'Unknown',
          description: cardData.data?.description || '',
          imageUrl: `/api/characters/${char.storyId}/${char.id}/image`,
        };
      } catch (error) {
        console.error(`Failed to parse character ${char.id}:`, error);
        return {
          id: char.id,
          storyId: char.storyId,
          name: 'Unknown',
          description: 'Failed to parse character data',
          imageUrl: null,
        };
      }
    })
  );

  res.json({ characters: charactersWithData });
}));

// Upload character PNG to a story
router.post('/story/:storyId', upload.single('character'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const { storyId } = req.params;
  const characterId = uuidv4();

  // Parse character card to validate
  try {
    const cardData = await CharacterParser.parseCard(req.file.buffer);

    // Save character PNG
    await storage.saveCharacter(storyId, characterId, req.file.buffer);

    res.status(201).json({
      id: characterId,
      storyId,
      name: cardData.data?.name || 'Unknown',
      description: cardData.data?.description || '',
      imageUrl: `/api/characters/${storyId}/${characterId}/image`,
      firstMessage: cardData.data?.first_mes || '',
    });
  } catch (error) {
    throw new AppError(`Invalid character card: ${error.message}`, 400);
  }
}));

// Get character image (returns PNG image for display)
router.get('/:storyId/:characterId/image', asyncHandler(async (req, res) => {
  const { storyId, characterId } = req.params;
  const pngBuffer = await storage.getCharacter(storyId, characterId);

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
  res.send(pngBuffer);
}));

// Get character by ID (returns PNG file for download)
router.get('/:storyId/:characterId', asyncHandler(async (req, res) => {
  const { storyId, characterId } = req.params;
  const pngBuffer = await storage.getCharacter(storyId, characterId);

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Disposition', `attachment; filename="${characterId}.png"`);
  res.send(pngBuffer);
}));

// Get character data (parsed JSON)
router.get('/:storyId/:characterId/data', asyncHandler(async (req, res) => {
  const { storyId, characterId } = req.params;
  const pngBuffer = await storage.getCharacter(storyId, characterId);
  const cardData = await CharacterParser.parseCard(pngBuffer);

  res.json({ character: cardData });
}));

// Update character (re-upload PNG)
router.put('/:storyId/:characterId', upload.single('character'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new AppError('No file uploaded', 400);
  }

  const { storyId, characterId } = req.params;

  // Parse and validate
  try {
    const cardData = await CharacterParser.parseCard(req.file.buffer);

    // Save updated character PNG
    await storage.saveCharacter(storyId, characterId, req.file.buffer);

    res.json({
      id: characterId,
      storyId,
      name: cardData.data?.name || 'Unknown',
      description: cardData.data?.description || '',
    });
  } catch (error) {
    throw new AppError(`Invalid character card: ${error.message}`, 400);
  }
}));

// Delete character
router.delete('/:storyId/:characterId', asyncHandler(async (req, res) => {
  const { storyId, characterId } = req.params;
  await storage.deleteCharacter(storyId, characterId);
  res.json({ success: true });
}));

export default router;
