/**
 * Bureau Database
 *
 * Bureau keeps its own SQLite file, separate from writers-guild.db, so the
 * experimental mode can be wiped and rebuilt without touching story mode's
 * data (see docs/bureau-design.md).
 *
 * Schema changes are appended to MIGRATIONS and never edited once shipped.
 * PRAGMA user_version records how many have run.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export const BUREAU_DB_FILENAME = 'bureau.db';

const MIGRATIONS = [
  // 1: Bureaus, their cast, and run records
  `
    CREATE TABLE bureaus (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      api_key TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL,
      bureau_time TEXT NOT NULL,
      present_offset_days INTEGER NOT NULL DEFAULT 0,
      timezone TEXT,
      house_style TEXT NOT NULL DEFAULT '',
      settings TEXT NOT NULL DEFAULT '{}',
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );

    CREATE TABLE cast_members (
      id TEXT PRIMARY KEY,
      bureau_id TEXT NOT NULL REFERENCES bureaus(id) ON DELETE CASCADE,
      library_character_id TEXT,
      name TEXT NOT NULL,
      is_persona INTEGER NOT NULL DEFAULT 0,
      is_draft INTEGER NOT NULL DEFAULT 0,
      seed_card TEXT NOT NULL,
      routine TEXT NOT NULL DEFAULT '{}',
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE INDEX idx_cast_members_bureau ON cast_members(bureau_id);
    -- A library character joins a Bureau at most once; drafts have no library id.
    CREATE UNIQUE INDEX idx_cast_members_library_character
      ON cast_members(bureau_id, library_character_id)
      WHERE library_character_id IS NOT NULL;

    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY,
      bureau_id TEXT NOT NULL REFERENCES bureaus(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      status TEXT NOT NULL,
      error TEXT,
      started TEXT NOT NULL,
      finished TEXT
    );
    CREATE INDEX idx_agent_runs_bureau ON agent_runs(bureau_id, started);

    CREATE TABLE agent_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      role TEXT NOT NULL,
      kind TEXT NOT NULL,
      request TEXT,
      response TEXT,
      reasoning TEXT,
      tool_calls TEXT,
      usage TEXT,
      duration_ms INTEGER,
      error TEXT,
      created TEXT NOT NULL
    );
    CREATE INDEX idx_agent_steps_run ON agent_steps(run_id, position);
  `,

  // 2: World lorebooks, stories, and turns
  `
    CREATE TABLE bureau_lorebooks (
      bureau_id TEXT NOT NULL REFERENCES bureaus(id) ON DELETE CASCADE,
      lorebook_id TEXT NOT NULL,
      PRIMARY KEY (bureau_id, lorebook_id)
    );

    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      bureau_id TEXT NOT NULL REFERENCES bureaus(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      start_time TEXT NOT NULL,
      end_time TEXT,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE INDEX idx_stories_bureau ON stories(bureau_id, position);

    CREATE TABLE story_cast (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      cast_member_id TEXT NOT NULL REFERENCES cast_members(id) ON DELETE CASCADE,
      PRIMARY KEY (story_id, cast_member_id)
    );

    CREATE TABLE turns (
      id TEXT PRIMARY KEY,
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      author_cast_id TEXT REFERENCES cast_members(id) ON DELETE SET NULL,
      content TEXT NOT NULL DEFAULT '',
      run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      edited INTEGER NOT NULL DEFAULT 0,
      active_variant_id TEXT,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE INDEX idx_turns_story ON turns(story_id, position);

    CREATE TABLE turn_variants (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      created TEXT NOT NULL
    );
    CREATE INDEX idx_turn_variants_turn ON turn_variants(turn_id, created);
  `,

  // 3: Track edits per version of a turn, so a fresh version isn't marked edited
  `
    ALTER TABLE turn_variants ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
    UPDATE turn_variants SET edited = 1
      WHERE id IN (SELECT active_variant_id FROM turns WHERE edited = 1);
  `,
];

export const BUREAU_SCHEMA_VERSION = MIGRATIONS.length;

// One connection per database file for the life of the process.
const connections = new Map();

/**
 * Open the Bureau database under a data root, creating and migrating it if needed.
 * @param {string} dataRoot
 * @returns {import('better-sqlite3').Database}
 */
export function openBureauDb(dataRoot) {
  const dbPath = path.join(dataRoot, BUREAU_DB_FILENAME);
  const existing = connections.get(dbPath);
  if (existing?.open) return existing;

  fs.mkdirSync(dataRoot, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  migrateBureauDb(db);

  connections.set(dbPath, db);
  return db;
}

/**
 * Close a data root's Bureau database if it is open. Used by tests and scripts.
 * @param {string} dataRoot
 */
export function closeBureauDb(dataRoot) {
  const dbPath = path.join(dataRoot, BUREAU_DB_FILENAME);
  connections.get(dbPath)?.close();
  connections.delete(dbPath);
}

/**
 * Run any migrations the database hasn't seen yet, in one transaction.
 * @param {import('better-sqlite3').Database} db
 */
export function migrateBureauDb(db) {
  const version = db.pragma('user_version', { simple: true });
  if (version > MIGRATIONS.length) {
    throw new Error(
      `bureau.db is at schema version ${version}, newer than this build supports (${MIGRATIONS.length})`,
    );
  }
  if (version === MIGRATIONS.length) return;

  db.transaction(() => {
    for (const sql of MIGRATIONS.slice(version)) {
      db.exec(sql);
    }
    db.pragma(`user_version = ${MIGRATIONS.length}`);
  })();
}
