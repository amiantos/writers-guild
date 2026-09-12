/**
 * Story Storage
 *
 * Queries for Bureau stories and their turns in bureau.db. Methods are
 * synchronous, like better-sqlite3 itself.
 *
 * A turn's `content` is the version currently shown. Generated turns keep
 * every version in turn_variants, so regenerating never loses earlier text,
 * and an edit is saved to the version being shown, so switching away and
 * back keeps it.
 */

import { v4 as uuidv4 } from 'uuid';
import { openBureauDb } from './bureau-db.js';

export const TURN_KINDS = ['prose', 'direction', 'scene_break'];
export const TURN_SOURCES = ['user', 'generated'];

function timestamp() {
  return new Date().toISOString();
}

function storyFromRow(row, castIds) {
  return {
    id: row.id,
    bureauId: row.bureau_id,
    position: row.position,
    title: row.title,
    status: row.status,
    startTime: row.start_time,
    endTime: row.end_time,
    castIds,
    turnCount: row.turn_count,
    created: row.created,
    modified: row.modified,
  };
}

function variantFromRow(row) {
  return { id: row.id, runId: row.run_id, created: row.created };
}

function turnFromRow(row, variants) {
  return {
    id: row.id,
    storyId: row.story_id,
    position: row.position,
    kind: row.kind,
    source: row.source,
    authorCastId: row.author_cast_id,
    content: row.content,
    runId: row.run_id,
    edited: row.edited === 1,
    activeVariantId: row.active_variant_id,
    variants,
    created: row.created,
    modified: row.modified,
  };
}

export class StoryStorage {
  constructor(dataRoot) {
    this.db = openBureauDb(dataRoot);
    this.prepareStatements();
  }

  prepareStatements() {
    const storyColumns = `s.*, (SELECT COUNT(*) FROM turns t WHERE t.story_id = s.id) AS turn_count`;

    this.stmts = {
      // Stories
      listStories: this.db.prepare(
        `SELECT ${storyColumns} FROM stories s WHERE s.bureau_id = ? ORDER BY s.position`,
      ),
      getStory: this.db.prepare(
        `SELECT ${storyColumns} FROM stories s WHERE s.bureau_id = ? AND s.id = ?`,
      ),
      nextStoryPosition: this.db.prepare(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM stories WHERE bureau_id = ?',
      ),
      insertStory: this.db.prepare(`
        INSERT INTO stories (id, bureau_id, position, title, status, start_time, created, modified)
        VALUES (@id, @bureauId, @position, @title, 'active', @startTime, @created, @modified)
      `),
      updateStoryTitle: this.db.prepare('UPDATE stories SET title = ?, modified = ? WHERE id = ?'),
      endStory: this.db.prepare(
        "UPDATE stories SET status = 'ended', end_time = ?, modified = ? WHERE id = ?",
      ),
      touchStory: this.db.prepare('UPDATE stories SET modified = ? WHERE id = ?'),
      deleteStory: this.db.prepare('DELETE FROM stories WHERE bureau_id = ? AND id = ?'),
      listStoryCast: this.db.prepare(
        'SELECT cast_member_id FROM story_cast WHERE story_id = ? ORDER BY rowid',
      ),
      clearStoryCast: this.db.prepare('DELETE FROM story_cast WHERE story_id = ?'),
      insertStoryCast: this.db.prepare(
        'INSERT OR IGNORE INTO story_cast (story_id, cast_member_id) VALUES (?, ?)',
      ),

      // Turns
      listTurns: this.db.prepare('SELECT * FROM turns WHERE story_id = ? ORDER BY position'),
      getTurn: this.db.prepare('SELECT * FROM turns WHERE story_id = ? AND id = ?'),
      nextTurnPosition: this.db.prepare(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM turns WHERE story_id = ?',
      ),
      insertTurn: this.db.prepare(`
        INSERT INTO turns (id, story_id, position, kind, source, author_cast_id, content, run_id,
                           edited, active_variant_id, created, modified)
        VALUES (@id, @storyId, @position, @kind, @source, @authorCastId, @content, @runId,
                0, @activeVariantId, @created, @modified)
      `),
      editTurn: this.db.prepare(
        'UPDATE turns SET content = ?, edited = 1, modified = ? WHERE id = ?',
      ),
      showVariant: this.db.prepare(`
        UPDATE turns SET content = @content, run_id = @runId, active_variant_id = @variantId,
                         modified = @modified
        WHERE id = @turnId
      `),
      deleteTurn: this.db.prepare('DELETE FROM turns WHERE story_id = ? AND id = ?'),

      // Variants
      insertVariant: this.db.prepare(`
        INSERT INTO turn_variants (id, turn_id, content, run_id, created)
        VALUES (@id, @turnId, @content, @runId, @created)
      `),
      getVariant: this.db.prepare('SELECT * FROM turn_variants WHERE turn_id = ? AND id = ?'),
      listVariants: this.db.prepare(
        'SELECT * FROM turn_variants WHERE turn_id = ? ORDER BY created, rowid',
      ),
      listStoryVariants: this.db.prepare(`
        SELECT v.* FROM turn_variants v
        JOIN turns t ON t.id = v.turn_id
        WHERE t.story_id = ?
        ORDER BY v.created, v.rowid
      `),
      updateVariantContent: this.db.prepare('UPDATE turn_variants SET content = ? WHERE id = ?'),
    };
  }

  castIdsFor(storyId) {
    return this.stmts.listStoryCast.all(storyId).map((row) => row.cast_member_id);
  }

  // ==================== Stories ====================

  /** A Bureau's stories in order. */
  listStories(bureauId) {
    return this.stmts.listStories
      .all(bureauId)
      .map((row) => storyFromRow(row, this.castIdsFor(row.id)));
  }

  getStory(bureauId, storyId) {
    const row = this.stmts.getStory.get(bureauId, storyId);
    return row ? storyFromRow(row, this.castIdsFor(storyId)) : null;
  }

  /**
   * @param {string} bureauId
   * @param {Object} story
   * @param {string} story.startTime - ISO time the story starts.
   * @param {string[]} story.castIds - Cast members present in the story.
   * @param {string} [story.title] - Defaults to "Story N".
   * @returns {Object} The new story.
   */
  createStory(bureauId, { startTime, castIds, title = '' }) {
    const id = uuidv4();
    const created = timestamp();
    this.db.transaction(() => {
      const position = this.stmts.nextStoryPosition.get(bureauId).next;
      this.stmts.insertStory.run({
        id,
        bureauId,
        position,
        title: title || `Story ${position + 1}`,
        startTime,
        created,
        modified: created,
      });
      for (const castId of castIds) {
        this.stmts.insertStoryCast.run(id, castId);
      }
    })();
    return this.getStory(bureauId, id);
  }

  /**
   * @param {string} bureauId
   * @param {string} storyId
   * @param {Object} updates
   * @param {string} [updates.title]
   * @param {string[]} [updates.castIds] - Replaces who is present.
   * @returns {Object|null} The updated story, or null if it doesn't exist.
   */
  updateStory(bureauId, storyId, { title, castIds }) {
    if (!this.stmts.getStory.get(bureauId, storyId)) return null;

    const modified = timestamp();
    this.db.transaction(() => {
      if (title !== undefined) {
        this.stmts.updateStoryTitle.run(title, modified, storyId);
      }
      if (castIds !== undefined) {
        this.stmts.clearStoryCast.run(storyId);
        for (const castId of castIds) {
          this.stmts.insertStoryCast.run(storyId, castId);
        }
        this.stmts.touchStory.run(modified, storyId);
      }
    })();
    return this.getStory(bureauId, storyId);
  }

  /**
   * @param {string} bureauId
   * @param {string} storyId
   * @param {Object} end
   * @param {string} end.endTime - ISO time the story ends.
   * @returns {Object|null} The ended story, or null if it doesn't exist.
   */
  endStory(bureauId, storyId, { endTime }) {
    if (!this.stmts.getStory.get(bureauId, storyId)) return null;
    this.stmts.endStory.run(endTime, timestamp(), storyId);
    return this.getStory(bureauId, storyId);
  }

  /** Deletes the story with its turns. */
  deleteStory(bureauId, storyId) {
    return this.stmts.deleteStory.run(bureauId, storyId).changes > 0;
  }

  // ==================== Turns ====================

  /** A story's turns in order, each with its variants. */
  listTurns(storyId) {
    const variantsByTurn = new Map();
    for (const row of this.stmts.listStoryVariants.all(storyId)) {
      if (!variantsByTurn.has(row.turn_id)) variantsByTurn.set(row.turn_id, []);
      variantsByTurn.get(row.turn_id).push(variantFromRow(row));
    }
    return this.stmts.listTurns
      .all(storyId)
      .map((row) => turnFromRow(row, variantsByTurn.get(row.id) ?? []));
  }

  getTurn(storyId, turnId) {
    const row = this.stmts.getTurn.get(storyId, turnId);
    if (!row) return null;
    return turnFromRow(row, this.stmts.listVariants.all(turnId).map(variantFromRow));
  }

  /**
   * Append a turn to a story. A generated turn also gets its first variant.
   *
   * @param {string} storyId
   * @param {Object} turn
   * @param {'prose'|'direction'|'scene_break'} turn.kind
   * @param {'user'|'generated'} turn.source
   * @param {string} [turn.content]
   * @param {string|null} [turn.authorCastId] - The persona for user prose; the lead for generated turns.
   * @param {string|null} [turn.runId] - The run that generated it.
   * @returns {Object} The new turn.
   */
  addTurn(storyId, { kind, source, content = '', authorCastId = null, runId = null }) {
    if (!TURN_KINDS.includes(kind)) {
      throw new Error(`Unknown turn kind: ${kind}`);
    }
    if (!TURN_SOURCES.includes(source)) {
      throw new Error(`Unknown turn source: ${source}`);
    }

    const id = uuidv4();
    const created = timestamp();
    const variantId = source === 'generated' ? uuidv4() : null;
    this.db.transaction(() => {
      const position = this.stmts.nextTurnPosition.get(storyId).next;
      this.stmts.insertTurn.run({
        id,
        storyId,
        position,
        kind,
        source,
        authorCastId,
        content,
        runId,
        activeVariantId: variantId,
        created,
        modified: created,
      });
      if (variantId) {
        this.stmts.insertVariant.run({ id: variantId, turnId: id, content, runId, created });
      }
      this.stmts.touchStory.run(created, storyId);
    })();
    return this.getTurn(storyId, id);
  }

  /**
   * Add a new version of a turn and show it.
   * @returns {Object|null} The turn, or null if it doesn't exist.
   */
  addVariant(storyId, turnId, { content, runId = null }) {
    if (!this.stmts.getTurn.get(storyId, turnId)) return null;

    const variantId = uuidv4();
    const created = timestamp();
    this.db.transaction(() => {
      this.stmts.insertVariant.run({ id: variantId, turnId, content, runId, created });
      this.stmts.showVariant.run({ turnId, content, runId, variantId, modified: created });
      this.stmts.touchStory.run(created, storyId);
    })();
    return this.getTurn(storyId, turnId);
  }

  /**
   * Show a different version of a turn.
   * @returns {Object|null} The turn, or null if the turn or variant doesn't exist.
   */
  selectVariant(storyId, turnId, variantId) {
    if (!this.stmts.getTurn.get(storyId, turnId)) return null;
    const variant = this.stmts.getVariant.get(turnId, variantId);
    if (!variant) return null;

    this.stmts.showVariant.run({
      turnId,
      content: variant.content,
      runId: variant.run_id,
      variantId,
      modified: timestamp(),
    });
    return this.getTurn(storyId, turnId);
  }

  /**
   * Replace a turn's text, saving it to the version being shown.
   * @returns {Object|null} The turn, or null if it doesn't exist.
   */
  editTurn(storyId, turnId, content) {
    const row = this.stmts.getTurn.get(storyId, turnId);
    if (!row) return null;

    const modified = timestamp();
    this.db.transaction(() => {
      this.stmts.editTurn.run(content, modified, turnId);
      if (row.active_variant_id) {
        this.stmts.updateVariantContent.run(content, row.active_variant_id);
      }
      this.stmts.touchStory.run(modified, storyId);
    })();
    return this.getTurn(storyId, turnId);
  }

  deleteTurn(storyId, turnId) {
    const removed = this.stmts.deleteTurn.run(storyId, turnId).changes > 0;
    if (removed) {
      this.stmts.touchStory.run(timestamp(), storyId);
    }
    return removed;
  }
}
