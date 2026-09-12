/**
 * Bureau API Routes
 *
 * Bureau is an experimental mode with its own database; see
 * docs/bureau-design.md. API keys are write-only through this API: responses
 * carry a masked preview, never the key itself.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { CastConflictError } from '../services/bureau/bureau-storage.js';
import { BureauSettingsError, DEFAULT_SETTINGS } from '../services/bureau/bureau-settings.js';
import { isValidTimeZone } from '../services/bureau/bureau-time.js';
import { DEFAULT_MODEL } from '../services/bureau/deepseek-client.js';
import { exportedCard } from '../services/bureau/character-export.js';
import { DEFAULT_HOUSE_STYLE } from '../services/bureau/writer-prompt.js';
import bureauMemoriesRouter from './bureau-memories.js';
import bureauStoriesRouter from './bureau-stories.js';
import { attachBureauStores, optionalString, requireBureau } from './bureau-route-helpers.js';

const router = express.Router();

router.use(attachBureauStores);

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

// Defaults a Bureau starts with, so the settings page can show them
router.get(
  '/defaults',
  asyncHandler(async (req, res) => {
    res.json({ houseStyle: DEFAULT_HOUSE_STYLE, settings: DEFAULT_SETTINGS, model: DEFAULT_MODEL });
  }),
);

// Get a Bureau
router.get(
  '/:bureauId',
  asyncHandler(async (req, res) => {
    res.json({ bureau: requireBureau(res.locals.stores.bureaus, req.params.bureauId) });
  }),
);

// Update a Bureau. An apiKey of '' removes the key; a timezone of null clears it.
// `settings` is a partial update, such as { writer: { thinking: true } }.
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
      timezone: body.timezone,
    };

    if (Object.values(updates).every((value) => value === undefined) && !body.settings) {
      throw new AppError('No updates provided', 400);
    }
    if (updates.name === '') {
      throw new AppError('Name cannot be empty', 400);
    }
    if (updates.model === '') {
      throw new AppError('Model cannot be empty', 400);
    }
    if (updates.timezone !== undefined && updates.timezone !== null) {
      if (!isValidTimeZone(updates.timezone)) {
        throw new AppError('timezone must be an IANA time zone name, or null', 400);
      }
    }

    let bureau;
    try {
      // One transaction, so invalid settings don't leave the other fields half-saved.
      bureaus.db.transaction(() => {
        bureau = bureaus.updateBureau(bureauId, updates);
        if (body.settings !== undefined) {
          bureau = bureaus.updateSettings(bureauId, body.settings);
        }
      })();
    } catch (error) {
      if (error instanceof BureauSettingsError) {
        throw new AppError(error.message, 400);
      }
      throw error;
    }
    res.json({ bureau });
  }),
);

// Delete a Bureau, with everything in it
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

// List cast members (without seed cards), with how many current memories each has,
// how many of those need review, and how many arc notes are waiting for review
router.get(
  '/:bureauId/cast',
  asyncHandler(async (req, res) => {
    const { bureaus, memories, arcNotes } = res.locals.stores;
    const { bureauId } = req.params;
    requireBureau(bureaus, bureauId);
    res.json({
      cast: bureaus.listCast(bureauId),
      memoryCounts: memories.countsByCast(bureauId),
      arcNoteCounts: arcNotes.proposedCountsByCast(bureauId),
    });
  }),
);

// Add a library character to the cast. The Bureau keeps its own copy of the
// card; the library character is never modified. A lorebook linked to the card
// is attached to the Bureau, as story mode does for stories.
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

    let castMember;
    try {
      castMember = bureaus.addCastMember(bureauId, {
        seedCard: card,
        libraryCharacterId: characterId,
        isPersona,
      });
    } catch (error) {
      if (!(error instanceof CastConflictError)) throw error;
      // Answered here rather than through AppError details: server.js's error
      // handler drops details, and the client needs the existing member's id.
      res.status(409).json({ error: error.message, castMemberId: error.castMemberId });
      return;
    }

    let attachedLorebookId = null;
    const linkedLorebookId = card.data?.extensions?.ursceal_lorebook_id;
    if (linkedLorebookId) {
      try {
        await library.getLorebook(linkedLorebookId);
        if (bureaus.attachLorebook(bureauId, linkedLorebookId)) {
          attachedLorebookId = linkedLorebookId;
        }
      } catch {
        // The card links a lorebook that is no longer in the library.
      }
    }

    res.status(201).json({ castMember, attachedLorebookId });
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

// Export a cast member to the library as a new character: a copy of their seed card with
// how they've changed, from accepted arc notes, and the original's portrait. Neither the
// seed card nor the library character it came from changes.
router.post(
  '/:bureauId/cast/:castId/export',
  asyncHandler(async (req, res) => {
    const { bureaus, arcNotes, library } = res.locals.stores;
    const { bureauId, castId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    const member = bureaus.getCastMember(bureauId, castId);
    if (!member) {
      throw new AppError('Cast member not found', 404);
    }

    const notes = arcNotes.listNotes(bureauId, castId, { status: 'accepted' });
    const card = exportedCard(member, notes, { bureauName: bureau.name });
    let image = null;
    if (member.libraryCharacterId) {
      try {
        image = await library.getCharacterImage(member.libraryCharacterId);
      } catch {
        // The library character is gone; export without a portrait.
      }
    }

    const characterId = uuidv4();
    await library.saveCharacter(characterId, card, image);
    res.status(201).json({ characterId, name: card.data.name, arcNotes: notes.length });
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

// ==================== World ====================

/** Attached lorebooks with their library details; ones deleted from the library are marked missing. */
async function attachedLorebooks({ bureaus, library }, bureauId) {
  const available = new Map(
    (await library.listAllLorebooks()).map((lorebook) => [lorebook.id, lorebook]),
  );
  return bureaus
    .listLorebookIds(bureauId)
    .map((id) =>
      available.has(id)
        ? { ...available.get(id), missing: false }
        : { id, name: null, description: '', entryCount: 0, missing: true },
    );
}

// List attached lorebooks
router.get(
  '/:bureauId/lorebooks',
  asyncHandler(async (req, res) => {
    const { stores } = res.locals;
    requireBureau(stores.bureaus, req.params.bureauId);
    res.json({ lorebooks: await attachedLorebooks(stores, req.params.bureauId) });
  }),
);

// Attach a library lorebook
router.post(
  '/:bureauId/lorebooks',
  asyncHandler(async (req, res) => {
    const { stores } = res.locals;
    const { bureauId } = req.params;
    requireBureau(stores.bureaus, bureauId);

    const { lorebookId } = req.body ?? {};
    if (!lorebookId || typeof lorebookId !== 'string') {
      throw new AppError('lorebookId is required', 400);
    }
    try {
      await stores.library.getLorebook(lorebookId);
    } catch (error) {
      if (error.message.startsWith('Lorebook not found')) {
        throw new AppError('Lorebook not found', 404);
      }
      throw error;
    }

    stores.bureaus.attachLorebook(bureauId, lorebookId);
    res.status(201).json({ lorebooks: await attachedLorebooks(stores, bureauId) });
  }),
);

// Detach a lorebook (the library lorebook is unaffected)
router.delete(
  '/:bureauId/lorebooks/:lorebookId',
  asyncHandler(async (req, res) => {
    const { stores } = res.locals;
    const { bureauId, lorebookId } = req.params;
    requireBureau(stores.bureaus, bureauId);

    if (!stores.bureaus.detachLorebook(bureauId, lorebookId)) {
      throw new AppError('Lorebook is not attached', 404);
    }
    res.json({ lorebooks: await attachedLorebooks(stores, bureauId) });
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

// ==================== Stories ====================

router.use('/:bureauId', bureauMemoriesRouter);
router.use('/:bureauId/stories', bureauStoriesRouter);

export default router;
