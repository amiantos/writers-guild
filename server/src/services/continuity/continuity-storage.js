/**
 * Continuity Storage
 *
 * A Continuity is text the reader writes to carry what's true across stories
 * and chats: who is together, what happened last time, where everyone is now.
 * A story or chat in a Continuity gets its text ahead of its own scenario in
 * the prompt (see scenarioWithContinuity). Every change to the text is kept as
 * a version, so an earlier one can be restored.
 *
 * Methods are synchronous, like better-sqlite3 itself. The tables are created
 * with the rest of the schema in database.js.
 */

import { v4 as uuidv4 } from 'uuid';

// Where a version came from: the Continuity's first text, a later edit, a restore of an earlier
// version, or an Archivist update accepted from a story or chat.
export const CONTINUITY_VERSION_SOURCES = ['created', 'edit', 'restore', 'archivist'];

/**
 * The scenario a story or chat's prompt uses: its Continuity's text, then its own scenario,
 * with a blank line between them. Either may be empty.
 */
export function scenarioWithContinuity(continuityText, scenario) {
  return [continuityText, scenario]
    .map((text) => (text ?? '').trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * A story or chat as its prompt sees it: when Continuities are on and it's in one, its scenario
 * is its Continuity's text followed by its own scenario. Otherwise it's returned as it is.
 */
export function withContinuityScenario(source, continuities, enabled) {
  if (!enabled || !source?.continuityId) return source;
  return {
    ...source,
    scenario: scenarioWithContinuity(continuities.content(source.continuityId), source.scenario),
  };
}

function continuityFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    created: row.created,
    modified: row.modified,
    storyCount: row.story_count ?? 0,
    chatCount: row.chat_count ?? 0,
  };
}

function versionFromRow(row) {
  return {
    id: row.id,
    continuityId: row.continuity_id,
    content: row.content,
    source: row.source,
    sourceId: row.source_id,
    created: row.created,
  };
}

const WITH_COUNTS = `
  SELECT c.*,
    (SELECT COUNT(*) FROM stories s WHERE s.continuity_id = c.id) AS story_count,
    (SELECT COUNT(*) FROM chats h WHERE h.continuity_id = c.id) AS chat_count
  FROM continuities c
`;

export class ContinuityStorage {
  /**
   * @param {import('better-sqlite3').Database} db - The main database, as opened by
   *   SqliteStorageService.
   */
  constructor(db) {
    this.db = db;
    this.stmts = {
      list: db.prepare(`${WITH_COUNTS} ORDER BY c.name COLLATE NOCASE, c.created`),
      get: db.prepare(`${WITH_COUNTS} WHERE c.id = ?`),
      getContent: db.prepare('SELECT content FROM continuities WHERE id = ?'),
      insert: db.prepare(`
        INSERT INTO continuities (id, name, content, created, modified)
        VALUES (@id, @name, @content, @created, @modified)
      `),
      update: db.prepare(`
        UPDATE continuities SET name = @name, content = @content, modified = @modified
        WHERE id = @id
      `),
      delete: db.prepare('DELETE FROM continuities WHERE id = ?'),
      detachStories: db.prepare('UPDATE stories SET continuity_id = NULL WHERE continuity_id = ?'),
      detachChats: db.prepare('UPDATE chats SET continuity_id = NULL WHERE continuity_id = ?'),
      insertVersion: db.prepare(`
        INSERT INTO continuity_versions (continuity_id, content, source, source_id, created)
        VALUES (@continuityId, @content, @source, @sourceId, @created)
      `),
      listVersions: db.prepare(
        'SELECT * FROM continuity_versions WHERE continuity_id = ? ORDER BY id',
      ),
      getStoryTitle: db.prepare('SELECT title FROM stories WHERE id = ?'),
      getChatTitle: db.prepare('SELECT title FROM chats WHERE id = ?'),
      getVersion: db.prepare(
        'SELECT * FROM continuity_versions WHERE continuity_id = ? AND id = ?',
      ),
    };
  }

  /** Every Continuity, by name, with how many stories and chats are in each. */
  list() {
    return this.stmts.list.all().map(continuityFromRow);
  }

  /** @returns {Object|null} */
  get(id) {
    const row = this.stmts.get.get(id);
    return row ? continuityFromRow(row) : null;
  }

  exists(id) {
    return Boolean(this.stmts.getContent.get(id));
  }

  /** A Continuity's text, or '' when it's gone. */
  content(id) {
    return this.stmts.getContent.get(id)?.content ?? '';
  }

  /** Make a Continuity, keeping its text as the first version. */
  create({ name, content = '' }) {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.stmts.insert.run({ id, name, content, created: now, modified: now });
      this.addVersion(id, content, 'created', null, now);
    })();
    return this.get(id);
  }

  /**
   * Change a Continuity's name or text; either left undefined stays as it is. A change to the
   * text is kept as a new version.
   * @returns {Object|null} The Continuity, or null if it doesn't exist.
   */
  update(id, { name, content }, { source = 'edit', sourceId = null } = {}) {
    const existing = this.get(id);
    if (!existing) return null;
    const next = {
      id,
      name: name ?? existing.name,
      content: content ?? existing.content,
      modified: new Date().toISOString(),
    };
    if (next.name === existing.name && next.content === existing.content) return existing;
    this.db.transaction(() => {
      this.stmts.update.run(next);
      if (next.content !== existing.content) {
        this.addVersion(id, next.content, source, sourceId, next.modified);
      }
    })();
    return this.get(id);
  }

  /**
   * Delete a Continuity and its versions. Its stories and chats stay, out of any Continuity.
   * @returns {boolean} Whether it existed.
   */
  delete(id) {
    return this.db.transaction(() => {
      this.stmts.detachStories.run(id);
      this.stmts.detachChats.run(id);
      return this.stmts.delete.run(id).changes > 0;
    })();
  }

  /**
   * A Continuity's versions, oldest first. An Archivist version also carries the title of the
   * story or chat it came from as `sourceTitle`, or null once that's deleted.
   */
  listVersions(id) {
    return this.stmts.listVersions.all(id).map((row) => {
      const version = versionFromRow(row);
      if (version.source === 'archivist') {
        const [kind, sourceId] = String(version.sourceId ?? '').split(/:(.*)/s);
        const statement = { story: this.stmts.getStoryTitle, chat: this.stmts.getChatTitle }[kind];
        version.sourceTitle = statement?.get(sourceId)?.title ?? null;
      }
      return version;
    });
  }

  /**
   * Put a Continuity's text back as it was at an earlier version, kept as a new version.
   * @returns {Object|null} The Continuity, or null if it or the version doesn't exist.
   */
  restoreVersion(id, versionId) {
    const version = this.stmts.getVersion.get(id, versionId);
    if (!version) return null;
    return this.update(
      id,
      { content: version.content },
      { source: 'restore', sourceId: String(versionId) },
    );
  }

  addVersion(continuityId, content, source, sourceId, created) {
    this.stmts.insertVersion.run({ continuityId, content, source, sourceId, created });
  }
}
