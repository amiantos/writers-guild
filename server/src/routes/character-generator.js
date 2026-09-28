/**
 * Character Generator API Routes
 *
 * The character generator for the library: it writes a card from
 * an idea with a preset, and saves the card once the reader has looked it over
 * (see services/character-generator.js).
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';
import {
  MAX_IDEA_CHARACTERS,
  cardToSave,
  generateLibraryCharacter,
  lorebookWorld,
} from '../services/character-generator.js';
import { getProvider } from '../services/provider-factory.js';

const router = express.Router();

let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new SqliteStorageService(req.app.locals.dataRoot);
  }
  next();
});

function bodyString(body, field) {
  const value = body?.[field];
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new AppError(`${field} must be a string`, 400);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_IDEA_CHARACTERS) {
    throw new AppError(`${field} must be at most ${MAX_IDEA_CHARACTERS} characters`, 400);
  }
  return trimmed;
}

async function providerFor(presetId) {
  const id = presetId || (await storage.getDefaultPresetId());
  if (!id) {
    throw new AppError('No configuration preset found. Please configure a preset first.', 400);
  }
  let preset;
  try {
    preset = await storage.getPreset(id);
  } catch (error) {
    throw new AppError(`Failed to load configuration preset: ${error.message}`, 400);
  }
  try {
    return { preset, provider: getProvider(preset) };
  } catch (error) {
    throw new AppError(`Failed to initialize provider: ${error.message}`, 400);
  }
}

// Generate a character card from an idea, without saving it
router.post(
  '/generate',
  asyncHandler(async (req, res) => {
    const idea = bodyString(req.body, 'idea');
    if (!idea) {
      throw new AppError('idea is required', 400);
    }
    const name = bodyString(req.body, 'name');
    const lorebookId = bodyString(req.body, 'lorebookId');
    let world = [];
    if (lorebookId) {
      try {
        world = lorebookWorld(await storage.getLorebook(lorebookId));
      } catch {
        throw new AppError('Lorebook not found', 404);
      }
    }
    const { preset, provider } = await providerFor(bodyString(req.body, 'presetId'));

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });
    let card;
    try {
      card = await generateLibraryCharacter({
        provider,
        preset,
        idea,
        name,
        world,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      throw new AppError(error.message || 'The character generator failed', 502);
    }
    if (controller.signal.aborted) return;
    res.json({ card });
  }),
);

// Save a generated card, as the reader edited it, to the library as a new character
router.post(
  '/save',
  asyncHandler(async (req, res) => {
    let card;
    try {
      card = cardToSave(req.body?.card);
    } catch (error) {
      throw new AppError(error.message, 400);
    }
    const characterId = uuidv4();
    await storage.saveCharacter(characterId, card, null);
    res.status(201).json({
      id: characterId,
      name: card.data.name,
      description: card.data.description,
      imageUrl: null,
      firstMessage: card.data.first_mes,
    });
  }),
);

export default router;
