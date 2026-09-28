import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteStorageService } from '../../services/sqliteStorage.js';
import { DeepSeekProvider } from '../../services/providers/deepseek-provider.js';
import characterGeneratorRouter from '../character-generator.js';

// The router keeps its storage in module scope, so every test in this file shares one directory.
let tempDir;
let storage;
let presetId;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'character-generator-routes-test-'));
  storage = new SqliteStorageService(tempDir);
  presetId = 'preset-1';
  await storage.savePreset(presetId, {
    name: 'Test',
    provider: 'deepseek',
    apiConfig: { apiKey: 'test-key', model: 'deepseek-v4-flash' },
    generationSettings: { maxTokens: 100 },
  });
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
  app.use('/api/character-generator', characterGeneratorRouter);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

function answerWith(character) {
  return vi
    .spyOn(DeepSeekProvider.prototype, 'generate')
    .mockResolvedValue({ content: JSON.stringify(character) });
}

describe('character generator routes', () => {
  it("generate a card with the chosen preset, in a lorebook's world, without saving it", async () => {
    await storage.saveLorebook('saltmere', {
      name: 'Saltmere',
      entries: [{ keys: ['The Gull'], content: 'The harbor pub.', enabled: true }],
    });
    const generate = answerWith({ name: 'Ines', description: 'Runs the pub.' });
    const countCharacters = () =>
      storage.db.prepare('SELECT COUNT(*) AS count FROM characters').get().count;
    const before = countCharacters();

    const res = await request(createApp())
      .post('/api/character-generator/generate')
      .send({ idea: 'A pub owner', presetId, lorebookId: 'saltmere' });

    expect(res.status).toBe(200);
    expect(res.body.card.data).toMatchObject({ name: 'Ines', description: 'Runs the pub.' });
    expect(generate.mock.calls[0][1]).toContain('The Gull: The harbor pub.');
    expect(countCharacters()).toBe(before);
  });

  it('reject a missing idea, an unknown lorebook, and a failed generation', async () => {
    const app = createApp();
    const url = '/api/character-generator/generate';
    expect((await request(app).post(url).send({ presetId })).status).toBe(400);
    expect(
      (await request(app).post(url).send({ idea: 'x', presetId, lorebookId: 'nope' })).status,
    ).toBe(404);

    vi.spyOn(DeepSeekProvider.prototype, 'generate').mockResolvedValue({ content: 'No.' });
    const failed = await request(app).post(url).send({ idea: 'x', presetId });
    expect(failed.status).toBe(502);
  });

  it('save the edited card to the library as a new character', async () => {
    const res = await request(createApp())
      .post('/api/character-generator/save')
      .send({ card: { data: { name: 'Ines', description: 'Runs the pub.', creator: 'someone' } } });

    expect(res.status).toBe(201);
    const card = await storage.getCharacter(res.body.id);
    expect(card.data).toMatchObject({
      name: 'Ines',
      description: 'Runs the pub.',
      creator: '',
      creator_notes: 'Generated in Writers Guild.',
    });

    const unnamed = await request(createApp())
      .post('/api/character-generator/save')
      .send({ card: { data: { name: '' } } });
    expect(unnamed.status).toBe(400);
  });
});
