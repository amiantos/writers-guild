/**
 * Personas API Routes
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
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

// Get current persona
router.get('/', asyncHandler(async (req, res) => {
  const persona = await storage.getPersona();
  res.json({ persona });
}));

// Update persona
router.put('/', asyncHandler(async (req, res) => {
  const { name, description, writingStyle } = req.body;

  const persona = {
    name: name?.trim() || '',
    description: description?.trim() || '',
    writingStyle: writingStyle?.trim() || '',
  };

  const saved = await storage.savePersona(persona);
  res.json({ persona: saved });
}));

export default router;
