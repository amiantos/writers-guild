import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SqliteStorageService } from '../sqliteStorage.js';
import { ChatStorage } from '../chat/chat-storage.js';
import { ContinuityStorage } from '../continuity/continuity-storage.js';
import { CardSuggestionStorage } from '../archivist/card-suggestion-storage.js';
import { UserStorage } from '../auth/user-storage.js';
import { OWNED_TABLES, SCHEMA_VERSION } from '../database.js';
import { ADMIN_USER_ID, runAsUser, setFallbackUserId } from '../user-context.js';

const card = (name) => ({ spec: 'chara_card_v2', data: { name, description: `${name}.` } });

describe('each user keeps to their own library', () => {
  let dataRoot;
  let storage;
  let chats;
  let continuities;
  let users;
  let guest;

  // As the auth middleware does for each request, rather than setup.js's fallback to the admin.
  beforeAll(() => setFallbackUserId(null));
  afterAll(() => setFallbackUserId(ADMIN_USER_ID));

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'user-isolation-test-'));
    storage = new SqliteStorageService(dataRoot);
    chats = new ChatStorage(storage.db);
    continuities = new ContinuityStorage(storage.db);
    users = new UserStorage(storage.db);
    guest = users.createUser({ username: 'guest', passwordHash: 'x' });
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  const asAdmin = (fn) => runAsUser(ADMIN_USER_ID, fn);
  const asGuest = (fn) => runAsUser(guest.id, fn);

  /** A story with a character, a lorebook, a preset, a chat and a Continuity, all the admin's. */
  async function adminLibrary() {
    return asAdmin(async () => {
      await storage.saveCharacter('char-a', card('Ada'));
      await storage.saveLorebook('lore-a', { name: 'Lore', entries: [{ keys: ['x'] }] });
      await storage.savePreset('preset-a', { name: 'Mine', apiConfig: { apiKey: 'secret' } });
      const story = await storage.createStory('Admin story');
      await storage.addCharacterToStory(story.id, 'char-a');
      await storage.addLorebookToStory(story.id, 'lore-a');
      await storage.updateStoryContent(story.id, 'Once upon a time');
      const chat = chats.createChat({ title: 'Admin chat', characterIds: ['char-a'] });
      chats.addTurn(chat.id, { source: 'user', messages: ['Hi'] });
      const continuity = continuities.create({ name: 'World', content: 'It is raining.' });
      return { story, chat, continuity };
    });
  }

  it('fails without a user rather than reading anyone', async () => {
    await expect(storage.listStories()).rejects.toThrow('No user for this operation');
    expect(() => chats.listChats()).toThrow('No user for this operation');
  });

  it("lists only the user's own things", async () => {
    await adminLibrary();

    await asGuest(async () => {
      expect(await storage.listStories()).toEqual([]);
      expect(await storage.listAllCharacters()).toEqual([]);
      expect(storage.listCharacterSummaries()).toEqual([]);
      expect(await storage.listAllLorebooks()).toEqual([]);
      expect(await storage.listPresets()).toEqual([]);
      expect(storage.listStoryLorebookLinks()).toEqual([]);
      expect(chats.listChats()).toEqual([]);
      expect(continuities.list()).toEqual([]);
    });
    await asAdmin(async () => {
      expect(await storage.listStories()).toHaveLength(1);
      expect(chats.listChats()).toHaveLength(1);
    });
  });

  it("can't read someone else's things by id", async () => {
    const { story, chat, continuity } = await adminLibrary();

    await asGuest(async () => {
      await expect(storage.getStory(story.id)).rejects.toThrow('Story not found');
      await expect(storage.getCharacter('char-a')).rejects.toThrow('Character not found');
      await expect(storage.getLorebook('lore-a')).rejects.toThrow('Lorebook not found');
      await expect(storage.getPreset('preset-a')).rejects.toThrow('Preset not found');
      expect(await storage.getCharacterImage('char-a')).toBeNull();
      expect(storage.listCharacterVersions('char-a')).toEqual([]);
      expect(await storage.listStoryCharacters(story.id)).toEqual([]);
      expect(await storage.listStoryLorebooks(story.id)).toEqual([]);
      expect(await storage.getStoriesUsingCharacter('char-a')).toEqual([]);
      expect(storage.getLorebookReferences('lore-a')).toEqual({ characters: [], stories: [] });
      expect(chats.getChat(chat.id)).toBeNull();
      expect(chats.listTurns(chat.id)).toEqual([]);
      expect(continuities.get(continuity.id)).toBeNull();
      expect(continuities.content(continuity.id)).toBe('');
      expect(continuities.listVersions(continuity.id)).toEqual([]);
      expect(storage.characterExists('char-a')).toBe(false);
    });
  });

  it("can't change or delete someone else's things", async () => {
    const { story, chat, continuity } = await adminLibrary();

    await asGuest(async () => {
      await expect(storage.updateStoryContent(story.id, 'Mine now')).rejects.toThrow(
        'Story not found',
      );
      await expect(storage.updateStoryMetadata(story.id, { title: 'Mine' })).rejects.toThrow(
        'Story not found',
      );
      await expect(storage.deleteStory(story.id)).rejects.toThrow('Story not found');
      await expect(storage.duplicateStory(story.id)).rejects.toThrow('Story not found');
      await expect(storage.undoStoryContent(story.id)).rejects.toThrow('Story not found');
      expect(() => storage.savePassagePrompt(story.id, { system: 's', user: 'u' })).toThrow(
        'Story not found',
      );
      await storage.deleteCharacter('char-a');
      await storage.deleteLorebook('lore-a');
      await storage.deletePreset('preset-a');
      expect(chats.updateChat(chat.id, { title: 'Mine' })).toBeNull();
      expect(chats.deleteChat(chat.id)).toBe(false);
      expect(() => chats.addTurn(chat.id, { source: 'user', messages: ['Hey'] })).toThrow(
        'Chat not found',
      );
      expect(continuities.update(continuity.id, { name: 'Mine', content: '' })).toBeNull();
      expect(continuities.delete(continuity.id)).toBe(false);
      // Saving under someone else's id doesn't take theirs over
      await expect(storage.saveCharacter('char-a', card('Impostor'))).rejects.toThrow(
        'UNIQUE constraint failed',
      );
      await expect(storage.saveLorebook('lore-a', { name: 'Impostor' })).rejects.toThrow(
        'UNIQUE constraint failed',
      );
      await expect(storage.savePreset('preset-a', { name: 'Impostor' })).rejects.toThrow(
        'UNIQUE constraint failed',
      );
    });

    await asAdmin(async () => {
      const kept = await storage.getStory(story.id);
      expect(kept.title).toBe('Admin story');
      expect(kept.content).toBe('Once upon a time');
      expect((await storage.getCharacter('char-a')).data.name).toBe('Ada');
      expect((await storage.getLorebook('lore-a')).entries).toHaveLength(1);
      expect((await storage.getPreset('preset-a')).name).toBe('Mine');
      expect(chats.getChat(chat.id).title).toBe('Admin chat');
      expect(chats.listTurns(chat.id)).toHaveLength(1);
      expect(continuities.get(continuity.id).name).toBe('World');
    });
  });

  it("can't bring someone else's things into their own", async () => {
    await adminLibrary();

    await asGuest(async () => {
      const story = await storage.createStory('Guest story');
      await expect(storage.addCharacterToStory(story.id, 'char-a')).rejects.toThrow(
        'Character not found',
      );
      await expect(storage.addLorebookToStory(story.id, 'lore-a')).rejects.toThrow(
        'Lorebook not found',
      );
      await expect(storage.setStoryPersona(story.id, 'char-a')).rejects.toThrow(
        'Character not found',
      );
      expect(() => chats.createChat({ title: 'Guest chat', characterIds: ['char-a'] })).toThrow(
        'Character not found',
      );
      expect(() => chats.createChat({ title: 'Guest chat', lorebookIds: ['lore-a'] })).toThrow(
        'Lorebook not found',
      );
      expect(chats.presetExists('preset-a')).toBe(false);
      const suggestions = new CardSuggestionStorage(storage.db);
      expect(
        suggestions.addAll('story', story.id, [
          { characterId: 'char-a', field: 'description', find: '', replace: 'Pwned.' },
        ]),
      ).toEqual([]);
    });
  });

  it('finds duplicate imports only in their own library', async () => {
    await asAdmin(() =>
      storage.saveCharacter('char-a', card('Ada'), null, { originChecksum: 'c' }),
    );
    await asAdmin(() => storage.saveLorebook('lore-a', { name: 'Lore' }, { originChecksum: 'l' }));

    await asGuest(() => {
      expect(storage.findCharactersByOriginChecksum('c')).toEqual([]);
      expect(storage.findExistingLorebookForImport('l')).toBeNull();
      // Lorebook names only need to differ within a library
      expect(storage.resolveUniqueLorebookName('Lore')).toBe('Lore');
    });
  });

  it('keeps settings for each user, starting from the defaults', async () => {
    await asAdmin(async () => {
      const settings = await storage.getSettings();
      await storage.saveSettings({ ...settings, onboardingCompleted: true, autoSave: false });
    });

    await asGuest(async () => {
      const settings = await storage.getSettings();
      expect(settings.onboardingCompleted).toBe(false);
      expect(settings.autoSave).toBe(true);
    });
    expect((await asAdmin(() => storage.getSettings())).autoSave).toBe(false);
  });

  it('deletes everything of a user with their account', async () => {
    await asGuest(async () => {
      await storage.saveCharacter('char-g', card('Gil'));
      await storage.saveLorebook('lore-g', { name: 'Guest lore', entries: [{ keys: ['y'] }] });
      await storage.savePreset('preset-g', { name: 'Guest preset' });
      const story = await storage.createStory('Guest story');
      await storage.addCharacterToStory(story.id, 'char-g');
      chats.createChat({ title: 'Guest chat', characterIds: ['char-g'] });
      continuities.create({ name: 'Guest world' });
      await storage.getSettings();
    });
    await adminLibrary();
    const session = users.createSession(guest.id);

    expect(users.deleteUser(guest.id)).toEqual({
      characterIds: ['char-g'],
      lorebookIds: ['lore-g'],
    });

    for (const table of OWNED_TABLES) {
      const owners = storage.db.prepare(`SELECT DISTINCT user_id FROM ${table}`).all();
      expect(owners.map((row) => row.user_id)).toEqual([ADMIN_USER_ID]);
    }
    expect(storage.db.prepare('SELECT COUNT(*) AS n FROM lorebook_entries').get().n).toBe(1);
    expect(storage.db.prepare('SELECT user_id FROM settings').all()).toEqual([
      { user_id: ADMIN_USER_ID },
    ]);
    expect(users.userForSession(session)).toBeNull();
    expect(users.getUser(guest.id)).toBeNull();
  });
});

describe('the users migration', () => {
  let dataRoot;

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  /** A v20 database: one row of settings, and no users or owners. */
  async function v20Install() {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'users-migration-test-'));
    const storage = new SqliteStorageService(dataRoot);
    await runAsUser(ADMIN_USER_ID, async () => {
      await storage.createStory('Old story');
      await storage.saveCharacter('old-char', card('Old'));
    });
    storage.close();

    const db = new Database(path.join(dataRoot, 'writers-guild.db'));
    db.exec(`
      DROP TABLE settings;
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        show_reasoning INTEGER DEFAULT 1,
        auto_save INTEGER DEFAULT 1,
        show_prompt INTEGER DEFAULT 1,
        third_person INTEGER DEFAULT 1,
        filter_asterisks INTEGER DEFAULT 1,
        include_dialogue_examples INTEGER DEFAULT 0,
        lorebook_scan_depth INTEGER DEFAULT 2000,
        lorebook_token_budget INTEGER DEFAULT 1800,
        lorebook_recursion_depth INTEGER DEFAULT 3,
        lorebook_enable_recursion INTEGER DEFAULT 1,
        default_persona_id TEXT,
        default_preset_id TEXT,
        onboarding_completed INTEGER DEFAULT 0,
        experimental_chats INTEGER DEFAULT 0,
        experimental_old_story_mode INTEGER DEFAULT 0,
        experimental_bureaus INTEGER DEFAULT 0
      );
      INSERT INTO settings (id, onboarding_completed, default_persona_id, experimental_chats)
        VALUES (1, 1, 'old-char', 1);
      DROP TABLE sessions;
      DROP TABLE invitations;
      DROP TABLE users;
    `);
    for (const table of OWNED_TABLES) {
      db.exec(`DROP INDEX idx_${table}_user`);
      db.exec(`ALTER TABLE ${table} DROP COLUMN user_id`);
    }
    db.prepare('UPDATE schema_version SET version = 20').run();
    db.close();
  }

  it("makes everything so far the admin's, settings included", async () => {
    await v20Install();
    const storage = new SqliteStorageService(dataRoot);
    try {
      expect(storage.db.prepare('SELECT version FROM schema_version').get().version).toBe(
        SCHEMA_VERSION,
      );
      const users = new UserStorage(storage.db);
      expect(users.listUsers().map((user) => user.id)).toEqual([ADMIN_USER_ID]);
      expect(users.authEnabled()).toBe(false);

      await runAsUser(ADMIN_USER_ID, async () => {
        expect((await storage.listStories()).map((story) => story.title)).toEqual(['Old story']);
        expect((await storage.getCharacter('old-char')).data.name).toBe('Old');
        const settings = await storage.getSettings();
        expect(settings.onboardingCompleted).toBe(true);
        expect(settings.defaultPersonaId).toBe('old-char');
        expect(settings.experimentalChats).toBe(true);
      });
    } finally {
      storage.close();
    }
  });
});
