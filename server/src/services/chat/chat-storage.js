/**
 * Chat Storage
 *
 * Queries for chat mode: text message conversations between the user's persona
 * and one or more characters. A chat is a list of turns, each one message from
 * the user or one reply from a character. A reply can hold several messages
 * and can be regenerated; its versions are its swipes, and the active swipe is
 * the one the conversation shows and the prompt reads.
 *
 * Methods are synchronous, like better-sqlite3 itself. The tables are created
 * with the rest of the schema in database.js.
 */

import { v4 as uuidv4 } from 'uuid';

export const TURN_SOURCES = ['user', 'character'];

function timestamp() {
  return new Date().toISOString();
}

function parseSwipes(json) {
  try {
    const swipes = JSON.parse(json || '[]');
    return Array.isArray(swipes) ? swipes : [];
  } catch {
    return [];
  }
}

function turnFromRow(row) {
  const swipes = parseSwipes(row.swipes);
  const activeSwipe = Math.min(Math.max(row.active_swipe, 0), Math.max(swipes.length - 1, 0));
  return {
    id: row.id,
    chatId: row.chat_id,
    position: row.position,
    source: row.source,
    characterId: row.character_id,
    senderName: row.sender_name,
    swipes,
    activeSwipe,
    messages: swipes[activeSwipe]?.messages ?? [],
    created: row.created,
    modified: row.modified,
  };
}

function newSwipe({ messages, reasoning = '' }) {
  return { messages, reasoning: reasoning || '', edited: false, created: timestamp() };
}

export class ChatStorage {
  /**
   * @param {import('better-sqlite3').Database} db - The main database, as opened by
   *   SqliteStorageService.
   */
  constructor(db) {
    this.db = db;
    this.prepareStatements();
  }

  prepareStatements() {
    this.stmts = {
      listChats: this.db.prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM chat_turns t WHERE t.chat_id = c.id) AS turn_count,
          (SELECT COALESCE(SUM(json_array_length(t.swipes,
                    '$[' || t.active_swipe || '].messages')), 0)
             FROM chat_turns t WHERE t.chat_id = c.id) AS message_count
        FROM chats c
        ORDER BY c.modified DESC, c.rowid DESC
      `),
      getChat: this.db.prepare('SELECT * FROM chats WHERE id = ?'),
      insertChat: this.db.prepare(`
        INSERT INTO chats (id, title, scenario, persona_character_id, config_preset_id, created, modified)
        VALUES (@id, @title, @scenario, @personaCharacterId, @configPresetId, @created, @modified)
      `),
      updateChat: this.db.prepare(`
        UPDATE chats SET title = @title, scenario = @scenario,
                         persona_character_id = @personaCharacterId,
                         config_preset_id = @configPresetId, modified = @modified
        WHERE id = @id
      `),
      touchChat: this.db.prepare('UPDATE chats SET modified = ? WHERE id = ?'),
      deleteChat: this.db.prepare('DELETE FROM chats WHERE id = ?'),

      getCharacterIds: this.db.prepare(
        'SELECT character_id FROM chat_characters WHERE chat_id = ? ORDER BY position, rowid',
      ),
      clearCharacters: this.db.prepare('DELETE FROM chat_characters WHERE chat_id = ?'),
      addCharacter: this.db.prepare(
        'INSERT OR IGNORE INTO chat_characters (chat_id, character_id, position) VALUES (?, ?, ?)',
      ),
      getLorebookIds: this.db.prepare(
        'SELECT lorebook_id FROM chat_lorebooks WHERE chat_id = ? ORDER BY rowid',
      ),
      clearLorebooks: this.db.prepare('DELETE FROM chat_lorebooks WHERE chat_id = ?'),
      addLorebook: this.db.prepare(
        'INSERT OR IGNORE INTO chat_lorebooks (chat_id, lorebook_id) VALUES (?, ?)',
      ),
      characterExists: this.db.prepare('SELECT 1 FROM characters WHERE id = ?'),
      lorebookExists: this.db.prepare('SELECT 1 FROM lorebooks WHERE id = ?'),
      presetExists: this.db.prepare('SELECT 1 FROM presets WHERE id = ?'),

      listTurns: this.db.prepare('SELECT * FROM chat_turns WHERE chat_id = ? ORDER BY position'),
      lastTurn: this.db.prepare(
        'SELECT * FROM chat_turns WHERE chat_id = ? ORDER BY position DESC LIMIT 1',
      ),
      getTurn: this.db.prepare('SELECT * FROM chat_turns WHERE chat_id = ? AND id = ?'),
      nextPosition: this.db.prepare(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM chat_turns WHERE chat_id = ?',
      ),
      insertTurn: this.db.prepare(`
        INSERT INTO chat_turns (id, chat_id, position, source, character_id, sender_name, swipes,
                                active_swipe, created, modified)
        VALUES (@id, @chatId, @position, @source, @characterId, @senderName, @swipes, 0,
                @created, @modified)
      `),
      updateTurnSwipes: this.db.prepare(
        'UPDATE chat_turns SET swipes = ?, active_swipe = ?, modified = ? WHERE id = ?',
      ),
      deleteTurn: this.db.prepare('DELETE FROM chat_turns WHERE chat_id = ? AND id = ?'),
      clearTurns: this.db.prepare('DELETE FROM chat_turns WHERE chat_id = ?'),
    };
  }

  // ==================== Chats ====================

  chatFromRow(row) {
    return {
      id: row.id,
      title: row.title,
      scenario: row.scenario || '',
      personaCharacterId: row.persona_character_id,
      configPresetId: row.config_preset_id,
      characterIds: this.stmts.getCharacterIds.all(row.id).map((r) => r.character_id),
      lorebookIds: this.stmts.getLorebookIds.all(row.id).map((r) => r.lorebook_id),
      created: row.created,
      modified: row.modified,
    };
  }

  /** Every chat, most recently active first, with its turn count and last message. */
  listChats() {
    return this.stmts.listChats.all().map((row) => {
      const last = this.stmts.lastTurn.get(row.id);
      const lastTurn = last ? turnFromRow(last) : null;
      return {
        ...this.chatFromRow(row),
        turnCount: row.turn_count,
        messageCount: row.message_count,
        lastMessage: lastTurn
          ? { senderName: lastTurn.senderName, content: lastTurn.messages.at(-1) ?? '' }
          : null,
      };
    });
  }

  /** @returns {Object|null} */
  getChat(chatId) {
    const row = this.stmts.getChat.get(chatId);
    return row ? this.chatFromRow(row) : null;
  }

  /**
   * @param {Object} fields
   * @param {string} fields.title
   * @param {string} [fields.scenario]
   * @param {string|null} [fields.personaCharacterId]
   * @param {string|null} [fields.configPresetId]
   * @param {string[]} [fields.characterIds]
   * @param {string[]} [fields.lorebookIds]
   */
  createChat(fields) {
    const id = uuidv4();
    const now = timestamp();
    this.db.transaction(() => {
      this.stmts.insertChat.run({
        id,
        title: fields.title,
        scenario: fields.scenario ?? '',
        personaCharacterId: fields.personaCharacterId ?? null,
        configPresetId: fields.configPresetId ?? null,
        created: now,
        modified: now,
      });
      this.setCharacters(id, fields.characterIds ?? []);
      this.setLorebooks(id, fields.lorebookIds ?? []);
    })();
    return this.getChat(id);
  }

  /**
   * Update a chat's fields. Fields left undefined keep their values; characterIds and
   * lorebookIds replace the lists when given.
   * @returns {Object|null} The updated chat, or null if it doesn't exist.
   */
  updateChat(chatId, updates) {
    const existing = this.getChat(chatId);
    if (!existing) return null;
    this.db.transaction(() => {
      this.stmts.updateChat.run({
        id: chatId,
        title: updates.title ?? existing.title,
        scenario: updates.scenario ?? existing.scenario,
        personaCharacterId:
          updates.personaCharacterId !== undefined
            ? updates.personaCharacterId
            : existing.personaCharacterId,
        configPresetId:
          updates.configPresetId !== undefined ? updates.configPresetId : existing.configPresetId,
        modified: timestamp(),
      });
      if (updates.characterIds !== undefined) this.setCharacters(chatId, updates.characterIds);
      if (updates.lorebookIds !== undefined) this.setLorebooks(chatId, updates.lorebookIds);
    })();
    return this.getChat(chatId);
  }

  setCharacters(chatId, characterIds) {
    this.stmts.clearCharacters.run(chatId);
    [...new Set(characterIds)].forEach((characterId, index) => {
      if (!this.stmts.characterExists.get(characterId)) {
        throw new Error(`Character not found: ${characterId}`);
      }
      this.stmts.addCharacter.run(chatId, characterId, index);
    });
  }

  setLorebooks(chatId, lorebookIds) {
    this.stmts.clearLorebooks.run(chatId);
    for (const lorebookId of new Set(lorebookIds)) {
      if (!this.stmts.lorebookExists.get(lorebookId)) {
        throw new Error(`Lorebook not found: ${lorebookId}`);
      }
      this.stmts.addLorebook.run(chatId, lorebookId);
    }
  }

  characterExists(characterId) {
    return Boolean(this.stmts.characterExists.get(characterId));
  }

  presetExists(presetId) {
    return Boolean(this.stmts.presetExists.get(presetId));
  }

  /** @returns {boolean} Whether the chat existed. */
  deleteChat(chatId) {
    return this.stmts.deleteChat.run(chatId).changes > 0;
  }

  // ==================== Turns ====================

  /** A chat's turns, oldest first. */
  listTurns(chatId) {
    return this.stmts.listTurns.all(chatId).map(turnFromRow);
  }

  /** @returns {Object|null} */
  getTurn(chatId, turnId) {
    const row = this.stmts.getTurn.get(chatId, turnId);
    return row ? turnFromRow(row) : null;
  }

  /** @returns {Object|null} */
  getLastTurn(chatId) {
    const row = this.stmts.lastTurn.get(chatId);
    return row ? turnFromRow(row) : null;
  }

  /**
   * Add a turn at the end of the chat.
   * @param {string} chatId
   * @param {Object} turn
   * @param {'user'|'character'} turn.source
   * @param {string|null} [turn.characterId] - Who wrote it: the character replying, or the
   *   persona for the user's messages.
   * @param {string} [turn.senderName]
   * @param {string[]} turn.messages
   * @param {string} [turn.reasoning]
   */
  addTurn(chatId, { source, characterId = null, senderName = '', messages, reasoning = '' }) {
    if (!TURN_SOURCES.includes(source)) {
      throw new Error(`Unknown turn source: ${source}`);
    }
    const id = uuidv4();
    const now = timestamp();
    this.db.transaction(() => {
      this.stmts.insertTurn.run({
        id,
        chatId,
        position: this.stmts.nextPosition.get(chatId).next,
        source,
        characterId,
        senderName,
        swipes: JSON.stringify([newSwipe({ messages, reasoning })]),
        created: now,
        modified: now,
      });
      this.stmts.touchChat.run(now, chatId);
    })();
    return this.getTurn(chatId, id);
  }

  writeSwipes(chatId, turnId, swipes, activeSwipe) {
    const now = timestamp();
    this.stmts.updateTurnSwipes.run(JSON.stringify(swipes), activeSwipe, now, turnId);
    this.stmts.touchChat.run(now, chatId);
    return this.getTurn(chatId, turnId);
  }

  /** Add a new version of a reply and make it the active one. */
  addSwipe(chatId, turnId, { messages, reasoning = '' }) {
    const turn = this.getTurn(chatId, turnId);
    if (!turn) return null;
    const swipes = [...turn.swipes, newSwipe({ messages, reasoning })];
    return this.writeSwipes(chatId, turnId, swipes, swipes.length - 1);
  }

  /** @returns {Object|null} The turn, or null if it or the swipe doesn't exist. */
  setActiveSwipe(chatId, turnId, index) {
    const turn = this.getTurn(chatId, turnId);
    if (!turn || !Number.isInteger(index) || index < 0 || index >= turn.swipes.length) {
      return null;
    }
    return this.writeSwipes(chatId, turnId, turn.swipes, index);
  }

  /**
   * Edit one message in a turn's active swipe.
   * @returns {Object|null} The turn, or null if it or the message doesn't exist.
   */
  editMessage(chatId, turnId, index, content) {
    const turn = this.getTurn(chatId, turnId);
    if (!turn || !Number.isInteger(index) || index < 0 || index >= turn.messages.length) {
      return null;
    }
    const swipes = turn.swipes.map((swipe, swipeIndex) =>
      swipeIndex === turn.activeSwipe
        ? {
            ...swipe,
            messages: swipe.messages.map((message, i) => (i === index ? content : message)),
            edited: true,
          }
        : swipe,
    );
    return this.writeSwipes(chatId, turnId, swipes, turn.activeSwipe);
  }

  /**
   * Delete one message from a turn's active swipe. A swipe left with no messages is
   * removed, and so is a turn left with no swipes.
   * @returns {{ turn: Object|null }|null} The turn as it stands (null once removed), or null
   *   if it or the message doesn't exist.
   */
  deleteMessage(chatId, turnId, index) {
    const turn = this.getTurn(chatId, turnId);
    if (!turn || !Number.isInteger(index) || index < 0 || index >= turn.messages.length) {
      return null;
    }
    let result;
    this.db.transaction(() => {
      const messages = turn.messages.filter((_message, i) => i !== index);
      let swipes;
      let activeSwipe = turn.activeSwipe;
      if (messages.length > 0) {
        swipes = turn.swipes.map((swipe, swipeIndex) =>
          swipeIndex === turn.activeSwipe ? { ...swipe, messages, edited: true } : swipe,
        );
      } else {
        swipes = turn.swipes.filter((_swipe, swipeIndex) => swipeIndex !== turn.activeSwipe);
        activeSwipe = Math.max(0, Math.min(activeSwipe, swipes.length - 1));
      }
      if (swipes.length === 0) {
        this.stmts.deleteTurn.run(chatId, turnId);
        this.stmts.touchChat.run(timestamp(), chatId);
        result = { turn: null };
      } else {
        result = { turn: this.writeSwipes(chatId, turnId, swipes, activeSwipe) };
      }
    })();
    return result;
  }

  /** Delete every turn in a chat. */
  clearTurns(chatId) {
    this.stmts.clearTurns.run(chatId);
    this.stmts.touchChat.run(timestamp(), chatId);
  }

  /** @returns {boolean} Whether the turn existed. */
  deleteTurn(chatId, turnId) {
    const deleted = this.stmts.deleteTurn.run(chatId, turnId).changes > 0;
    if (deleted) this.stmts.touchChat.run(timestamp(), chatId);
    return deleted;
  }
}
