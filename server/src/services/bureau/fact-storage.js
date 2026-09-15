/**
 * Fact Storage
 *
 * Queries for a Bureau's established facts in bureau.db (see "Established facts" in
 * docs/bureau-design.md). A fact is something true in the Bureau's world that every agent keeps to,
 * such as who lives where. The reader writes facts, and the Archivist proposes new ones, or changes
 * to old ones, for the reader to accept or reject. Rejected proposals are kept as history.
 *
 * A fact that changes another names the one it replaces and leaves it in place, so a chapter set
 * earlier still sees the old fact, and rejecting or deleting the change brings the old one back.
 * memory.js decides which facts a chapter or a moment can see. Methods are synchronous, like
 * better-sqlite3 itself.
 */

import { openBureauDb } from './bureau-db.js';

export const FACT_STATUSES = ['proposed', 'accepted', 'rejected'];
/** story and correspondence: proposed by the Archivist. manual: written by the reader. */
export const FACT_SOURCES = ['story', 'correspondence', 'manual'];

function parseIds(text) {
  try {
    const ids = JSON.parse(text);
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function factFromRow(row) {
  return {
    id: row.id,
    bureauId: row.bureau_id,
    content: row.content,
    proposedContent: row.proposed_content,
    rationale: row.rationale,
    status: row.status,
    replaces: row.replaces,
    replacesContent: row.replaces_content ?? null,
    replacedBy: row.replaced_by ?? null,
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

export class FactStorage {
  constructor(dataRoot) {
    this.db = openBureauDb(dataRoot);
    this.prepareStatements();
  }

  prepareStatements() {
    // When a fact's source was written (see memory-storage.js).
    const sourceCreated = `CASE f.source_type
        WHEN 'story' THEN s.created
        WHEN 'correspondence' THEN (
          SELECT MIN(cited_message.created) FROM json_each(f.source_turn_ids) AS cited
          JOIN messages cited_message ON cited_message.id = cited.value
        )
      END AS source_created`;
    // The newest accepted fact that replaces this one.
    const replacedBy = `(
        SELECT r.id FROM facts r WHERE r.replaces = f.id AND r.status = 'accepted'
        ORDER BY r.id DESC LIMIT 1
      ) AS replaced_by`;
    const columns = `f.*, s.title AS source_title, s.position AS source_position,
      old.content AS replaces_content, ${sourceCreated}, ${replacedBy}`;
    const joins = `LEFT JOIN stories s ON f.source_type = 'story' AND s.id = f.source_id
      LEFT JOIN facts old ON old.id = f.replaces`;

    this.stmts = {
      // Oldest first by Bureau time, with facts that have no time (written by the reader) first.
      list: this.db.prepare(`
        SELECT ${columns} FROM facts f ${joins}
        WHERE f.bureau_id = ?
        ORDER BY (f.world_time IS NOT NULL), f.world_time, s.position, f.id
      `),
      get: this.db.prepare(
        `SELECT ${columns} FROM facts f ${joins} WHERE f.bureau_id = ? AND f.id = ?`,
      ),
      insert: this.db.prepare(`
        INSERT INTO facts (bureau_id, content, proposed_content, rationale, status, replaces,
                           world_time, source_type, source_id, source_turn_ids, run_id, created,
                           decided, modified)
        VALUES (@bureauId, @content, @content, @rationale, @status, @replaces, @worldTime,
                @sourceType, @sourceId, @sourceTurnIds, @runId, @created, @decided, @modified)
      `),
      update: this.db.prepare(`
        UPDATE facts SET content = @content, status = @status, needs_review = @needsReview,
                         decided = @decided, modified = @modified
        WHERE id = @id
      `),
      delete: this.db.prepare('DELETE FROM facts WHERE bureau_id = ? AND id = ?'),
      deleteForStory: this.db.prepare(
        "DELETE FROM facts WHERE bureau_id = ? AND source_type = 'story' AND source_id = ?",
      ),
      flagTurns: this.db.prepare(`
        UPDATE facts SET needs_review = 1, modified = @modified
        WHERE bureau_id = @bureauId AND source_type = @sourceType AND source_id = @sourceId
          AND needs_review = 0
          AND EXISTS (
            SELECT 1 FROM json_each(facts.source_turn_ids) cited
            WHERE cited.value IN (SELECT value FROM json_each(@turnIds))
          )
      `),
    };
  }

  /**
   * A Bureau's facts, oldest first.
   * @param {'proposed'|'accepted'|'rejected'} [options.status]
   */
  listFacts(bureauId, { status } = {}) {
    if (status !== undefined && !FACT_STATUSES.includes(status)) {
      throw new Error(`Unknown fact status: ${status}`);
    }
    const facts = this.stmts.list.all(bureauId).map(factFromRow);
    return status ? facts.filter((fact) => fact.status === status) : facts;
  }

  getFact(bureauId, factId) {
    const row = this.stmts.get.get(bureauId, factId);
    return row ? factFromRow(row) : null;
  }

  /**
   * @param {string} bureauId
   * @param {Object} fact
   * @param {string} fact.content
   * @param {string} [fact.rationale] - Why the Archivist proposed it.
   * @param {'proposed'|'accepted'|'rejected'} [fact.status] - A fact the reader writes is accepted
   *   as it's written.
   * @param {number|null} [fact.replaces] - The fact in the same Bureau this one changes. Anything
   *   else is ignored.
   * @param {string|null} [fact.worldTime] - Bureau time it dates from.
   * @param {'story'|'correspondence'|'manual'} [fact.sourceType]
   * @param {string|null} [fact.sourceId]
   * @param {string[]} [fact.sourceTurnIds]
   * @param {string|null} [fact.runId]
   * @returns {Object} The new fact.
   */
  addFact(
    bureauId,
    {
      content,
      rationale = '',
      status = 'proposed',
      replaces = null,
      worldTime = null,
      sourceType = 'manual',
      sourceId = null,
      sourceTurnIds = [],
      runId = null,
    },
  ) {
    if (!FACT_STATUSES.includes(status)) {
      throw new Error(`Unknown fact status: ${status}`);
    }
    if (!FACT_SOURCES.includes(sourceType)) {
      throw new Error(`Unknown fact source: ${sourceType}`);
    }
    const now = new Date().toISOString();
    const { lastInsertRowid } = this.stmts.insert.run({
      bureauId,
      content,
      rationale,
      status,
      replaces: replaces && this.getFact(bureauId, replaces) ? replaces : null,
      worldTime,
      sourceType,
      sourceId,
      sourceTurnIds: JSON.stringify(sourceTurnIds),
      runId,
      created: now,
      decided: status === 'proposed' ? null : now,
      modified: now,
    });
    return this.getFact(bureauId, Number(lastInsertRowid));
  }

  /**
   * Accept, reject, or edit a fact. Editing the content counts as reviewing it.
   * @param {Object} updates - Any of content, status, needsReview.
   * @returns {Object|null} The updated fact, or null if it doesn't exist.
   */
  updateFact(bureauId, factId, { content, status, needsReview }) {
    const fact = this.getFact(bureauId, factId);
    if (!fact) return null;
    if (status !== undefined && !FACT_STATUSES.includes(status)) {
      throw new Error(`Unknown fact status: ${status}`);
    }

    const now = new Date().toISOString();
    const nextStatus = status ?? fact.status;
    const contentChanged = content !== undefined && content !== fact.content;
    let decided = fact.decided;
    if (nextStatus === 'proposed') decided = null;
    else if (nextStatus !== fact.status) decided = now;

    this.stmts.update.run({
      id: factId,
      content: content ?? fact.content,
      status: nextStatus,
      needsReview: (needsReview ?? (contentChanged ? false : fact.needsReview)) ? 1 : 0,
      decided,
      modified: now,
    });
    return this.getFact(bureauId, factId);
  }

  /** Deleting a fact brings back any fact it replaced. */
  deleteFact(bureauId, factId) {
    return this.stmts.delete.run(bureauId, factId).changes > 0;
  }

  /** Delete every fact proposed from a story. Returns how many were deleted. */
  deleteStoryFacts(bureauId, storyId) {
    return this.stmts.deleteForStory.run(bureauId, storyId).changes;
  }

  /**
   * Mark facts that cite changed or deleted turns, or messages, for review.
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

  /** What waits for the reader: proposals, and accepted facts whose sources changed. */
  reviewCounts(bureauId) {
    const row = this.stmts.reviewCounts.get(bureauId);
    return { proposed: row.proposed, needsReview: row.needs_review };
  }
}
