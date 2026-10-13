/**
 * Auth API Routes
 *
 * Signing in and out, the links that invite someone or reset a password, and the admin turning
 * signing in on and off. Signing in is off on a fresh install (see authenticate.js); the admin
 * turns it on by giving their account a username and password.
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { clearSessionCookie, setSessionCookie } from '../middleware/authenticate.js';
import { ADMIN_USER_ID } from '../services/user-context.js';
import { userStorageFor, usernameProblem } from '../services/auth/user-storage.js';
import {
  hashPassword,
  passwordProblem,
  verifyDecoy,
  verifyPassword,
} from '../services/auth/passwords.js';
import { SignInThrottle } from '../services/auth/sign-in-throttle.js';

const router = express.Router();

// Per account, and more loosely per address, since behind a proxy everyone shares one.
const accountThrottle = new SignInThrottle();
const addressThrottle = new SignInThrottle({ maxFailures: 50 });

/** For tests: forget past failed sign ins. */
export function resetSignInThrottle() {
  accountThrottle.failures.clear();
  addressThrottle.failures.clear();
}

let users;

router.use((req, res, next) => {
  users = userStorageFor(req.app.locals.dataRoot);
  next();
});

/** What the client is told about a user. */
export function publicUser(user) {
  return user ? { id: user.id, username: user.username, role: user.role } : null;
}

/** The path in the client a link opens at. */
export function linkPath(link) {
  return `/${link.kind === 'reset' ? 'reset-password' : 'invite'}/${link.token}`;
}

function checkPassword(password) {
  const problem = passwordProblem(password);
  if (problem) throw new AppError(problem, 400);
}

function checkUsername(username, exceptUserId = null) {
  const problem = usernameProblem(username);
  if (problem) throw new AppError(problem, 400);
  if (users.usernameTaken(username, exceptUserId)) {
    throw new AppError('That username is taken', 409);
  }
}

function signedIn(req) {
  if (!req.user) throw new AppError('Sign in required', 401, { signInRequired: true });
  return req.user;
}

function signInAs(req, res, user) {
  setSessionCookie(req, res, users.createSession(user.id));
  return publicUser(user);
}

/**
 * Refuse when there have been too many failures from this address or for this account (when
 * there is one), and count this try against both.
 */
async function throttled(req, account, attempt) {
  const keys = [[addressThrottle, req.ip]];
  if (account) keys.push([accountThrottle, account]);
  if (keys.some(([throttle, key]) => throttle.blocked(key))) {
    throw new AppError('Too many failed attempts. Try again in a few minutes.', 429);
  }
  const ok = await attempt();
  for (const [throttle, key] of keys) {
    if (ok) throttle.succeed(key);
    else throttle.fail(key);
  }
  return ok;
}

// Whether signing in is on, and who's signed in. With it off, that's always the admin.
router.get('/status', (req, res) => {
  res.json({ authEnabled: users.authEnabled(), user: publicUser(req.user) });
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body ?? {};
    if (!users.authEnabled()) {
      throw new AppError('Signing in is off', 400);
    }
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw new AppError('Username and password are required', 400);
    }

    const found = users.findUserForSignIn(username);
    const ok = await throttled(req, username.toLowerCase(), () =>
      found?.passwordHash ? verifyPassword(password, found.passwordHash) : verifyDecoy(password),
    );
    if (!ok) throw new AppError('Wrong username or password', 401);

    res.json({ user: signInAs(req, res, found.user) });
  }),
);

router.post('/logout', (req, res) => {
  users.deleteSession(req.sessionToken);
  clearSessionCookie(req, res);
  res.json({ success: true });
});

// Change your own password. Signs you out everywhere else.
router.put(
  '/password',
  asyncHandler(async (req, res) => {
    const user = signedIn(req);
    const { currentPassword, newPassword } = req.body ?? {};
    if (!users.authEnabled()) {
      throw new AppError('Signing in is off', 400);
    }
    const ok = await throttled(req, user.username?.toLowerCase(), () =>
      verifyPassword(String(currentPassword ?? ''), users.passwordHashOf(user.id)),
    );
    if (!ok) throw new AppError('Current password is wrong', 401);
    checkPassword(newPassword);

    users.setPassword(user.id, await hashPassword(newPassword), req.sessionToken);
    res.json({ success: true });
  }),
);

// The admin turns signing in on by giving their account a username and password.
router.post(
  '/enable',
  asyncHandler(async (req, res) => {
    const user = signedIn(req);
    if (user.role !== 'admin') throw new AppError('Only the admin can do that', 403);
    if (users.authEnabled()) throw new AppError('Signing in is already on', 409);
    const { username, password } = req.body ?? {};
    checkUsername(username, ADMIN_USER_ID);
    checkPassword(password);

    const admin = users.setCredentials(ADMIN_USER_ID, {
      username,
      passwordHash: await hashPassword(password),
    });
    res.json({ authEnabled: true, user: signInAs(req, res, admin) });
  }),
);

// The admin turns signing in off again, which only they can be using.
router.post(
  '/disable',
  asyncHandler(async (req, res) => {
    const user = signedIn(req);
    if (user.role !== 'admin') throw new AppError('Only the admin can do that', 403);
    if (!users.authEnabled()) throw new AppError('Signing in is already off', 409);
    if (users.hasOtherUsers()) {
      throw new AppError('Signing in can only be turned off once you are the only user', 409);
    }
    const ok = await throttled(req, user.username?.toLowerCase(), () =>
      verifyPassword(String(req.body?.password ?? ''), users.passwordHashOf(user.id)),
    );
    if (!ok) throw new AppError('Password is wrong', 401);

    users.disableAuth();
    clearSessionCookie(req, res);
    res.json({ authEnabled: false, user: publicUser(users.getUser(ADMIN_USER_ID)) });
  }),
);

function findLinkOr404(token) {
  const link = users.findLink(token);
  if (!link) throw new AppError('This link has expired or was already used', 404);
  return link;
}

// What a link is for, before it's used.
router.get('/links/:token', (req, res) => {
  const link = findLinkOr404(req.params.token);
  res.json({
    kind: link.kind,
    username: link.kind === 'reset' ? users.getUser(link.userId)?.username : null,
    expires: link.expires,
  });
});

// Use a link: make the account an invitation is for, or set a new password. Signs in either way.
router.post(
  '/links/:token',
  asyncHandler(async (req, res) => {
    let link;
    await throttled(req, null, async () => {
      link = users.findLink(req.params.token);
      return !!link;
    });
    if (!link) throw new AppError('This link has expired or was already used', 404);

    const { username, password } = req.body ?? {};
    checkPassword(password);
    let user;
    if (link.kind === 'invite') {
      checkUsername(username);
      const passwordHash = await hashPassword(password);
      try {
        user = users.acceptInvitation(link.id, { username, passwordHash });
      } catch (error) {
        // Taken by someone else while the password was hashing
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw new AppError('That username is taken', 409);
        }
        throw error;
      }
    } else {
      user = users.acceptReset(link, await hashPassword(password));
    }
    if (!user) throw new AppError('This link has expired or was already used', 404);

    users.deleteSession(req.sessionToken);
    res.json({ user: signInAs(req, res, user) });
  }),
);

export default router;
