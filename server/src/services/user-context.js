/**
 * User Context
 *
 * Whose library a piece of work reads and writes. The auth middleware runs each request inside
 * runAsUser(), and every query on a table a user owns compares its user_id to the SQL function
 * current_user_id(), which reads it from here. Outside a user's context the function throws, so a
 * query that loses track of whose it is fails instead of reaching someone else's library.
 */

import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';

/** The account a fresh install runs as, signed in or not, and the owner of everything before. */
export const ADMIN_USER_ID = 'admin';

const context = new AsyncLocalStorage();

// For tests that call storage or mount a router without the auth middleware.
let fallbackUserId = null;

/** Run fn, and everything it starts, as the given user. */
export function runAsUser(userId, fn) {
  return context.run({ userId }, fn);
}

/** The user the current work runs as. Throws outside a user's context. */
export function currentUserId() {
  const userId = context.getStore()?.userId ?? fallbackUserId;
  if (!userId) {
    throw new Error('No user for this operation');
  }
  return userId;
}

/**
 * Keep the current user through a callback something else calls later. Middleware that reads the
 * request as a stream, like multer, calls next() from the stream's events, which aren't promised
 * to run in the request's context; binding next() makes sure of it.
 */
export function bindToUser(fn) {
  return AsyncResource.bind(fn);
}

/** Wrap middleware so whatever runs after it keeps the user it was called with. */
export function keepingUser(middleware) {
  return (req, res, next) => middleware(req, res, bindToUser(next));
}

/**
 * The user storage falls back to outside a user's context. Only for tests: the server always runs
 * requests as someone, and anything without a user should fail.
 */
export function setFallbackUserId(userId) {
  fallbackUserId = userId;
}

/** Give a database connection current_user_id(), for queries to scope themselves with. */
export function registerUserFunction(db) {
  db.function('current_user_id', { deterministic: false }, () => currentUserId());
}

/** SQL keeping a query on one of OWNED_TABLES (database.js) to the current user's rows. */
export const MINE = 'user_id = current_user_id()';

/** SQL keeping a query to the rows whose `column` names a row of `table` the current user owns. */
export function mineThrough(column, table) {
  return `${column} IN (SELECT id FROM ${table} WHERE ${MINE})`;
}
