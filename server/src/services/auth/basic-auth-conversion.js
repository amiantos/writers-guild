/**
 * Basic Auth Conversion
 *
 * Before there were users, BASIC_AUTH_USERNAME and BASIC_AUTH_PASSWORD were how Writers Guild was
 * kept private. On an install that has them, the first start with users turns signing in on with
 * the same username and password for the admin, so it stays private behind one prompt instead of
 * two: basic auth stands aside once signing in is on (see basic-auth.js).
 */

import { ADMIN_USER_ID } from '../user-context.js';
import { hashPassword } from './passwords.js';
import { usernameProblem } from './user-storage.js';

/**
 * Give the admin the basic auth credentials, once: only while the admin has never had a username,
 * so turning signing in off later isn't undone by the next start.
 *
 * @param {import('./user-storage.js').UserStorage} users
 * @param {{username?: string, password?: string}} credentials
 * @returns {Promise<{converted: boolean, reason?: string}>} Why it wasn't, when there's something
 *   the person running the server should know.
 */
export async function convertBasicAuth(users, { username, password }) {
  if (!username || !password) return { converted: false };
  if (users.getUser(ADMIN_USER_ID)?.username || users.hasOtherUsers()) {
    return { converted: false };
  }
  const problem = usernameProblem(username);
  if (problem) {
    return { converted: false, reason: `BASIC_AUTH_USERNAME can't be a username: ${problem}` };
  }

  users.setCredentials(ADMIN_USER_ID, { username, passwordHash: await hashPassword(password) });
  return { converted: true };
}
