/**
 * Memory Storage
 *
 * Queries for character memories in bureau.db (see "Memory" in
 * docs/bureau-design.md). Methods are synchronous, like better-sqlite3 itself.
 *
 * A memory is current until it's retired or superseded. Superseding keeps the
 * old memory, linked to its replacement, so deleting the replacement brings the
 * old one back. memory.js decides which memories a particular story can see.
 */

import { openBureauDb } from './bureau-db.js';

/** knowledge: lasting facts. episode: what happened in one story, from one character's view. */
export const MEMORY_LAYERS = ['knowledge', 'episode'];
/** story: recorded by the Archivist. manual: written in the memory browser, such as backstory. */
export const MEMORY_SOURCES = ['story', 'manual'];
/** retired includes memories replaced by newer ones. */
export const MEMORY_STATUSES = ['current', 'retired'];

export const DEFAULT_IMPORTANCE = 3;

/** A whole number from 1 (trivia) to 5 (defining). */
export function clampImportance(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return DEFAULT_IMPORTANCE;
  return Math.min(5, Math.max(1, number));
}

/** Free text as an FTS5 query matching any of its words, with no query syntax passed through. */
export function toFtsQuery(text) {
  const words = String(text ?? '').match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.map((word) => `"${word}"`).join(' OR ');
}

function parseIds(text) {
  try {
    const ids = JSON.parse(text);
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function memoryFromRow(row) {
  return {
    id: row.id,
    bureauId: row.bureau_id,
    castMemberId: row.cast_member_id,
    layer: row.layer,
    content: row.content,
    importance: row.importance,
    worldTime: row.world_time,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceTitle: row.source_title ?? null,
    sourcePosition: row.source_position ?? null,
    sourceTurnIds: parseIds(row.source_turn_ids),
    runId: row.run_id,
    supersededBy: row.superseded_by,
    pinned: row.pinned === 1,
    retired: row.retired === 1,
    needsReview: row.needs_review === 1,
    created: row.created,
    modified: row.modified,
  };
}

export class MemoryStorage {
  constructor(dataRoot) {
    this.db = openBureauDb(dataRoot);
    this.prepareStatements();
  }

  prepareStatements() {
    const columns = 'm.*, s.title AS source_title, s.position AS source_position';
    const withSource = `LEFT JOIN stories s ON m.source_type = 'story' AND s.id = m.source_id`;
    // Newest first by Bureau time; memories with no time (backstory) last.
    const newestFirst = 'ORDER BY (m.world_time IS NULL), m.world_time DESC, m.id DESC';

    this.stmts = {
      listAll: this.db.prepare(`
        SELECT ${columns} FROM memories m ${withSource}
        WHERE m.bureau_id = ? AND m.cast_member_id = ?
        ${newestFirst}
      `),
      listCurrent: this.db.prepare(`
        SELECT ${columns} FROM memories m ${withSource}
        WHERE m.bureau_id = ? AND m.cast_member_id = ? AND m.retired = 0
          AND m.superseded_by IS NULL
        ${newestFirst}
      `),
      listRetired: this.db.prepare(`
        SELECT ${columns} FROM memories m ${withSource}
        WHERE m.bureau_id = ? AND m.cast_member_id = ?
          AND (m.retired = 1 OR m.superseded_by IS NOT NULL)
        ${newestFirst}
      `),
      search: this.db.prepare(`
        SELECT ${columns} FROM memories_fts f
        JOIN memories m ON m.id = f.rowid
        ${withSource}
        WHERE memories_fts MATCH @query AND m.bureau_id = @bureauId
          AND m.cast_member_id = @castId
        ORDER BY bm25(memories_fts)
        LIMIT @limit
      `),
      get: this.db.prepare(
        `SELECT ${columns} FROM memories m ${withSource} WHERE m.bureau_id = ? AND m.id = ?`,
      ),
      insert: this.db.prepare(`
        INSERT INTO memories (bureau_id, cast_member_id, layer, content, importance, world_time,
                              source_type, source_id, source_turn_ids, run_id, pinned,
                              created, modified)
        VALUES (@bureauId, @castId, @layer, @content, @importance, @worldTime,
                @sourceType, @sourceId, @sourceTurnIds, @runId, @pinned, @created, @modified)
      `),
      supersede: this.db.prepare(`
        UPDATE memories SET superseded_by = @newId, modified = @modified
        WHERE bureau_id = @bureauId AND cast_member_id = @castId AND id = @oldId
          AND superseded_by IS NULL
      `),
      update: this.db.prepare(`
        UPDATE memories SET content = @content, importance = @importance, pinned = @pinned,
                            retired = @retired, needs_review = @needsReview,
                            superseded_by = @supersededBy, modified = @modified
        WHERE id = @id
      `),
      retire: this.db.prepare('UPDATE memories SET retired = 1, modified = ? WHERE id = ?'),
      delete: this.db.prepare('DELETE FROM memories WHERE bureau_id = ? AND id = ?'),
      deleteForStory: this.db.prepare(
        "DELETE FROM memories WHERE bureau_id = ? AND source_type = 'story' AND source_id = ?",
      ),
      flagTurns: this.db.prepare(`
        UPDATE memories SET needs_review = 1, modified = @modified
        WHERE bureau_id = @bureauId AND source_type = 'story' AND source_id = @storyId
          AND needs_review = 0
          AND EXISTS (
            SELECT 1 FROM json_each(memories.source_turn_ids) cited
            WHERE cited.value IN (SELECT value FROM json_each(@turnIds))
          )
      `),
      countsByCast: this.db.prepare(`
        SELECT cast_member_id, COUNT(*) AS current, SUM(needs_review) AS needs_review
        FROM memories
        WHERE bureau_id = ? AND retired = 0 AND superseded_by IS NULL
        GROUP BY cast_member_id
      `),
    };
  }

  /**
   * A character's memories, newest first.
   * @param {string} bureauId
   * @param {string} castId
   * @param {Object} [options]
   * @param {'current'|'retired'|'all'} [options.status] - 'all' includes retired and replaced
   *   memories, which memory.js needs to see what was current at an earlier time.
   * @param {'knowledge'|'episode'} [options.layer]
   */
  listMemories(bureauId, castId, { status = 'current', layer } = {}) {
    const statement = {
      current: this.stmts.listCurrent,
      retired: this.stmts.listRetired,
      all: this.stmts.listAll,
    }[status];
    if (!statement) {
      throw new Error(`Unknown memory status: ${status}`);
    }
    const memories = statement.all(bureauId, castId).map(memoryFromRow);
    return layer ? memories.filter((memory) => memory.layer === layer) : memories;
  }

  /** Full-text search over a character's memories, best match first, retired ones included. */
  searchMemories(bureauId, castId, text, { limit = 50 } = {}) {
    const query = toFtsQuery(text);
    if (!query) return [];
    return this.stmts.search.all({ query, bureauId, castId, limit }).map(memoryFromRow);
  }

  getMemory(bureauId, memoryId) {
    const row = this.stmts.get.get(bureauId, memoryId);
    return row ? memoryFromRow(row) : null;
  }

  /**
   * @param {string} bureauId
   * @param {string} castId
   * @param {Object} memory
   * @param {'knowledge'|'episode'} memory.layer
   * @param {string} memory.content
   * @param {number} [memory.importance]
   * @param {string|null} [memory.worldTime] - Bureau time it dates from; null for backstory.
   * @param {'story'|'manual'} [memory.sourceType]
   * @param {string|null} [memory.sourceId] - The story, for story memories.
   * @param {string[]} [memory.sourceTurnIds]
   * @param {string|null} [memory.runId] - The Archivist run that recorded it.
   * @param {boolean} [memory.pinned]
   * @param {number|null} [memory.supersedes] - A current memory of the same character that
   *   this one replaces. Anything else is ignored.
   * @returns {Object} The new memory.
   */
  addMemory(
    bureauId,
    castId,
    {
      layer,
      content,
      importance = DEFAULT_IMPORTANCE,
      worldTime = null,
      sourceType = 'manual',
      sourceId = null,
      sourceTurnIds = [],
      runId = null,
      pinned = false,
      supersedes = null,
    },
  ) {
    if (!MEMORY_LAYERS.includes(layer)) {
      throw new Error(`Unknown memory layer: ${layer}`);
    }
    if (!MEMORY_SOURCES.includes(sourceType)) {
      throw new Error(`Unknown memory source: ${sourceType}`);
    }

    const now = new Date().toISOString();
    let id;
    this.db.transaction(() => {
      id = this.stmts.insert.run({
        bureauId,
        castId,
        layer,
        content,
        importance: clampImportance(importance),
        worldTime,
        sourceType,
        sourceId,
        sourceTurnIds: JSON.stringify(sourceTurnIds),
        runId,
        pinned: pinned ? 1 : 0,
        created: now,
        modified: now,
      }).lastInsertRowid;
      if (supersedes) {
        this.stmts.supersede.run({ bureauId, castId, oldId: supersedes, newId: id, modified: now });
      }
    })();
    return this.getMemory(bureauId, Number(id));
  }

  /**
   * @param {string} bureauId
   * @param {number} memoryId
   * @param {Object} updates - Any of content, importance, pinned, retired, needsReview.
   *   Editing the content counts as reviewing it. Setting retired to false also restores a
   *   memory that was replaced, retiring the newest version that replaced it.
   * @returns {Object|null} The updated memory, or null if it doesn't exist.
   */
  updateMemory(bureauId, memoryId, { content, importance, pinned, retired, needsReview }) {
    const memory = this.getMemory(bureauId, memoryId);
    if (!memory) return null;

    const contentChanged = content !== undefined && content !== memory.content;
    const restored = retired === false;
    const modified = new Date().toISOString();
    this.db.transaction(() => {
      // Two versions of one memory shouldn't both be current.
      if (restored && memory.supersededBy !== null) {
        const newest = this.newestVersionOf(bureauId, memory.supersededBy);
        if (newest && !newest.retired) {
          this.stmts.retire.run(modified, newest.id);
        }
      }
      this.stmts.update.run({
        id: memoryId,
        content: content ?? memory.content,
        importance: importance === undefined ? memory.importance : clampImportance(importance),
        pinned: (pinned ?? memory.pinned) ? 1 : 0,
        retired: (retired ?? memory.retired) ? 1 : 0,
        needsReview: (needsReview ?? (contentChanged ? false : memory.needsReview)) ? 1 : 0,
        supersededBy: restored ? null : memory.supersededBy,
        modified,
      });
    })();
    return this.getMemory(bureauId, memoryId);
  }

  /** The end of a chain of replacements, starting from a memory. */
  newestVersionOf(bureauId, memoryId) {
    let memory = this.getMemory(bureauId, memoryId);
    const seen = new Set();
    while (memory && memory.supersededBy !== null && !seen.has(memory.id)) {
      seen.add(memory.id);
      memory = this.getMemory(bureauId, memory.supersededBy);
    }
    return memory;
  }

  /** Deleting a memory brings back any memory it had replaced. */
  deleteMemory(bureauId, memoryId) {
    return this.stmts.delete.run(bureauId, memoryId).changes > 0;
  }

  /** Delete everything recorded from a story. Returns how many memories were deleted. */
  deleteStoryMemories(bureauId, storyId) {
    return this.stmts.deleteForStory.run(bureauId, storyId).changes;
  }

  /**
   * Mark memories that cite changed or deleted turns for review.
   * @returns {number} How many memories were newly marked.
   */
  flagTurnsChanged(bureauId, storyId, turnIds) {
    if (turnIds.length === 0) return 0;
    return this.stmts.flagTurns.run({
      bureauId,
      storyId,
      turnIds: JSON.stringify(turnIds),
      modified: new Date().toISOString(),
    }).changes;
  }

  /** Current memory counts per cast member: { [castId]: { current, needsReview } }. */
  countsByCast(bureauId) {
    return Object.fromEntries(
      this.stmts.countsByCast
        .all(bureauId)
        .map((row) => [
          row.cast_member_id,
          { current: row.current, needsReview: row.needs_review ?? 0 },
        ]),
    );
  }
}
