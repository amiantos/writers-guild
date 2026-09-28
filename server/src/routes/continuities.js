/**
 * Continuities API Routes
 *
 * The experimental Continuities: text the reader writes once and shares
 * between stories and chats, put ahead of each one's own scenario in the
 * prompt (see services/continuity/continuity-storage.js). Every route answers
 * 404 while the experimental toggle is off.
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';
import { ContinuityStorage } from '../services/continuity/continuity-storage.js';

const router = express.Router();

export const MAX_CONTINUITY_NAME_CHARACTERS = 200;
export const MAX_CONTINUITY_CHARACTERS = 20000;

let storage;
let continuities;

router.use((req, res, next) => {
  if (!storage) {
    storage = new SqliteStorageService(req.app.locals.dataRoot);
    continuities = new ContinuityStorage(storage.db);
  }
  next();
});

router.use(
  asyncHandler(async (req, res, next) => {
    const settings = await storage.getSettings();
    if (!settings?.experimentalContinuity) {
      throw new AppError('Continuities are turned off', 404);
    }
    next();
  }),
);

// ==================== Helpers ====================

function requireContinuity(id) {
  const continuity = continuities.get(id);
  if (!continuity) throw new AppError('Continuity not found', 404);
  return continuity;
}

/** A string field from a request body, trimmed and checked; undefined when not given. */
function optionalText(body, field, max) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new AppError(`${field} must be a string`, 400);
  const text = value.trim();
  if (text.length > max) throw new AppError(`${field} must be at most ${max} characters`, 400);
  return text;
}

function continuityFields(body) {
  const name = optionalText(body, 'name', MAX_CONTINUITY_NAME_CHARACTERS);
  if (name === '') throw new AppError('name is required', 400);
  return { name, content: optionalText(body, 'content', MAX_CONTINUITY_CHARACTERS) };
}

// ==================== Routes ====================

// Every Continuity, with how many stories and chats are in each
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ continuities: continuities.list() });
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, content } = continuityFields(req.body ?? {});
    if (!name) throw new AppError('name is required', 400);
    res.status(201).json({ continuity: continuities.create({ name, content: content ?? '' }) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ continuity: requireContinuity(req.params.id) });
  }),
);

// Rename a Continuity or change its text; a change to the text is kept as a new version
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    requireContinuity(req.params.id);
    const fields = continuityFields(req.body ?? {});
    res.json({ continuity: continuities.update(req.params.id, fields) });
  }),
);

// Delete a Continuity; its stories and chats stay, in no Continuity
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!continuities.delete(req.params.id)) {
      throw new AppError('Continuity not found', 404);
    }
    res.json({ success: true });
  }),
);

// Every version of a Continuity's text, oldest first
router.get(
  '/:id/versions',
  asyncHandler(async (req, res) => {
    requireContinuity(req.params.id);
    res.json({ versions: continuities.listVersions(req.params.id) });
  }),
);

// Put a Continuity's text back as it was at an earlier version
router.post(
  '/:id/versions/:versionId/restore',
  asyncHandler(async (req, res) => {
    requireContinuity(req.params.id);
    const continuity = continuities.restoreVersion(req.params.id, Number(req.params.versionId));
    if (!continuity) throw new AppError('Version not found', 404);
    res.json({ continuity });
  }),
);

export default router;
