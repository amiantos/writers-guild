import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SqliteStorageService } from '../sqliteStorage.js';
import { SCHEMA_VERSION } from '../database.js';

/** Roll the main database back to v11, before Enhanced Story Mode. */
function downgradeToV11(dataRoot) {
  const db = new Database(path.join(dataRoot, 'writers-guild.db'));
  db.exec('ALTER TABLE settings DROP COLUMN experimental_enhanced_story');
  db.exec('ALTER TABLE stories DROP COLUMN passages');
  db.prepare('UPDATE schema_version SET version = 11').run();
  db.close();
}

describe('the Enhanced Story Mode migration', () => {
  let dataRoot;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'enhanced-story-test-'));
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('adds the toggle, off, and an empty record of passages to existing stories', async () => {
    let storage = new SqliteStorageService(dataRoot);
    const { id } = await storage.createStory('Old story');
    await storage.updateStoryContent(id, 'Once upon a time.');
    storage.close();
    downgradeToV11(dataRoot);

    storage = new SqliteStorageService(dataRoot);
    try {
      expect((await storage.getSettings()).experimentalEnhancedStory).toBe(false);
      const story = await storage.getStory(id);
      expect(story.content).toBe('Once upon a time.');
      expect(story.passages).toEqual([]);
      expect(storage.db.prepare('SELECT version FROM schema_version').get().version).toBe(
        SCHEMA_VERSION,
      );
    } finally {
      storage.close();
    }
  });
});
