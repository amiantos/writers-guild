import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initializeDatabase } from '../database.js';
import { UserStorage } from '../auth/user-storage.js';
import { verifyPassword } from '../auth/passwords.js';
import { convertBasicAuth } from '../auth/basic-auth-conversion.js';
import { ADMIN_USER_ID } from '../user-context.js';

describe('converting basic auth to signing in', () => {
  let dataRoot;
  let db;
  let users;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'basic-auth-conversion-test-'));
    db = initializeDatabase(dataRoot);
    users = new UserStorage(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it("makes the basic auth credentials the admin's, turning signing in on", async () => {
    const result = await convertBasicAuth(users, { username: 'brad', password: 'short' });

    expect(result).toEqual({ converted: true });
    expect(users.authEnabled()).toBe(true);
    const found = users.findUserForSignIn('brad');
    expect(found.user.id).toBe(ADMIN_USER_ID);
    // Kept even below the length new passwords need
    expect(await verifyPassword('short', found.passwordHash)).toBe(true);
  });

  it('does nothing without both credentials', async () => {
    expect(await convertBasicAuth(users, { username: 'brad' })).toEqual({ converted: false });
    expect(await convertBasicAuth(users, {})).toEqual({ converted: false });
    expect(users.authEnabled()).toBe(false);
  });

  it('happens only once, so turning signing in off stays off', async () => {
    await convertBasicAuth(users, { username: 'brad', password: 'first password' });
    users.disableAuth();

    const again = await convertBasicAuth(users, { username: 'brad', password: 'first password' });

    expect(again).toEqual({ converted: false });
    expect(users.authEnabled()).toBe(false);
  });

  it('leaves an admin who already signs in alone, whatever the env says', async () => {
    users.setCredentials(ADMIN_USER_ID, { username: 'boss', passwordHash: 'kept' });

    expect(await convertBasicAuth(users, { username: 'brad', password: 'x' })).toEqual({
      converted: false,
    });
    expect(users.passwordHashOf(ADMIN_USER_ID)).toBe('kept');
  });

  it("says why when the basic auth username can't be one", async () => {
    const result = await convertBasicAuth(users, {
      username: 'me@example.com',
      password: 'secret',
    });

    expect(result.converted).toBe(false);
    expect(result.reason).toMatch(/^BASIC_AUTH_USERNAME can't be a username/);
    expect(users.authEnabled()).toBe(false);
  });
});
