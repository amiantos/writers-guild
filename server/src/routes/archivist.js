/**
 * Archivist API Routes
 *
 * The experimental Archivist for library character cards: it reads a story or
 * chat, suggests edits to its characters' descriptions and personalities, and
 * applies the ones the reader accepts as new card versions (see
 * services/archivist/card-archivist.js). Every route answers 404 while the
 * Archivist's experimental toggle is off.
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

const router = express.Router();

export const MAX_SUGGESTION_CHARACTERS = 4000;

let storage;
let chats;
let suggestions;

// The latest read of each source, by `kind:sourceId`: the one running now, so a second waits for
// it, or how the last one ended. A read goes on when its request drops (a proxy or browser giving
// up on a long wait), so the reader can still learn how it ended by asking again.
const runs = new Map();
// Finished reads remembered at most, the oldest forgotten first.
const MAX_FINISHED_RUNS = 100;
let lastRunId = 0;
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
    };
  }
  throw new AppError('Unknown source: expected story or chat', 404);
}

/** The source's characters as the Archivist sees them, the persona's card included. */
async function loadCast(source) {
  const ids = new Set([...source.characterIds, source.personaCharacterId].filter(Boolean));
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
  const { id, running, part, added, error, cancelled, startedAt, finishedAt } = run;
  return { id, running, part, added, error, cancelled, startedAt, finishedAt };
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
 * Read a source to the end, keeping what it suggests and recording how it ended in `run`. A read
 * that fails partway keeps what the passes before it found; a cancelled one keeps nothing.
 */
async function read(kind, sourceId, run) {
  const key = `${kind}:${sourceId}`;
  try {
    const source = await loadSource(kind, sourceId);
    if (!source.text.trim()) {
      throw new AppError(`There's nothing in this ${kind} to read yet`, 400);
    }
    const cast = await loadCast(source);
    if (cast.length === 0) {
      throw new AppError(`This ${kind} has no library characters to review`, 400);
    }
    const { preset, provider } = await providerFor(source);
    console.log(`[Archivist] ${key}: reading ${source.text.length} characters`);
    const found = await runArchivist({
      provider,
      preset,
      cast,
      text: source.text,
      kind,
      existing: suggestions.listForSource(kind, sourceId),
      signal: run.controller.signal,
      onPart: (part) => {
        run.part = { index: part.index, count: part.count };
        console.log(
          `[Archivist] ${key}: part ${part.index + 1} of ${part.count} (${part.characters} characters)`,
        );
      },
    });
    // Nothing is kept from a read the reader cancelled.
    if (run.controller.signal.aborted) {
      run.cancelled = true;
      return;
    }
    run.added = suggestions.addAll(kind, sourceId, found).length;
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
    const kept =
      error instanceof ArchivistRunError && error.found.length > 0
        ? suggestions.addAll(kind, sourceId, error.found).length
        : 0;
    run.added = kept;
    run.error =
      (error.message || 'The Archivist failed') +
      (kept > 0 ? ` The ${kept} suggestion(s) from the parts before it are kept.` : '');
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

function reviewDecisions(body) {
  const decisions = body?.decisions;
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

// The suggestions for a story or chat that are waiting for review, and its latest read
router.get(
  '/:kind/:sourceId',
  asyncHandler(async (req, res) => {
    const { kind, sourceId } = req.params;
    await loadSource(kind, sourceId);
    const run = runs.get(`${kind}:${sourceId}`);
    res.json({
      suggestions: await pendingFor(kind, sourceId),
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
        suggestions: await pendingFor(kind, sourceId),
      });
    }
    res.json({
      added: run.added,
      suggestions: await pendingFor(kind, sourceId),
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
    await loadSource(kind, sourceId);
    const decisions = reviewDecisions(req.body);
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

    res.json({ applied, stale, suggestions: await pendingFor(kind, sourceId) });
  }),
);

export default router;
