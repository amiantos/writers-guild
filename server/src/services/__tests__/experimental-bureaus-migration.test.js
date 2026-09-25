import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SqliteStorageService } from '../sqliteStorage.js';
import { SCHEMA_VERSION } from '../database.js';
import { BureauStorage } from '../bureau/bureau-storage.js';
import { closeBureauDb } from '../bureau/bureau-db.js';

/** Roll the main database back to v10, before Bureaus had a toggle. */
function downgradeToV10(dataRoot) {
  const db = new Database(path.join(dataRoot, 'writers-guild.db'));
  db.exec('ALTER TABLE settings DROP COLUMN experimental_bureaus');
  db.prepare('UPDATE schema_version SET version = 10').run();
  db.close();
}

function createBureau(dataRoot) {
  new BureauStorage(dataRoot).createBureau({ name: 'Harbor' });
  closeBureauDb(dataRoot);
}

async function bureausEnabled(dataRoot) {
  const storage = new SqliteStorageService(dataRoot);
  try {
    return (await storage.getSettings()).experimentalBureaus;
  } finally {
    storage.close();
  }
}

describe('the Bureaus experimental toggle', () => {
  let dataRoot;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-toggle-test-'));
  });

  afterEach(() => {
    closeBureauDb(dataRoot);
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('is off for a new install', async () => {
    expect(await bureausEnabled(dataRoot)).toBe(false);
  });

  it('turns on when an upgrade finds existing Bureaus', async () => {
    new SqliteStorageService(dataRoot).close();
    createBureau(dataRoot);
    downgradeToV10(dataRoot);

    expect(await bureausEnabled(dataRoot)).toBe(true);
    const db = new Database(path.join(dataRoot, 'writers-guild.db'), { readonly: true });
    expect(db.prepare('SELECT version FROM schema_version').get().version).toBe(SCHEMA_VERSION);
    db.close();
  });

  it('stays off on upgrade when bureau.db has no Bureaus, or there is none', async () => {
    new SqliteStorageService(dataRoot).close();
    downgradeToV10(dataRoot);
    expect(await bureausEnabled(dataRoot)).toBe(false);
    expect(fs.existsSync(path.join(dataRoot, 'bureau.db'))).toBe(false);

    new BureauStorage(dataRoot);
    closeBureauDb(dataRoot);
    downgradeToV10(dataRoot);
    expect(await bureausEnabled(dataRoot)).toBe(false);
  });

  it('only turns on once, so turning it off later sticks', async () => {
    new SqliteStorageService(dataRoot).close();
    createBureau(dataRoot);
    downgradeToV10(dataRoot);
    expect(await bureausEnabled(dataRoot)).toBe(true);

    const storage = new SqliteStorageService(dataRoot);
    await storage.saveSettings({ ...(await storage.getSettings()), experimentalBureaus: false });
    storage.close();

    expect(await bureausEnabled(dataRoot)).toBe(false);
  });
});
