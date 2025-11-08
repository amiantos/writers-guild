/**
 * Settings API Routes
 */

import express from 'express';
import { asyncHandler } from '../middleware/error-handler.js';
import { StorageService } from '../services/storage.js';

const router = express.Router();

// Initialize storage service
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new StorageService(req.app.locals.dataRoot);
  }
  next();
});

// Get all settings
router.get('/', asyncHandler(async (req, res) => {
  const settings = await storage.getSettings();
  res.json({ settings });
}));

// Update settings
router.put('/', asyncHandler(async (req, res) => {
  const {
    apiKey,
    maxTokens,
    showReasoning,
    autoSave,
    showPrompt,
    thirdPerson,
    filterAsterisks,
  } = req.body;

  // Get current settings
  const current = await storage.getSettings() || {};

  // Merge with updates
  const updated = {
    ...current,
    ...(apiKey !== undefined && { apiKey }),
    ...(maxTokens !== undefined && { maxTokens: parseInt(maxTokens) || 4000 }),
    ...(showReasoning !== undefined && { showReasoning: Boolean(showReasoning) }),
    ...(autoSave !== undefined && { autoSave: Boolean(autoSave) }),
    ...(showPrompt !== undefined && { showPrompt: Boolean(showPrompt) }),
    ...(thirdPerson !== undefined && { thirdPerson: Boolean(thirdPerson) }),
    ...(filterAsterisks !== undefined && { filterAsterisks: Boolean(filterAsterisks) }),
  };

  const saved = await storage.saveSettings(updated);
  res.json({ settings: saved });
}));

export default router;
