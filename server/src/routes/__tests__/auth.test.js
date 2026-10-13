import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import authenticate from '../../middleware/authenticate.js';
import { errorHandler } from '../../middleware/error-handler.js';
import authRouter, { resetSignInThrottle } from '../auth.js';
import usersRouter from '../users.js';
import storiesRouter from '../stories.js';
import charactersRouter from '../characters.js';
import settingsRouter from '../settings.js';
import { ADMIN_USER_ID, setFallbackUserId } from '../../services/user-context.js';
import { userStorageFor } from '../../services/auth/user-storage.js';
import { AssetManager } from '../../services/asset-manager.js';
import { createTestCharacterPng } from './test-helpers.js';

/**
 * The API as server.js puts it together, so each request runs as whoever it signs in as. The
 * routers keep their storage in module scope, so the whole file shares one data directory and
 * its tests run in order, from a fresh install to several users.
 */
let dataRoot;
let app;

beforeAll(() => {
  // As in the server: no user unless the auth middleware gives one.
  setFallbackUserId(null);
  dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-test-'));
  app = express();
  app.use(express.json());
  app.locals.dataRoot = dataRoot;
  app.use('/api', authenticate());
  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/stories', storiesRouter);
  app.use('/api/characters', charactersRouter);
  app.use('/api/settings', settingsRouter);
  app.use(errorHandler);
  admin = browser();
  guest = browser();
  stranger = browser();
});

afterAll(() => {
  setFallbackUserId(ADMIN_USER_ID);
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => resetSignInThrottle());

/** A browser: keeps its cookies, and sends the header the API wants on writes, as the client does. */
function browser() {
  const agent = request.agent(app);
  const send = (method) => (url, body) =>
    agent[method](url)
      .set('X-Requested-With', 'WritersGuild')
      .send(body ?? {});
  return {
    get: (url) => agent.get(url),
    post: send('post'),
    put: send('put'),
    delete: send('delete'),
    agent,
  };
}

const tokenOf = (link) => link.path.split('/').pop();

let admin;
let guest;
let stranger;
let adminStoryId;
let guestId;

describe('with signing in off', () => {
  it('runs every request as the admin, with no sign in', async () => {
    const status = await stranger.get('/api/auth/status').expect(200);
    expect(status.body).toEqual({
      authEnabled: false,
      user: { id: ADMIN_USER_ID, username: null, role: 'admin' },
    });

    // No header needed either, as before there were users
    const created = await request(app)
      .post('/api/stories')
      .send({ title: 'Admin story' })
      .expect(201);
    adminStoryId = created.body.story.id;
    const { body } = await stranger.get('/api/stories').expect(200);
    expect(body.stories.map((story) => story.title)).toEqual(['Admin story']);
  });

  it('has no one to invite until signing in is on', async () => {
    const invite = await admin.post('/api/users/invitations').expect(409);
    expect(invite.body.error).toBe('Turn on signing in before inviting anyone');
    const login = await admin.post('/api/auth/login', { username: 'x', password: 'whatever!' });
    expect(login.body.error).toBe('Signing in is off');
  });

  it('turns on with a username and password for the admin', async () => {
    await admin.post('/api/auth/enable', { username: 'ad', password: 'longenough' }).expect(400);
    await admin.post('/api/auth/enable', { username: 'boss', password: 'short' }).expect(400);

    const { body, headers } = await admin
      .post('/api/auth/enable', { username: 'boss', password: 'correct horse' })
      .expect(200);
    expect(body).toEqual({
      authEnabled: true,
      user: { id: ADMIN_USER_ID, username: 'boss', role: 'admin' },
    });
    expect(headers['set-cookie'][0]).toMatch(/^wg_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
  });
});

describe('with signing in on', () => {
  it('turns away anyone not signed in', async () => {
    const { body } = await stranger.get('/api/stories').expect(401);
    expect(body.signInRequired).toBe(true);
    await stranger.get('/api/settings').expect(401);
    await stranger.post('/api/auth/enable', { username: 'evil', password: 'longenough' });
    const status = await stranger.get('/api/auth/status').expect(200);
    expect(status.body).toEqual({ authEnabled: true, user: null });
  });

  it('keeps the admin signed in, with their library', async () => {
    const { body } = await admin.get('/api/stories').expect(200);
    expect(body.stories.map((story) => story.id)).toEqual([adminStoryId]);
  });

  it('refuses writes without the header another site could not add', async () => {
    const { body } = await admin.agent.post('/api/stories').send({ title: 'Forged' }).expect(403);
    expect(body.error).toBe('Missing X-Requested-With header');
  });

  it('signs in with the right password only', async () => {
    const other = browser();
    await other.post('/api/auth/login', { username: 'boss', password: 'wrong one' }).expect(401);
    await other.post('/api/auth/login', { username: 'nobody', password: 'wrong one' }).expect(401);
    const { body } = await other
      .post('/api/auth/login', { username: 'BOSS', password: 'correct horse' })
      .expect(200);
    expect(body.user.username).toBe('boss');
    await other.get('/api/stories').expect(200);

    await other.post('/api/auth/logout').expect(200);
    await other.get('/api/stories').expect(401);
  });

  it('stops taking guesses after too many', async () => {
    const guesser = browser();
    for (let i = 0; i < 10; i++) {
      await guesser.post('/api/auth/login', { username: 'boss', password: `guess ${i}` });
    }
    const { body } = await guesser
      .post('/api/auth/login', { username: 'boss', password: 'correct horse' })
      .expect(429);
    expect(body.error).toMatch(/^Too many failed attempts/);
  });
});

describe('invitations', () => {
  let invitation;

  it('are made by the admin, as a link to open once', async () => {
    const { body } = await admin.post('/api/users/invitations').expect(201);
    invitation = body.invitation;
    expect(invitation.path).toMatch(/^\/invite\/[\w-]{43}$/);
    expect(invitation).not.toHaveProperty('token');

    const pending = await admin.get('/api/users/invitations').expect(200);
    expect(pending.body.invitations.map((link) => link.id)).toEqual([invitation.id]);

    const opened = await stranger.get(`/api/auth/links/${tokenOf(invitation)}`).expect(200);
    expect(opened.body.kind).toBe('invite');
    await stranger.get('/api/auth/links/not-a-real-token').expect(404);
  });

  it('make an account, signed in, with a library of its own', async () => {
    await guest
      .post(`/api/auth/links/${tokenOf(invitation)}`, { username: 'boss', password: 'guestpass' })
      .expect(409);

    const { body } = await guest
      .post(`/api/auth/links/${tokenOf(invitation)}`, { username: 'guest', password: 'guestpass' })
      .expect(200);
    expect(body.user).toMatchObject({ username: 'guest', role: 'user' });
    guestId = body.user.id;

    expect((await guest.get('/api/stories').expect(200)).body.stories).toEqual([]);
    const settings = await guest.get('/api/settings').expect(200);
    expect(settings.body.settings.onboardingCompleted).toBe(false);
  });

  it('work only once', async () => {
    await stranger
      .post(`/api/auth/links/${tokenOf(invitation)}`, { username: 'third', password: 'thirdpass' })
      .expect(404);
    const pending = await admin.get('/api/users/invitations').expect(200);
    expect(pending.body.invitations).toEqual([]);
  });

  it('can be taken back before they are used', async () => {
    const { body } = await admin.post('/api/users/invitations').expect(201);
    await admin.delete(`/api/users/invitations/${body.invitation.id}`).expect(200);
    const opened = await stranger.get(`/api/auth/links/${tokenOf(body.invitation)}`).expect(404);
    expect(opened.body.error).toBe('This link has expired or was already used');
  });
});

describe('two users', () => {
  it("can't see or touch each other's stories", async () => {
    // Someone else's story reads as one that doesn't exist
    const read = await guest.get(`/api/stories/${adminStoryId}`);
    expect(read.body.error).toBe(`Story not found: ${adminStoryId}`);
    await guest.put(`/api/stories/${adminStoryId}`, { title: 'Mine now' });
    await guest.delete(`/api/stories/${adminStoryId}`);

    const { body } = await admin.get(`/api/stories/${adminStoryId}`).expect(200);
    expect(body.story.title).toBe('Admin story');
  });

  it('upload into their own library', async () => {
    const png = await createTestCharacterPng({
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: { name: 'Uploaded', description: 'An upload', first_mes: 'Hi' },
    });
    const { body } = await guest.agent
      .post('/api/characters/import')
      .set('X-Requested-With', 'WritersGuild')
      .attach('character', png, 'card.png')
      .expect(201);

    const mine = await guest.get('/api/characters').expect(200);
    expect(mine.body.characters.map((character) => character.id)).toEqual([body.id]);
    const theirs = await admin.get('/api/characters').expect(200);
    expect(theirs.body.characters).toEqual([]);
    await admin.get(`/api/characters/${body.id}/image`).expect(404);
    await guest.get(`/api/characters/${body.id}/image`).expect(200);
  });

  it('leave the user list and invitations to the admin', async () => {
    await guest.get('/api/users').expect(403);
    await guest.post('/api/users/invitations').expect(403);
    await guest.post('/api/auth/disable', { password: 'guestpass' }).expect(403);

    const { body } = await admin.get('/api/users').expect(200);
    expect(body.users.map((user) => [user.username, user.role])).toEqual([
      ['boss', 'admin'],
      ['guest', 'user'],
    ]);
  });

  it("keep signing in on while there's anyone besides the admin", async () => {
    const { body } = await admin
      .post('/api/auth/disable', { password: 'correct horse' })
      .expect(409);
    expect(body.error).toBe('Signing in can only be turned off once you are the only user');
  });
});

describe('passwords', () => {
  it('change with the current one, signing out everywhere else', async () => {
    const otherTab = browser();
    await otherTab.post('/api/auth/login', { username: 'guest', password: 'guestpass' });

    await guest
      .put('/api/auth/password', { currentPassword: 'nope', newPassword: 'newguestpass' })
      .expect(401);
    await guest
      .put('/api/auth/password', { currentPassword: 'guestpass', newPassword: 'newguestpass' })
      .expect(200);

    await guest.get('/api/stories').expect(200);
    const signedOut = await otherTab.get('/api/stories').expect(401);
    expect(signedOut.body.signInRequired).toBe(true);
  });

  it('reset with a link from the admin, which signs in', async () => {
    const { body } = await admin.post(`/api/users/${guestId}/reset-link`).expect(200);
    expect(body.link.path).toMatch(/^\/reset-password\//);

    const opened = await stranger.get(`/api/auth/links/${tokenOf(body.link)}`).expect(200);
    expect(opened.body).toMatchObject({ kind: 'reset', username: 'guest' });

    const resetter = browser();
    await resetter
      .post(`/api/auth/links/${tokenOf(body.link)}`, { password: 'resetguestpass' })
      .expect(200);
    await resetter.get('/api/stories').expect(200);
    // The old session is gone with the old password
    await guest.get('/api/stories').expect(401);
    await guest.post('/api/auth/login', { username: 'guest', password: 'resetguestpass' });
    await guest.get('/api/stories').expect(200);
  });
});

describe('deleting a user', () => {
  it('takes their library, cached images and sessions with them', async () => {
    const characters = await guest.get('/api/characters').expect(200);
    const characterId = characters.body.characters[0].id;
    const assets = new AssetManager(dataRoot, 'characters');
    await assets.writeFileOnly(characterId, `${'a'.repeat(64)}.png`, Buffer.from('png'));

    await admin.delete(`/api/users/${ADMIN_USER_ID}`).expect(400);
    await admin.delete(`/api/users/${guestId}`).expect(200);

    await guest.get('/api/stories').expect(401);
    expect(fs.existsSync(assets.entityDir(characterId))).toBe(false);
    const { body } = await admin.get('/api/users').expect(200);
    expect(body.users.map((user) => user.username)).toEqual(['boss']);
  });

  it('lets signing in be turned off again, by the admin alone', async () => {
    await admin.post('/api/auth/disable', { password: 'wrong' }).expect(401);
    const { body } = await admin
      .post('/api/auth/disable', { password: 'correct horse' })
      .expect(200);
    expect(body.authEnabled).toBe(false);

    const status = await stranger.get('/api/auth/status').expect(200);
    expect(status.body.authEnabled).toBe(false);
    const stories = await stranger.get('/api/stories').expect(200);
    expect(stories.body.stories.map((story) => story.id)).toEqual([adminStoryId]);
    expect(userStorageFor(dataRoot).getUser(ADMIN_USER_ID).hasPassword).toBe(false);
  });
});

describe('sessions', () => {
  it('last as long as they are used, the cookie with them', async () => {
    const users = userStorageFor(dataRoot);
    // Signing in back on, as it was turned off above
    users.setCredentials(ADMIN_USER_ID, { username: 'boss', passwordHash: 'unused' });
    const token = users.createSession(ADMIN_USER_ID);
    // As if signed in 20 days ago
    users.db
      .prepare('UPDATE sessions SET expires = ?')
      .run(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString());

    const { headers } = await request(app)
      .get('/api/auth/status')
      .set('Cookie', `wg_session=${token}`)
      .expect(200);

    expect(headers['set-cookie'][0]).toMatch(/^wg_session=.+; Max-Age=2592000$/);
    const { expires } = users.db.prepare('SELECT expires FROM sessions').get();
    expect(Date.parse(expires) - Date.now()).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
  });
});
