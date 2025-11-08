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

export default router;
