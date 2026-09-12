/**
 * Bureau API Routes
 *
 * Bureau is an experimental mode with its own database; see
 * docs/bureau-design.md. API keys are write-only through this API: responses
 * carry a masked preview, never the key itself.
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { BureauStorage, CastConflictError } from '../services/bureau/bureau-storage.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';

const router = express.Router();

// Stores are cached per data root: production mounts this router once, but
// each test suite mounts it against its own temporary directory.
const storesByRoot = new Map();

router.use((req, res, next) => {
  const { dataRoot } = req.app.locals;
  if (!storesByRoot.has(dataRoot)) {
    storesByRoot.set(dataRoot, {
      bureaus: new BureauStorage(dataRoot),
      library: new SqliteStorageService(dataRoot),
    });
  }
  res.locals.stores = storesByRoot.get(dataRoot);
  next();
});

function requireBureau(bureaus, bureauId) {
  const bureau = bureaus.getBureau(bureauId);
  if (!bureau) {
    throw new AppError('Bureau not found', 404);
  }
  return bureau;
}

/** A trimmed string field from the body, or undefined when it's absent. */
function optionalString(body, field) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new AppError(`${field} must be a string`, 400);
  }
  return value.trim();
}

// ==================== Bureaus ====================

// List Bureaus
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ bureaus: res.locals.stores.bureaus.listBureaus() });
  }),
);

// Create a Bureau
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const name = optionalString(body, 'name');
    if (!name) {
      throw new AppError('Name is required', 400);
    }
    const model = optionalString(body, 'model');

    const bureau = res.locals.stores.bureaus.createBureau({
      name,
      description: optionalString(body, 'description') ?? '',
      apiKey: optionalString(body, 'apiKey') ?? '',
      ...(model ? { model } : {}),
    });
    res.status(201).json({ bureau });
  }),
);

// Get a Bureau
router.get(
  '/:bureauId',
  asyncHandler(async (req, res) => {
    res.json({ bureau: requireBureau(res.locals.stores.bureaus, req.params.bureauId) });
  }),
);

// Update a Bureau. An apiKey of '' removes the key.
router.put(
  '/:bureauId',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    const { bureauId } = req.params;
    requireBureau(bureaus, bureauId);

    const body = req.body ?? {};
    const updates = {
      name: optionalString(body, 'name'),
      description: optionalString(body, 'description'),
      apiKey: optionalString(body, 'apiKey'),
      model: optionalString(body, 'model'),
      houseStyle: optionalString(body, 'houseStyle'),
    };

    if (Object.values(updates).every((value) => value === undefined)) {
      throw new AppError('No updates provided', 400);
    }
    if (updates.name === '') {
      throw new AppError('Name cannot be empty', 400);
    }
    if (updates.model === '') {
      throw new AppError('Model cannot be empty', 400);
    }

    res.json({ bureau: bureaus.updateBureau(bureauId, updates) });
  }),
);

// Delete a Bureau, with its cast and run records
router.delete(
  '/:bureauId',
  asyncHandler(async (req, res) => {
    if (!res.locals.stores.bureaus.deleteBureau(req.params.bureauId)) {
      throw new AppError('Bureau not found', 404);
    }
    res.json({ success: true });
  }),
);

// ==================== Cast ====================

// List cast members (without seed cards)
router.get(
  '/:bureauId/cast',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    requireBureau(bureaus, req.params.bureauId);
    res.json({ cast: bureaus.listCast(req.params.bureauId) });
  }),
);

// Add a library character to the cast. The Bureau keeps its own copy of the
// card; the library character is never modified.
router.post(
  '/:bureauId/cast',
  asyncHandler(async (req, res) => {
    const { bureaus, library } = res.locals.stores;
    const { bureauId } = req.params;
    requireBureau(bureaus, bureauId);

    const { characterId, isPersona = false } = req.body ?? {};
    if (!characterId || typeof characterId !== 'string') {
      throw new AppError('characterId is required', 400);
    }
    if (typeof isPersona !== 'boolean') {
      throw new AppError('isPersona must be a boolean', 400);
    }

    let card;
    try {
      card = await library.getCharacter(characterId);
    } catch (error) {
      if (error.message.startsWith('Character not found')) {
        throw new AppError('Character not found', 404);
      }
      throw error;
    }

    try {
      const castMember = bureaus.addCastMember(bureauId, {
        seedCard: card,
        libraryCharacterId: characterId,
        isPersona,
      });
      res.status(201).json({ castMember });
    } catch (error) {
      if (!(error instanceof CastConflictError)) throw error;
      // Answered here rather than through AppError details: server.js's error
      // handler drops details, and the client needs the existing member's id.
      res.status(409).json({ error: error.message, castMemberId: error.castMemberId });
    }
  }),
);

// Get a cast member, including its seed card
router.get(
  '/:bureauId/cast/:castId',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    const { bureauId, castId } = req.params;
    requireBureau(bureaus, bureauId);

    const castMember = bureaus.getCastMember(bureauId, castId);
    if (!castMember) {
      throw new AppError('Cast member not found', 404);
    }
    res.json({ castMember });
  }),
);

// Update a cast member
router.put(
  '/:bureauId/cast/:castId',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    const { bureauId, castId } = req.params;
    requireBureau(bureaus, bureauId);

    const { isPersona } = req.body ?? {};
    if (typeof isPersona !== 'boolean') {
      throw new AppError('isPersona must be a boolean', 400);
    }

    const castMember = bureaus.updateCastMember(bureauId, castId, { isPersona });
    if (!castMember) {
      throw new AppError('Cast member not found', 404);
    }
    res.json({ castMember });
  }),
);

// Remove a cast member (the library character is unaffected)
router.delete(
  '/:bureauId/cast/:castId',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    const { bureauId, castId } = req.params;
    requireBureau(bureaus, bureauId);

    if (!bureaus.removeCastMember(bureauId, castId)) {
      throw new AppError('Cast member not found', 404);
    }
    res.json({ success: true });
  }),
);

// ==================== Run records ====================

// List runs, newest first
router.get(
  '/:bureauId/runs',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    requireBureau(bureaus, req.params.bureauId);

    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isNaN(requested) ? 50 : Math.min(Math.max(requested, 1), 200);
    res.json({ runs: bureaus.listRuns(req.params.bureauId, { limit }) });
  }),
);

// Get a run with its steps
router.get(
  '/:bureauId/runs/:runId',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    const { bureauId, runId } = req.params;
    requireBureau(bureaus, bureauId);

    const run = bureaus.getRun(bureauId, runId);
    if (!run) {
      throw new AppError('Run not found', 404);
    }
    res.json({ run });
  }),
);

export default router;
