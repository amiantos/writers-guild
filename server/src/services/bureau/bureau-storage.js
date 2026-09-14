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
import { applySettingsUpdate, resolveSettings } from './bureau-settings.js';

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
    timezone: row.timezone,
    houseStyle: row.house_style,
    settings: resolveSettings(parseJson(row.settings, {})),
    avatarWindows: parseJson(row.avatar_windows, []),
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
                           model = @model, house_style = @houseStyle, timezone = @timezone,
                           bureau_time = @bureauTime, modified = @modified
        WHERE id = @id
      `),
      updateSettings: this.db.prepare('UPDATE bureaus SET settings = ?, modified = ? WHERE id = ?'),
      setBureauTime: this.db.prepare(
        'UPDATE bureaus SET bureau_time = ?, modified = ? WHERE id = ?',
      ),
      setAvatarWindows: this.db.prepare('UPDATE bureaus SET avatar_windows = ? WHERE id = ?'),
      touchBureau: this.db.prepare('UPDATE bureaus SET modified = ? WHERE id = ?'),

      // World
      listLorebookIds: this.db.prepare(
        'SELECT lorebook_id FROM bureau_lorebooks WHERE bureau_id = ? ORDER BY rowid',
      ),
      attachLorebook: this.db.prepare(
        'INSERT OR IGNORE INTO bureau_lorebooks (bureau_id, lorebook_id) VALUES (?, ?)',
      ),
      detachLorebook: this.db.prepare(
        'DELETE FROM bureau_lorebooks WHERE bureau_id = ? AND lorebook_id = ?',
      ),
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
        VALUES (@id, @bureauId, @libraryCharacterId, @name, @isPersona, @isDraft, @seedCard,
                @created, @modified)
      `),
      promoteDraft: this.db.prepare(`
        UPDATE cast_members SET is_draft = 0, library_character_id = @libraryCharacterId,
                                modified = @modified
        WHERE bureau_id = @bureauId AND id = @id AND is_draft = 1
      `),
      updateCastPersona: this.db.prepare(`
        UPDATE cast_members SET is_persona = @isPersona, modified = @modified
        WHERE bureau_id = @bureauId AND id = @id
      `),
      clearOtherPersonas: this.db.prepare(`
        UPDATE cast_members SET is_persona = 0, modified = @modified
        WHERE bureau_id = @bureauId AND is_persona = 1 AND id != @id
      `),
      updateCastRoutine: this.db.prepare(`
        UPDATE cast_members SET routine = @routine, modified = @modified
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
   * @param {Object} updates - Any of name, description, apiKey, model, houseStyle, timezone, and
   *   bureauTime (an ISO time, checked by bureau-time.js).
   *   Undefined fields are left alone. An apiKey of '' removes the key, and a
   *   timezone of null clears it.
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
      timezone: updates.timezone !== undefined ? updates.timezone : row.timezone,
      bureauTime: updates.bureauTime ?? row.bureau_time,
      modified: new Date().toISOString(),
    });
    return this.getBureau(bureauId);
  }

  /**
   * Apply a partial settings update, such as { writer: { thinking: true } }.
   * @returns {Object|null} The updated Bureau, or null if it doesn't exist.
   * @throws {import('./bureau-settings.js').BureauSettingsError} For unknown or invalid settings.
   */
  updateSettings(bureauId, update) {
    const row = this.stmts.getBureau.get(bureauId);
    if (!row) return null;

    const settings = applySettingsUpdate(parseJson(row.settings, {}), update);
    this.stmts.updateSettings.run(JSON.stringify(settings), new Date().toISOString(), bureauId);
    return this.getBureau(bureauId);
  }

  /**
   * Move the Bureau's clock. bureau-time.js decides what the time should be.
   * @param {string} bureauId
   * @param {string} bureauTime - ISO timestamp.
   * @returns {boolean} Whether the Bureau exists.
   */
  setBureauTime(bureauId, bureauTime) {
    const now = new Date().toISOString();
    return this.stmts.setBureauTime.run(bureauTime, now, bureauId).changes > 0;
  }

  /**
   * Save the avatar windows floating over the Bureau's chapters. Moving a window isn't a change to
   * the Bureau, so it doesn't move the Bureau up the list.
   * @param {string} bureauId
   * @param {Array<{ id: string, castId: string, x: number, y: number, width: number,
   *   height: number }>} avatarWindows
   * @returns {boolean} Whether the Bureau exists.
   */
  setAvatarWindows(bureauId, avatarWindows) {
    return this.stmts.setAvatarWindows.run(JSON.stringify(avatarWindows), bureauId).changes > 0;
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
   * @param {boolean} [member.isPersona] - A Bureau has one reader's character, so this
   *   unmarks whoever had the role.
   * @param {boolean} [member.isDraft] - A generated character that exists only in this Bureau
   *   until it's saved to the library.
   * @returns {Object} The new cast member.
   * @throws {CastConflictError} When the library character is already in the cast.
   */
  addCastMember(
    bureauId,
    { seedCard, libraryCharacterId = null, isPersona = false, isDraft = false },
  ) {
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
        isDraft: isDraft ? 1 : 0,
        seedCard: JSON.stringify(seedCard),
        created: now,
        modified: now,
      });
      if (isPersona) {
        this.stmts.clearOtherPersonas.run({ bureauId, id, modified: now });
      }
      this.stmts.touchBureau.run(now, bureauId);
    })();
    return this.getCastMember(bureauId, id);
  }

  /**
   * @param {string} bureauId
   * @param {string} castId
   * @param {Object} updates
   * @param {boolean} [updates.isPersona] - Marking a member unmarks the previous reader's
   *   character.
   * @param {string} [updates.routine] - How they usually spend their days, for replies and
   *   offscreen life.
   * @returns {Object|null} The updated member, or null if it doesn't exist.
   */
  updateCastMember(bureauId, castId, { isPersona, routine }) {
    if (!this.stmts.getCastMember.get(bureauId, castId)) return null;

    if (routine !== undefined) {
      this.stmts.updateCastRoutine.run({
        bureauId,
        id: castId,
        routine: JSON.stringify({ text: routine }),
        modified: new Date().toISOString(),
      });
    }
    if (isPersona !== undefined) {
      const modified = new Date().toISOString();
      this.db.transaction(() => {
        if (isPersona) {
          this.stmts.clearOtherPersonas.run({ bureauId, id: castId, modified });
        }
        this.stmts.updateCastPersona.run({
          bureauId,
          id: castId,
          isPersona: isPersona ? 1 : 0,
          modified,
        });
      })();
    }
    return this.getCastMember(bureauId, castId);
  }

  /**
   * Link a draft cast member to the library character it was saved as.
   * @returns {Object|null} The member, or null if it isn't a draft in this Bureau.
   * @throws {CastConflictError} When that library character is already in the cast.
   */
  promoteDraft(bureauId, castId, libraryCharacterId) {
    const existing = this.stmts.findCastByLibraryCharacter.get(bureauId, libraryCharacterId);
    if (existing) throw new CastConflictError(existing.id);

    const now = new Date().toISOString();
    const promoted = this.stmts.promoteDraft.run({
      bureauId,
      id: castId,
      libraryCharacterId,
      modified: now,
    });
    if (promoted.changes === 0) return null;
    this.stmts.touchBureau.run(now, bureauId);
    return this.getCastMember(bureauId, castId);
  }

  removeCastMember(bureauId, castId) {
    const removed = this.stmts.deleteCastMember.run(bureauId, castId).changes > 0;
    if (removed) {
      this.stmts.touchBureau.run(new Date().toISOString(), bureauId);
    }
    return removed;
  }

  // ==================== World ====================

  /** Ids of the library lorebooks attached to a Bureau, in the order attached. */
  listLorebookIds(bureauId) {
    return this.stmts.listLorebookIds.all(bureauId).map((row) => row.lorebook_id);
  }

  /** Attach a library lorebook. Attaching one that's already attached does nothing. */
  attachLorebook(bureauId, lorebookId) {
    const attached = this.stmts.attachLorebook.run(bureauId, lorebookId).changes > 0;
    if (attached) {
      this.stmts.touchBureau.run(new Date().toISOString(), bureauId);
    }
    return attached;
  }

  detachLorebook(bureauId, lorebookId) {
    const detached = this.stmts.detachLorebook.run(bureauId, lorebookId).changes > 0;
    if (detached) {
      this.stmts.touchBureau.run(new Date().toISOString(), bureauId);
    }
    return detached;
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
