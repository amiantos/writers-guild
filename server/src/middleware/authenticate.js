/**
 * Authentication middleware for the API.
 *
 * Until the admin turns signing in on, every request runs as the admin, as a single-user install
 * always has. Once it's on, a request runs as the user its session cookie signs in, and without
 * one only the few routes for signing in are open. Either way the request runs inside
 * runAsUser(), which is what keeps storage to that user's library.
 */

import { ADMIN_USER_ID, runAsUser } from '../services/user-context.js';
import { SESSION_TTL_MS, userStorageFor } from '../services/auth/user-storage.js';

export const SESSION_COOKIE = 'wg_session';

// Open without signing in, relative to /api.
const PUBLIC_ROUTES = [
  ['GET', /^\/auth\/status$/],
  ['POST', /^\/auth\/login$/],
  ['POST', /^\/auth\/logout$/],
  ['GET', /^\/auth\/links\/[^/]+$/],
  ['POST', /^\/auth\/links\/[^/]+$/],
];

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The value of a cookie on the request, or null. */
export function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function cookieAttributes(req) {
  // Behind a proxy that ends TLS, X-Forwarded-Proto says the browser's side is HTTPS.
  const secure = req.secure || req.get('x-forwarded-proto') === 'https';
  return `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Sign the browser in with a session's token. */
export function setSessionCookie(req, res, token) {
  res.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(req)}; Max-Age=${Math.floor(
      SESSION_TTL_MS / 1000,
    )}`,
  );
}

export function clearSessionCookie(req, res) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttributes(req)}; Max-Age=0`);
}

function isPublic(req) {
  return PUBLIC_ROUTES.some(([method, path]) => req.method === method && path.test(req.path));
}

export default function authenticate() {
  return (req, res, next) => {
    const users = userStorageFor(req.app.locals.dataRoot);

    if (!users.authEnabled()) {
      req.user = users.getUser(ADMIN_USER_ID);
      return runAsUser(ADMIN_USER_ID, next);
    }

    // The session cookie goes with any request from the same site, other apps on the same host
    // included. A header of our own can't be added cross-origin without CORS allowing it, so
    // requiring one on writes keeps another page from making them as the reader.
    if (!SAFE_METHODS.has(req.method) && !req.get('x-requested-with')) {
      return res.status(403).json({ error: 'Missing X-Requested-With header' });
    }

    const token = readCookie(req, SESSION_COOKIE);
    const user = users.userForSession(token);
    if (user) {
      req.user = user;
      req.sessionToken = token;
      return runAsUser(user.id, next);
    }

    if (isPublic(req)) return next();
    res.status(401).json({ error: 'Sign in required', signInRequired: true });
  };
}

/** Let only the admin through. */
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Only the admin can do that' });
  }
  next();
}
