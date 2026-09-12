/**
 * Bureau Memory Routes
 *
 * Mounted at /api/bureaus/:bureauId. The memory browser lists, searches, and
 * corrects a character's memories here; the Archivist records them (see
 * services/bureau/archivist.js).
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { DEFAULT_IMPORTANCE, MEMORY_STATUSES } from '../services/bureau/memory-storage.js';
import { optionalString, requireBureau } from './bureau-route-helpers.js';

const router = express.Router({ mergeParams: true });

function requireCastMember(bureaus, bureauId, castId) {
  const member = bureaus.getCastMember(bureauId, castId);
  if (!member) {
    throw new AppError('Cast member not found', 404);
  }
  return member;
}

function memoryIdFrom(params) {
  const id = Number(params.memoryId);
  if (!Number.isInteger(id) || id < 1) {
    throw new AppError('Memory not found', 404);
  }
  return id;
}

function optionalBoolean(body, field) {
  const value = body[field];
  if (value !== undefined && typeof value !== 'boolean') {
    throw new AppError(`${field} must be a boolean`, 400);
  }
  return value;
}

function optionalImportance(body) {
  const value = body.importance;
  if (value !== undefined && !(Number.isInteger(value) && value >= 1 && value <= 5)) {
    throw new AppError('importance must be a whole number from 1 to 5', 400);
  }
  return value;
}

// List a character's memories (status 'current' or 'retired'), or search them all with q
router.get(
  '/cast/:castId/memories',
  asyncHandler(async (req, res) => {
    const { bureaus, memories } = res.locals.stores;
    const { bureauId, castId } = req.params;
    requireBureau(bureaus, bureauId);
    requireCastMember(bureaus, bureauId, castId);

    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (query) {
      res.json({ memories: memories.searchMemories(bureauId, castId, query) });
      return;
    }

    const status = req.query.status ?? 'current';
    if (!MEMORY_STATUSES.includes(status)) {
      throw new AppError(`status must be one of: ${MEMORY_STATUSES.join(', ')}`, 400);
    }
    res.json({ memories: memories.listMemories(bureauId, castId, { status }) });
  }),
);

// Write something a character knows, such as backstory from before the first story
router.post(
  '/cast/:castId/memories',
  asyncHandler(async (req, res) => {
    const { bureaus, memories } = res.locals.stores;
    const { bureauId, castId } = req.params;
    requireBureau(bureaus, bureauId);
    const member = requireCastMember(bureaus, bureauId, castId);
    if (member.isPersona) {
      throw new AppError("The reader's character doesn't keep memories", 400);
    }

    const body = req.body ?? {};
    const content = optionalString(body, 'content');
    if (!content) {
      throw new AppError('content is required', 400);
    }

    const memory = memories.addMemory(bureauId, castId, {
      layer: 'knowledge',
      content,
      importance: optionalImportance(body) ?? DEFAULT_IMPORTANCE,
      pinned: optionalBoolean(body, 'pinned') ?? false,
    });
    res.status(201).json({ memory });
  }),
);

// Edit, pin, retire, or restore a memory, or mark it reviewed
router.put(
  '/memories/:memoryId',
  asyncHandler(async (req, res) => {
    const { bureaus, memories } = res.locals.stores;
    const { bureauId } = req.params;
    requireBureau(bureaus, bureauId);
    const memoryId = memoryIdFrom(req.params);

    const body = req.body ?? {};
    const content = optionalString(body, 'content');
    if (content === '') {
      throw new AppError('content cannot be empty', 400);
    }
    const updates = {
      content,
      importance: optionalImportance(body),
      pinned: optionalBoolean(body, 'pinned'),
      retired: optionalBoolean(body, 'retired'),
      needsReview: optionalBoolean(body, 'needsReview'),
    };
    if (Object.values(updates).every((value) => value === undefined)) {
      throw new AppError('No updates provided', 400);
    }

    const memory = memories.updateMemory(bureauId, memoryId, updates);
    if (!memory) {
      throw new AppError('Memory not found', 404);
    }
    res.json({ memory });
  }),
);

// Delete a memory; any memory it had replaced becomes current again
router.delete(
  '/memories/:memoryId',
  asyncHandler(async (req, res) => {
    const { bureaus, memories } = res.locals.stores;
    const { bureauId } = req.params;
    requireBureau(bureaus, bureauId);

    if (!memories.deleteMemory(bureauId, memoryIdFrom(req.params))) {
      throw new AppError('Memory not found', 404);
    }
    res.json({ success: true });
  }),
);

export default router;
