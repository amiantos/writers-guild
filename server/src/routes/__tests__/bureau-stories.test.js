import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import bureausRouter from '../bureaus.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { getBureauStores } from '../../services/bureau/stores.js';
import { closeBureauDb } from '../../services/bureau/bureau-db.js';
import { DeepSeekError } from '../../services/bureau/deepseek-client.js';

function card(name) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name } };
}

/** A fake DeepSeek client that streams `text` as two content events. */
function fakeClient(text = 'The lamp was lit.', { failWith = null } = {}) {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    async *chatStream(options) {
      client.calls.push(options);
      if (failWith) throw failWith;
      const middle = Math.floor(text.length / 2);
      yield { type: 'reasoning', text: 'Planning.' };
      yield { type: 'content', text: text.slice(0, middle) };
      yield { type: 'content', text: text.slice(middle) };
      yield {
        type: 'done',
        content: text,
        reasoning: 'Planning.',
        toolCalls: [],
        finishReason: 'stop',
        usage: { prompt_tokens: 50, completion_tokens: 10 },
        model: 'deepseek-flash',
      };
    },
  };
  return client;
}

function parseEvents(text) {
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)));
}

describe('Bureau story routes', () => {
  let app;
  let tempDir;
  let stores;
  let client;
  let bureau;
  let mara;
  let theo;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-stories-'));
    stores = getBureauStores(tempDir);
  });

  afterAll(() => {
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    stores.bureaus.db.exec('DELETE FROM bureaus');
    bureau = stores.bureaus.createBureau({ name: 'Harbor', apiKey: 'sk-story-routes' });
    mara = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Mara'),
      libraryCharacterId: 'c1',
    });
    theo = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Theo'),
      libraryCharacterId: 'c2',
      isPersona: true,
    });
    bureau = stores.bureaus.getBureau(bureau.id);

    client = fakeClient();
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.locals.createBureauClient = () => client;
    app.use('/api/bureaus', bureausRouter);
    app.use(errorHandler);
  });

  const storiesUrl = () => `/api/bureaus/${bureau.id}/stories`;

  async function startStory(body = {}) {
    const { body: result } = await request(app).post(storiesUrl()).send(body).expect(201);
    return result.story;
  }

  describe('starting and ending', () => {
    it('starts a story with the whole cast at the present, and moves the Bureau clock', async () => {
      const before = Date.now();

      const { body } = await request(app)
        .post(storiesUrl())
        .send({ timeZone: 'America/Chicago' })
        .expect(201);

      expect(body.story).toMatchObject({
        title: 'Story 1',
        status: 'active',
        castIds: [mara.id, theo.id],
      });
      expect(Date.parse(body.story.startTime)).toBeGreaterThanOrEqual(before - 1000);
      expect(body.bureau).toMatchObject({
        bureauTime: body.story.startTime,
        timezone: 'America/Chicago',
      });
    });

    it("starts at the Bureau's current time or a picked time", async () => {
      stores.bureaus.setBureauTime(bureau.id, '2026-09-01T20:00:00.000Z');

      const atBureauTime = await startStory({ start: { choice: 'bureau' } });
      const atCustomTime = await startStory({
        title: 'Summer, 1996',
        castIds: [mara.id],
        start: { choice: 'custom', customTime: '1996-06-03T21:00:00-07:00' },
      });

      expect(atBureauTime.startTime).toBe('2026-09-01T20:00:00.000Z');
      expect(atCustomTime).toMatchObject({
        title: 'Summer, 1996',
        castIds: [mara.id],
        startTime: '1996-06-04T04:00:00.000Z',
      });
    });

    it('rejects an unknown time choice or cast member', async () => {
      await request(app)
        .post(storiesUrl())
        .send({ start: { choice: 'someday' } })
        .expect(400);
      await request(app)
        .post(storiesUrl())
        .send({ castIds: ['not-cast'] })
        .expect(400);
    });

    it('ends a story at a picked time and moves the Bureau clock', async () => {
      const story = await startStory();

      const { body } = await request(app)
        .post(`${storiesUrl()}/${story.id}/end`)
        .send({ end: { choice: 'custom', customTime: '2026-10-28T02:00:00Z' } })
        .expect(200);

      expect(body.story).toMatchObject({ status: 'ended', endTime: '2026-10-28T02:00:00.000Z' });
      expect(body.bureau.bureauTime).toBe('2026-10-28T02:00:00.000Z');
      await request(app).post(`${storiesUrl()}/${story.id}/end`).send({}).expect(409);
      await request(app)
        .post(`${storiesUrl()}/${story.id}/generate`)
        .send({ action: 'continue' })
        .expect(409);
    });
  });

  describe('stories and turns', () => {
    it('lists, renames, recasts, and deletes stories', async () => {
      const story = await startStory();

      const { body: list } = await request(app).get(storiesUrl()).expect(200);
      expect(list.stories.map((item) => item.id)).toEqual([story.id]);

      const { body: updated } = await request(app)
        .put(`${storiesUrl()}/${story.id}`)
        .send({ title: 'Lamplight', castIds: [theo.id] })
        .expect(200);
      expect(updated.story).toMatchObject({ title: 'Lamplight', castIds: [theo.id] });
      await request(app).put(`${storiesUrl()}/${story.id}`).send({ title: ' ' }).expect(400);

      await request(app).delete(`${storiesUrl()}/${story.id}`).expect(200);
      await request(app).get(`${storiesUrl()}/${story.id}`).expect(404);
    });

    it('adds, edits, and deletes turns from the reader', async () => {
      const story = await startStory();
      const turnsUrl = `${storiesUrl()}/${story.id}/turns`;

      const { body: prose } = await request(app)
        .post(turnsUrl)
        .send({ kind: 'prose', content: 'Theo knocked.' })
        .expect(201);
      expect(prose.turn).toMatchObject({ kind: 'prose', source: 'user', authorCastId: theo.id });
      await request(app).post(turnsUrl).send({ kind: 'scene_break' }).expect(201);
      await request(app).post(turnsUrl).send({ kind: 'prose', content: '' }).expect(400);
      await request(app).post(turnsUrl).send({ kind: 'poem', content: 'Roses' }).expect(400);

      const { body: edited } = await request(app)
        .put(`${turnsUrl}/${prose.turn.id}`)
        .send({ content: 'Theo knocked twice.' })
        .expect(200);
      expect(edited.turn).toMatchObject({ content: 'Theo knocked twice.', edited: true });

      await request(app).delete(`${turnsUrl}/${prose.turn.id}`).expect(200);
      const { body: detail } = await request(app).get(`${storiesUrl()}/${story.id}`).expect(200);
      expect(detail.turns.map((turn) => turn.kind)).toEqual(['scene_break']);
      await request(app).put(`${turnsUrl}/missing`).send({ content: 'x' }).expect(404);
    });
  });

  describe('generation', () => {
    it("adds the reader's prose, then the Writer's reply", async () => {
      const story = await startStory();

      const { body } = await request(app)
        .post(`${storiesUrl()}/${story.id}/generate`)
        .send({ action: 'write', text: 'Theo knocked.', leadCastId: mara.id })
        .expect(201);

      expect(body.userTurn).toMatchObject({
        kind: 'prose',
        source: 'user',
        content: 'Theo knocked.',
        authorCastId: theo.id,
      });
      expect(body.turn).toMatchObject({
        kind: 'prose',
        source: 'generated',
        content: 'The lamp was lit.',
        authorCastId: mara.id,
      });
      expect(client.calls[0].messages[1].content).toContain('Theo knocked.');
    });

    it('adds a direction and passes it to the Writer', async () => {
      const story = await startStory();

      const { body } = await request(app)
        .post(`${storiesUrl()}/${story.id}/generate`)
        .send({ action: 'direct', text: 'She suggests the night market' })
        .expect(201);

      expect(body.userTurn).toMatchObject({
        kind: 'direction',
        content: 'She suggests the night market',
      });
      expect(client.calls[0].messages[1].content).toContain(
        'The author wants this to happen next: She suggests the night market',
      );
    });

    it('streams events when asked', async () => {
      const story = await startStory();

      const response = await request(app)
        .post(`${storiesUrl()}/${story.id}/generate`)
        .set('Accept', 'text/event-stream')
        .send({ action: 'write', text: 'Theo knocked.' })
        .buffer(true)
        .parse((res, callback) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => callback(null, data));
        })
        .expect(200);

      const events = parseEvents(response.body);
      expect(events.map((event) => event.type)).toEqual([
        'turn',
        'run',
        'reasoning',
        'content',
        'content',
        'done',
      ]);
      expect(events.at(-1).turn).toMatchObject({
        content: 'The lamp was lit.',
        runId: events[1].runId,
      });
    });

    it('validates generation requests', async () => {
      const story = await startStory({ castIds: [theo.id] });
      const url = `${storiesUrl()}/${story.id}/generate`;

      await request(app).post(url).send({ action: 'sing' }).expect(400);
      await request(app).post(url).send({ action: 'write' }).expect(400);
      await request(app).post(url).send({ action: 'continue', leadCastId: mara.id }).expect(400);

      stores.bureaus.updateBureau(bureau.id, { apiKey: '' });
      const { body } = await request(app).post(url).send({ action: 'continue' }).expect(400);
      expect(body.error).toMatch(/no API key/);
      expect(client.calls).toHaveLength(0);
    });

    it('reports a model failure and keeps the reader turn', async () => {
      client = fakeClient('', {
        failWith: new DeepSeekError('DeepSeek API error 402 (insufficient balance): Top up'),
      });
      const story = await startStory();

      const { body } = await request(app)
        .post(`${storiesUrl()}/${story.id}/generate`)
        .send({ action: 'write', text: 'Theo knocked.' })
        .expect(502);

      expect(body.error).toMatch(/insufficient balance/);
      const { body: detail } = await request(app).get(`${storiesUrl()}/${story.id}`).expect(200);
      expect(detail.turns.map((turn) => turn.source)).toEqual(['user']);
    });

    it('regenerates a generated turn as a new variant and switches between them', async () => {
      const story = await startStory();
      const { body: first } = await request(app)
        .post(`${storiesUrl()}/${story.id}/generate`)
        .send({ action: 'write', text: 'Theo knocked.' })
        .expect(201);
      client = fakeClient('The lamp guttered out.');

      const turnUrl = `${storiesUrl()}/${story.id}/turns/${first.turn.id}`;
      const { body: regenerated } = await request(app)
        .post(`${turnUrl}/regenerate`)
        .send({})
        .expect(200);

      expect(regenerated.turn).toMatchObject({
        id: first.turn.id,
        content: 'The lamp guttered out.',
      });
      expect(regenerated.turn.variants).toHaveLength(2);
      expect(client.calls[0].messages[1].content).toContain("leave Theo's next words");

      const { body: switched } = await request(app)
        .put(`${turnUrl}/variant`)
        .send({ variantId: first.turn.activeVariantId })
        .expect(200);
      expect(switched.turn.content).toBe('The lamp was lit.');

      await request(app)
        .post(`${storiesUrl()}/${story.id}/turns/${first.userTurn.id}/regenerate`)
        .send({})
        .expect(400);
      await request(app).put(`${turnUrl}/variant`).send({ variantId: 'missing' }).expect(404);
    });
  });
});
