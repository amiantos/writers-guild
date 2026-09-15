/**
 * Bureau Fact Routes
 *
 * Mounted at /api/bureaus/:bureauId. The World section lists a Bureau's established facts here,
 * adds the reader's own, and reviews the ones the Archivist proposes (see
 * services/bureau/fact-storage.js).
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { FACT_STATUSES } from '../services/bureau/fact-storage.js';
import { optionalString, requireBureau } from './bureau-route-helpers.js';

const router = express.Router({ mergeParams: true });

function factIdFrom(params) {
  const id = Number(params.factId);
  if (!Number.isInteger(id) || id < 1) {
    throw new AppError('Fact not found', 404);
  }
  return id;
}

function requireStatus(status) {
  if (status !== undefined && !FACT_STATUSES.includes(status)) {
    throw new AppError(`status must be one of: ${FACT_STATUSES.join(', ')}`, 400);
  }
  return status;
}

// List the Bureau's facts, oldest first, optionally with one status
router.get(
  '/facts',
  asyncHandler(async (req, res) => {
    const { bureaus, facts } = res.locals.stores;
    const { bureauId } = req.params;
    requireBureau(bureaus, bureauId);

    const status = requireStatus(req.query.status);
    res.json({ facts: facts.listFacts(bureauId, { status }) });
  }),
);

// Write a fact. A fact the reader writes is accepted as written.
router.post(
  '/facts',
  asyncHandler(async (req, res) => {
    const { bureaus, facts } = res.locals.stores;
    const { bureauId } = req.params;
    requireBureau(bureaus, bureauId);

    const content = optionalString(req.body ?? {}, 'content');
    if (!content) {
      throw new AppError('content is required', 400);
    }
    res.status(201).json({ fact: facts.addFact(bureauId, { content, status: 'accepted' }) });
  }),
);

// Accept, reject, or edit a fact, or mark it reviewed
router.put(
  '/facts/:factId',
  asyncHandler(async (req, res) => {
    const { bureaus, facts } = res.locals.stores;
    const { bureauId } = req.params;
    requireBureau(bureaus, bureauId);
    const factId = factIdFrom(req.params);

    const body = req.body ?? {};
    const content = optionalString(body, 'content');
    if (content === '') {
      throw new AppError('content cannot be empty', 400);
    }
    const status = requireStatus(body.status);
    const { needsReview } = body;
    if (needsReview !== undefined && typeof needsReview !== 'boolean') {
      throw new AppError('needsReview must be a boolean', 400);
    }
    if (content === undefined && status === undefined && needsReview === undefined) {
      throw new AppError('No updates provided', 400);
    }

    const fact = facts.updateFact(bureauId, factId, { content, status, needsReview });
    if (!fact) {
      throw new AppError('Fact not found', 404);
    }
    res.json({ fact });
  }),
);

// Delete a fact; any fact it had replaced stands again
router.delete(
  '/facts/:factId',
  asyncHandler(async (req, res) => {
    const { bureaus, facts } = res.locals.stores;
    const { bureauId } = req.params;
    requireBureau(bureaus, bureauId);

    if (!facts.deleteFact(bureauId, factIdFrom(req.params))) {
      throw new AppError('Fact not found', 404);
    }
    res.json({ success: true });
  }),
);

export default router;
