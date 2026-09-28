import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteStorageService } from '../../services/sqliteStorage.js';
import { DeepSeekProvider } from '../../services/providers/deepseek-provider.js';
import continuitiesRouter from '../continuities.js';
import storiesRouter from '../stories.js';
import chatsRouter from '../chats.js';

// The routers keep their storage in module scope, so every test in this file shares one directory.
let tempDir;
let storage;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'continuities-routes-test-'));
  storage = new SqliteStorageService(tempDir);
});

afterAll(() => {
  storage.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.locals.dataRoot = tempDir;
  app.use('/api/continuities', continuitiesRouter);
  app.use('/api/stories', storiesRouter);
  app.use('/api/chats', chatsRouter);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

async function setContinuity(on) {
  const settings = await storage.getSettings();
  await storage.saveSettings({ ...settings, experimentalContinuity: on });
}

let counter = 0;
async function preset() {
  counter += 1;
  const id = `preset-${counter}`;
  await storage.savePreset(id, {
    name: 'Test',
    provider: 'deepseek',
    apiConfig: { apiKey: 'test-key', model: 'deepseek-v4-flash' },
    generationSettings: { maxTokens: 100, maxContextTokens: 8000 },
  });
  return id;
}

function stubStoryGeneration() {
  const spy = vi.spyOn(DeepSeekProvider.prototype, 'buildPrompts').mockResolvedValue({
    system: 'system prompt',
    user: 'user prompt',
  });
  vi.spyOn(DeepSeekProvider.prototype, 'generateStreaming').mockResolvedValue({
    stream: (async function* () {
      yield { content: 'Hello.', finished: true };
    })(),
    metadata: {},
  });
  return spy;
}

async function createContinuity(app, body = {}) {
  const response = await request(app)
    .post('/api/continuities')
    .send({ name: 'The Harbor Years', content: 'Layla and Sam are married.', ...body })
    .expect(201);
  return response.body.continuity;
}

describe('Continuities API', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  it('answers 404 while the toggle is off', async () => {
    await setContinuity(false);
    await request(app).get('/api/continuities').expect(404);
  });

  it('creates, lists, renames and edits a Continuity, keeping each text as a version', async () => {
    await setContinuity(true);
    const continuity = await createContinuity(app);
    expect(continuity).toMatchObject({
      name: 'The Harbor Years',
      content: 'Layla and Sam are married.',
      storyCount: 0,
      chatCount: 0,
    });

    const list = await request(app).get('/api/continuities').expect(200);
    expect(list.body.continuities.map((c) => c.id)).toContain(continuity.id);

    await request(app)
      .put(`/api/continuities/${continuity.id}`)
      .send({ name: 'Harbor' })
      .expect(200);
    const edited = await request(app)
      .put(`/api/continuities/${continuity.id}`)
      .send({ content: '  Layla and Sam are separated.  ' })
      .expect(200);
    expect(edited.body.continuity).toMatchObject({
      name: 'Harbor',
      content: 'Layla and Sam are separated.',
    });

    // A rename alone isn't a new version of the text.
    const versions = await request(app).get(`/api/continuities/${continuity.id}/versions`);
    expect(versions.body.versions.map((v) => [v.source, v.content])).toEqual([
      ['created', 'Layla and Sam are married.'],
      ['edit', 'Layla and Sam are separated.'],
    ]);
  });

  it('restores an earlier version as a new one', async () => {
    await setContinuity(true);
    const continuity = await createContinuity(app);
    await request(app)
      .put(`/api/continuities/${continuity.id}`)
      .send({ content: 'Something else.' })
      .expect(200);
    const [first] = (await request(app).get(`/api/continuities/${continuity.id}/versions`)).body
      .versions;

    const restored = await request(app)
      .post(`/api/continuities/${continuity.id}/versions/${first.id}/restore`)
      .expect(200);
    expect(restored.body.continuity.content).toBe('Layla and Sam are married.');

    const versions = (await request(app).get(`/api/continuities/${continuity.id}/versions`)).body
      .versions;
    expect(versions.at(-1)).toMatchObject({ source: 'restore', sourceId: String(first.id) });

    await request(app)
      .post(`/api/continuities/${continuity.id}/versions/99999/restore`)
      .expect(404);
  });

  it('refuses a missing name or text that is too long', async () => {
    await setContinuity(true);
    await request(app).post('/api/continuities').send({ content: 'x' }).expect(400);
    await request(app)
      .post('/api/continuities')
      .send({ name: 'Long', content: 'x'.repeat(20001) })
      .expect(400);
  });

  it('counts its stories and chats, and deleting it takes them out of it', async () => {
    await setContinuity(true);
    const continuity = await createContinuity(app);
    const story = (await request(app).post('/api/stories').send({ title: 'One' }).expect(201)).body
      .story;
    await request(app)
      .put(`/api/stories/${story.id}`)
      .send({ continuityId: continuity.id })
      .expect(200);
    const chat = (
      await request(app).post('/api/chats').send({ continuityId: continuity.id }).expect(201)
    ).body.chat;
    expect(chat.continuityId).toBe(continuity.id);

    const read = await request(app).get(`/api/continuities/${continuity.id}`).expect(200);
    expect(read.body.continuity).toMatchObject({ storyCount: 1, chatCount: 1 });

    await request(app).delete(`/api/continuities/${continuity.id}`).expect(200);
    expect((await storage.getStory(story.id)).continuityId).toBeNull();
    const chatAfter = await request(app).get(`/api/chats/${chat.id}`).expect(200);
    expect(chatAfter.body.chat.continuityId).toBeNull();
  });

  it("won't put a story or chat in a Continuity that doesn't exist", async () => {
    await setContinuity(true);
    const story = (await request(app).post('/api/stories').send({ title: 'Two' }).expect(201)).body
      .story;
    await request(app).put(`/api/stories/${story.id}`).send({ continuityId: 'nope' }).expect(400);
    await request(app).post('/api/chats').send({ continuityId: 'nope' }).expect(400);
  });
});

describe('Continuity in prompts', () => {
  let app;

  beforeAll(() => {
    app = createApp();
  });

  async function storyInContinuity(scenario) {
    const continuity = await createContinuity(app);
    const story = (await request(app).post('/api/stories').send({ title: 'Gen' }).expect(201)).body
      .story;
    await request(app)
      .put(`/api/stories/${story.id}`)
      .send({ continuityId: continuity.id, scenario, configPresetId: await preset() })
      .expect(200);
    return story.id;
  }

  it("puts a story's Continuity ahead of its scenario", async () => {
    await setContinuity(true);
    const storyId = await storyInContinuity('A storm is coming.');
    const spy = stubStoryGeneration();

    await request(app).post(`/api/stories/${storyId}/continue`).expect(200);
    expect(spy.mock.calls[0][0].story.scenario).toBe(
      'Layla and Sam are married.\n\nA storm is coming.',
    );
  });

  it("leaves a story's scenario alone while the toggle is off", async () => {
    await setContinuity(true);
    const storyId = await storyInContinuity('A storm is coming.');
    await setContinuity(false);
    const spy = stubStoryGeneration();

    await request(app).post(`/api/stories/${storyId}/continue`).expect(200);
    expect(spy.mock.calls[0][0].story.scenario).toBe('A storm is coming.');
  });

  it("puts a chat's Continuity ahead of its scenario", async () => {
    await setContinuity(true);
    const continuity = await createContinuity(app);
    const layla = 'char-layla';
    await storage.saveCharacter(layla, { spec: 'chara_card_v2', data: { name: 'Layla' } });
    const chat = (
      await request(app)
        .post('/api/chats')
        .send({
          characterIds: [layla],
          configPresetId: await preset(),
          continuityId: continuity.id,
          scenario: 'Midnight.',
        })
        .expect(201)
    ).body.chat;
    const spy = vi.spyOn(DeepSeekProvider.prototype, 'generateStreaming').mockResolvedValue({
      stream: (async function* () {
        yield { content: 'hey' };
      })(),
    });

    await request(app).post(`/api/chats/${chat.id}/messages`).send({ text: 'hi' }).expect(201);
    expect(spy.mock.calls[0][0]).toContain('Layla and Sam are married.\n\nMidnight.');
    // The chat keeps its own scenario.
    const read = await request(app).get(`/api/chats/${chat.id}`).expect(200);
    expect(read.body.chat.scenario).toBe('Midnight.');
  });
});
