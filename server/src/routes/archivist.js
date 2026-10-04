/**
 * Archivist API Routes
 *
 * The experimental Archivist for library character cards: it reads a story or
 * chat, suggests edits to its characters' descriptions and personalities, and
 * applies the ones the reader accepts as new card versions (see
 * services/archivist/card-archivist.js). A story or chat in a Continuity also
 * gets an updated Continuity (see services/archivist/continuity-archivist.js),
 * while Continuities are turned on, and a Continuity can be condensed on its
 * own. Every route answers 404 while the Archivist's experimental toggle is off.
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';
import { ChatStorage } from '../services/chat/chat-storage.js';
import { CardSuggestionStorage } from '../services/archivist/card-suggestion-storage.js';
import {
  ArchivistRunError,
  CARD_SUGGESTION_FIELDS,
  applyEdit,
  chatTranscript,
  describeError,
  runArchivist,
} from '../services/archivist/card-archivist.js';
import { getProvider } from '../services/provider-factory.js';
import { ContinuityStorage } from '../services/continuity/continuity-storage.js';
import { ContinuitySuggestionStorage } from '../services/archivist/continuity-suggestion-storage.js';
import {
  MAX_CONTINUITY_SUGGESTION_CHARACTERS,
  compactContinuity,
  runContinuityArchivist,
} from '../services/archivist/continuity-archivist.js';

const router = express.Router();

export const MAX_SUGGESTION_CHARACTERS = 4000;

let storage;
let chats;
let suggestions;
let continuities;
let continuitySuggestions;

// The latest read of each source, by `kind:sourceId`: the one running now, so a second waits for
// it, or how the last one ended. A read goes on when its request drops (a proxy or browser giving
// up on a long wait), so the reader can still learn how it ended by asking again.
const runs = new Map();
// Finished reads remembered at most, the oldest forgotten first.
const MAX_FINISHED_RUNS = 100;
let lastRunId = 0;
// The Continuities being condensed now, so one isn't condensed twice at once.
const compacting = new Set();
// The latest card save queued per character, so two reviews can't overwrite each other's edits.
const cardLocks = new Map();

/** Run `task` once every earlier task for the same character has finished. */
function withCardLock(characterId, task) {
  const previous = cardLocks.get(characterId) ?? Promise.resolve();
  const next = previous.then(task, task);
  const settled = next.catch(() => {});
  cardLocks.set(characterId, settled);
  settled.finally(() => {
    if (cardLocks.get(characterId) === settled) cardLocks.delete(characterId);
  });
  return next;
}

router.use((req, res, next) => {
  if (!storage) {
    storage = new SqliteStorageService(req.app.locals.dataRoot);
    chats = new ChatStorage(storage.db);
    suggestions = new CardSuggestionStorage(storage.db);
    continuities = new ContinuityStorage(storage.db);
    continuitySuggestions = new ContinuitySuggestionStorage(storage.db);
  }
  next();
});

router.use(
  asyncHandler(async (req, res, next) => {
    const settings = await storage.getSettings();
    if (!settings?.experimentalArchivist) {
      throw new AppError('The Archivist is turned off', 404);
    }
    next();
  }),
);

// ==================== Helpers ====================

/**
 * The story or chat a request names: what the Archivist reads, whose cards it may change, and
 * the preset it writes with.
 */
async function loadSource(kind, sourceId) {
  if (kind === 'story') {
    let story;
    try {
      story = await storage.getStory(sourceId);
    } catch {
      story = null;
    }
    if (!story) throw new AppError('Story not found', 404);
    return {
      title: story.title,
      text: story.content ?? '',
      characterIds: story.characterIds ?? [],
      personaCharacterId: story.personaCharacterId,
      configPresetId: story.configPresetId,
      continuityId: story.continuityId ?? null,
    };
  }
  if (kind === 'chat') {
    const chat = chats.getChat(sourceId);
    if (!chat) throw new AppError('Chat not found', 404);
    return {
      title: chat.title,
      text: chatTranscript(chats.listTurns(sourceId)),
      characterIds: chat.characterIds,
      personaCharacterId: chat.personaCharacterId,
      configPresetId: chat.configPresetId,
      continuityId: chat.continuityId ?? null,
    };
  }
  throw new AppError('Unknown source: expected story or chat', 404);
}

/**
 * The Continuity the Archivist keeps up to date for a source, alongside its cast's cards, or
 * null: the source isn't in one, or Continuities are turned off.
 */
async function continuityFor(source) {
  if (!source.continuityId) return null;
  const settings = await storage.getSettings();
  if (!settings?.experimentalContinuity) return null;
  return continuities.get(source.continuityId);
}

/**
 * The Continuity update waiting for review, with the Continuity's name and text as they now
 * stand, or null. Only an update to `active`, the Continuity the Archivist keeps for the source
 * now, is shown: one to a Continuity the source has left, or while Continuities are turned off,
 * waits unseen. It's stale when the Continuity changed since it was written.
 */
function pendingContinuityFor(kind, sourceId, active) {
  const suggestion = continuitySuggestions.proposedFor(kind, sourceId);
  if (!suggestion || !active || suggestion.continuityId !== active.id) return null;
  const continuity = continuities.get(suggestion.continuityId);
  if (!continuity) return null;
  return {
    ...suggestion,
    continuityName: continuity.name,
    current: continuity.content,
    stale: continuity.content !== suggestion.base,
  };
}

/** What a list of a source's suggestions says, the Continuity it would update included. */
async function listFor(kind, sourceId, source) {
  const continuity = await continuityFor(source ?? (await loadSource(kind, sourceId)));
  return {
    suggestions: await pendingFor(kind, sourceId),
    continuity: continuity ? { id: continuity.id, name: continuity.name } : null,
    continuitySuggestion: pendingContinuityFor(kind, sourceId, continuity),
  };
}

/** The source's characters as the Archivist sees them, the persona's card included. */
async function loadCast(source) {
  return loadCards([...source.characterIds, source.personaCharacterId]);
}

/** Characters' cards by id, as the Archivist sees them, skipping any that are gone. */
async function loadCards(characterIds) {
  const ids = new Set(characterIds.filter(Boolean));
  const cast = [];
  for (const id of ids) {
    let card;
    try {
      card = await storage.getCharacter(id);
    } catch {
      continue;
    }
    cast.push({
      id,
      name: card.data?.name || 'Unnamed',
      description: card.data?.description ?? '',
      personality: card.data?.personality ?? '',
    });
  }
  return cast;
}

async function providerFor(source) {
  const presetId = source.configPresetId || (await storage.getDefaultPresetId());
  if (!presetId) {
    throw new AppError('No configuration preset found. Please configure a preset first.', 400);
  }
  let preset;
  try {
    preset = await storage.getPreset(presetId);
  } catch (error) {
    throw new AppError(`Failed to load configuration preset: ${error.message}`, 400);
  }
  try {
    return { preset, provider: getProvider(preset) };
  } catch (error) {
    throw new AppError(`Failed to initialize provider: ${error.message}`, 400);
  }
}

/**
 * The suggestions waiting for review, each with its character's name and the field as it now
 * stands. A suggestion is stale when the text it replaces is gone from the card.
 */
async function pendingFor(kind, sourceId) {
  const cards = new Map();
  const pending = [];
  for (const suggestion of suggestions.listForSource(kind, sourceId)) {
    if (suggestion.status !== 'proposed') continue;
    if (!cards.has(suggestion.characterId)) {
      cards.set(
        suggestion.characterId,
        await storage.getCharacter(suggestion.characterId).catch(() => null),
      );
    }
    const card = cards.get(suggestion.characterId);
    if (!card) continue;
    const current = card.data?.[suggestion.field] ?? '';
    pending.push({
      ...suggestion,
      characterName: card.data?.name || 'Unnamed',
      current,
      stale: applyEdit(current, suggestion.find, suggestion.replace) === null,
    });
  }
  return pending;
}

/** A read as the client sees it. */
function runView(run) {
  if (!run) return null;
  const { id, running, stage, part, added, error, cancelled, startedAt, finishedAt } = run;
  return { id, running, stage, part, added, error, cancelled, startedAt, finishedAt };
}

/** Log a failed read with everything the reader's message leaves out. */
function logFailure(key, error) {
  console.error(`[Archivist] ${key}: the read failed: ${describeError(error)}`);
  if (error.answer !== undefined) {
    console.error(`[Archivist] ${key}: the answer began: ${JSON.stringify(error.answer)}`);
  }
  console.error(error);
}

/**
 * Read a source to the end, keeping what it suggests and recording how it ended in `run`. A
 * source in a Continuity gets an update to it first, then card edits. A read that fails partway
 * keeps what the passes before it found; a cancelled one keeps nothing.
 */
async function read(kind, sourceId, run) {
  const key = `${kind}:${sourceId}`;
  const onPart = (part) => {
    run.part = { index: part.index, count: part.count };
    console.log(
      `[Archivist] ${key}: ${run.stage}, part ${part.index + 1} of ${part.count} (${part.characters} characters)`,
    );
  };
  try {
    const source = await loadSource(kind, sourceId);
    if (!source.text.trim()) {
      throw new AppError(`There's nothing in this ${kind} to read yet`, 400);
    }
    const continuity = await continuityFor(source);
    const cast = await loadCast(source);
    if (!continuity && cast.length === 0) {
      throw new AppError(`This ${kind} has no library characters to review`, 400);
    }
    const { preset, provider } = await providerFor(source);
    console.log(`[Archivist] ${key}: reading ${source.text.length} characters`);

    // Keeps a Continuity update, counting it when it was kept.
    const keepUpdate = (update) => {
      if (!update) return 0;
      const kept = continuitySuggestions.add(kind, sourceId, {
        continuityId: continuity.id,
        base: continuity.content,
        replace: update.replace,
        rationale: update.rationale,
      });
      return kept ? 1 : 0;
    };
    let update = null;
    if (continuity) {
      run.stage = 'continuity';
      run.part = null;
      console.log(`[Archivist] ${key}: updating the Continuity "${continuity.name}"`);
      try {
        update = await runContinuityArchivist({
          provider,
          preset,
          name: continuity.name,
          continuity: continuity.content,
          text: source.text,
          kind,
          cast,
          signal: run.controller.signal,
          onPart,
          onCompact: () => {
            run.stage = 'compact';
            run.part = null;
            console.log(`[Archivist] ${key}: condensing the Continuity`);
          },
        });
      } catch (error) {
        if (error instanceof ArchivistRunError) {
          error.keep = () => keepUpdate(error.found[0]);
          error.keptNote = () => 'The Continuity update from the parts before it is kept.';
        }
        throw error;
      }
    }

    let found = [];
    if (cast.length > 0) {
      run.stage = 'cards';
      run.part = null;
      try {
        found = await runArchivist({
          provider,
          preset,
          cast,
          text: source.text,
          kind,
          existing: suggestions.listForSource(kind, sourceId),
          signal: run.controller.signal,
          onPart,
        });
      } catch (error) {
        // The Continuity update is whole by now, so it's kept with whatever the cards' passes found.
        if (!run.controller.signal.aborted && (update || error instanceof ArchivistRunError)) {
          const cards = error instanceof ArchivistRunError ? error.found : [];
          error.keep = () => keepUpdate(update) + suggestions.addAll(kind, sourceId, cards).length;
          error.keptNote = (kept) =>
            update
              ? 'What the Archivist found before it failed is kept.'
              : `The ${kept} suggestion(s) from the parts before it are kept.`;
        }
        throw error;
      }
    }

    // Nothing is kept from a read the reader cancelled.
    if (run.controller.signal.aborted) {
      run.cancelled = true;
      return;
    }
    run.added = keepUpdate(update) + suggestions.addAll(kind, sourceId, found).length;
    console.log(`[Archivist] ${key}: done, ${run.added} new suggestion(s)`);
  } catch (error) {
    if (run.controller.signal.aborted) {
      run.cancelled = true;
      console.log(`[Archivist] ${key}: cancelled`);
      return;
    }
    if (error instanceof AppError) {
      run.error = error.message;
      run.status = error.statusCode;
      return;
    }
    logFailure(key, error);
    const kept = error.keep ? error.keep() : 0;
    run.added = kept;
    run.error =
      (error.message || 'The Archivist failed') + (kept > 0 ? ` ${error.keptNote(kept)}` : '');
    run.status = 502;
  } finally {
    run.running = false;
    run.finishedAt = new Date().toISOString();
    delete run.controller;
    forgetOldRuns();
  }
}

/** Forget the oldest finished reads past the most kept. The map keeps the order reads started. */
function forgetOldRuns() {
  let finished = [...runs.values()].filter((run) => !run.running).length;
  for (const [key, run] of runs) {
    if (finished <= MAX_FINISHED_RUNS) break;
    if (run.running) continue;
    runs.delete(key);
    finished -= 1;
  }
}

/** The decision on a source's Continuity update, checked, or null when there's none. */
function continuityDecision(body) {
  const decision = body?.continuity;
  if (decision === undefined || decision === null) return null;
  if (!Number.isInteger(decision?.id) || typeof decision.accept !== 'boolean') {
    throw new AppError('A Continuity decision needs an id and accept', 400);
  }
  if (decision.replace === undefined) return decision;
  const text = typeof decision.replace === 'string' ? decision.replace.trim() : '';
  if (!text || text.length > MAX_CONTINUITY_SUGGESTION_CHARACTERS) {
    throw new AppError(
      `An edited Continuity must be 1 to ${MAX_CONTINUITY_SUGGESTION_CHARACTERS} characters`,
      400,
    );
  }
  return { ...decision, replace: text };
}

/**
 * Accept or reject a source's Continuity update. An accepted one becomes the Continuity's text,
 * kept in its History as the Archivist's version, unless the Continuity changed since it was
 * written: then it stays waiting and comes back as stale. It runs without awaiting anything, so
 * two reviews of one update can't both apply it. Only an update to `active`, the Continuity the
 * Archivist keeps for the source now, can be decided.
 * @returns {{applied: boolean, stale: boolean}}
 */
function reviewContinuity(kind, sourceId, decision, active) {
  const suggestion = continuitySuggestions.get(decision.id);
  const own =
    suggestion?.status === 'proposed' &&
    suggestion.sourceKind === kind &&
    suggestion.sourceId === sourceId &&
    suggestion.continuityId === active?.id;
  if (!own) return { applied: false, stale: false };
  if (!decision.accept) {
    continuitySuggestions.setStatus(suggestion.id, 'rejected');
    return { applied: false, stale: false };
  }
  const continuity = continuities.get(suggestion.continuityId);
  if (!continuity) return { applied: false, stale: false };
  if (continuity.content !== suggestion.base) return { applied: false, stale: true };
  const replace = decision.replace ?? suggestion.replace;
  continuities.update(
    continuity.id,
    { content: replace },
    { source: 'archivist', sourceId: `${kind}:${sourceId}` },
  );
  continuitySuggestions.setStatus(suggestion.id, 'accepted', replace);
  return { applied: true, stale: false };
}

function reviewDecisions(body) {
  // A review of only a Continuity update needn't list card decisions.
  const decisions = body?.decisions ?? (body?.continuity ? [] : undefined);
  if (!Array.isArray(decisions)) {
    throw new AppError('decisions must be a list', 400);
  }
  const ids = new Set();
  return decisions.map((decision) => {
    if (!Number.isInteger(decision?.id) || typeof decision.accept !== 'boolean') {
      throw new AppError('Each decision needs an id and accept', 400);
    }
    if (ids.has(decision.id)) {
      throw new AppError('Each suggestion can be decided once per review', 400);
    }
    ids.add(decision.id);
    if (decision.replace !== undefined) {
      const text = typeof decision.replace === 'string' ? decision.replace.trim() : '';
      if (!text || text.length > MAX_SUGGESTION_CHARACTERS) {
        throw new AppError(
          `An edited suggestion must be 1 to ${MAX_SUGGESTION_CHARACTERS} characters`,
          400,
        );
      }
      return { ...decision, replace: text };
    }
    return decision;
  });
}

// ==================== Routes ====================

// Condense a Continuity's text, given in the body as the reader has it now, with the cards of the
// characters in its stories and chats. Nothing is saved: the answer goes back to the editor, for
// the reader to keep or undo. It's written with the default preset.
router.post(
  '/continuities/:id/compact',
  asyncHandler(async (req, res) => {
    const settings = await storage.getSettings();
    const continuity = settings?.experimentalContinuity ? continuities.get(req.params.id) : null;
    if (!continuity) throw new AppError('Continuity not found', 404);
    const given = req.body?.content;
    if (given !== undefined && typeof given !== 'string') {
      throw new AppError('content must be a string', 400);
    }
    const text = (given ?? continuity.content).trim();
    if (!text) throw new AppError('There is nothing in this Continuity to condense', 400);
    if (text.length > MAX_CONTINUITY_SUGGESTION_CHARACTERS) {
      throw new AppError(
        `content must be at most ${MAX_CONTINUITY_SUGGESTION_CHARACTERS} characters`,
        400,
      );
    }
    if (compacting.has(continuity.id)) {
      throw new AppError('The Archivist is already condensing this Continuity', 409);
    }

    compacting.add(continuity.id);
    const controller = new AbortController();
    // Stop when the reader gives up waiting, since nothing is kept without them.
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const { preset, provider } = await providerFor({ configPresetId: null });
      const cast = await loadCards(continuities.characterIds(continuity.id));
      console.log(
        `[Archivist] continuity:${continuity.id}: condensing ${text.length} characters with ${cast.length} card(s)`,
      );
      const compacted = await compactContinuity({
        provider,
        preset,
        name: continuity.name,
        continuity: text,
        cast,
        signal: controller.signal,
      });
      res.json({
        content: compacted?.replace ?? null,
        rationale: compacted?.rationale ?? '',
      });
    } catch (error) {
      if (controller.signal.aborted || error instanceof AppError) throw error;
      logFailure(`continuity:${continuity.id}`, error);
      throw new AppError(error.message || 'The Archivist failed', 502);
    } finally {
      compacting.delete(continuity.id);
    }
  }),
);

// The suggestions for a story or chat that are waiting for review, and its latest read
router.get(
  '/:kind/:sourceId',
  asyncHandler(async (req, res) => {
    const { kind, sourceId } = req.params;
    const source = await loadSource(kind, sourceId);
    const run = runs.get(`${kind}:${sourceId}`);
    res.json({
      ...(await listFor(kind, sourceId, source)),
      running: run?.running ?? false,
      run: runView(run),
    });
  }),
);

// Read the story or chat and suggest edits to its characters' cards. The answer waits for the
// read, but the read doesn't wait on the answer: if the request drops, it goes on, and the list
// above says how it ended.
router.post(
  '/:kind/:sourceId/run',
  asyncHandler(async (req, res) => {
    const { kind, sourceId } = req.params;
    // Claimed before anything is awaited, so two requests can't both start reading.
    const key = `${kind}:${sourceId}`;
    if (runs.get(key)?.running) {
      throw new AppError('The Archivist is already reading this', 409);
    }
    const run = {
      id: ++lastRunId,
      running: true,
      stage: null,
      part: null,
      added: 0,
      error: null,
      cancelled: false,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      controller: new AbortController(),
    };
    // Set anew, so the map's order is the order reads started.
    runs.delete(key);
    runs.set(key, run);
    await read(kind, sourceId, run);
    // A source that isn't there has no read to remember.
    if (run.status === 404) runs.delete(key);
    if (res.destroyed) return;
    if (run.error) {
      // What earlier parts found is kept, so the list comes too.
      throw new AppError(run.error, run.status ?? 500, {
        run: runView(run),
        ...(await listFor(kind, sourceId).catch(() => ({}))),
      });
    }
    res.json({
      added: run.added,
      ...(await listFor(kind, sourceId)),
      run: runView(run),
    });
  }),
);

// Stop the read in progress; nothing it found is kept
router.post(
  '/:kind/:sourceId/cancel',
  asyncHandler(async (req, res) => {
    const { kind, sourceId } = req.params;
    const run = runs.get(`${kind}:${sourceId}`);
    const cancelled = Boolean(run?.running);
    if (cancelled) run.controller?.abort();
    res.json({ cancelled });
  }),
);

// Accept or reject suggestions. Accepted ones are made to each card in one save, kept in its
// History as the Archivist's version; a suggestion whose text is gone from the card stays waiting.
router.post(
  '/:kind/:sourceId/review',
  asyncHandler(async (req, res) => {
    const { kind, sourceId } = req.params;
    const source = await loadSource(kind, sourceId);
    const decisions = reviewDecisions(req.body);
    const continuity = continuityDecision(req.body);
    const continuityResult = continuity
      ? reviewContinuity(kind, sourceId, continuity, await continuityFor(source))
      : { applied: false, stale: false };
    const own = new Map(
      suggestions
        .listForSource(kind, sourceId)
        .filter((suggestion) => suggestion.status === 'proposed')
        .map((suggestion) => [suggestion.id, suggestion]),
    );

    const decidedByCharacter = new Map();
    for (const decision of decisions) {
      const suggestion = own.get(decision.id);
      if (!suggestion) continue;
      const list = decidedByCharacter.get(suggestion.characterId) ?? [];
      list.push({
        ...suggestion,
        accept: decision.accept,
        replace: decision.replace ?? suggestion.replace,
      });
      decidedByCharacter.set(suggestion.characterId, list);
    }

    const stale = [];
    let applied = 0;
    for (const [characterId, decided] of decidedByCharacter) {
      // Each suggestion is checked again and decided under its card's lock, rejections included,
      // so a review running at the same time can't apply it twice, lose an edit, or reject an edit
      // that is already on the card.
      applied += await withCardLock(characterId, async () => {
        const still = decided.filter(
          (suggestion) => suggestions.get(suggestion.id)?.status === 'proposed',
        );
        for (const suggestion of still) {
          if (!suggestion.accept) suggestions.setStatus(suggestion.id, 'rejected');
        }
        const accepted = still.filter((suggestion) => suggestion.accept);
        if (accepted.length === 0) return 0;
        const card = await storage.getCharacter(characterId).catch(() => null);
        if (!card) return 0;
        const made = [];
        for (const suggestion of accepted.toSorted((a, b) => a.id - b.id)) {
          if (!CARD_SUGGESTION_FIELDS.includes(suggestion.field)) continue;
          const edited = applyEdit(
            card.data[suggestion.field],
            suggestion.find,
            suggestion.replace,
          );
          if (edited === null) {
            stale.push(suggestion.id);
            continue;
          }
          card.data[suggestion.field] = edited;
          made.push(suggestion);
        }
        if (made.length === 0) return 0;
        await storage.saveCharacter(characterId, card, null, {
          source: 'archivist',
          sourceId: `${kind}:${sourceId}`,
        });
        for (const suggestion of made) {
          suggestions.setStatus(suggestion.id, 'accepted', suggestion.replace);
        }
        return made.length;
      });
    }

    res.json({
      applied,
      stale,
      continuityApplied: continuityResult.applied,
      continuityStale: continuityResult.stale,
      ...(await listFor(kind, sourceId)),
    });
  }),
);

export default router;
