/**
 * Make a link to reset a password, for when the admin can't sign in to make one.
 *
 *   node scripts/reset-password.js [username]
 *
 * Without a username it's for the admin. Prints the path to open on Writers Guild to choose a new
 * password; the link works once, for a day. In Docker:
 *
 *   docker compose exec writers-guild node scripts/reset-password.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';
import { userStorageFor, LINK_TTL_MS } from '../src/services/auth/user-storage.js';
import { ADMIN_USER_ID } from '../src/services/user-context.js';
import { linkPath } from '../src/routes/auth.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = yaml.parse(fs.readFileSync(path.join(serverDir, 'config.yaml'), 'utf8'));
// The same data directory the server uses (see server.js)
const dataRoot = path.resolve(serverDir, process.env.DATA_DIR || config.data.root);

const users = userStorageFor(dataRoot);
const username = process.argv[2];

if (!users.authEnabled()) {
  console.log('Signing in is off, so there is no password to reset.');
  process.exit(0);
}

const user = username ? users.findUserForSignIn(username)?.user : users.getUser(ADMIN_USER_ID);
if (!user?.username) {
  console.error(username ? `No user named ${username}.` : 'The admin has no username yet.');
  process.exit(1);
}

const link = users.createLink('reset', user.id);
console.log(`To choose a new password for ${user.username}, open this on your Writers Guild:

  ${linkPath(link)}

For example http://localhost:8000${linkPath(link)}. It works once, within ${
  LINK_TTL_MS.reset / (60 * 60 * 1000)
} hours.`);
