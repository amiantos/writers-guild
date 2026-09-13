/**
 * Arc Note Storage
 *
 * Queries for arc notes in bureau.db (see "Character development" in
 * docs/bureau-design.md). An arc note records how a character has changed.
 * The Archivist proposes them, and only accepted notes shape later stories;
 * rejected ones are kept as history. Methods are synchronous, like
 * better-sqlite3 itself.
 */

import { openBureauDb } from './bureau-db.js';

export const ARC_NOTE_STATUSES = ['proposed', 'accepted', 'rejected'];
/** story: proposed by the Archivist. manual: written by the reader. */
export const ARC_NOTE_SOURCES = ['story', 'correspondence', 'manual'];

function parseIds(text) {
  try {
    const ids = JSON.parse(text);
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function noteFromRow(row) {
  return {
    id: row.id,
    bureauId: row.bureau_id,
    castMemberId: row.cast_member_id,
    content: row.content,
    proposedContent: row.proposed_content,
    rationale: row.rationale,
    status: row.status,
    worldTime: row.world_time,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceTitle: row.source_title ?? null,
    sourcePosition: row.source_position ?? null,
    sourceCreated: row.source_created ?? null,
    sourceTurnIds: parseIds(row.source_turn_ids),
    runId: row.run_id,
    needsReview: row.needs_review === 1,
    created: row.created,
    decided: row.decided,
    modified: row.modified,
  };
}

export class ArcNoteStorage {
  constructor(dataRoot) {
    this.db = openBureauDb(dataRoot);
    this.prepareStatements();
  }

  prepareStatements() {
    // When a note's source was written (see memory-storage.js).
    const sourceCreated = `CASE n.source_type
        WHEN 'story' THEN s.created
        WHEN 'correspondence' THEN (
          SELECT MIN(cited_message.created) FROM json_each(n.source_turn_ids) AS cited
          JOIN messages cited_message ON cited_message.id = cited.value
        )
      END AS source_created`;
    const columns = `n.*, s.title AS source_title, s.position AS source_position, ${sourceCreated}`;
    const withSource = `LEFT JOIN stories s ON n.source_type = 'story' AND s.id = n.source_id`;

    this.stmts = {
      // Oldest first by Bureau time, with notes that have no time (written by the reader) first.
      // Built with string concatenation (not template interpolation) since `columns` and
      // `withSource` are fixed fragments, not query parameters — those stay as `?` placeholders.
      list: this.db.prepare(
        'SELECT ' +
          columns +
          ' FROM arc_notes n ' +
          withSource +
          `
        WHERE n.bureau_id = ? AND n.cast_member_id = ?
        ORDER BY (n.world_time IS NOT NULL), n.world_time, s.position, n.id
      `,
      ),
      get: this.db.prepare(
        'SELECT ' + columns + ' FROM arc_notes n ' + withSource + ' WHERE n.bureau_id = ? AND n.id = ?',
      ),
      insert: this.db.prepare(`
        INSERT INTO arc_notes (bureau_id, cast_member_id, content, proposed_content, rationale,
                               status, world_time, source_type, source_id, source_turn_ids,
                               run_id, created, decided, modified)
        VALUES (@bureauId, @castId, @content, @content, @rationale, @status, @worldTime,
                @sourceType, @sourceId, @sourceTurnIds, @runId, @created, @decided, @modified)
      `),
      update: this.db.prepare(`
        UPDATE arc_notes SET content = @content, status = @status, needs_review = @needsReview,
                             decided = @decided, modified = @modified
        WHERE id = @id
      `),
      delete: this.db.prepare('DELETE FROM arc_notes WHERE bureau_id = ? AND id = ?'),
      deleteForStory: this.db.prepare(
        "DELETE FROM arc_notes WHERE bureau_id = ? AND source_type = 'story' AND source_id = ?",
      ),
      flagTurns: this.db.prepare(`
        UPDATE arc_notes SET needs_review = 1, modified = @modified
        WHERE bureau_id = @bureauId AND source_type = @sourceType AND source_id = @sourceId
          AND needs_review = 0
          AND EXISTS (
            SELECT 1 FROM json_each(arc_notes.source_turn_ids) cited
            WHERE cited.value IN (SELECT value FROM json_each(@turnIds))
          )
      `),
      // Rejected notes shape nothing, so only proposals and flagged accepted notes need the reader.
      reviewCounts: this.db.prepare(`
        SELECT cast_member_id,
               SUM(status = 'proposed') AS proposed,
               SUM(status = 'accepted' AND needs_review = 1) AS needs_review
        FROM arc_notes
        WHERE bureau_id = ?
        GROUP BY cast_member_id
        HAVING proposed > 0 OR needs_review > 0
      `),
    };
  }

  /**
   * A character's arc notes, oldest first.
   * @param {'proposed'|'accepted'|'rejected'} [options.status]
   */
  listNotes(bureauId, castId, { status } = {}) {
    if (status !== undefined && !ARC_NOTE_STATUSES.includes(status)) {
      throw new Error(`Unknown arc note status: ${status}`);
    }
    const notes = this.stmts.list.all(bureauId, castId).map(noteFromRow);
    return status ? notes.filter((note) => note.status === status) : notes;
  }

  getNote(bureauId, noteId) {
    const row = this.stmts.get.get(bureauId, noteId);
    return row ? noteFromRow(row) : null;
  }

  /**
   * @param {string} bureauId
   * @param {string} castId
   * @param {Object} note
   * @param {string} note.content
   * @param {string} [note.rationale] - Why the Archivist proposed it.
   * @param {'proposed'|'accepted'|'rejected'} [note.status] - A note the reader writes is
   *   accepted as it's written.
   * @param {string|null} [note.worldTime] - Bureau time it dates from.
   * @param {'story'|'correspondence'|'manual'} [note.sourceType]
   * @param {string|null} [note.sourceId]
   * @param {string[]} [note.sourceTurnIds]
   * @param {string|null} [note.runId]
   * @returns {Object} The new note.
   */
  addNote(
    bureauId,
    castId,
    {
      content,
      rationale = '',
      status = 'proposed',
      worldTime = null,
      sourceType = 'manual',
      sourceId = null,
      sourceTurnIds = [],
      runId = null,
    },
  ) {
    if (!ARC_NOTE_STATUSES.includes(status)) {
      throw new Error(`Unknown arc note status: ${status}`);
    }
    if (!ARC_NOTE_SOURCES.includes(sourceType)) {
      throw new Error(`Unknown arc note source: ${sourceType}`);
    }
    const now = new Date().toISOString();
    const { lastInsertRowid } = this.stmts.insert.run({
      bureauId,
      castId,
      content,
      rationale,
      status,
      worldTime,
      sourceType,
      sourceId,
      sourceTurnIds: JSON.stringify(sourceTurnIds),
      runId,
      created: now,
      decided: status === 'proposed' ? null : now,
      modified: now,
    });
    return this.getNote(bureauId, Number(lastInsertRowid));
  }

  /**
   * Accept, reject, or edit a note. Editing the content counts as reviewing it.
   * @param {Object} updates - Any of content, status, needsReview.
   * @returns {Object|null} The updated note, or null if it doesn't exist.
   */
  updateNote(bureauId, noteId, { content, status, needsReview }) {
    const note = this.getNote(bureauId, noteId);
    if (!note) return null;
    if (status !== undefined && !ARC_NOTE_STATUSES.includes(status)) {
      throw new Error(`Unknown arc note status: ${status}`);
    }

    const now = new Date().toISOString();
    const nextStatus = status ?? note.status;
    const contentChanged = content !== undefined && content !== note.content;
    let decided = note.decided;
    if (nextStatus === 'proposed') decided = null;
    else if (nextStatus !== note.status) decided = now;

    this.stmts.update.run({
      id: noteId,
      content: content ?? note.content,
      status: nextStatus,
      needsReview: (needsReview ?? (contentChanged ? false : note.needsReview)) ? 1 : 0,
      decided,
      modified: now,
    });
    return this.getNote(bureauId, noteId);
  }

  deleteNote(bureauId, noteId) {
    return this.stmts.delete.run(bureauId, noteId).changes > 0;
  }

  /** Delete every note proposed from a story. Returns how many were deleted. */
  deleteStoryNotes(bureauId, storyId) {
    return this.stmts.deleteForStory.run(bureauId, storyId).changes;
  }

  /**
   * Mark notes that cite changed or deleted turns, or messages, for review.
   * @param {string} bureauId
   * @param {string} sourceId - The story, or the thread for correspondence.
   * @param {string[]} turnIds - Turn or message ids.
   * @param {'story'|'correspondence'} [sourceType]
   * @returns {number} How many were marked.
   */
  flagTurnsChanged(bureauId, sourceId, turnIds, sourceType = 'story') {
    if (turnIds.length === 0) return 0;
    return this.stmts.flagTurns.run({
      bureauId,
      sourceId,
      sourceType,
      turnIds: JSON.stringify(turnIds),
      modified: new Date().toISOString(),
    }).changes;
  }

  /**
   * What waits for the reader per cast member: proposals, and accepted notes whose passages
   * changed. { [castId]: { proposed, needsReview } }
   */
  reviewCountsByCast(bureauId) {
    return Object.fromEntries(
      this.stmts.reviewCounts
        .all(bureauId)
        .map((row) => [
          row.cast_member_id,
          { proposed: row.proposed, needsReview: row.needs_review },
        ]),
    );
  }
}
