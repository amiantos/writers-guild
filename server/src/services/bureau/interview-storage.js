/**
 * Interview Storage
 *
 * Queries for interviews in bureau.db (see "Profiles and interviews" in
 * docs/bureau-design.md). An interview keeps its questions and answers in
 * order, and the latest write-up waiting for the reader's review. A character
 * has at most one open interview. Methods are synchronous, like better-sqlite3
 * itself.
 */

import { v4 as uuidv4 } from 'uuid';
import { openBureauDb } from './bureau-db.js';

export const INTERVIEW_MESSAGE_SOURCES = ['user', 'generated'];

export class InterviewConflictError extends Error {
  /**
   * @param {string} interviewId - The interview already open.
   */
  constructor(interviewId) {
    super('This character already has an interview going');
    this.name = 'InterviewConflictError';
    this.interviewId = interviewId;
  }
}

function parseJson(text, fallback) {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function interviewFromRow(row) {
  return {
    id: row.id,
    bureauId: row.bureau_id,
    castMemberId: row.cast_member_id,
    focus: row.focus,
    note: row.note,
    status: row.status,
    messages: parseJson(row.messages, []),
    proposal: parseJson(row.proposal, null),
    created: row.created,
    modified: row.modified,
  };
}

export class InterviewStorage {
  constructor(dataRoot) {
    this.db = openBureauDb(dataRoot);
    this.prepareStatements();
  }

  prepareStatements() {
    this.stmts = {
      get: this.db.prepare('SELECT * FROM interviews WHERE bureau_id = ? AND id = ?'),
      getOpen: this.db.prepare(
        "SELECT * FROM interviews WHERE bureau_id = ? AND cast_member_id = ? AND status = 'open'",
      ),
      insert: this.db.prepare(`
        INSERT INTO interviews (id, bureau_id, cast_member_id, focus, note, created, modified)
        VALUES (@id, @bureauId, @castId, @focus, @note, @created, @modified)
      `),
      setMessages: this.db.prepare(`
        UPDATE interviews SET messages = @messages, proposal = @proposal, modified = @modified
        WHERE id = @id AND status = 'open'
      `),
      setProposal: this.db.prepare(`
        UPDATE interviews SET proposal = @proposal, modified = @modified
        WHERE bureau_id = @bureauId AND id = @id AND status = 'open'
      `),
      accept: this.db.prepare(`
        UPDATE interviews SET status = 'accepted', proposal = @proposal, modified = @modified
        WHERE bureau_id = @bureauId AND id = @id AND status = 'open'
      `),
      delete: this.db.prepare('DELETE FROM interviews WHERE bureau_id = ? AND id = ?'),
    };
  }

  getInterview(bureauId, interviewId) {
    const row = this.stmts.get.get(bureauId, interviewId);
    return row ? interviewFromRow(row) : null;
  }

  /** A character's open interview, or null. */
  getOpenInterview(bureauId, castId) {
    const row = this.stmts.getOpen.get(bureauId, castId);
    return row ? interviewFromRow(row) : null;
  }

  /**
   * @param {string} bureauId
   * @param {string} castId
   * @param {Object} interview
   * @param {string} interview.focus - A key of INTERVIEW_FOCUSES (see interview.js).
   * @param {string} [interview.note] - What the reader wants to cover, in their words.
   * @returns {Object} The new interview.
   * @throws {InterviewConflictError} When the character already has an open interview.
   */
  startInterview(bureauId, castId, { focus, note = '' }) {
    const existing = this.stmts.getOpen.get(bureauId, castId);
    if (existing) throw new InterviewConflictError(existing.id);

    const id = uuidv4();
    const now = new Date().toISOString();
    this.stmts.insert.run({ id, bureauId, castId, focus, note, created: now, modified: now });
    return this.getInterview(bureauId, id);
  }

  /**
   * Add a question or an answer to an open interview. An answer sets aside the write-up, which no
   * longer covers everything the reader said.
   *
   * @param {string} bureauId
   * @param {string} interviewId
   * @param {Object} message
   * @param {'user'|'generated'} message.source - The reader's answer, or the interviewer's question.
   * @param {string} message.content
   * @param {string|null} [message.runId]
   * @param {boolean} [message.replaceQuestion] - Take the place of the last message, if it's a
   *   question.
   * @returns {Object|null} The interview, or null if it isn't open.
   */
  addMessage(bureauId, interviewId, { source, content, runId = null, replaceQuestion = false }) {
    if (!INTERVIEW_MESSAGE_SOURCES.includes(source)) {
      throw new Error(`Unknown message source: ${source}`);
    }

    let added = false;
    this.db.transaction(() => {
      const row = this.stmts.get.get(bureauId, interviewId);
      if (!row || row.status !== 'open') return;

      const now = new Date().toISOString();
      const messages = parseJson(row.messages, []);
      if (replaceQuestion && messages.at(-1)?.source === 'generated') {
        messages.pop();
      }
      messages.push({ id: uuidv4(), source, content, runId, created: now });
      this.stmts.setMessages.run({
        id: interviewId,
        messages: JSON.stringify(messages),
        proposal: source === 'user' ? null : row.proposal,
        modified: now,
      });
      added = true;
    })();
    return added ? this.getInterview(bureauId, interviewId) : null;
  }

  /**
   * Save a write-up for the reader to review, replacing any earlier one.
   * @returns {Object|null} The interview, or null if it isn't open.
   */
  setProposal(bureauId, interviewId, proposal) {
    const changed = this.stmts.setProposal.run({
      bureauId,
      id: interviewId,
      proposal: JSON.stringify(proposal),
      modified: new Date().toISOString(),
    }).changes;
    return changed > 0 ? this.getInterview(bureauId, interviewId) : null;
  }

  /**
   * Close an interview whose write-up the reader accepted, keeping what they accepted.
   * @returns {boolean} Whether it was open.
   */
  acceptInterview(bureauId, interviewId, accepted) {
    return (
      this.stmts.accept.run({
        bureauId,
        id: interviewId,
        proposal: JSON.stringify(accepted),
        modified: new Date().toISOString(),
      }).changes > 0
    );
  }

  deleteInterview(bureauId, interviewId) {
    return this.stmts.delete.run(bureauId, interviewId).changes > 0;
  }
}
