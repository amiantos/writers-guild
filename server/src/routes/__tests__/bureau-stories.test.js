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
import { settleBackgroundArchives } from '../../services/bureau/archivist.js';

function card(name) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name } };
}

/**
 * A fake DeepSeek client. The Writer's stream sends `text` as two content
 * events; the Archivist's call records `client.archiveRecord`.
 */
function fakeClient(text = 'The lamp was lit.', { failWith = null } = {}) {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    archiveCalls: [],
    archiveRecord: { knowledge: [], episodes: [], story_summary: 'Summary.' },
    archiveFailure: null,
    async chat(options) {
      client.archiveCalls.push(options);
      if (client.archiveFailure) throw client.archiveFailure;
      return {
        content: '',
        reasoning: '',
        finishReason: 'tool_calls',
        model: 'deepseek-flash',
        usage: { prompt_tokens: 400, completion_tokens: 60 },
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'record_memories', arguments: JSON.stringify(client.archiveRecord) },
          },
        ],
      };
    },
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

/** An Archivist record in which Mara learns `content` from the first passage. */
function maraKnows(content) {
  return {
    knowledge: [{ character: 'Mara', content, importance: 4, supersedes: 0, passages: [0] }],
    episodes: [{ character: 'Mara', content: 'Theo confided in Mara.' }],
    story_summary: 'Theo confesses.',
  };
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
    stores.bureaus.updateSettings(bureau.id, { director: { enabled: false } });
    bureau = stores.bureaus.getBureau(bureau.id);

    client = fakeClient();
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.locals.createBureauClient = () => client;
    app.locals.bureauAutoArchive = false;
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

    it("starts at the Bureau's present when its date is moved", async () => {
      stores.bureaus.updateBureau(bureau.id, { presentOffsetDays: -365 });
      const before = Date.now();

      const story = await startStory({ start: { choice: 'present' } });

      const started = Date.parse(story.startTime);
      expect(started).toBeGreaterThanOrEqual(before - 365 * 86_400_000 - 1000);
      expect(started).toBeLessThan(before - 364 * 86_400_000);
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

    it("reverts one of the Editor's fixes", async () => {
      const story = await startStory();
      const original = '"Coming?" Mara asked. "No," Theo said.';
      const replacement = '"Coming?" Mara asked.\n\n"No," Theo said.';
      const runId = stores.bureaus.createRun({
        bureauId: bureau.id,
        purpose: 'turn',
        targetType: 'story',
        targetId: story.id,
      });
      stores.bureaus.addStep(runId, {
        position: 0,
        role: 'editor',
        kind: 'tool',
        request: { name: 'edit_paragraphs' },
        response: {
          edits: [
            { paragraph: 1, rules: ['multiple_speakers'], reason: '', original, replacement },
          ],
        },
      });
      const turn = stores.stories.addTurn(story.id, {
        kind: 'prose',
        source: 'generated',
        content: `The lamp was lit.\n\n${replacement}`,
        runId,
      });
      const url = `${storiesUrl()}/${story.id}/turns/${turn.id}/revert-edit`;

      const { body } = await request(app).post(url).send({ runId, index: 0 }).expect(200);

      expect(body.turn).toMatchObject({
        content: `The lamp was lit.\n\n${original}`,
        edited: true,
      });
      await request(app).post(url).send({ runId, index: 0 }).expect(409);
      await request(app).post(url).send({ runId, index: 3 }).expect(404);
      await request(app).post(url).send({ runId: 'another-run', index: 0 }).expect(409);
      await request(app).post(url).send({}).expect(400);
    });

    it('reverts a cut-down fix once, in the paragraph it replaced', async () => {
      const story = await startStory();
      const original = 'Mara grinned. "Race you," she said. Theo laughed. "You\'re on," he said.';
      const replacement = 'Mara grinned. "Race you," she said.';
      const runId = stores.bureaus.createRun({
        bureauId: bureau.id,
        purpose: 'turn',
        targetType: 'story',
        targetId: story.id,
      });
      stores.bureaus.addStep(runId, {
        position: 0,
        role: 'editor',
        kind: 'tool',
        request: { name: 'edit_paragraphs' },
        response: {
          edits: [
            { paragraph: 1, rules: ['speaking_for_reader'], reason: '', original, replacement },
          ],
        },
      });
      // The same words also end the first paragraph, which must be left alone.
      const turn = stores.stories.addTurn(story.id, {
        kind: 'prose',
        source: 'generated',
        content: `The race began. ${replacement}\n\n${replacement}`,
        runId,
      });
      const url = `${storiesUrl()}/${story.id}/turns/${turn.id}/revert-edit`;

      const { body } = await request(app).post(url).send({ runId, index: 0 }).expect(200);

      expect(body.turn.content).toBe(`The race began. ${replacement}\n\n${original}`);
      const { body: again } = await request(app).post(url).send({ runId, index: 0 }).expect(409);
      expect(again.error).toMatch(/already reverted/);
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
        'stage',
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

  describe('memory', () => {
    async function storyWithConfession() {
      const story = await startStory();
      await request(app)
        .post(`${storiesUrl()}/${story.id}/turns`)
        .send({ kind: 'prose', content: "Theo admitted he couldn't swim." })
        .expect(201);
      client.archiveRecord = maraKnows("Theo can't swim.");
      return story;
    }

    async function maraMemories(query = {}) {
      const { body } = await request(app)
        .get(`/api/bureaus/${bureau.id}/cast/${mara.id}/memories`)
        .query(query)
        .expect(200);
      return body.memories;
    }

    it('commits a story to memory on request', async () => {
      const story = await storyWithConfession();

      const { body } = await request(app)
        .post(`${storiesUrl()}/${story.id}/archive`)
        .send({})
        .expect(200);

      expect(body.archive).toMatchObject({ passes: 1, added: 1, episodes: 1 });
      expect(body.story).toMatchObject({ archivedThrough: 0, summary: 'Theo confesses.' });
      expect((await maraMemories()).map((memory) => memory.content)).toEqual([
        'Theo confided in Mara.',
        "Theo can't swim.",
      ]);

      stores.bureaus.updateBureau(bureau.id, { apiKey: '' });
      await request(app).post(`${storiesUrl()}/${story.id}/archive`).send({}).expect(400);
    });

    it('reports a model failure while committing', async () => {
      const story = await storyWithConfession();
      client.archiveFailure = new DeepSeekError('DeepSeek API error 429 (rate limited): Slow down');

      const { body } = await request(app)
        .post(`${storiesUrl()}/${story.id}/archive`)
        .send({})
        .expect(502);

      expect(body.error).toMatch(/rate limited/);
    });

    it('reads the rest of a story into memory when it ends', async () => {
      const story = await storyWithConfession();

      const { body } = await request(app)
        .post(`${storiesUrl()}/${story.id}/end`)
        .send({ end: { choice: 'unchanged' } })
        .expect(200);

      expect(body).toMatchObject({ archive: { added: 1 }, archiveError: null });
      expect(body.story).toMatchObject({ status: 'ended', archivedThrough: 0 });
    });

    it("doesn't archive an ending story when the Bureau archives only on request", async () => {
      stores.bureaus.updateSettings(bureau.id, { memory: { autoArchive: false } });
      const story = await storyWithConfession();

      const { body } = await request(app)
        .post(`${storiesUrl()}/${story.id}/end`)
        .send({})
        .expect(200);

      expect(body).toMatchObject({ archive: null, archiveError: null });
      expect(client.archiveCalls).toHaveLength(0);
    });

    it('still ends the story when archiving fails', async () => {
      const story = await storyWithConfession();
      client.archiveFailure = new DeepSeekError('DeepSeek API error 402 (insufficient balance)');

      const { body } = await request(app)
        .post(`${storiesUrl()}/${story.id}/end`)
        .send({})
        .expect(200);

      expect(body.story.status).toBe('ended');
      expect(body.archiveError).toMatch(/insufficient balance/);
    });

    it('marks memories for review when a turn they cite changes', async () => {
      const story = await storyWithConfession();
      await request(app).post(`${storiesUrl()}/${story.id}/archive`).send({}).expect(200);
      const [turn] = stores.stories.listTurns(story.id);

      await request(app)
        .put(`${storiesUrl()}/${story.id}/turns/${turn.id}`)
        .send({ content: 'Theo admitted he could barely swim.' })
        .expect(200);

      // The episode covers every passage, so it's flagged along with the knowledge.
      expect((await maraMemories()).map((memory) => [memory.layer, memory.needsReview])).toEqual([
        ['episode', true],
        ['knowledge', true],
      ]);
      const { body } = await request(app).get(`/api/bureaus/${bureau.id}/cast`).expect(200);
      expect(body.memoryCounts[mara.id]).toEqual({ current: 2, needsReview: 2 });
    });

    it('deletes the memories and arc notes recorded from a deleted story', async () => {
      const story = await storyWithConfession();
      await request(app).post(`${storiesUrl()}/${story.id}/archive`).send({}).expect(200);
      stores.arcNotes.addNote(bureau.id, mara.id, {
        content: 'Mara trusts Theo.',
        sourceType: 'story',
        sourceId: story.id,
        worldTime: story.startTime,
      });

      await request(app).delete(`${storiesUrl()}/${story.id}`).expect(200);

      expect(await maraMemories()).toEqual([]);
      expect(stores.arcNotes.listNotes(bureau.id, mara.id)).toEqual([]);
    });

    it('archives settled turns in the background after generating', async () => {
      app.locals.bureauAutoArchive = true;
      const story = await startStory();
      for (let index = 0; index < 11; index += 1) {
        stores.stories.addTurn(story.id, {
          kind: 'prose',
          source: 'user',
          content: `Passage ${index}.`,
        });
      }

      await request(app)
        .post(`${storiesUrl()}/${story.id}/generate`)
        .send({ action: 'continue' })
        .expect(201);
      await settleBackgroundArchives();

      expect(client.archiveCalls).toHaveLength(1);
      expect(stores.stories.getStory(bureau.id, story.id).archivedThrough).toBe(5);
    });
  });
});
