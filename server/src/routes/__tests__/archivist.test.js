import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteStorageService } from '../../services/sqliteStorage.js';
import { ChatStorage } from '../../services/chat/chat-storage.js';
import { DeepSeekProvider } from '../../services/providers/deepseek-provider.js';
import archivistRouter from '../archivist.js';

// The router keeps its storage in module scope, so every test in this file shares one directory.
let tempDir;
let storage;
let chats;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivist-routes-test-'));
  storage = new SqliteStorageService(tempDir);
  chats = new ChatStorage(storage.db);
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
  app.use('/api/archivist', archivistRouter);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

async function setArchivist(on) {
  const settings = await storage.getSettings();
  await storage.saveSettings({ ...settings, experimentalArchivist: on });
}

let counter = 0;
async function character(name, data = {}) {
  counter += 1;
  const id = `char-${counter}`;
  await storage.saveCharacter(id, { spec: 'chara_card_v2', data: { name, ...data } });
  return id;
}

async function preset() {
  counter += 1;
  const id = `preset-${counter}`;
  await storage.savePreset(id, {
    name: 'Test',
    provider: 'deepseek',
    apiConfig: { apiKey: 'test-key', model: 'deepseek-v4-flash' },
    generationSettings: { maxTokens: 100 },
  });
  return id;
}

async function story(content, characterIds) {
  const { id } = await storage.createStory('Summer');
  await storage.updateStoryContent(id, content);
  for (const characterId of characterIds) await storage.addCharacterToStory(id, characterId);
  await storage.updateStoryMetadata(id, { configPresetId: await preset() });
  return id;
}

function answerWith(suggestions) {
  return vi
    .spyOn(DeepSeekProvider.prototype, 'generate')
    .mockResolvedValue({ content: JSON.stringify({ suggestions }) });
}

describe('Archivist routes', () => {
  it('answer 404 while the experimental toggle is off', async () => {
    await setArchivist(false);
    const layla = await character('Layla', { description: 'Layla is single.' });
    const storyId = await story('Layla met Sam.', [layla]);
    const res = await request(createApp()).get(`/api/archivist/story/${storyId}`);
    expect(res.status).toBe(404);
  });

  it('suggest, accept and reject edits, saving each card once as an Archivist version', async () => {
    await setArchivist(true);
    const app = createApp();
    const layla = await character('Layla', {
      description: 'Layla is a baker. She is single.',
      personality: 'Warm.',
    });
    const storyId = await story('Layla and Sam fell in love.', [layla]);
    const generate = answerWith([
      {
        character: 'Layla',
        field: 'description',
        find: 'She is single.',
        replace: 'She is with Sam.',
      },
      { character: 'Layla', field: 'personality', find: '', replace: 'Hopeful about the future.' },
      { character: 'Layla', field: 'description', find: 'She is a pilot.', replace: 'Nope.' },
      { character: 'Sam', field: 'description', find: '', replace: 'Not in the cast.' },
    ]);

    const run = await request(app).post(`/api/archivist/story/${storyId}/run`);
    expect(run.status).toBe(200);
    expect(run.body.added).toBe(2);
    expect(generate.mock.calls[0][1]).toContain('Layla and Sam fell in love.');
    const [relationship, hope] = run.body.suggestions;
    expect(relationship).toMatchObject({
      characterName: 'Layla',
      current: 'Layla is a baker. She is single.',
      stale: false,
    });

    // Running again doesn't repeat what's waiting.
    const again = await request(app).post(`/api/archivist/story/${storyId}/run`);
    expect(again.body.added).toBe(0);

    const review = await request(app)
      .post(`/api/archivist/story/${storyId}/review`)
      .send({
        decisions: [
          { id: relationship.id, accept: true, replace: 'She is in love with Sam.' },
          { id: hope.id, accept: false },
        ],
      });
    expect(review.status).toBe(200);
    expect(review.body).toMatchObject({ applied: 1, stale: [], suggestions: [] });

    const card = await storage.getCharacter(layla);
    expect(card.data.description).toBe('Layla is a baker. She is in love with Sam.');
    expect(card.data.personality).toBe('Warm.');
    const versions = storage.listCharacterVersions(layla);
    expect(versions.at(-1)).toMatchObject({
      source: 'archivist',
      sourceId: `story:${storyId}`,
      sourceTitle: 'Summer',
    });

    // The rejected one is shown to later runs, and not proposed again.
    generate.mockClear();
    const third = await request(app).post(`/api/archivist/story/${storyId}/run`);
    expect(third.body.added).toBe(0);
    expect(generate.mock.calls[0][1]).toContain('Turned down');
  });

  it('leave a suggestion waiting when the card changed underneath it', async () => {
    await setArchivist(true);
    const app = createApp();
    const layla = await character('Layla', { description: 'She is single.' });
    const storyId = await story('Layla met Sam.', [layla]);
    answerWith([
      {
        character: 'Layla',
        field: 'description',
        find: 'She is single.',
        replace: 'She is with Sam.',
      },
    ]);
    const run = await request(app).post(`/api/archivist/story/${storyId}/run`);
    const [suggestion] = run.body.suggestions;

    const card = await storage.getCharacter(layla);
    card.data.description = 'She is married.';
    await storage.saveCharacter(layla, card);

    const listed = await request(app).get(`/api/archivist/story/${storyId}`);
    expect(listed.body.suggestions[0].stale).toBe(true);

    const review = await request(app)
      .post(`/api/archivist/story/${storyId}/review`)
      .send({ decisions: [{ id: suggestion.id, accept: true }] });
    expect(review.body).toMatchObject({ applied: 0, stale: [suggestion.id] });
    expect(review.body.suggestions).toHaveLength(1);
  });

  it("read a chat as a transcript, with the persona's card in the cast", async () => {
    await setArchivist(true);
    const layla = await character('Layla', { description: 'She is single.' });
    const bradley = await character('Bradley', { description: 'The user.' });
    const chat = chats.createChat({
      title: 'Late night',
      characterIds: [layla],
      personaCharacterId: bradley,
      configPresetId: await preset(),
    });
    chats.addTurn(chat.id, { source: 'user', senderName: 'Bradley', messages: ['you up?'] });
    chats.addTurn(chat.id, {
      source: 'character',
      characterId: layla,
      senderName: 'Layla',
      messages: ['always'],
    });
    const generate = answerWith([]);

    const res = await request(createApp()).post(`/api/archivist/chat/${chat.id}/run`);
    expect(res.status).toBe(200);
    const prompt = generate.mock.calls[0][1];
    expect(prompt).toContain('Bradley: you up?\nLayla: always');
    expect(prompt).toContain('## Layla');
    expect(prompt).toContain('## Bradley');
  });

  it('refuse to read an empty story, and delete suggestions with their story', async () => {
    await setArchivist(true);
    const app = createApp();
    const layla = await character('Layla', { description: 'She is single.' });
    const empty = await story('', [layla]);
    expect((await request(app).post(`/api/archivist/story/${empty}/run`)).status).toBe(400);

    const storyId = await story('Layla met Sam.', [layla]);
    answerWith([{ character: 'Layla', field: 'description', find: '', replace: 'She met Sam.' }]);
    await request(app).post(`/api/archivist/story/${storyId}/run`);
    await storage.deleteStory(storyId);
    const left = storage.db
      .prepare('SELECT COUNT(*) AS count FROM card_suggestions WHERE source_id = ?')
      .get(storyId);
    expect(left.count).toBe(0);
  });

  it('read a source once at a time', async () => {
    await setArchivist(true);
    const app = createApp();
    const layla = await character('Layla', { description: 'She is single.' });
    const storyId = await story('Layla met Sam.', [layla]);
    let finish;
    vi.spyOn(DeepSeekProvider.prototype, 'generate').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ content: '{"suggestions": []}' });
        }),
    );

    const first = request(app)
      .post(`/api/archivist/story/${storyId}/run`)
      .then((r) => r);
    const second = await request(app).post(`/api/archivist/story/${storyId}/run`);
    expect(second.status).toBe(409);
    await vi.waitFor(() => expect(finish).toBeDefined());
    finish();
    expect((await first).status).toBe(200);
    expect((await request(app).get(`/api/archivist/story/${storyId}`)).body.running).toBe(false);
  });

  it('keep both edits when two reviews of the same card run at once', async () => {
    await setArchivist(true);
    const app = createApp();
    const layla = await character('Layla', { description: 'She is single.', personality: 'Warm.' });
    const storyId = await story('Layla met Sam.', [layla]);
    answerWith([
      {
        character: 'Layla',
        field: 'description',
        find: 'She is single.',
        replace: 'She is with Sam.',
      },
      { character: 'Layla', field: 'personality', find: '', replace: 'Hopeful.' },
    ]);
    const run = await request(app).post(`/api/archivist/story/${storyId}/run`);
    const [relationship, hope] = run.body.suggestions;

    // Reading a card takes a moment, so without the lock each review would read the card before
    // the other saved it.
    const read = SqliteStorageService.prototype.getCharacter;
    vi.spyOn(SqliteStorageService.prototype, 'getCharacter').mockImplementation(
      async function (id) {
        const card = await read.call(this, id);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return card;
      },
    );
    const review = (decisions) =>
      request(app).post(`/api/archivist/story/${storyId}/review`).send({ decisions });
    const results = await Promise.all([
      review([{ id: relationship.id, accept: true }]),
      review([{ id: hope.id, accept: true }]),
      review([{ id: hope.id, accept: true }]),
    ]);

    expect(results.map((r) => r.body.applied).toSorted()).toEqual([0, 1, 1]);
    vi.restoreAllMocks();
    const card = await storage.getCharacter(layla);
    expect(card.data.description).toBe('She is with Sam.');
    expect(card.data.personality).toBe('Warm. Hopeful.');
  });

  it('reject malformed review decisions', async () => {
    await setArchivist(true);
    const layla = await character('Layla');
    const storyId = await story('Layla met Sam.', [layla]);
    const res = await request(createApp())
      .post(`/api/archivist/story/${storyId}/review`)
      .send({ decisions: [{ id: 'x', accept: true }] });
    expect(res.status).toBe(400);
  });
});
