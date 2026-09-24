/**
 * Chats API Routes
 *
 * Chat mode: text message conversations between the user's persona and one or
 * more characters, set up by an optional scenario. Replies use the chat's
 * preset (or the default one) with any provider, and stream as server-sent
 * events when the client asks for text/event-stream; otherwise they answer
 * with JSON once saved. Unlike story mode, the server saves each reply itself,
 * including a partial one when the client stops it.
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';
import { ChatStorage } from '../services/chat/chat-storage.js';
import { generateChatReply } from '../services/chat/chat-reply.js';
import { joinNames, pickSpeaker } from '../services/chat/chat-prompt.js';
import { getProvider } from '../services/provider-factory.js';
import { sseChannel } from '../utils/sse.js';

const router = express.Router();

export const MAX_MESSAGE_CHARACTERS = 8000;
export const MAX_SCENARIO_CHARACTERS = 8000;

let storage;
let chats;

router.use((req, res, next) => {
  if (!storage) {
    storage = new SqliteStorageService(req.app.locals.dataRoot);
    chats = new ChatStorage(storage.db);
  }
  next();
});

// ==================== Helpers ====================

function requireChat(chatId) {
  const chat = chats.getChat(chatId);
  if (!chat) {
    throw new AppError('Chat not found', 404);
  }
  return chat;
}

function requireTurn(chatId, turnId) {
  const turn = chats.getTurn(chatId, turnId);
  if (!turn) {
    throw new AppError('Message not found', 404);
  }
  return turn;
}

function requiredText(value, field, max = MAX_MESSAGE_CHARACTERS) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    throw new AppError(`${field} is required`, 400);
  }
  if (text.length > max) {
    throw new AppError(`${field} must be at most ${max} characters`, 400);
  }
  return text;
}

function optionalString(body, field, max) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (value !== null && typeof value !== 'string') {
    throw new AppError(`${field} must be a string`, 400);
  }
  const text = (value ?? '').trim();
  if (max && text.length > max) {
    throw new AppError(`${field} must be at most ${max} characters`, 400);
  }
  return text;
}

function optionalIdList(body, field) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
    throw new AppError(`${field} must be a list of ids`, 400);
  }
  return value;
}

/** The chat's fields from a request body, checked. Fields not given stay undefined. */
function chatFields(body) {
  const fields = {
    title: optionalString(body, 'title', 200),
    scenario: optionalString(body, 'scenario', MAX_SCENARIO_CHARACTERS),
    characterIds: optionalIdList(body, 'characterIds'),
    lorebookIds: optionalIdList(body, 'lorebookIds'),
  };
  for (const field of ['personaCharacterId', 'configPresetId']) {
    const value = body[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') {
      throw new AppError(`${field} must be an id or null`, 400);
    }
    fields[field] = value || null;
  }
  if (fields.personaCharacterId && !chats.characterExists(fields.personaCharacterId)) {
    throw new AppError('Persona character not found', 400);
  }
  if (fields.configPresetId && !chats.presetExists(fields.configPresetId)) {
    throw new AppError('Preset not found', 400);
  }
  if (fields.personaCharacterId && fields.characterIds?.includes(fields.personaCharacterId)) {
    throw new AppError("The persona can't also be a character in the chat", 400);
  }
  return fields;
}

/** Save through storage, turning a missing character or lorebook into a 400. */
function saveChat(write) {
  try {
    return write();
  } catch (error) {
    if (/^(Character|Lorebook) not found/.test(error.message)) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
}

async function characterCard(characterId) {
  try {
    const card = await storage.getCharacter(characterId);
    return { ...card, id: characterId };
  } catch {
    return null;
  }
}

function isAutoTitle(title) {
  return title === 'Untitled Chat' || title.startsWith('Chat with ');
}

async function defaultTitle(characterIds) {
  const cards = await Promise.all(characterIds.map(characterCard));
  const names = cards.filter(Boolean).map((card) => card.data?.name || 'Character');
  return names.length > 0 ? `Chat with ${joinNames(names)}` : 'Untitled Chat';
}

/**
 * Everything a reply needs: the chat's characters and persona as cards, its lorebooks with
 * entries, its preset (or the default one), and a provider for it.
 */
async function loadReplyContext(chat) {
  const presetId = chat.configPresetId || (await storage.getDefaultPresetId());
  if (!presetId) {
    throw new AppError('No configuration preset found. Please configure a preset first.', 400);
  }
  let preset;
  try {
    preset = await storage.getPreset(presetId);
  } catch (error) {
    throw new AppError(`Failed to load configuration preset: ${error.message}`, 400);
  }
  let provider;
  try {
    provider = getProvider(preset);
  } catch (error) {
    throw new AppError(`Failed to initialize provider: ${error.message}`, 400);
  }

  const characters = (await Promise.all(chat.characterIds.map(characterCard))).filter(Boolean);
  if (characters.length === 0) {
    throw new AppError('Add a character to this chat first', 400);
  }
  const persona = chat.personaCharacterId ? await characterCard(chat.personaCharacterId) : null;

  const lorebooks = [];
  for (const lorebookId of chat.lorebookIds) {
    try {
      lorebooks.push(await storage.getLorebook(lorebookId));
    } catch (error) {
      console.error(`[Chats] Failed to load lorebook ${lorebookId}:`, error.message);
    }
  }
  return { preset, provider, characters, persona, lorebooks };
}

function findSpeaker(characters, characterId) {
  const speaker = characters.find((card) => card.id === characterId);
  if (!speaker) {
    throw new AppError("That character isn't in this chat", 400);
  }
  return speaker;
}

/**
 * Write a reply and answer the request: as a stream of events when the client asked for one,
 * otherwise as JSON once the reply is saved.
 */
async function respondWithReply(req, res, { chat, context, speaker, userTurn, regenerate }) {
  const channel = sseChannel(req, res);
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  channel.open();
  if (userTurn) {
    channel.send({ type: 'turn', turn: userTurn });
  }
  channel.send({ type: 'speaker', characterId: speaker.id, name: speaker.data?.name ?? '' });

  try {
    const turn = await generateChatReply({
      chats,
      chat,
      speaker,
      ...context,
      regenerate,
      signal: controller.signal,
      onEvent: (event) => channel.send(event),
    });
    if (controller.signal.aborted) {
      // The client left; anything written so far was saved.
      if (!res.writableEnded) res.end();
      return;
    }
    channel.finish({ statusCode: 201, body: { userTurn, turn, chat: chats.getChat(chat.id) } });
  } catch (error) {
    if (controller.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }
    console.error('[Chats] Reply failed:', error);
    channel.fail(error.message, 502);
  }
}

// ==================== Chats ====================

// List chats, most recently active first
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ chats: chats.listChats() });
  }),
);

// Create a chat. The persona defaults to the default persona in settings.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const fields = chatFields(req.body ?? {});
    if (fields.personaCharacterId === undefined) {
      const settings = await storage.getSettings();
      const defaultPersona = settings?.defaultPersonaId ?? null;
      fields.personaCharacterId =
        defaultPersona &&
        chats.characterExists(defaultPersona) &&
        !fields.characterIds?.includes(defaultPersona)
          ? defaultPersona
          : null;
    }
    const title = fields.title || (await defaultTitle(fields.characterIds ?? []));
    const chat = saveChat(() => chats.createChat({ ...fields, title }));
    res.status(201).json({ chat });
  }),
);

// A chat and its turns
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const chat = requireChat(req.params.id);
    res.json({ chat, turns: chats.listTurns(chat.id) });
  }),
);

// Update a chat's title, scenario, characters, persona, lorebooks, or preset
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = requireChat(req.params.id);
    const fields = chatFields(req.body ?? {});
    const personaId =
      fields.personaCharacterId !== undefined
        ? fields.personaCharacterId
        : existing.personaCharacterId;
    const characterIds = fields.characterIds ?? existing.characterIds;
    if (personaId && characterIds.includes(personaId)) {
      throw new AppError("The persona can't also be a character in the chat", 400);
    }
    // A title named after the characters follows them, as a story's does.
    const characterChange =
      fields.characterIds !== undefined &&
      fields.title === undefined &&
      isAutoTitle(existing.title);
    if (fields.title === '' || characterChange) {
      fields.title = await defaultTitle(characterIds);
    }
    const chat = saveChat(() => chats.updateChat(existing.id, fields));
    res.json({ chat });
  }),
);

// Delete a chat and its messages
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!chats.deleteChat(req.params.id)) {
      throw new AppError('Chat not found', 404);
    }
    res.json({ success: true });
  }),
);

// ==================== Writing ====================

// Send a message as the persona. A character replies unless reply is false: characterId picks
// who, and otherwise someone the message names, or whoever spoke last.
router.post(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const chat = requireChat(req.params.id);
    const body = req.body ?? {};
    const text = requiredText(body.text, 'text');
    const wantsReply = body.reply !== false;
    const context = wantsReply ? await loadReplyContext(chat) : null;
    // Checked before the message is saved, so a bad request saves nothing.
    const chosen =
      context && body.characterId ? findSpeaker(context.characters, body.characterId) : null;

    const persona = chat.personaCharacterId ? await characterCard(chat.personaCharacterId) : null;
    const userTurn = chats.addTurn(chat.id, {
      source: 'user',
      characterId: persona?.id ?? null,
      senderName: persona?.data?.name ?? 'User',
      messages: [text],
    });

    if (!wantsReply) {
      res.status(201).json({ userTurn, chat: chats.getChat(chat.id) });
      return;
    }
    const speaker = chosen ?? pickSpeaker(context.characters, chats.listTurns(chat.id));
    await respondWithReply(req, res, { chat, context, speaker, userTurn });
  }),
);

// Have a character write without a new message from the user: to start the chat, or to follow
// up. characterId picks who; otherwise it's chosen as for a message.
router.post(
  '/:id/reply',
  asyncHandler(async (req, res) => {
    const chat = requireChat(req.params.id);
    const context = await loadReplyContext(chat);
    const { characterId } = req.body ?? {};
    const speaker = characterId
      ? findSpeaker(context.characters, characterId)
      : pickSpeaker(context.characters, chats.listTurns(chat.id));
    await respondWithReply(req, res, { chat, context, speaker, userTurn: null });
  }),
);

// Write another version of the last reply, kept as a new swipe
router.post(
  '/:id/turns/:turnId/regenerate',
  asyncHandler(async (req, res) => {
    const chat = requireChat(req.params.id);
    const turn = requireTurn(chat.id, req.params.turnId);
    if (turn.source !== 'character') {
      throw new AppError('Only replies can be regenerated', 400);
    }
    if (chats.getLastTurn(chat.id)?.id !== turn.id) {
      throw new AppError('Only the last reply can be regenerated', 400);
    }
    const context = await loadReplyContext(chat);
    const speaker = context.characters.find((card) => card.id === turn.characterId);
    if (!speaker) {
      throw new AppError('The character who wrote this reply is no longer in the chat', 400);
    }
    await respondWithReply(req, res, { chat, context, speaker, userTurn: null, regenerate: turn });
  }),
);

// ==================== Messages ====================

// Show another version of the last reply. Once the chat has moved on, a reply's version stays.
router.put(
  '/:id/turns/:turnId/swipe',
  asyncHandler(async (req, res) => {
    const chat = requireChat(req.params.id);
    requireTurn(chat.id, req.params.turnId);
    if (chats.getLastTurn(chat.id)?.id !== req.params.turnId) {
      throw new AppError('Only the last reply can switch versions', 400);
    }
    const turn = chats.setActiveSwipe(chat.id, req.params.turnId, req.body?.index);
    if (!turn) {
      throw new AppError('No such version of this reply', 400);
    }
    res.json({ turn });
  }),
);

// Edit one message of a turn
router.put(
  '/:id/turns/:turnId/messages/:index',
  asyncHandler(async (req, res) => {
    const chat = requireChat(req.params.id);
    requireTurn(chat.id, req.params.turnId);
    const content = requiredText(req.body?.content, 'content');
    const turn = chats.editMessage(chat.id, req.params.turnId, Number(req.params.index), content);
    if (!turn) {
      throw new AppError('Message not found', 404);
    }
    res.json({ turn });
  }),
);

// Delete one message of a turn; a turn left empty is removed
router.delete(
  '/:id/turns/:turnId/messages/:index',
  asyncHandler(async (req, res) => {
    const chat = requireChat(req.params.id);
    requireTurn(chat.id, req.params.turnId);
    const result = chats.deleteMessage(chat.id, req.params.turnId, Number(req.params.index));
    if (!result) {
      throw new AppError('Message not found', 404);
    }
    res.json(result);
  }),
);

// Clear the chat: delete every message, keeping its setup
router.delete(
  '/:id/turns',
  asyncHandler(async (req, res) => {
    const chat = requireChat(req.params.id);
    chats.clearTurns(chat.id);
    res.json({ success: true });
  }),
);

// Delete a whole turn: a user's message or a reply with all its versions
router.delete(
  '/:id/turns/:turnId',
  asyncHandler(async (req, res) => {
    const chat = requireChat(req.params.id);
    if (!chats.deleteTurn(chat.id, req.params.turnId)) {
      throw new AppError('Message not found', 404);
    }
    res.json({ success: true });
  }),
);

export default router;
