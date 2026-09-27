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
  CARD_SUGGESTION_FIELDS,
  applyEdit,
  chatTranscript,
  runArchivist,
} from '../services/archivist/card-archivist.js';
import { getProvider } from '../services/provider-factory.js';

const router = express.Router();

export const MAX_SUGGESTION_CHARACTERS = 4000;

let storage;
let chats;
let suggestions;

// Sources the Archivist is reading now, so a second run waits for the first.
const running = new Set();

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

function reviewDecisions(body) {
  const decisions = body?.decisions;
  if (!Array.isArray(decisions)) {
    throw new AppError('decisions must be a list', 400);
  }
  return decisions.map((decision) => {
    if (!Number.isInteger(decision?.id) || typeof decision.accept !== 'boolean') {
      throw new AppError('Each decision needs an id and accept', 400);
    }
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

// The suggestions for a story or chat that are waiting for review
router.get(
  '/:kind/:sourceId',
  asyncHandler(async (req, res) => {
    const { kind, sourceId } = req.params;
    await loadSource(kind, sourceId);
    res.json({
      suggestions: await pendingFor(kind, sourceId),
      running: running.has(`${kind}:${sourceId}`),
    });
  }),
);

// Read the story or chat and suggest edits to its characters' cards
router.post(
  '/:kind/:sourceId/run',
  asyncHandler(async (req, res) => {
    const { kind, sourceId } = req.params;
    // Claimed before anything is awaited, so two requests can't both start reading.
    const key = `${kind}:${sourceId}`;
    if (running.has(key)) {
      throw new AppError('The Archivist is already reading this', 409);
    }
    running.add(key);
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

      const controller = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) controller.abort();
      });

      let found;
      try {
        found = await runArchivist({
          provider,
          preset,
          cast,
          text: source.text,
          kind,
          existing: suggestions.listForSource(kind, sourceId),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        throw new AppError(error.message || 'The Archivist failed', 502);
      }
      suggestions.addAll(kind, sourceId, found);
      res.json({ added: found.length, suggestions: await pendingFor(kind, sourceId) });
    } finally {
      running.delete(key);
    }
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

    const acceptedByCharacter = new Map();
    for (const decision of decisions) {
      const suggestion = own.get(decision.id);
      if (!suggestion) continue;
      if (!decision.accept) {
        suggestions.setStatus(suggestion.id, 'rejected');
        continue;
      }
      const list = acceptedByCharacter.get(suggestion.characterId) ?? [];
      list.push({ ...suggestion, replace: decision.replace ?? suggestion.replace });
      acceptedByCharacter.set(suggestion.characterId, list);
    }

    const stale = [];
    let applied = 0;
    for (const [characterId, accepted] of acceptedByCharacter) {
      const card = await storage.getCharacter(characterId).catch(() => null);
      if (!card) continue;
      const made = [];
      for (const suggestion of accepted.toSorted((a, b) => a.id - b.id)) {
        if (!CARD_SUGGESTION_FIELDS.includes(suggestion.field)) continue;
        const edited = applyEdit(card.data[suggestion.field], suggestion.find, suggestion.replace);
        if (edited === null) {
          stale.push(suggestion.id);
          continue;
        }
        card.data[suggestion.field] = edited;
        made.push(suggestion);
      }
      if (made.length === 0) continue;
      await storage.saveCharacter(characterId, card, null, {
        source: 'archivist',
        sourceId: `${kind}:${sourceId}`,
      });
      for (const suggestion of made) {
        suggestions.setStatus(suggestion.id, 'accepted', suggestion.replace);
      }
      applied += made.length;
    }

    res.json({ applied, stale, suggestions: await pendingFor(kind, sourceId) });
  }),
);

export default router;
