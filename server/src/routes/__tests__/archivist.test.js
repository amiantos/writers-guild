import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import http from 'http';
import path from 'path';
import os from 'os';
import { SqliteStorageService } from '../../services/sqliteStorage.js';
import { ChatStorage } from '../../services/chat/chat-storage.js';
import { CardSuggestionStorage } from '../../services/archivist/card-suggestion-storage.js';
import { ContinuityStorage } from '../../services/continuity/continuity-storage.js';
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

  it('decide a suggestion once when an accept and a reject of it run at once', async () => {
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
    const [relationship] = run.body.suggestions;

    // The reject arrives while the accept is saving the card.
    const save = SqliteStorageService.prototype.saveCharacter;
    let rejecting;
    const review = (accept) =>
      request(app)
        .post(`/api/archivist/story/${storyId}/review`)
        .send({ decisions: [{ id: relationship.id, accept }] });
    vi.spyOn(SqliteStorageService.prototype, 'saveCharacter').mockImplementation(async function (
      ...args
    ) {
      rejecting ??= review(false).then((r) => r);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return save.apply(this, args);
    });
    const setStatus = vi.spyOn(CardSuggestionStorage.prototype, 'setStatus');
    await review(true);
    await rejecting;
    vi.restoreAllMocks();

    // The accept won, so the reject waiting behind it found the suggestion already decided.
    expect(setStatus.mock.calls.map(([, status]) => status)).toEqual(['accepted']);
    const card = await storage.getCharacter(layla);
    expect(card.data.description).toBe('She is with Sam.');
  });

  it('reject malformed review decisions, and a suggestion decided twice', async () => {
    await setArchivist(true);
    const layla = await character('Layla');
    const storyId = await story('Layla met Sam.', [layla]);
    const review = (decisions) =>
      request(createApp()).post(`/api/archivist/story/${storyId}/review`).send({ decisions });
    expect((await review([{ id: 'x', accept: true }])).status).toBe(400);
    expect(
      (
        await review([
          { id: 1, accept: true },
          { id: 1, accept: false },
        ])
      ).status,
    ).toBe(400);
  });

  it("keep nothing from a read whose story, or a character's card, was deleted meanwhile", async () => {
    await setArchivist(true);
    const app = createApp();
    const layla = await character('Layla', { description: 'She is single.' });
    const sam = await character('Sam', { description: 'He is single.' });
    const storyId = await story('Layla met Sam.', [layla, sam]);
    const edits = [
      { character: 'Layla', field: 'description', find: '', replace: 'She met Sam.' },
      { character: 'Sam', field: 'description', find: '', replace: 'He met Layla.' },
    ];

    vi.spyOn(DeepSeekProvider.prototype, 'generate').mockImplementation(async () => {
      await storage.deleteCharacter(sam);
      return { content: JSON.stringify({ suggestions: edits }) };
    });
    const run = await request(app).post(`/api/archivist/story/${storyId}/run`);
    expect(run.status).toBe(200);
    expect(run.body.added).toBe(1);
    expect(run.body.suggestions.map((s) => s.characterName)).toEqual(['Layla']);

    const other = await story('Layla left.', [layla]);
    vi.spyOn(DeepSeekProvider.prototype, 'generate').mockImplementation(async () => {
      await storage.deleteStory(other);
      return { content: JSON.stringify({ suggestions: edits }) };
    });
    await request(app).post(`/api/archivist/story/${other}/run`);
    const left = storage.db
      .prepare('SELECT COUNT(*) AS count FROM card_suggestions WHERE source_id = ?')
      .get(other);
    expect(left.count).toBe(0);
  });

  it('keep reading when the request drops, and report how the read ended', async () => {
    await setArchivist(true);
    const layla = await character('Layla', { description: 'She is single.' });
    const storyId = await story('Layla met Sam.', [layla]);
    let finish;
    vi.spyOn(DeepSeekProvider.prototype, 'generate').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              content: JSON.stringify({
                suggestions: [
                  { character: 'Layla', field: 'description', find: '', replace: 'She met Sam.' },
                ],
              }),
            });
        }),
    );
    const app = createApp();
    const server = app.listen(0);
    try {
      const call = http.request({
        host: '127.0.0.1',
        port: server.address().port,
        method: 'POST',
        path: `/api/archivist/story/${storyId}/run`,
      });
      call.on('error', () => {});
      call.end();
      await vi.waitFor(() => expect(finish).toBeDefined());
      call.destroy();
      // Give the server a moment to see the request close before the model answers.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const during = await request(app).get(`/api/archivist/story/${storyId}`);
      expect(during.body).toMatchObject({ running: true, run: { running: true } });
      finish();
      await vi.waitFor(async () =>
        expect((await request(app).get(`/api/archivist/story/${storyId}`)).body.running).toBe(
          false,
        ),
      );
      const after = await request(app).get(`/api/archivist/story/${storyId}`);
      expect(after.body.run).toMatchObject({ added: 1, error: null, cancelled: false });
      expect(after.body.suggestions.map((s) => s.replace)).toEqual(['She met Sam.']);
    } finally {
      server.close();
    }
  });

  it('keep nothing from a read the reader stopped', async () => {
    await setArchivist(true);
    const app = createApp();
    const layla = await character('Layla', { description: 'She is single.' });
    const storyId = await story('Layla met Sam.', [layla]);
    let finish;
    vi.spyOn(DeepSeekProvider.prototype, 'generate').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () =>
            resolve({
              content: JSON.stringify({
                suggestions: [
                  { character: 'Layla', field: 'description', find: '', replace: 'She met Sam.' },
                ],
              }),
            });
        }),
    );

    const run = request(app)
      .post(`/api/archivist/story/${storyId}/run`)
      .then((r) => r);
    await vi.waitFor(() => expect(finish).toBeDefined());
    const cancel = await request(app).post(`/api/archivist/story/${storyId}/cancel`);
    expect(cancel.body).toEqual({ cancelled: true });
    finish();

    const done = await run;
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ added: 0, suggestions: [], run: { cancelled: true } });
    const nothing = await request(app).post(`/api/archivist/story/${storyId}/cancel`);
    expect(nothing.body).toEqual({ cancelled: false });
  });

  it('say why a read failed, in its answer, the log, and later lists', async () => {
    await setArchivist(true);
    const app = createApp();
    const layla = await character('Layla', { description: 'She is single.' });
    const storyId = await story('Layla met Sam.', [layla]);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(DeepSeekProvider.prototype, 'generate').mockRejectedValue(
      new TypeError('fetch failed', { cause: new Error('Headers Timeout Error') }),
    );

    const run = await request(app).post(`/api/archivist/story/${storyId}/run`);
    expect(run.status).toBe(502);
    expect(run.body.error).toBe('fetch failed (Headers Timeout Error)');
    expect(log.mock.calls.flat().join(' ')).toContain('Headers Timeout Error');

    const listed = await request(app).get(`/api/archivist/story/${storyId}`);
    expect(listed.body.running).toBe(false);
    expect(listed.body.run.error).toBe('fetch failed (Headers Timeout Error)');
  });

  it('keep what earlier parts found when a later part fails', async () => {
    await setArchivist(true);
    const app = createApp();
    const layla = await character('Layla', { description: 'She is single.' });
    const long = Array.from({ length: 40 }, (_, i) => `${i} ${'Layla walked. '.repeat(200)}`).join(
      '\n\n',
    );
    const storyId = await story(long, [layla]);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(DeepSeekProvider.prototype, 'generate')
      .mockResolvedValueOnce({
        content: JSON.stringify({
          suggestions: [
            { character: 'Layla', field: 'description', find: '', replace: 'She walks a lot.' },
          ],
        }),
      })
      .mockRejectedValue(new Error('Context length exceeded'));

    const run = await request(app).post(`/api/archivist/story/${storyId}/run`);
    expect(run.status).toBe(502);
    expect(run.body.error).toMatch(/^Part 2 of \d+: Context length exceeded/);
    expect(run.body.error).toContain('The 1 suggestion(s) from the parts before it are kept.');

    const listed = await request(app).get(`/api/archivist/story/${storyId}`);
    expect(listed.body.run).toMatchObject({ added: 1, part: { index: 1 } });
    expect(listed.body.suggestions.map((s) => s.replace)).toEqual(['She walks a lot.']);
  });
});

function answerWithContinuity(continuity) {
  return vi
    .spyOn(DeepSeekProvider.prototype, 'generate')
    .mockResolvedValue({ content: JSON.stringify({ continuity, rationale: 'Added the date.' }) });
}

describe('Archivist routes for a source in a Continuity', () => {
  const START = 'Bradley helped Amanda find her dog. He asked her out on a date.';
  const UPDATED = `${START} The date went well, and Amanda will call about a second one.`;
  let continuities;

  beforeAll(() => {
    continuities = new ContinuityStorage(storage.db);
  });

  async function setContinuity(on) {
    const settings = await storage.getSettings();
    await storage.saveSettings({ ...settings, experimentalContinuity: on });
  }

  async function storyInContinuity(characterIds = []) {
    const continuity = continuities.create({ name: 'Bradley and Amanda', content: START });
    const storyId = await story('They went out to dinner and hit it off.', characterIds);
    await storage.updateStoryMetadata(storyId, { continuityId: continuity.id });
    return { storyId, continuity };
  }

  it('suggest an updated Continuity instead of card edits, and apply an edited one', async () => {
    await setArchivist(true);
    await setContinuity(true);
    const app = createApp();
    const bradley = await character('Bradley', { description: 'Bradley is single.' });
    const { storyId, continuity } = await storyInContinuity([bradley]);
    const generate = answerWithContinuity(UPDATED);

    const listed = await request(app).get(`/api/archivist/story/${storyId}`);
    expect(listed.body.continuity).toEqual({ id: continuity.id, name: 'Bradley and Amanda' });

    const run = await request(app).post(`/api/archivist/story/${storyId}/run`);
    expect(run.status).toBe(200);
    expect(run.body.added).toBe(1);
    expect(run.body.suggestions).toEqual([]);
    expect(generate.mock.calls[0][1]).toContain(START);
    expect(generate.mock.calls[0][1]).toContain('They went out to dinner');
    const suggestion = run.body.continuitySuggestion;
    expect(suggestion).toMatchObject({
      continuityName: 'Bradley and Amanda',
      current: START,
      replace: UPDATED,
      rationale: 'Added the date.',
      stale: false,
    });

    const edited = `${UPDATED} He can't stop smiling.`;
    const review = await request(app)
      .post(`/api/archivist/story/${storyId}/review`)
      .send({ continuity: { id: suggestion.id, accept: true, replace: edited } });
    expect(review.status).toBe(200);
    expect(review.body).toMatchObject({ continuityApplied: true, continuitySuggestion: null });
    expect(continuities.get(continuity.id).content).toBe(edited);
    expect(continuities.listVersions(continuity.id).at(-1)).toMatchObject({
      source: 'archivist',
      sourceId: `story:${storyId}`,
      sourceTitle: 'Summer',
    });
    expect((await storage.getCharacter(bradley)).data.description).toBe('Bradley is single.');
  });

  it("read a story with no characters, and replace an update that's still waiting", async () => {
    await setArchivist(true);
    await setContinuity(true);
    const app = createApp();
    const { storyId } = await storyInContinuity();
    answerWithContinuity(UPDATED);
    const first = await request(app).post(`/api/archivist/story/${storyId}/run`);
    expect(first.status).toBe(200);

    vi.restoreAllMocks();
    answerWithContinuity(`${UPDATED} Again.`);
    const second = await request(app).post(`/api/archivist/story/${storyId}/run`);
    expect(second.body.continuitySuggestion.replace).toBe(`${UPDATED} Again.`);
    expect(second.body.continuitySuggestion.id).not.toBe(first.body.continuitySuggestion.id);
  });

  it('leave an update waiting when the Continuity changed underneath it, and reject it', async () => {
    await setArchivist(true);
    await setContinuity(true);
    const app = createApp();
    const { storyId, continuity } = await storyInContinuity();
    answerWithContinuity(UPDATED);
    const run = await request(app).post(`/api/archivist/story/${storyId}/run`);
    const { id } = run.body.continuitySuggestion;

    continuities.update(continuity.id, { content: `${START} Edited by hand.` });
    const accept = await request(app)
      .post(`/api/archivist/story/${storyId}/review`)
      .send({ continuity: { id, accept: true } });
    expect(accept.body).toMatchObject({ continuityApplied: false, continuityStale: true });
    expect(accept.body.continuitySuggestion).toMatchObject({ id, stale: true });
    expect(continuities.get(continuity.id).content).toBe(`${START} Edited by hand.`);

    const reject = await request(app)
      .post(`/api/archivist/story/${storyId}/review`)
      .send({ continuity: { id, accept: false } });
    expect(reject.body.continuitySuggestion).toBeNull();
  });

  it('say so when nothing is worth carrying forward', async () => {
    await setArchivist(true);
    await setContinuity(true);
    const { storyId } = await storyInContinuity();
    answerWithContinuity(null);
    const run = await request(createApp()).post(`/api/archivist/story/${storyId}/run`);
    expect(run.body).toMatchObject({ added: 0, continuitySuggestion: null });
  });

  it('review the cards while Continuities are turned off', async () => {
    await setArchivist(true);
    await setContinuity(false);
    const layla = await character('Layla', { description: 'She is single.' });
    const { storyId } = await storyInContinuity([layla]);
    answerWith([{ character: 'Layla', field: 'description', find: '', replace: 'She dates.' }]);
    const run = await request(createApp()).post(`/api/archivist/story/${storyId}/run`);
    expect(run.body).toMatchObject({ added: 1, continuity: null, continuitySuggestion: null });
  });

  it('reject a malformed Continuity decision', async () => {
    await setArchivist(true);
    await setContinuity(true);
    const { storyId } = await storyInContinuity();
    const app = createApp();
    await request(app)
      .post(`/api/archivist/story/${storyId}/review`)
      .send({ continuity: { id: 'x', accept: true } })
      .expect(400);
    await request(app)
      .post(`/api/archivist/story/${storyId}/review`)
      .send({ continuity: { id: 1, accept: true, replace: '  ' } })
      .expect(400);
  });

  it('hide and refuse an update to a Continuity the story left, or while Continuities are off', async () => {
    await setArchivist(true);
    await setContinuity(true);
    const app = createApp();
    const { storyId, continuity } = await storyInContinuity();
    answerWithContinuity(UPDATED);
    const run = await request(app).post(`/api/archivist/story/${storyId}/run`);
    const { id } = run.body.continuitySuggestion;

    await setContinuity(false);
    const off = await request(app)
      .post(`/api/archivist/story/${storyId}/review`)
      .send({ continuity: { id, accept: true } });
    expect(off.body).toMatchObject({ continuityApplied: false, continuitySuggestion: null });

    await setContinuity(true);
    const other = continuities.create({ name: 'Elsewhere', content: 'Other.' });
    await storage.updateStoryMetadata(storyId, { continuityId: other.id });
    const moved = await request(app)
      .post(`/api/archivist/story/${storyId}/review`)
      .send({ continuity: { id, accept: true } });
    expect(moved.body).toMatchObject({ continuityApplied: false, continuitySuggestion: null });
    expect(continuities.get(continuity.id).content).toBe(START);
    expect(continuities.get(other.id).content).toBe('Other.');
  });

  it('keep no update from a read whose story was deleted meanwhile', async () => {
    await setArchivist(true);
    await setContinuity(true);
    const { storyId, continuity } = await storyInContinuity();
    vi.spyOn(DeepSeekProvider.prototype, 'generate').mockImplementation(async () => {
      await storage.deleteStory(storyId);
      return { content: JSON.stringify({ continuity: UPDATED, rationale: '' }) };
    });
    await request(createApp()).post(`/api/archivist/story/${storyId}/run`);
    const rows = storage.db
      .prepare('SELECT COUNT(*) AS count FROM continuity_suggestions WHERE continuity_id = ?')
      .get(continuity.id);
    expect(rows.count).toBe(0);
  });
});
