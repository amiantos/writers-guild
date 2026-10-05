import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SqliteStorageService } from '../sqliteStorage.js';
import { SCHEMA_VERSION } from '../database.js';

/**
 * Roll the main database back to v18, when Enhanced Story Mode, the Archivist and Continuities
 * each had an experimental toggle, here as a reader who had turned them all off.
 */
function downgradeToV18(dataRoot) {
  const db = new Database(path.join(dataRoot, 'writers-guild.db'));
  db.exec('ALTER TABLE settings DROP COLUMN experimental_old_story_mode');
  for (const column of [
    'experimental_enhanced_story',
    'experimental_archivist',
    'experimental_continuity',
  ]) {
    db.exec(`ALTER TABLE settings ADD COLUMN ${column} INTEGER DEFAULT 0`);
  }
  db.prepare('UPDATE schema_version SET version = 18').run();
  db.close();
}

describe('the old story mode migration', () => {
  let dataRoot;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'old-story-mode-migration-test-'));
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('adds the old story mode toggle, off, whatever the retired toggles said', async () => {
    new SqliteStorageService(dataRoot).close();
    downgradeToV18(dataRoot);

    const storage = new SqliteStorageService(dataRoot);
    try {
      const settings = await storage.getSettings();
      expect(settings.experimentalOldStoryMode).toBe(false);
      expect(settings).not.toHaveProperty('experimentalEnhancedStory');
      // Settings still save with the retired columns left in place
      await storage.saveSettings({ ...settings, experimentalOldStoryMode: true });
      expect((await storage.getSettings()).experimentalOldStoryMode).toBe(true);
      expect(storage.db.prepare('SELECT version FROM schema_version').get().version).toBe(
        SCHEMA_VERSION,
      );
    } finally {
      storage.close();
    }
  });
});
