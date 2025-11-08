/**
 * Stories API Routes
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { StorageService } from '../services/storage.js';

const router = express.Router();

// Initialize storage service (will be set in server.js)
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new StorageService(req.app.locals.dataRoot);
  }
  next();
});

// List all stories
router.get('/', asyncHandler(async (req, res) => {
  const stories = await storage.listStories();
  res.json({ stories });
}));

// Create new story
router.post('/', asyncHandler(async (req, res) => {
  const { title, description } = req.body;

  if (!title || !title.trim()) {
    throw new AppError('Title is required', 400);
  }

  const story = await storage.createStory(title.trim(), description?.trim() || '');
  res.status(201).json({ story });
}));

// Get story by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const story = await storage.getStory(req.params.id);
  res.json({ story });
}));

// Update story metadata
router.put('/:id', asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  const updates = {};

  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description.trim();

  if (Object.keys(updates).length === 0) {
    throw new AppError('No updates provided', 400);
  }

  const story = await storage.updateStoryMetadata(req.params.id, updates);
  res.json({ story });
}));

// Update story content
router.put('/:id/content', asyncHandler(async (req, res) => {
  const { content } = req.body;

  if (content === undefined) {
    throw new AppError('Content is required', 400);
  }

  const result = await storage.updateStoryContent(req.params.id, content);
  res.json(result);
}));

// Delete story
router.delete('/:id', asyncHandler(async (req, res) => {
  await storage.deleteStory(req.params.id);
  res.json({ success: true });
}));

// ==================== Story-Character Associations ====================

// Get characters for this story
router.get('/:id/characters', asyncHandler(async (req, res) => {
  const characters = await storage.listStoryCharacters(req.params.id);

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
          description: 'Failed to load',
          imageUrl: null,
        };
      }
    })
  );

  res.json({ characters: charactersWithData });
}));

// Add existing character to story
router.post('/:id/characters', asyncHandler(async (req, res) => {
  const { characterId } = req.body;

  if (!characterId) {
    throw new AppError('Character ID is required', 400);
  }

  await storage.addCharacterToStory(req.params.id, characterId);
  res.json({ success: true });
}));

// Remove character from story (doesn't delete character)
router.delete('/:id/characters/:characterId', asyncHandler(async (req, res) => {
  const { id: storyId, characterId } = req.params;
  await storage.removeCharacterFromStory(storyId, characterId);
  res.json({ success: true });
}));

// Set story persona (use a character as persona)
router.put('/:id/persona', asyncHandler(async (req, res) => {
  const { characterId } = req.body; // Can be null to unset

  await storage.setStoryPersona(req.params.id, characterId);
  res.json({ success: true });
}));

export default router;

