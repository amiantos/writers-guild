import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SqliteStorageService } from '../sqliteStorage.js';
import { SCHEMA_VERSION } from '../database.js';

/** Roll the main database back to v13, before the Archivist. */
function downgradeToV13(dataRoot) {
  const db = new Database(path.join(dataRoot, 'writers-guild.db'));
  db.exec('DROP TRIGGER card_suggestions_story_deleted');
  db.exec('DROP TRIGGER card_suggestions_chat_deleted');
  db.exec('DROP TABLE card_suggestions');
  db.prepare('UPDATE schema_version SET version = 13').run();
  db.close();
}

describe('the Archivist migration', () => {
  let dataRoot;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archivist-migration-test-'));
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('adds the table of suggestions', async () => {
    new SqliteStorageService(dataRoot).close();
    downgradeToV13(dataRoot);

    const storage = new SqliteStorageService(dataRoot);
    try {
      expect(storage.db.prepare('SELECT COUNT(*) AS count FROM card_suggestions').get().count).toBe(
        0,
      );
      expect(storage.db.prepare('SELECT version FROM schema_version').get().version).toBe(
        SCHEMA_VERSION,
      );
    } finally {
      storage.close();
    }
  });
});
