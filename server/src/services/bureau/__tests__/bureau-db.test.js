import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  openBureauDb,
  closeBureauDb,
  migrateBureauDb,
  BUREAU_DB_FILENAME,
  BUREAU_SCHEMA_VERSION,
} from '../bureau-db.js';

describe('bureau-db', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-db-'));
  });

  afterEach(() => {
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates bureau.db with the current schema', () => {
    const db = openBureauDb(tempDir);

    expect(fs.existsSync(path.join(tempDir, BUREAU_DB_FILENAME))).toBe(true);
    expect(db.pragma('user_version', { simple: true })).toBe(BUREAU_SCHEMA_VERSION);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((table) => table.name);
    expect(tables).toEqual(
      expect.arrayContaining(['bureaus', 'cast_members', 'agent_runs', 'agent_steps']),
    );
  });

  it('leaves writers-guild.db alone', () => {
    openBureauDb(tempDir);
    expect(fs.existsSync(path.join(tempDir, 'writers-guild.db'))).toBe(false);
  });

  it('reuses one connection per data root', () => {
    expect(openBureauDb(tempDir)).toBe(openBureauDb(tempDir));
  });

  it('keeps existing data when reopened', () => {
    openBureauDb(tempDir)
      .prepare(
        `INSERT INTO bureaus (id, name, model, bureau_time, created, modified)
         VALUES ('b1', 'Kept', 'deepseek-flash', 'now', 'now', 'now')`,
      )
      .run();
    closeBureauDb(tempDir);

    const reopened = openBureauDb(tempDir);
    expect(reopened.prepare('SELECT name FROM bureaus').get().name).toBe('Kept');
    expect(reopened.pragma('user_version', { simple: true })).toBe(BUREAU_SCHEMA_VERSION);
  });

  it('upgrades an older database to the current schema', () => {
    const db = openBureauDb(tempDir);
    db.exec(`
      DROP TABLE messages;
      DROP TABLE threads;
      DROP TABLE arc_notes;
      DROP TABLE memories_fts;
      DROP TABLE memories;
      DROP TABLE turn_variants;
      DROP TABLE turns;
      DROP TABLE story_cast;
      DROP TABLE stories;
      DROP TABLE bureau_lorebooks;
    `);
    db.pragma('user_version = 1');
    closeBureauDb(tempDir);

    const upgraded = openBureauDb(tempDir);

    expect(upgraded.pragma('user_version', { simple: true })).toBe(BUREAU_SCHEMA_VERSION);
    const tables = upgraded
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((table) => table.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'bureau_lorebooks',
        'stories',
        'story_cast',
        'turns',
        'turn_variants',
        'memories',
        'memories_fts',
        'arc_notes',
        'threads',
        'messages',
      ]),
    );
    expect(upgraded.prepare('SELECT archived_through, summary FROM stories').all()).toEqual([]);
  });

  it("moves a shifted Bureau's clock to the date it showed, and stops counting the offset", () => {
    const db = openBureauDb(tempDir);
    db.exec(`
      INSERT INTO bureaus (id, name, model, bureau_time, present_offset_days, created, modified)
      VALUES ('shifted', 'Shifted', 'deepseek-flash', '2020-01-01T00:00:00.000Z', -365, 'now', 'now'),
             ('plain', 'Plain', 'deepseek-flash', '2020-01-01T00:00:00.000Z', 0, 'now', 'now');
    `);
    // Back to the turns table version 6 had, before time could pass in a chapter.
    db.exec('ALTER TABLE turns DROP COLUMN bureau_time');
    db.pragma('user_version = 6');
    closeBureauDb(tempDir);

    const upgraded = openBureauDb(tempDir);
    const rows = Object.fromEntries(
      upgraded
        .prepare('SELECT id, bureau_time, present_offset_days FROM bureaus')
        .all()
        .map((row) => [row.id, row]),
    );

    const yearAgo = Date.now() - 365 * 86_400_000;
    expect(Math.abs(Date.parse(rows.shifted.bureau_time) - yearAgo)).toBeLessThan(60_000);
    expect(rows.shifted.bureau_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(rows.plain.bureau_time).toBe('2020-01-01T00:00:00.000Z');
    expect([rows.shifted.present_offset_days, rows.plain.present_offset_days]).toEqual([0, 0]);
    expect(
      upgraded
        .prepare('PRAGMA table_info(turns)')
        .all()
        .map((column) => column.name),
    ).toContain('bureau_time');
  });

  it('refuses a database written by a newer build', () => {
    const db = new Database(path.join(tempDir, 'future.db'));
    db.pragma('user_version = 999');

    expect(() => migrateBureauDb(db)).toThrow(/newer than this build supports/);
    db.close();
  });
});
