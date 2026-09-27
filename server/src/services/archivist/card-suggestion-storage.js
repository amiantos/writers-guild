/**
 * Card Suggestion Storage
 *
 * The Archivist's suggested edits to library character cards, kept per story
 * or chat. A suggestion is proposed until the reader accepts or rejects it;
 * rejected ones are kept so later runs don't propose them again. They're
 * deleted with their story or chat (see the triggers in database.js).
 *
 * Methods are synchronous, like better-sqlite3 itself. The table is created
 * with the rest of the schema in database.js.
 */

export const SUGGESTION_SOURCE_KINDS = ['story', 'chat'];
export const SUGGESTION_STATUSES = ['proposed', 'accepted', 'rejected'];

function suggestionFromRow(row) {
  return {
    id: row.id,
    characterId: row.character_id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    field: row.field,
    find: row.find,
    replace: row.replace,
    rationale: row.rationale,
    quote: row.quote,
    status: row.status,
    created: row.created,
  };
}

export class CardSuggestionStorage {
  /**
   * @param {import('better-sqlite3').Database} db - The main database, as opened by
   *   SqliteStorageService.
   */
  constructor(db) {
    this.db = db;
    this.stmts = {
      listForSource: db.prepare(
        'SELECT * FROM card_suggestions WHERE source_kind = ? AND source_id = ? ORDER BY id',
      ),
      get: db.prepare('SELECT * FROM card_suggestions WHERE id = ?'),
      insert: db.prepare(`
        INSERT INTO card_suggestions (character_id, source_kind, source_id, field, find, replace,
                                      rationale, quote, status, created)
        VALUES (@characterId, @sourceKind, @sourceId, @field, @find, @replace, @rationale, @quote,
                'proposed', @created)
      `),
      update: db.prepare('UPDATE card_suggestions SET status = ?, replace = ? WHERE id = ?'),
      storyExists: db.prepare('SELECT 1 FROM stories WHERE id = ?'),
      chatExists: db.prepare('SELECT 1 FROM chats WHERE id = ?'),
      characterExists: db.prepare('SELECT 1 FROM characters WHERE id = ?'),
    };
  }

  /** Every suggestion for a story or chat, oldest first, in any status. */
  listForSource(sourceKind, sourceId) {
    return this.stmts.listForSource.all(sourceKind, sourceId).map(suggestionFromRow);
  }

  /** @returns {Object|null} */
  get(id) {
    const row = this.stmts.get.get(id);
    return row ? suggestionFromRow(row) : null;
  }

  /**
   * Keep new suggestions for a story or chat, proposed. Returns them as kept: none when the
   * story or chat is gone, and none for a character whose card is gone, since either may be
   * deleted while the Archivist reads.
   */
  addAll(sourceKind, sourceId, suggestions) {
    const created = new Date().toISOString();
    const sourceExists = sourceKind === 'chat' ? this.stmts.chatExists : this.stmts.storyExists;
    return this.db.transaction(() => {
      if (!sourceExists.get(sourceId)) return [];
      return suggestions
        .filter((suggestion) => this.stmts.characterExists.get(suggestion.characterId))
        .map((suggestion) => {
          const { lastInsertRowid } = this.stmts.insert.run({
            ...suggestion,
            sourceKind,
            sourceId,
            created,
          });
          return this.get(Number(lastInsertRowid));
        });
    })();
  }

  /** Mark a suggestion accepted or rejected, keeping the text the reader settled on. */
  setStatus(id, status, replace) {
    const current = this.get(id);
    if (!current) return null;
    this.stmts.update.run(status, replace ?? current.replace, id);
    return this.get(id);
  }
}
