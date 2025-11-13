/**
 * Configuration Presets API Routes
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '../middleware/error-handler.js';
import { StorageService } from '../services/storage.js';
import { getDefaultPresets } from '../services/default-presets.js';

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

export default router;
