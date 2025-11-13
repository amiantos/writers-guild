/**
 * Configuration Presets API Routes
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '../middleware/error-handler.js';
import { StorageService } from '../services/storage.js';
import { getDefaultPresets } from '../services/default-presets.js';
import { AIHordeProvider } from '../services/providers/aihorde-provider.js';

const router = express.Router();

// Initialize storage service
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new StorageService(req.app.locals.dataRoot);
  }
  next();
});

// List all presets
router.get('/', asyncHandler(async (req, res) => {
  const presets = await storage.listPresets();
  res.json({ presets });
}));

// Get a specific preset
router.get('/:id', asyncHandler(async (req, res) => {
  const preset = await storage.getPreset(req.params.id);
  res.json({ preset });
}));

// Create a new preset
router.post('/', asyncHandler(async (req, res) => {
  const presetId = uuidv4();
  const presetData = {
    ...req.body,
    id: presetId
  };

  // Validate required fields
  if (!presetData.name || !presetData.provider) {
    return res.status(400).json({
      error: 'Preset name and provider are required'
    });
  }

  await storage.savePreset(presetId, presetData);
  res.status(201).json({
    preset: presetData
  });
}));

// Update an existing preset
router.put('/:id', asyncHandler(async (req, res) => {
  const presetId = req.params.id;

  // Check if preset exists
  try {
    await storage.getPreset(presetId);
  } catch (error) {
    return res.status(404).json({
      error: `Preset not found: ${presetId}`
    });
  }

  const presetData = {
    ...req.body,
    id: presetId
  };

  await storage.savePreset(presetId, presetData);
  res.json({
    preset: presetData
  });
}));

// Delete a preset
router.delete('/:id', asyncHandler(async (req, res) => {
  const presetId = req.params.id;

  // Check if preset exists
  try {
    await storage.getPreset(presetId);
  } catch (error) {
    return res.status(404).json({
      error: `Preset not found: ${presetId}`
    });
  }

  await storage.deletePreset(presetId);
  res.json({
    success: true,
    message: `Preset ${presetId} deleted`
  });
}));

// Get default preset ID
router.get('/default/id', asyncHandler(async (req, res) => {
  const defaultPresetId = await storage.getDefaultPresetId();
  res.json({ defaultPresetId });
}));

// Set default preset
router.put('/default/id', asyncHandler(async (req, res) => {
  const { presetId } = req.body;

  if (!presetId) {
    return res.status(400).json({
      error: 'Preset ID is required'
    });
  }

  // Verify preset exists
  try {
    await storage.getPreset(presetId);
  } catch (error) {
    return res.status(404).json({
      error: `Preset not found: ${presetId}`
    });
  }

  await storage.setDefaultPresetId(presetId);
  res.json({
    success: true,
    defaultPresetId: presetId
  });
}));

// Initialize default presets (can be called manually or during migration)
router.post('/initialize-defaults', asyncHandler(async (req, res) => {
  const defaults = getDefaultPresets();
  const createdPresets = [];

  for (const [key, presetData] of Object.entries(defaults)) {
    const presetId = uuidv4();
    await storage.savePreset(presetId, {
      ...presetData,
      id: presetId
    });
    createdPresets.push({
      id: presetId,
      name: presetData.name,
      provider: presetData.provider
    });
  }

  res.json({
    success: true,
    presets: createdPresets
  });
}));

// Get available AI Horde models (with caching)
let hordeModelsCache = null;
let hordeCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

router.get('/aihorde/models', asyncHandler(async (req, res) => {
  const now = Date.now();

  // Return cached data if still valid
  if (hordeModelsCache && (now - hordeCacheTime) < CACHE_DURATION) {
    return res.json({
      models: hordeModelsCache,
      cached: true,
      cacheAge: Math.floor((now - hordeCacheTime) / 1000)
    });
  }

  // Fetch fresh data
  try {
    // Create temporary provider instance (API key not required for public endpoints)
    const provider = new AIHordeProvider({ apiKey: '0000000000' });
    const models = await provider.getAvailableModels();
    const autoSelected = provider.autoSelectModels(models);

    // Update cache
    hordeModelsCache = models;
    hordeCacheTime = now;

    res.json({
      models,
      autoSelected,  // Array of recommended model names
      cached: false
    });
  } catch (error) {
    console.error('Failed to fetch AI Horde models:', error);
    res.status(500).json({
      error: 'Failed to fetch models from AI Horde',
      message: error.message
    });
  }
}));

// Get AI Horde worker data (for context limit calculations)
router.get('/aihorde/workers', asyncHandler(async (req, res) => {
  try {
    const provider = new AIHordeProvider({ apiKey: '0000000000' });
    const workers = await provider.getWorkerData();

    res.json({ workers });
  } catch (error) {
    console.error('Failed to fetch AI Horde workers:', error);
    res.status(500).json({
      error: 'Failed to fetch workers from AI Horde',
      message: error.message
    });
  }
}));

export default router;
