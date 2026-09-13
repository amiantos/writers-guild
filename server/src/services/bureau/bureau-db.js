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

  // 4: Character memories with full-text search, and how far each story has been archived
  `
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bureau_id TEXT NOT NULL REFERENCES bureaus(id) ON DELETE CASCADE,
      cast_member_id TEXT NOT NULL REFERENCES cast_members(id) ON DELETE CASCADE,
      layer TEXT NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 3,
      world_time TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT,
      source_turn_ids TEXT NOT NULL DEFAULT '[]',
      run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      superseded_by INTEGER REFERENCES memories(id) ON DELETE SET NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      retired INTEGER NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE INDEX idx_memories_cast ON memories(cast_member_id, layer);
    CREATE INDEX idx_memories_source ON memories(source_type, source_id);
    CREATE INDEX idx_memories_superseded_by ON memories(superseded_by);

    CREATE VIRTUAL TABLE memories_fts USING fts5(
      content, content = 'memories', content_rowid = 'id', tokenize = 'porter unicode61'
    );
    CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts (rowid, content) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts (memories_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
    END;
    CREATE TRIGGER memories_fts_update AFTER UPDATE OF content ON memories BEGIN
      INSERT INTO memories_fts (memories_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
      INSERT INTO memories_fts (rowid, content) VALUES (new.id, new.content);
    END;

    -- Position of the last turn the Archivist has read (-1 for none), and its running summary.
    ALTER TABLE stories ADD COLUMN archived_through INTEGER NOT NULL DEFAULT -1;
    ALTER TABLE stories ADD COLUMN summary TEXT NOT NULL DEFAULT '';
  `,

  // 5: Arc notes, the reviewed record of how each character develops
  `
    CREATE TABLE arc_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bureau_id TEXT NOT NULL REFERENCES bureaus(id) ON DELETE CASCADE,
      cast_member_id TEXT NOT NULL REFERENCES cast_members(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      -- What was first proposed, so an edit before accepting stays visible.
      proposed_content TEXT NOT NULL,
      rationale TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'proposed',
      world_time TEXT,
      source_type TEXT NOT NULL,
      source_id TEXT,
      source_turn_ids TEXT NOT NULL DEFAULT '[]',
      run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      needs_review INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL,
      decided TEXT,
      modified TEXT NOT NULL
    );
    CREATE INDEX idx_arc_notes_cast ON arc_notes(cast_member_id, status);
    CREATE INDEX idx_arc_notes_source ON arc_notes(source_type, source_id);
  `,

  // 6: Correspondence, one thread per cast member with the reader's character
  `
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      bureau_id TEXT NOT NULL REFERENCES bureaus(id) ON DELETE CASCADE,
      cast_member_id TEXT NOT NULL REFERENCES cast_members(id) ON DELETE CASCADE,
      -- Position of the last message the Archivist has read (-1 for none).
      archived_through INTEGER NOT NULL DEFAULT -1,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_threads_cast ON threads(bureau_id, cast_member_id);

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      source TEXT NOT NULL,
      -- The reader's character or the cast member who sent it; null once they leave the cast.
      sender_cast_id TEXT REFERENCES cast_members(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      -- Bureau time when it was sent.
      bureau_time TEXT NOT NULL,
      run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
      edited INTEGER NOT NULL DEFAULT 0,
      created TEXT NOT NULL,
      modified TEXT NOT NULL
    );
    CREATE UNIQUE INDEX idx_messages_thread_position ON messages(thread_id, position);
  `,

  // 7: Bureau time became a manual clock. A Bureau whose present was moved by a day offset keeps
  // the date it showed: its clock moves there, and the offset stops counting.
  `
    UPDATE bureaus
    SET bureau_time = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', present_offset_days || ' days')
    WHERE present_offset_days != 0;
    UPDATE bureaus SET present_offset_days = 0;
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
