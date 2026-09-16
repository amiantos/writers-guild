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
import { archiveSettledSessions } from '../services/bureau/archivist.js';
import { CastConflictError } from '../services/bureau/bureau-storage.js';
import { BureauSettingsError, DEFAULT_SETTINGS } from '../services/bureau/bureau-settings.js';
import {
  BureauTimeError,
  isValidTimeZone,
  parseBureauTime,
  passTime,
} from '../services/bureau/bureau-time.js';
import { DEFAULT_MODEL, DeepSeekError } from '../services/bureau/deepseek-client.js';
import { exportedCard } from '../services/bureau/character-export.js';
import { generateCharacter } from '../services/bureau/character-generator.js';
import { DEFAULT_CORRESPONDENCE_STYLE } from '../services/bureau/correspondence.js';
import { DEFAULT_HOUSE_STYLE } from '../services/bureau/writer-prompt.js';
import bureauCorrespondenceRouter from './bureau-correspondence.js';
import bureauFactsRouter from './bureau-facts.js';
import bureauMemoriesRouter from './bureau-memories.js';
import bureauProfilesRouter from './bureau-profiles.js';
import bureauStoriesRouter from './bureau-stories.js';
import {
  attachBureauStores,
  createBureauClient,
  optionalString,
  requireApiKey,
  requireBureau,
} from './bureau-route-helpers.js';

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

// Create a Bureau. With shareApiKey, its key becomes the shared key instead, unless a shared key is
// already saved: that one stays, and the key is the Bureau's own.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    const body = req.body ?? {};
    const name = optionalString(body, 'name');
    if (!name) {
      throw new AppError('Name is required', 400);
    }
    const description = optionalString(body, 'description') ?? '';
    const apiKey = optionalString(body, 'apiKey') ?? '';
    const model = optionalString(body, 'model');
    const { shareApiKey = false } = body;
    if (typeof shareApiKey !== 'boolean') {
      throw new AppError('shareApiKey must be a boolean', 400);
    }

    let bureau;
    // One transaction, so a key is only shared along with the Bureau it was typed for.
    bureaus.db.transaction(() => {
      const sharing = shareApiKey && apiKey !== '' && !bureaus.getSharedApiKey().hasApiKey;
      if (sharing) {
        bureaus.setSharedApiKey(apiKey);
      }
      bureau = bureaus.createBureau({
        name,
        description,
        apiKey: sharing ? '' : apiKey,
        ...(model ? { model } : {}),
      });
    })();
    res.status(201).json({ bureau });
  }),
);

// Defaults a Bureau starts with, so the settings page can show them
router.get(
  '/defaults',
  asyncHandler(async (req, res) => {
    res.json({
      houseStyle: DEFAULT_HOUSE_STYLE,
      correspondenceStyle: DEFAULT_CORRESPONDENCE_STYLE,
      settings: DEFAULT_SETTINGS,
      model: DEFAULT_MODEL,
    });
  }),
);

// The shared API key, used by every Bureau without a key of its own. Like a Bureau's key, it's
// write-only: responses carry a masked preview.
router.get(
  '/shared-key',
  asyncHandler(async (req, res) => {
    res.json({ sharedKey: res.locals.stores.bureaus.getSharedApiKey() });
  }),
);

// Save the shared API key. An apiKey of '' removes it.
router.put(
  '/shared-key',
  asyncHandler(async (req, res) => {
    const apiKey = optionalString(req.body ?? {}, 'apiKey');
    if (apiKey === undefined) {
      throw new AppError('apiKey is required', 400);
    }
    res.json({ sharedKey: res.locals.stores.bureaus.setSharedApiKey(apiKey) });
  }),
);

// Get a Bureau
router.get(
  '/:bureauId',
  asyncHandler(async (req, res) => {
    res.json({ bureau: requireBureau(res.locals.stores.bureaus, req.params.bureauId) });
  }),
);

/**
 * A style saved exactly as its default is stored empty, so the Bureau keeps following the default
 * as it improves instead of keeping a copy of it.
 */
function followingDefault(style, defaultStyle) {
  return typeof style === 'string' && style.trim() === defaultStyle.trim() ? '' : style;
}

/** Run a Bureau time calculation, answering 400 for a time it can't take. */
function withBureauTime(resolve) {
  try {
    return resolve();
  } catch (error) {
    if (error instanceof BureauTimeError) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
}

// Update a Bureau. An apiKey of '' removes the key; a timezone of null clears it. bureauTime
// sets the Bureau's clock to any time in the years 1 to 9999, earlier or later.
// `settings` is a partial update, such as { writer: { thinking: true } }. A house style or
// correspondence style that matches its default is saved empty (see followingDefault).
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
      houseStyle: followingDefault(optionalString(body, 'houseStyle'), DEFAULT_HOUSE_STYLE),
      timezone: body.timezone,
      bureauTime:
        body.bureauTime === undefined
          ? undefined
          : withBureauTime(() => parseBureauTime(body.bureauTime, 'bureauTime')),
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
          const style = body.settings?.correspondence?.style;
          const settings =
            typeof style === 'string'
              ? {
                  ...body.settings,
                  correspondence: {
                    ...body.settings.correspondence,
                    style: followingDefault(style, DEFAULT_CORRESPONDENCE_STYLE),
                  },
                }
              : body.settings;
          bureau = bureaus.updateSettings(bureauId, settings);
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

/**
 * Start background passes over each thread's finished sessions, as after a reply. Failures are
 * logged, never thrown.
 */
function commitFinishedSessions(req, stores, bureau) {
  try {
    const client = createBureauClient(req, stores.bureaus.getBureauCredentials(bureau.id));
    for (const thread of stores.threads.listThreads(bureau.id)) {
      archiveSettledSessions({ stores, bureauId: bureau.id, threadId: thread.id, client });
    }
  } catch (error) {
    console.error('[Bureau] Committing finished messages to memory failed:', error.message);
  }
}

// Let time pass: move the Bureau's clock forward by a step ({ step }: hour, later, morning, days,
// or week) or to a later time ({ to }). An earlier time is set in the Bureau's settings instead.
// Exchanges of messages this leaves finished go into memory in the background.
router.post(
  '/:bureauId/time',
  asyncHandler(async (req, res) => {
    const { stores } = res.locals;
    const { bureaus } = stores;
    const { bureauId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);

    const bureauTime = withBureauTime(() =>
      passTime(bureau.bureauTime, req.body ?? {}, bureau.timezone),
    );
    if (Date.parse(bureauTime) < Date.parse(bureau.bureauTime)) {
      throw new AppError(
        "Time only moves forward here: to can't be earlier than Bureau time. Set an earlier time in the Bureau's settings.",
        400,
      );
    }

    bureaus.setBureauTime(bureauId, bureauTime);
    const moved = bureaus.getBureau(bureauId);
    res.json({ bureau: moved });

    // Tests turn this off with app.locals.bureauAutoArchive.
    if (
      moved.hasApiKey &&
      moved.settings.memory.autoArchive &&
      (req.app.locals.bureauAutoArchive ?? true)
    ) {
      commitFinishedSessions(req, stores, moved);
    }
  }),
);

const MAX_AVATAR_WINDOWS = 20;
// Story mode's limits for a window's size and position, in pixels.
const MAX_WINDOW_SIZE = 5000;
const MAX_WINDOW_OFFSET = 10000;

/** An avatar window as saved, from avatarWindows[index] in a request. */
function avatarWindowFrom(value, index) {
  const at = `avatarWindows[${index}]`;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError(`${at} must be an object`, 400);
  }
  const { id, castId, x, y, width, height } = value;
  for (const [field, string] of Object.entries({ id, castId })) {
    if (typeof string !== 'string' || !string) {
      throw new AppError(`${at}.${field} must be a non-empty string`, 400);
    }
  }
  for (const [field, number] of Object.entries({ x, y, width, height })) {
    if (!Number.isFinite(number)) {
      throw new AppError(`${at}.${field} must be a finite number`, 400);
    }
  }
  if (width <= 0 || height <= 0 || width > MAX_WINDOW_SIZE || height > MAX_WINDOW_SIZE) {
    throw new AppError(`${at} must be more than 0 and at most ${MAX_WINDOW_SIZE} across`, 400);
  }
  if (Math.abs(x) > MAX_WINDOW_OFFSET || Math.abs(y) > MAX_WINDOW_OFFSET) {
    throw new AppError(`${at} must be within ${MAX_WINDOW_OFFSET} of the corner`, 400);
  }
  return { id, castId, x, y, width, height };
}

// Save the avatar windows floating over the Bureau's chapters, replacing the ones saved before.
// Each is { id, castId, x, y, width, height }; castId is whom it shows.
router.put(
  '/:bureauId/avatar-windows',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    const { bureauId } = req.params;
    requireBureau(bureaus, bureauId);

    const { avatarWindows } = req.body ?? {};
    if (!Array.isArray(avatarWindows)) {
      throw new AppError('avatarWindows must be an array', 400);
    }
    if (avatarWindows.length > MAX_AVATAR_WINDOWS) {
      throw new AppError(`A Bureau can have at most ${MAX_AVATAR_WINDOWS} avatar windows`, 400);
    }
    const windows = avatarWindows.map(avatarWindowFrom);
    bureaus.setAvatarWindows(bureauId, windows);
    res.json({ avatarWindows: windows });
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

// Reset a Bureau to a blank slate: its chapters, messages, memories, and arc notes are deleted, with
// the runs that wrote them. The cast and their profiles with every version stay, and so do
// interviews, lorebooks, settings, and Bureau time.
router.post(
  '/:bureauId/reset',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    if (!bureaus.resetBureau(req.params.bureauId)) {
      throw new AppError('Bureau not found', 404);
    }
    res.json({ bureau: bureaus.getBureau(req.params.bureauId) });
  }),
);

// ==================== Cast ====================

// List cast members (without seed cards), with how many current memories each has and
// how many of those need review, and how many arc notes are proposed or need review
router.get(
  '/:bureauId/cast',
  asyncHandler(async (req, res) => {
    const { bureaus, memories, arcNotes } = res.locals.stores;
    const { bureauId } = req.params;
    requireBureau(bureaus, bureauId);
    res.json({
      cast: bureaus.listCast(bureauId),
      memoryCounts: memories.countsByCast(bureauId),
      arcNoteCounts: arcNotes.reviewCountsByCast(bureauId),
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

    const { characterId, card: draftCard, isPersona = false } = req.body ?? {};
    if (draftCard !== undefined) {
      // A generated card joins as a draft, kept in this Bureau until it's saved to the library.
      const name = draftCard?.data?.name;
      if (typeof name !== 'string' || !name.trim()) {
        throw new AppError('card must be a character card with a name', 400);
      }
      const castMember = bureaus.addCastMember(bureauId, { seedCard: draftCard, isDraft: true });
      res.status(201).json({ castMember, attachedLorebookId: null });
      return;
    }
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

// Update a cast member: whether they're the reader's character. Their card and routine change
// through their profile (see bureau-profiles.js).
router.put(
  '/:bureauId/cast/:castId',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    const { bureauId, castId } = req.params;
    requireBureau(bureaus, bureauId);

    const { isPersona } = req.body ?? {};
    if (isPersona === undefined) {
      throw new AppError('No updates provided', 400);
    }
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

// Generate a character card from an idea, without saving it
router.post(
  '/:bureauId/characters/generate',
  asyncHandler(async (req, res) => {
    const { stores } = res.locals;
    const { bureauId } = req.params;
    const bureau = requireBureau(stores.bureaus, bureauId);
    requireApiKey(bureau);
    const body = req.body ?? {};
    const idea = optionalString(body, 'idea');
    if (!idea) {
      throw new AppError('idea is required', 400);
    }
    // Someone created from a chapter usually has a name and a part to play already.
    const name = optionalString(body, 'name') ?? '';
    const role = optionalString(body, 'role') ?? '';

    const client = createBureauClient(req, stores.bureaus.getBureauCredentials(bureauId));
    try {
      const { card, runId } = await generateCharacter({
        stores,
        bureau,
        client,
        idea,
        name,
        role,
      });
      res.json({ card, runId });
    } catch (error) {
      if (error instanceof DeepSeekError) {
        throw new AppError(error.message, 502);
      }
      throw error;
    }
  }),
);

// Drafts being saved to the library, so overlapping requests can't save one twice.
const promotingCastIds = new Set();

// Save a draft cast member to the library as a new character, and link the two
router.post(
  '/:bureauId/cast/:castId/promote',
  asyncHandler(async (req, res) => {
    const { bureaus, library } = res.locals.stores;
    const { bureauId, castId } = req.params;
    requireBureau(bureaus, bureauId);
    const member = bureaus.getCastMember(bureauId, castId);
    if (!member) {
      throw new AppError('Cast member not found', 404);
    }
    if (!member.isDraft) {
      throw new AppError('Only a draft character can be saved to the library this way', 400);
    }
    if (promotingCastIds.has(castId)) {
      throw new AppError(`${member.name} is already being saved to the library`, 409);
    }

    promotingCastIds.add(castId);
    try {
      const characterId = uuidv4();
      await library.saveCharacter(characterId, structuredClone(member.seedCard), null);
      const castMember = bureaus.promoteDraft(bureauId, castId, characterId);
      if (!castMember) {
        // Removed from the cast while the library copy was being saved.
        await library.deleteCharacter(characterId);
        throw new AppError(`${member.name} left the cast while being saved`, 409);
      }
      res.status(201).json({ castMember, characterId });
    } finally {
      promotingCastIds.delete(castId);
    }
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
router.use('/:bureauId', bureauFactsRouter);
router.use('/:bureauId', bureauProfilesRouter);
router.use('/:bureauId/stories', bureauStoriesRouter);
router.use('/:bureauId/threads', bureauCorrespondenceRouter);

export default router;
