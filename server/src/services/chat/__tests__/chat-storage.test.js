import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SqliteStorageService } from '../../sqliteStorage.js';
import { ChatStorage } from '../chat-storage.js';

describe('ChatStorage', () => {
  let tempDir;
  let storage;
  let chats;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-storage-test-'));
    storage = new SqliteStorageService(tempDir);
    chats = new ChatStorage(storage.db);
    await storage.saveCharacter('layla', { spec: 'chara_card_v2', data: { name: 'Layla' } });
    await storage.saveCharacter('sam', { spec: 'chara_card_v2', data: { name: 'Sam' } });
    await storage.saveLorebook('book', { name: 'Book', entries: [] });
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function reply(chatId, messages) {
    return chats.addTurn(chatId, {
      source: 'character',
      characterId: 'layla',
      senderName: 'Layla',
      messages,
    });
  }

  it('creates, lists, updates, and deletes chats with their characters and lorebooks', () => {
    const chat = chats.createChat({
      title: 'Late night',
      scenario: 'Midnight.',
      characterIds: ['sam', 'layla'],
      lorebookIds: ['book'],
    });
    expect(chat).toMatchObject({
      title: 'Late night',
      scenario: 'Midnight.',
      characterIds: ['sam', 'layla'],
      lorebookIds: ['book'],
      personaCharacterId: null,
    });

    const updated = chats.updateChat(chat.id, { scenario: 'Dawn.', characterIds: ['layla'] });
    expect(updated).toMatchObject({ title: 'Late night', scenario: 'Dawn.' });
    expect(updated.characterIds).toEqual(['layla']);

    expect(chats.listChats().map((item) => item.id)).toEqual([chat.id]);
    expect(chats.deleteChat(chat.id)).toBe(true);
    expect(chats.getChat(chat.id)).toBeNull();
    expect(chats.updateChat(chat.id, { title: 'x' })).toBeNull();
  });

  it('rejects characters and lorebooks that do not exist', () => {
    expect(() => chats.createChat({ title: 'x', characterIds: ['nobody'] })).toThrow(
      'Character not found',
    );
    expect(() => chats.createChat({ title: 'x', lorebookIds: ['nothing'] })).toThrow(
      'Lorebook not found',
    );
    expect(chats.listChats()).toEqual([]);
  });

  it('drops a deleted character from its chats', async () => {
    const chat = chats.createChat({ title: 'x', characterIds: ['layla', 'sam'] });
    await storage.deleteCharacter('sam');
    expect(chats.getChat(chat.id).characterIds).toEqual(['layla']);
  });

  it('adds turns in order and reports the last message in the list', () => {
    const chat = chats.createChat({ title: 'x', characterIds: ['layla'] });
    chats.addTurn(chat.id, { source: 'user', senderName: 'Bradley', messages: ['hey'] });
    reply(chat.id, ['hi', 'what’s up']);

    const turns = chats.listTurns(chat.id);
    expect(turns.map((turn) => [turn.position, turn.source, turn.messages])).toEqual([
      [0, 'user', ['hey']],
      [1, 'character', ['hi', 'what’s up']],
    ]);
    expect(chats.listChats()[0]).toMatchObject({
      turnCount: 2,
      lastMessage: { senderName: 'Layla', content: 'what’s up' },
    });
    expect(() => chats.addTurn(chat.id, { source: 'narrator', messages: ['x'] })).toThrow(
      'Unknown turn source',
    );
  });

  it('keeps swipes, switching the active one', () => {
    const chat = chats.createChat({ title: 'x', characterIds: ['layla'] });
    const turn = reply(chat.id, ['first']);

    const swiped = chats.addSwipe(chat.id, turn.id, { messages: ['second'], reasoning: 'hmm' });
    expect(swiped.activeSwipe).toBe(1);
    expect(swiped.messages).toEqual(['second']);
    expect(swiped.swipes[1].reasoning).toBe('hmm');

    expect(chats.setActiveSwipe(chat.id, turn.id, 0).messages).toEqual(['first']);
    expect(chats.setActiveSwipe(chat.id, turn.id, 5)).toBeNull();
    expect(chats.setActiveSwipe(chat.id, turn.id, 'x')).toBeNull();
  });

  it('edits a message in the active swipe only', () => {
    const chat = chats.createChat({ title: 'x', characterIds: ['layla'] });
    const turn = reply(chat.id, ['a', 'b']);
    chats.addSwipe(chat.id, turn.id, { messages: ['c', 'd'] });

    const edited = chats.editMessage(chat.id, turn.id, 1, 'D');
    expect(edited.messages).toEqual(['c', 'D']);
    expect(edited.swipes[0].messages).toEqual(['a', 'b']);
    expect(edited.swipes[1].edited).toBe(true);
    expect(chats.editMessage(chat.id, turn.id, 2, 'x')).toBeNull();
  });

  it('deletes messages, then the swipe, then the turn as they empty', () => {
    const chat = chats.createChat({ title: 'x', characterIds: ['layla'] });
    const turn = reply(chat.id, ['a', 'b']);
    chats.addSwipe(chat.id, turn.id, { messages: ['c'] });

    expect(chats.deleteMessage(chat.id, turn.id, 0).turn.messages).toEqual(['a', 'b']);
    expect(chats.deleteMessage(chat.id, turn.id, 0).turn.messages).toEqual(['b']);
    expect(chats.deleteMessage(chat.id, turn.id, 0)).toEqual({ turn: null });
    expect(chats.listTurns(chat.id)).toEqual([]);
    expect(chats.deleteMessage(chat.id, turn.id, 0)).toBeNull();
  });

  it('deletes whole turns', () => {
    const chat = chats.createChat({ title: 'x', characterIds: ['layla'] });
    const turn = reply(chat.id, ['a']);
    expect(chats.deleteTurn(chat.id, turn.id)).toBe(true);
    expect(chats.deleteTurn(chat.id, turn.id)).toBe(false);
  });
});
