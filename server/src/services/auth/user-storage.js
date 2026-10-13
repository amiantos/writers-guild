/**
 * User Storage
 *
 * Users, their sessions, and the single-use links that invite someone or reset a password. Unlike
 * the rest of storage these queries aren't kept to the current user: they're how a request comes
 * to have one.
 *
 * Signing in is off on a fresh install, which runs everything as the admin. It's on once the admin
 * has a password, and stays on while anyone else has an account.
 *
 * Methods are synchronous, like better-sqlite3 itself. The tables are created with the rest of
 * the schema in database.js.
 */

import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { initializeDatabase, OWNED_TABLES } from '../database.js';
import { ADMIN_USER_ID } from '../user-context.js';

export const USER_ROLES = ['admin', 'user'];
export const LINK_KINDS = ['invite', 'reset'];

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// A session in use is extended, at most once a day.
const SESSION_REFRESH_MS = 24 * 60 * 60 * 1000;

export const LINK_TTL_MS = { invite: 7 * 24 * 60 * 60 * 1000, reset: 24 * 60 * 60 * 1000 };

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

/** Why a username can't be used, or null if it can. Whether it's taken is checked on save. */
export function usernameProblem(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    return 'Username must be 3 to 32 letters, numbers, dots, dashes or underscores';
  }
  return null;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function userFromRow(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    hasPassword: !!row.password_hash,
    created: row.created,
  };
}

function linkFromRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    userId: row.user_id,
    created: row.created,
    expires: row.expires,
  };
}

const storages = new Map();

/** The user storage for a data directory, opened once. */
export function userStorageFor(dataRoot) {
  if (!storages.has(dataRoot)) {
    storages.set(dataRoot, new UserStorage(initializeDatabase(dataRoot)));
  }
  return storages.get(dataRoot);
}

export class UserStorage {
  /** @param {import('better-sqlite3').Database} db */
  constructor(db) {
    this.db = db;
    this.stmts = {
      getUser: db.prepare('SELECT * FROM users WHERE id = ?'),
      findUser: db.prepare('SELECT * FROM users WHERE username = ?'),
      listUsers: db.prepare(`SELECT * FROM users ORDER BY role = 'admin' DESC, username`),
      countOthers: db.prepare('SELECT COUNT(*) AS count FROM users WHERE id != ?'),
      insertUser: db.prepare(`
        INSERT INTO users (id, username, role, password_hash, created, modified)
        VALUES (@id, @username, @role, @passwordHash, @created, @modified)
      `),
      insertSettings: db.prepare('INSERT OR IGNORE INTO settings (user_id) VALUES (?)'),
      setCredentials: db.prepare(
        'UPDATE users SET username = ?, password_hash = ?, modified = ? WHERE id = ?',
      ),
      setPassword: db.prepare('UPDATE users SET password_hash = ?, modified = ? WHERE id = ?'),
      deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
      ownedIds: Object.fromEntries(
        ['characters', 'lorebooks'].map((table) => [
          table,
          db.prepare(`SELECT id FROM ${table} WHERE user_id = ?`),
        ]),
      ),
      deleteOwned: OWNED_TABLES.map((table) =>
        db.prepare(`DELETE FROM ${table} WHERE user_id = ?`),
      ),

      insertSession: db.prepare(
        'INSERT INTO sessions (id, user_id, created, expires) VALUES (?, ?, ?, ?)',
      ),
      getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
      extendSession: db.prepare('UPDATE sessions SET expires = ? WHERE id = ?'),
      deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
      deleteSessionsFor: db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?'),
      deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires <= ?'),

      insertLink: db.prepare(`
        INSERT INTO invitations (id, token_hash, kind, user_id, created, expires)
        VALUES (@id, @tokenHash, @kind, @userId, @created, @expires)
      `),
      findLink: db.prepare('SELECT * FROM invitations WHERE token_hash = ? AND expires > ?'),
      listLinks: db.prepare('SELECT * FROM invitations WHERE kind = ? ORDER BY created'),
      deleteLink: db.prepare('DELETE FROM invitations WHERE id = ?'),
      deleteLinksFor: db.prepare('DELETE FROM invitations WHERE kind = ? AND user_id = ?'),
      deleteAllLinks: db.prepare('DELETE FROM invitations'),
      deleteExpiredLinks: db.prepare('DELETE FROM invitations WHERE expires <= ?'),
    };
  }

  // ==================== Users ====================

  /** Whether requests need a signed-in user. Off until the admin has a password. */
  authEnabled() {
    return (
      !!this.stmts.getUser.get(ADMIN_USER_ID)?.password_hash ||
      this.stmts.countOthers.get(ADMIN_USER_ID).count > 0
    );
  }

  /** @returns {Object|null} */
  getUser(userId) {
    const row = this.stmts.getUser.get(userId);
    return row ? userFromRow(row) : null;
  }

  /** The user and their password hash, for signing in. @returns {Object|null} */
  findUserForSignIn(username) {
    const row = this.stmts.findUser.get(String(username ?? ''));
    return row ? { user: userFromRow(row), passwordHash: row.password_hash } : null;
  }

  /** The password hash of a user, for checking it before a change. */
  passwordHashOf(userId) {
    return this.stmts.getUser.get(userId)?.password_hash ?? null;
  }

  usernameTaken(username, exceptUserId = null) {
    const row = this.stmts.findUser.get(username);
    return !!row && row.id !== exceptUserId;
  }

  listUsers() {
    return this.stmts.listUsers.all().map(userFromRow);
  }

  /** Make an account, with settings of its own. */
  createUser({ username, role = 'user', passwordHash }) {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.stmts.insertUser.run({ id, username, role, passwordHash, created: now, modified: now });
      this.stmts.insertSettings.run(id);
    })();
    return this.getUser(id);
  }

  /** Give a user a username and password, as the admin does to turn signing in on. */
  setCredentials(userId, { username, passwordHash }) {
    this.stmts.setCredentials.run(username, passwordHash, new Date().toISOString(), userId);
    return this.getUser(userId);
  }

  /**
   * Change a user's password, signing them out everywhere but `keepSessionToken`, and dropping any
   * link to reset it.
   */
  setPassword(userId, passwordHash, keepSessionToken = null) {
    this.db.transaction(() => {
      this.stmts.setPassword.run(passwordHash, new Date().toISOString(), userId);
      this.stmts.deleteSessionsFor.run(userId, keepSessionToken ? hashToken(keepSessionToken) : '');
      this.stmts.deleteLinksFor.run('reset', userId);
    })();
  }

  /**
   * Turn signing in off: the admin's password goes, with every session and link. Only for when
   * the admin is the only user.
   */
  disableAuth() {
    this.db.transaction(() => {
      this.stmts.setPassword.run(null, new Date().toISOString(), ADMIN_USER_ID);
      this.stmts.deleteSessionsFor.run(ADMIN_USER_ID, '');
      this.stmts.deleteAllLinks.run();
    })();
  }

  /** Whether anyone besides the admin has an account. */
  hasOtherUsers() {
    return this.stmts.countOthers.get(ADMIN_USER_ID).count > 0;
  }

  /**
   * Delete a user and everything in their library. Their sessions, links and settings go with the
   * account.
   * @returns {{characterIds: string[], lorebookIds: string[]}|null} The characters and lorebooks
   *   deleted, whose cached images are for the caller to remove; null if there's no such user.
   */
  deleteUser(userId) {
    return this.db.transaction(() => {
      if (!this.stmts.getUser.get(userId)) return null;
      const characterIds = this.stmts.ownedIds.characters.all(userId).map((row) => row.id);
      const lorebookIds = this.stmts.ownedIds.lorebooks.all(userId).map((row) => row.id);
      for (const statement of this.stmts.deleteOwned) statement.run(userId);
      this.stmts.deleteUser.run(userId);
      return { characterIds, lorebookIds };
    })();
  }

  // ==================== Sessions ====================

  /** @returns {string} The token for the session cookie. */
  createSession(userId) {
    const token = newToken();
    const now = Date.now();
    this.stmts.deleteExpiredSessions.run(new Date(now).toISOString());
    this.stmts.insertSession.run(
      hashToken(token),
      userId,
      new Date(now).toISOString(),
      new Date(now + SESSION_TTL_MS).toISOString(),
    );
    return token;
  }

  /** The user a session cookie's token signs in, or null once it's expired or gone. */
  userForSession(token) {
    if (!token) return null;
    const id = hashToken(token);
    const session = this.stmts.getSession.get(id);
    const now = Date.now();
    if (!session || Date.parse(session.expires) <= now) return null;
    if (Date.parse(session.expires) - now < SESSION_TTL_MS - SESSION_REFRESH_MS) {
      this.stmts.extendSession.run(new Date(now + SESSION_TTL_MS).toISOString(), id);
    }
    return this.getUser(session.user_id);
  }

  deleteSession(token) {
    if (token) this.stmts.deleteSession.run(hashToken(token));
  }

  // ==================== Links ====================

  /**
   * Make a single-use link: an invitation to make an account, or a reset of `userId`'s password.
   * Making a reset link replaces any the user already had.
   * @returns {Object} The link, with the `token` for its URL. Only the token's hash is kept, so
   *   this is the only time it can be read.
   */
  createLink(kind, userId = null) {
    if (!LINK_KINDS.includes(kind)) throw new Error(`Unknown link kind: ${kind}`);
    const token = newToken();
    const now = Date.now();
    const link = {
      id: uuidv4(),
      tokenHash: hashToken(token),
      kind,
      userId,
      created: new Date(now).toISOString(),
      expires: new Date(now + LINK_TTL_MS[kind]).toISOString(),
    };
    this.db.transaction(() => {
      this.stmts.deleteExpiredLinks.run(link.created);
      if (kind === 'reset') this.stmts.deleteLinksFor.run('reset', userId);
      this.stmts.insertLink.run(link);
    })();
    return { ...linkFromRow({ ...link, user_id: userId }), token };
  }

  /** The unexpired link a token is for, or null. */
  findLink(token) {
    const row = this.stmts.findLink.get(hashToken(String(token ?? '')), new Date().toISOString());
    return row ? linkFromRow(row) : null;
  }

  /** The invitations not yet used or expired, oldest first. */
  listInvitations() {
    this.stmts.deleteExpiredLinks.run(new Date().toISOString());
    return this.stmts.listLinks.all('invite').map(linkFromRow);
  }

  /** @returns {boolean} Whether the link existed. */
  deleteLink(linkId) {
    return this.stmts.deleteLink.run(linkId).changes > 0;
  }

  /**
   * Use an invitation: make the account it's for, all or nothing, so the link can't be used twice.
   * @returns {Object|null} The new user, or null if the link was used or deleted meanwhile.
   */
  acceptInvitation(linkId, { username, passwordHash }) {
    return this.db.transaction(() => {
      if (this.stmts.deleteLink.run(linkId).changes === 0) return null;
      return this.createUser({ username, passwordHash });
    })();
  }

  /**
   * Use a reset link: set the user's password and sign them out everywhere.
   * @returns {Object|null} The user, or null if the link was used or deleted meanwhile.
   */
  acceptReset(link, passwordHash) {
    return this.db.transaction(() => {
      if (this.stmts.deleteLink.run(link.id).changes === 0) return null;
      this.setPassword(link.userId, passwordHash);
      return this.getUser(link.userId);
    })();
  }
}
