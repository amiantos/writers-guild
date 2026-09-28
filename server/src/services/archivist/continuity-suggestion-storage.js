/**
 * Continuity Suggestion Storage
 *
 * The Archivist's suggested updates to a Continuity, kept per story or chat.
 * A story or chat has at most one waiting at a time: a new read replaces it.
 * Each keeps the text it was written from as `base`, so an update to a
 * Continuity that has changed since can be told apart. They're deleted with
 * their story or chat (see the triggers in database.js) or their Continuity.
 *
 * Methods are synchronous, like better-sqlite3 itself.
 */

function suggestionFromRow(row) {
  return {
    id: row.id,
    continuityId: row.continuity_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    base: row.base,
    replace: row.replace,
    rationale: row.rationale,
    status: row.status,
    created: row.created,
  };
}

export class ContinuitySuggestionStorage {
  /**
   * @param {import('better-sqlite3').Database} db - The main database, as opened by
   *   SqliteStorageService.
   */
  constructor(db) {
    this.db = db;
    this.stmts = {
      proposed: db.prepare(`
        SELECT * FROM continuity_suggestions
        WHERE source_kind = ? AND source_id = ? AND status = 'proposed'
        ORDER BY id DESC LIMIT 1
      `),
      get: db.prepare('SELECT * FROM continuity_suggestions WHERE id = ?'),
      clearProposed: db.prepare(`
        DELETE FROM continuity_suggestions
        WHERE source_kind = ? AND source_id = ? AND status = 'proposed'
      `),
      insert: db.prepare(`
        INSERT INTO continuity_suggestions (continuity_id, source_kind, source_id, base, replace,
                                            rationale, status, created)
        VALUES (@continuityId, @sourceKind, @sourceId, @base, @replace, @rationale, 'proposed',
                @created)
      `),
      update: db.prepare('UPDATE continuity_suggestions SET status = ?, replace = ? WHERE id = ?'),
      continuityExists: db.prepare('SELECT 1 FROM continuities WHERE id = ?'),
      storyExists: db.prepare('SELECT 1 FROM stories WHERE id = ?'),
      chatExists: db.prepare('SELECT 1 FROM chats WHERE id = ?'),
    };
  }

  /** The update waiting for review for a story or chat, or null. */
  proposedFor(sourceKind, sourceId) {
    const row = this.stmts.proposed.get(sourceKind, sourceId);
    return row ? suggestionFromRow(row) : null;
  }

  /** @returns {Object|null} */
  get(id) {
    const row = this.stmts.get.get(id);
    return row ? suggestionFromRow(row) : null;
  }

  /**
   * Keep a new update for a story or chat, replacing any still waiting. Returns it as kept, or
   * null when the story, chat or Continuity is gone, since either may be deleted while the
   * Archivist reads.
   */
  add(sourceKind, sourceId, { continuityId, base, replace, rationale = '' }) {
    const sourceExists = sourceKind === 'chat' ? this.stmts.chatExists : this.stmts.storyExists;
    return this.db.transaction(() => {
      if (!sourceExists.get(sourceId)) return null;
      if (!this.stmts.continuityExists.get(continuityId)) return null;
      this.stmts.clearProposed.run(sourceKind, sourceId);
      const { lastInsertRowid } = this.stmts.insert.run({
        continuityId,
        sourceKind,
        sourceId,
        base,
        replace,
        rationale,
        created: new Date().toISOString(),
      });
      return this.get(Number(lastInsertRowid));
    })();
  }

  /** Mark an update accepted or rejected, keeping the text the reader settled on. */
  setStatus(id, status, replace) {
    const current = this.get(id);
    if (!current) return null;
    this.stmts.update.run(status, replace ?? current.replace, id);
    return this.get(id);
  }
}
