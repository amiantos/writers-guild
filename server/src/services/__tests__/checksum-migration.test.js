import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

import { SqliteStorageService } from '../sqliteStorage.js';
import { SCHEMA_VERSION } from '../database.js';
import { computeLorebookChecksum } from '../checksum-service.js';
import { LorebookParser } from '../lorebook-parser.js';
import { errorHandler } from '../../middleware/error-handler.js';

/**
 * Roll a v9 database back to the v8 shape: drop the checksum columns and reset
 * the recorded version. Reopening it then exercises the real migration path with
 * real data in place, which is the situation that matters — an install that
 * already has the duplicated lorebooks this feature exists to stop.
 */
function downgradeToV8(dbPath) {
  const db = new Database(dbPath);
  for (const table of ['characters', 'lorebooks']) {
    for (const column of [
      'import_origin_checksum',
      'import_internal_checksum',
      'current_checksum',
    ]) {
      db.exec(`DROP INDEX IF EXISTS idx_${table}_${column}`);
      db.exec(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    }
  }
  db.prepare('UPDATE schema_version SET version = 8').run();
  db.close();
}

function worldBook(content = 'Dragons are real.') {
  return {
    name: 'World Book',
    entries: [{ keys: ['dragon'], content, enabled: true, insertion_order: 100 }],
  };
}

/**
 * The lorebook as an import would store it: parsed from the embedded book, then
 * named after the character, exactly as extractAndSaveEmbeddedLorebook does.
 */
function parsedWorldBook(content = 'Dragons are real.') {
  const parsed = LorebookParser.parseEmbeddedLorebook(worldBook(content));
  parsed.name = "Alice's Lorebook";
  parsed.description = 'Lorebook for Alice';
  return parsed;
}

/**
 * A fresh copy of the characters router bound to the current temp directory.
 * The router keeps its storage service in module scope, so a per-test database
 * needs a per-test module instance.
 */
async function freshApp(dataRoot) {
  vi.resetModules();
  const { default: charactersRouter } = await import('../../routes/characters.js');

  const app = express();
  app.use(express.json());
  app.locals.dataRoot = dataRoot;
  app.use('/api/characters', charactersRouter);
  app.use(errorHandler);
  return app;
}

describe('schema v8 to v9 upgrade', () => {
  let tempDir;
  let dbPath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checksum-migration-'));
    dbPath = path.join(tempDir, 'writers-guild.db');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Seed a lorebook, then roll the database back to v8. */
  async function seedV8Install(content) {
    const seed = new SqliteStorageService(tempDir);
    await seed.saveLorebook('lb-existing', parsedWorldBook(content));
    seed.db.close();

    expect(fs.existsSync(dbPath)).toBe(true);
    downgradeToV8(dbPath);
  }

  it('adds the columns and reports the new version', async () => {
    await seedV8Install();

    const storage = new SqliteStorageService(tempDir);
    expect(storage.db.prepare('SELECT version FROM schema_version').get().version).toBe(
      SCHEMA_VERSION,
    );

    const columns = storage.db
      .prepare('PRAGMA table_info(lorebooks)')
      .all()
      .map((c) => c.name);
    expect(columns).toEqual(expect.arrayContaining(['import_origin_checksum', 'current_checksum']));
  });

  it('leaves migrated rows without a checksum until the backfill runs', async () => {
    await seedV8Install();
    const storage = new SqliteStorageService(tempDir);

    const before = storage.db
      .prepare('SELECT current_checksum FROM lorebooks WHERE id = ?')
      .get('lb-existing');
    expect(before.current_checksum).toBeNull();

    expect(await storage.backfillChecksums()).toEqual({ characters: 0, lorebooks: 1 });

    const after = storage.db
      .prepare('SELECT current_checksum FROM lorebooks WHERE id = ?')
      .get('lb-existing');
    expect(after.current_checksum).toBe(computeLorebookChecksum(parsedWorldBook()));
  });

  it('is idempotent across restarts', async () => {
    await seedV8Install();
    const storage = new SqliteStorageService(tempDir);
    await storage.backfillChecksums();
    expect(await storage.backfillChecksums()).toEqual({ characters: 0, lorebooks: 0 });
  });

  it('reuses a pre-existing lorebook when importing a character that carries it', async () => {
    // The whole point of the upgrade path. If backfilled checksums did not match
    // what an import computes, the installs that actually have this problem
    // would go on accumulating duplicates.
    await seedV8Install();

    const storage = new SqliteStorageService(tempDir);
    await storage.backfillChecksums();

    const app = await freshApp(tempDir);

    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: 'Alice', description: 'A knight.', character_book: worldBook() },
    };

    const { body } = await request(app)
      .post('/api/characters/import-json')
      .attach('character', Buffer.from(JSON.stringify(card)), 'card.json')
      .expect(201);

    expect(body.embeddedLorebook.reused).toBe(true);
    expect(body.embeddedLorebook.id).toBe('lb-existing');
    expect(storage.db.prepare('SELECT id FROM lorebooks').all()).toHaveLength(1);
  });

  it('still imports a lorebook whose content differs from the migrated one', async () => {
    await seedV8Install('Dragons are a myth.');

    const storage = new SqliteStorageService(tempDir);
    await storage.backfillChecksums();

    const app = await freshApp(tempDir);

    const card = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: 'Alice', description: 'A knight.', character_book: worldBook() },
    };

    const { body } = await request(app)
      .post('/api/characters/import-json')
      .attach('character', Buffer.from(JSON.stringify(card)), 'card.json')
      .expect(201);

    expect(body.embeddedLorebook.reused).toBe(false);
    expect(storage.db.prepare('SELECT id FROM lorebooks').all()).toHaveLength(2);
  });
});
