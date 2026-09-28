import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SqliteStorageService } from '../sqliteStorage.js';
import { SCHEMA_VERSION } from '../database.js';
import { scenarioWithContinuity } from '../continuity/continuity-storage.js';

/** Roll the main database back to v14, before Continuities. */
function downgradeToV14(dataRoot) {
  const db = new Database(path.join(dataRoot, 'writers-guild.db'));
  db.exec('ALTER TABLE stories DROP COLUMN continuity_id');
  db.exec('ALTER TABLE chats DROP COLUMN continuity_id');
  db.exec('DROP TABLE continuity_versions');
  db.exec('DROP TABLE continuities');
  db.exec('ALTER TABLE settings DROP COLUMN experimental_continuity');
  db.prepare('UPDATE schema_version SET version = 14').run();
  db.close();
}

describe('the Continuity migration', () => {
  let dataRoot;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-migration-test-'));
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('adds the toggle, off, the tables, and a Continuity to stories and chats', async () => {
    const before = new SqliteStorageService(dataRoot);
    const story = await before.createStory('Kept');
    before.close();
    downgradeToV14(dataRoot);

    const storage = new SqliteStorageService(dataRoot);
    try {
      expect((await storage.getSettings()).experimentalContinuity).toBe(false);
      expect(storage.db.prepare('SELECT COUNT(*) AS count FROM continuities').get().count).toBe(0);
      expect((await storage.getStory(story.id)).continuityId).toBeNull();
      const chatColumns = storage.db.prepare('PRAGMA table_info(chats)').all();
      expect(chatColumns.some((column) => column.name === 'continuity_id')).toBe(true);
      expect(storage.db.prepare('SELECT version FROM schema_version').get().version).toBe(
        SCHEMA_VERSION,
      );
    } finally {
      storage.close();
    }
  });
});

describe("the Continuity Archivist's migration", () => {
  it('adds the table of suggested Continuity updates', () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-suggestions-migration-'));
    try {
      new SqliteStorageService(dataRoot).close();
      const db = new Database(path.join(dataRoot, 'writers-guild.db'));
      db.exec('DROP TRIGGER continuity_suggestions_story_deleted');
      db.exec('DROP TRIGGER continuity_suggestions_chat_deleted');
      db.exec('DROP TABLE continuity_suggestions');
      db.prepare('UPDATE schema_version SET version = 15').run();
      db.close();

      const storage = new SqliteStorageService(dataRoot);
      try {
        const count = storage.db
          .prepare('SELECT COUNT(*) AS count FROM continuity_suggestions')
          .get().count;
        expect(count).toBe(0);
        expect(storage.db.prepare('SELECT version FROM schema_version').get().version).toBe(
          SCHEMA_VERSION,
        );
      } finally {
        storage.close();
      }
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});

describe('scenarioWithContinuity', () => {
  it('puts the Continuity first, with a blank line, and skips what is empty', () => {
    expect(scenarioWithContinuity(' World. ', ' Scene. ')).toBe('World.\n\nScene.');
    expect(scenarioWithContinuity('World.', '')).toBe('World.');
    expect(scenarioWithContinuity('', 'Scene.')).toBe('Scene.');
    expect(scenarioWithContinuity(null, undefined)).toBe('');
  });
});

describe('the perspective migration', () => {
  it('adds the perspective columns to stories, which read as the default', async () => {
    const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-migration-'));
    try {
      const before = new SqliteStorageService(dataRoot);
      const story = await before.createStory('Kept');
      before.close();

      const db = new Database(path.join(dataRoot, 'writers-guild.db'));
      for (const column of ['perspective', 'perspective_tense', 'perspective_character_id']) {
        db.exec(`ALTER TABLE stories DROP COLUMN ${column}`);
      }
      db.prepare('UPDATE schema_version SET version = 16').run();
      db.close();

      const storage = new SqliteStorageService(dataRoot);
      try {
        const migrated = await storage.getStory(story.id);
        expect(migrated.perspective).toBeNull();
        expect(migrated.perspectiveTense).toBeNull();
        expect(migrated.perspectiveCharacterId).toBeNull();
        expect(storage.db.prepare('SELECT version FROM schema_version').get().version).toBe(
          SCHEMA_VERSION,
        );
      } finally {
        storage.close();
      }
    } finally {
      fs.rmSync(dataRoot, { recursive: true, force: true });
    }
  });
});
