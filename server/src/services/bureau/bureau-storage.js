/**
 * Bureau Storage
 *
 * Queries for bureau.db. Methods are synchronous, like better-sqlite3 itself.
 *
 * API keys only leave this module through getBureauCredentials(), which exists
 * for server-side model calls. Everything else carries a masked preview.
 */

import { v4 as uuidv4 } from 'uuid';
import { openBureauDb } from './bureau-db.js';
import { DEFAULT_MODEL } from './deepseek-client.js';

export class CastConflictError extends Error {
  /**
   * @param {string} castMemberId - The member already holding that library character.
   */
  constructor(castMemberId) {
    super("That character is already in this Bureau's cast");
    this.name = 'CastConflictError';
    this.castMemberId = castMemberId;
  }
}

/**
 * Masked preview of an API key: enough to tell keys apart, not enough to use one.
 * @param {string} apiKey
 * @returns {string}
 */
export function maskApiKey(apiKey) {
  if (!apiKey) return '';
  if (apiKey.length <= 8) return '••••';
  return `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`;
}

function parseJson(text, fallback) {
  if (text === null || text === undefined) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function toJson(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function bureauFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    model: row.model,
    hasApiKey: row.api_key.length > 0,
    apiKeyPreview: maskApiKey(row.api_key),
    bureauTime: row.bureau_time,
    presentOffsetDays: row.present_offset_days,
    timezone: row.timezone,
    houseStyle: row.house_style,
    settings: parseJson(row.settings, {}),
    castCount: row.cast_count,
    created: row.created,
    modified: row.modified,
  };
}

function castMemberFromRow(row, { includeSeedCard = false } = {}) {
  const member = {
    id: row.id,
    bureauId: row.bureau_id,
    libraryCharacterId: row.library_character_id,
    name: row.name,
    isPersona: row.is_persona === 1,
    isDraft: row.is_draft === 1,
    routine: parseJson(row.routine, {}),
    created: row.created,
    modified: row.modified,
  };
  if (includeSeedCard) {
    member.seedCard = parseJson(row.seed_card, null);
  }
  return member;
}

function runFromRow(row) {
  return {
    id: row.id,
    bureauId: row.bureau_id,
    purpose: row.purpose,
    targetType: row.target_type,
    targetId: row.target_id,
    status: row.status,
    error: row.error,
    started: row.started,
    finished: row.finished,
    stepCount: row.step_count,
  };
}

function stepFromRow(row) {
  return {
    id: row.id,
    position: row.position,
    role: row.role,
    kind: row.kind,
    request: parseJson(row.request, null),
    response: parseJson(row.response, null),
    reasoning: row.reasoning,
    toolCalls: parseJson(row.tool_calls, null),
    usage: parseJson(row.usage, null),
    durationMs: row.duration_ms,
    error: row.error,
    created: row.created,
  };
}

export class BureauStorage {
  constructor(dataRoot) {
    this.db = openBureauDb(dataRoot);
    this.prepareStatements();
  }

  prepareStatements() {
    const bureauColumns = `b.*, (SELECT COUNT(*) FROM cast_members c WHERE c.bureau_id = b.id) AS cast_count`;
    const runColumns = `r.*, (SELECT COUNT(*) FROM agent_steps s WHERE s.run_id = r.id) AS step_count`;

    this.stmts = {
      // Bureaus
      listBureaus: this.db.prepare(
        `SELECT ${bureauColumns} FROM bureaus b ORDER BY b.modified DESC, b.rowid DESC`,
      ),
      getBureau: this.db.prepare(`SELECT ${bureauColumns} FROM bureaus b WHERE b.id = ?`),
      getCredentials: this.db.prepare('SELECT api_key, model FROM bureaus WHERE id = ?'),
      insertBureau: this.db.prepare(`
        INSERT INTO bureaus (id, name, description, api_key, model, bureau_time, created, modified)
        VALUES (@id, @name, @description, @apiKey, @model, @bureauTime, @created, @modified)
      `),
      updateBureau: this.db.prepare(`
        UPDATE bureaus SET name = @name, description = @description, api_key = @apiKey,
                           model = @model, house_style = @houseStyle, modified = @modified
        WHERE id = @id
      `),
      touchBureau: this.db.prepare('UPDATE bureaus SET modified = ? WHERE id = ?'),
      deleteBureau: this.db.prepare('DELETE FROM bureaus WHERE id = ?'),

      // Cast
      listCast: this.db.prepare(
        'SELECT * FROM cast_members WHERE bureau_id = ? ORDER BY created, rowid',
      ),
      getCastMember: this.db.prepare('SELECT * FROM cast_members WHERE bureau_id = ? AND id = ?'),
      findCastByLibraryCharacter: this.db.prepare(
        'SELECT id FROM cast_members WHERE bureau_id = ? AND library_character_id = ?',
      ),
      insertCastMember: this.db.prepare(`
        INSERT INTO cast_members (id, bureau_id, library_character_id, name, is_persona, is_draft,
                                  seed_card, created, modified)
        VALUES (@id, @bureauId, @libraryCharacterId, @name, @isPersona, 0, @seedCard,
                @created, @modified)
      `),
      updateCastPersona: this.db.prepare(`
        UPDATE cast_members SET is_persona = @isPersona, modified = @modified
        WHERE bureau_id = @bureauId AND id = @id
      `),
      deleteCastMember: this.db.prepare('DELETE FROM cast_members WHERE bureau_id = ? AND id = ?'),

      // Run records
      insertRun: this.db.prepare(`
        INSERT INTO agent_runs (id, bureau_id, purpose, target_type, target_id, status, started)
        VALUES (@id, @bureauId, @purpose, @targetType, @targetId, 'running', @started)
      `),
      finishRun: this.db.prepare(`
        UPDATE agent_runs SET status = @status, error = @error, finished = @finished WHERE id = @id
      `),
      insertStep: this.db.prepare(`
        INSERT INTO agent_steps (run_id, position, role, kind, request, response, reasoning,
                                 tool_calls, usage, duration_ms, error, created)
        VALUES (@runId, @position, @role, @kind, @request, @response, @reasoning,
                @toolCalls, @usage, @durationMs, @error, @created)
      `),
      listRuns: this.db.prepare(`
        SELECT ${runColumns} FROM agent_runs r
        WHERE r.bureau_id = ?
        ORDER BY r.started DESC, r.rowid DESC
        LIMIT ?
      `),
      getRun: this.db.prepare(
        `SELECT ${runColumns} FROM agent_runs r WHERE r.bureau_id = ? AND r.id = ?`,
      ),
      listSteps: this.db.prepare('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY position'),
    };
  }

  // ==================== Bureaus ====================

  listBureaus() {
    return this.stmts.listBureaus.all().map(bureauFromRow);
  }

  getBureau(bureauId) {
    const row = this.stmts.getBureau.get(bureauId);
    return row ? bureauFromRow(row) : null;
  }

  /**
   * The Bureau's API key and model, for server-side model calls. Never send
   * the result to a client.
   * @returns {{ apiKey: string, model: string } | null}
   */
  getBureauCredentials(bureauId) {
    const row = this.stmts.getCredentials.get(bureauId);
    return row ? { apiKey: row.api_key, model: row.model } : null;
  }

  /**
   * @param {Object} bureau
   * @param {string} bureau.name
   * @param {string} [bureau.description]
   * @param {string} [bureau.apiKey]
   * @param {string} [bureau.model]
   */
  createBureau({ name, description = '', apiKey = '', model = DEFAULT_MODEL }) {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.stmts.insertBureau.run({
      id,
      name,
      description,
      apiKey,
      model,
      bureauTime: now,
      created: now,
      modified: now,
    });
    return this.getBureau(id);
  }

  /**
   * @param {string} bureauId
   * @param {Object} updates - Any of name, description, apiKey, model, houseStyle.
   *   Undefined fields are left alone; an apiKey of '' removes the key.
   * @returns {Object|null} The updated Bureau, or null if it doesn't exist.
   */
  updateBureau(bureauId, updates) {
    const row = this.stmts.getBureau.get(bureauId);
    if (!row) return null;

    this.stmts.updateBureau.run({
      id: bureauId,
      name: updates.name ?? row.name,
      description: updates.description ?? row.description,
      apiKey: updates.apiKey ?? row.api_key,
      model: updates.model ?? row.model,
      houseStyle: updates.houseStyle ?? row.house_style,
      modified: new Date().toISOString(),
    });
    return this.getBureau(bureauId);
  }

  /** Deletes the Bureau with its cast and run records. */
  deleteBureau(bureauId) {
    return this.stmts.deleteBureau.run(bureauId).changes > 0;
  }

  // ==================== Cast ====================

  /** Cast members without their seed cards. */
  listCast(bureauId) {
    return this.stmts.listCast.all(bureauId).map((row) => castMemberFromRow(row));
  }

  /** A cast member with its seed card, or null. */
  getCastMember(bureauId, castId) {
    const row = this.stmts.getCastMember.get(bureauId, castId);
    return row ? castMemberFromRow(row, { includeSeedCard: true }) : null;
  }

  /**
   * Add a character to a Bureau's cast from a copy of its card.
   *
   * The card is stored as the member's seed card and never written back to the
   * library, so nothing that happens in a Bureau can reach the library character.
   *
   * @param {string} bureauId
   * @param {Object} member
   * @param {Object} member.seedCard - Full V2 card to copy.
   * @param {string|null} [member.libraryCharacterId]
   * @param {boolean} [member.isPersona]
   * @returns {Object} The new cast member.
   * @throws {CastConflictError} When the library character is already in the cast.
   */
  addCastMember(bureauId, { seedCard, libraryCharacterId = null, isPersona = false }) {
    if (libraryCharacterId) {
      const existing = this.stmts.findCastByLibraryCharacter.get(bureauId, libraryCharacterId);
      if (existing) throw new CastConflictError(existing.id);
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.stmts.insertCastMember.run({
        id,
        bureauId,
        libraryCharacterId,
        name: seedCard?.data?.name || 'Unnamed',
        isPersona: isPersona ? 1 : 0,
        seedCard: JSON.stringify(seedCard),
        created: now,
        modified: now,
      });
      this.stmts.touchBureau.run(now, bureauId);
    })();
    return this.getCastMember(bureauId, id);
  }

  /**
   * @param {string} bureauId
   * @param {string} castId
   * @param {Object} updates
   * @param {boolean} [updates.isPersona]
   * @returns {Object|null} The updated member, or null if it doesn't exist.
   */
  updateCastMember(bureauId, castId, { isPersona }) {
    if (!this.stmts.getCastMember.get(bureauId, castId)) return null;

    if (isPersona !== undefined) {
      this.stmts.updateCastPersona.run({
        bureauId,
        id: castId,
        isPersona: isPersona ? 1 : 0,
        modified: new Date().toISOString(),
      });
    }
    return this.getCastMember(bureauId, castId);
  }

  removeCastMember(bureauId, castId) {
    const removed = this.stmts.deleteCastMember.run(bureauId, castId).changes > 0;
    if (removed) {
      this.stmts.touchBureau.run(new Date().toISOString(), bureauId);
    }
    return removed;
  }

  // ==================== Run records ====================

  /**
   * @param {Object} run
   * @param {string} run.bureauId
   * @param {string} run.purpose
   * @param {string|null} [run.targetType]
   * @param {string|null} [run.targetId]
   * @returns {string} The new run's id.
   */
  createRun({ bureauId, purpose, targetType = null, targetId = null }) {
    const id = uuidv4();
    this.stmts.insertRun.run({
      id,
      bureauId,
      purpose,
      targetType,
      targetId,
      started: new Date().toISOString(),
    });
    return id;
  }

  finishRun(runId, { status, error = null }) {
    this.stmts.finishRun.run({ id: runId, status, error, finished: new Date().toISOString() });
  }

  /**
   * @param {string} runId
   * @param {Object} step - position, role, kind, and optionally request, response,
   *   reasoning, toolCalls, usage, durationMs, error.
   */
  addStep(runId, step) {
    this.stmts.insertStep.run({
      runId,
      position: step.position,
      role: step.role,
      kind: step.kind,
      request: toJson(step.request),
      response: toJson(step.response),
      reasoning: step.reasoning || null,
      toolCalls: step.toolCalls?.length ? JSON.stringify(step.toolCalls) : null,
      usage: toJson(step.usage),
      durationMs: step.durationMs ?? null,
      error: step.error ?? null,
      created: new Date().toISOString(),
    });
  }

  /** Runs newest first, without steps. */
  listRuns(bureauId, { limit = 50 } = {}) {
    return this.stmts.listRuns.all(bureauId, limit).map(runFromRow);
  }

  /** A run with its steps in order, or null. */
  getRun(bureauId, runId) {
    const row = this.stmts.getRun.get(bureauId, runId);
    if (!row) return null;
    return { ...runFromRow(row), steps: this.stmts.listSteps.all(runId).map(stepFromRow) };
  }
}
