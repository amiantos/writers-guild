/**
 * Thread Storage
 *
 * Queries for correspondence in bureau.db: one thread per cast member, written
 * with the Bureau's reader's character, and its messages in order (see
 * "Correspondence" in docs/bureau-design.md). Methods are synchronous, like
 * better-sqlite3 itself.
 */

import { v4 as uuidv4 } from 'uuid';
import { openBureauDb } from './bureau-db.js';

export const MESSAGE_SOURCES = ['user', 'generated'];

function timestamp() {
  return new Date().toISOString();
}

function threadFromRow(row) {
  return {
    id: row.id,
    bureauId: row.bureau_id,
    castMemberId: row.cast_member_id,
    archivedThrough: row.archived_through,
    messageCount: row.message_count,
    lastMessage:
      row.last_id === null
        ? null
        : {
            id: row.last_id,
            source: row.last_source,
            content: row.last_content,
            bureauTime: row.last_bureau_time,
          },
    created: row.created,
    modified: row.modified,
  };
}

function messageFromRow(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    position: row.position,
    source: row.source,
    senderCastId: row.sender_cast_id,
    content: row.content,
    bureauTime: row.bureau_time,
    runId: row.run_id,
    edited: row.edited === 1,
    created: row.created,
    modified: row.modified,
  };
}

export class ThreadStorage {
  constructor(dataRoot) {
    this.db = openBureauDb(dataRoot);
    this.prepareStatements();
  }

  prepareStatements() {
    const threadColumns = `t.*,
      (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS message_count,
      last.id AS last_id, last.source AS last_source, last.content AS last_content,
      last.bureau_time AS last_bureau_time`;
    const withLastMessage = `LEFT JOIN messages last ON last.id = (
      SELECT id FROM messages WHERE thread_id = t.id ORDER BY position DESC LIMIT 1
    )`;

    this.stmts = {
      // Threads
      listThreads: this.db.prepare(`
        SELECT ${threadColumns} FROM threads t ${withLastMessage}
        WHERE t.bureau_id = ?
        ORDER BY t.modified DESC, t.rowid DESC
      `),
      getThread: this.db.prepare(
        `SELECT ${threadColumns} FROM threads t ${withLastMessage} WHERE t.bureau_id = ? AND t.id = ?`,
      ),
      getThreadForCast: this.db.prepare(`
        SELECT ${threadColumns} FROM threads t ${withLastMessage}
        WHERE t.bureau_id = ? AND t.cast_member_id = ?
      `),
      insertThread: this.db.prepare(`
        INSERT OR IGNORE INTO threads (id, bureau_id, cast_member_id, created, modified)
        VALUES (@id, @bureauId, @castId, @created, @modified)
      `),
      touchThread: this.db.prepare('UPDATE threads SET modified = ? WHERE id = ?'),
      setArchiveProgress: this.db.prepare('UPDATE threads SET archived_through = ? WHERE id = ?'),
      deleteThread: this.db.prepare('DELETE FROM threads WHERE bureau_id = ? AND id = ?'),

      // Messages; a negative limit means no limit.
      listMessages: this.db.prepare(`
        SELECT * FROM (
          SELECT * FROM messages WHERE thread_id = ? ORDER BY position DESC LIMIT ?
        ) ORDER BY position
      `),
      getMessage: this.db.prepare('SELECT * FROM messages WHERE thread_id = ? AND id = ?'),
      // Past the archived positions too, so a message added after the last ones were deleted
      // isn't mistaken for one the Archivist has already read.
      nextPosition: this.db.prepare(`
        SELECT MAX(
          COALESCE((SELECT MAX(position) FROM messages WHERE thread_id = @threadId), -1),
          COALESCE((SELECT archived_through FROM threads WHERE id = @threadId), -1)
        ) + 1 AS next
      `),
      insertMessage: this.db.prepare(`
        INSERT INTO messages (id, thread_id, position, source, sender_cast_id, content,
                              bureau_time, run_id, created, modified)
        VALUES (@id, @threadId, @position, @source, @senderCastId, @content,
                @bureauTime, @runId, @created, @modified)
      `),
      editMessage: this.db.prepare(
        'UPDATE messages SET content = ?, edited = 1, modified = ? WHERE thread_id = ? AND id = ?',
      ),
      deleteMessage: this.db.prepare('DELETE FROM messages WHERE thread_id = ? AND id = ?'),
    };
  }

  // ==================== Threads ====================

  /** A Bureau's threads, most recently active first, each with its last message. */
  listThreads(bureauId) {
    return this.stmts.listThreads.all(bureauId).map(threadFromRow);
  }

  getThread(bureauId, threadId) {
    const row = this.stmts.getThread.get(bureauId, threadId);
    return row ? threadFromRow(row) : null;
  }

  /** A cast member's thread, or null when nothing has been written yet. */
  getThreadForCast(bureauId, castId) {
    const row = this.stmts.getThreadForCast.get(bureauId, castId);
    return row ? threadFromRow(row) : null;
  }

  /**
   * A cast member's thread, started if there isn't one yet.
   * @throws When the cast member isn't in the Bureau.
   */
  getOrCreateThread(bureauId, castId) {
    const now = timestamp();
    this.stmts.insertThread.run({ id: uuidv4(), bureauId, castId, created: now, modified: now });
    return this.getThreadForCast(bureauId, castId);
  }

  /** Record the position of the last message the Archivist has read. */
  setArchiveProgress(threadId, archivedThrough) {
    this.stmts.setArchiveProgress.run(archivedThrough, threadId);
  }

  /** Deletes a thread with its messages. */
  deleteThread(bureauId, threadId) {
    return this.stmts.deleteThread.run(bureauId, threadId).changes > 0;
  }

  // ==================== Messages ====================

  /**
   * A thread's messages, oldest first.
   * @param {string} threadId
   * @param {Object} [options]
   * @param {number} [options.limit] - Only the latest this many.
   */
  listMessages(threadId, { limit } = {}) {
    return this.stmts.listMessages.all(threadId, limit ?? -1).map(messageFromRow);
  }

  getMessage(threadId, messageId) {
    const row = this.stmts.getMessage.get(threadId, messageId);
    return row ? messageFromRow(row) : null;
  }

  /**
   * @param {string} threadId
   * @param {Object} message
   * @param {'user'|'generated'} message.source - The reader's, or written by the Writer.
   * @param {string} message.content
   * @param {string} message.bureauTime - Bureau time it was sent (ISO).
   * @param {string|null} [message.senderCastId] - Who sent it.
   * @param {string|null} [message.runId] - The run that wrote it.
   * @returns {Object} The new message.
   */
  addMessage(threadId, { source, content, bureauTime, senderCastId = null, runId = null }) {
    if (!MESSAGE_SOURCES.includes(source)) {
      throw new Error(`Unknown message source: ${source}`);
    }
    const id = uuidv4();
    const now = timestamp();
    this.db.transaction(() => {
      const { next } = this.stmts.nextPosition.get({ threadId });
      this.stmts.insertMessage.run({
        id,
        threadId,
        position: next,
        source,
        senderCastId,
        content,
        bureauTime,
        runId,
        created: now,
        modified: now,
      });
      this.stmts.touchThread.run(now, threadId);
    })();
    return this.getMessage(threadId, id);
  }

  /** @returns {Object|null} The edited message, or null if it doesn't exist. */
  editMessage(threadId, messageId, content) {
    const { changes } = this.stmts.editMessage.run(content, timestamp(), threadId, messageId);
    return changes > 0 ? this.getMessage(threadId, messageId) : null;
  }

  deleteMessage(threadId, messageId) {
    return this.stmts.deleteMessage.run(threadId, messageId).changes > 0;
  }
}
