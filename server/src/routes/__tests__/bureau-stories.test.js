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
    archiveRecord: { knowledge: [], story_summary: 'Summary.' },
    offscreenRecord: { entries: [] },
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
            function:
              options.tools[0].name === 'record_offscreen'
                ? { name: 'record_offscreen', arguments: JSON.stringify(client.offscreenRecord) }
                : { name: 'record_memories', arguments: JSON.stringify(client.archiveRecord) },
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
    it('starts a story with the whole cast at Bureau time by default', async () => {
      stores.bureaus.setBureauTime(bureau.id, '1350-06-01T20:00:00.000Z');

      const { body } = await request(app)
        .post(storiesUrl())
        .send({ timeZone: 'America/Chicago' })
        .expect(201);

      expect(body.story).toMatchObject({
        title: 'Chapter 1',
        status: 'active',
        castIds: [mara.id, theo.id],
      });
      expect(body.story.startTime).toBe('1350-06-01T20:00:00.000Z');
      expect(body.bureau).toMatchObject({
        bureauTime: '1350-06-01T20:00:00.000Z',
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

    it("commits the reader's character's threads with anyone before a chapter starts", async () => {
      const ines = stores.bureaus.addCastMember(bureau.id, {
        seedCard: card('Ines'),
        libraryCharacterId: 'c3',
      });
      const thread = stores.threads.getOrCreateThread(bureau.id, ines.id);
      const message = stores.threads.addMessage(thread.id, {
        source: 'user',
        senderCastId: theo.id,
        content: "I'm leaving the island.",
        bureauTime: '2026-09-01T20:00:00.000Z',
      });
      stores.bureaus.setBureauTime(bureau.id, '2026-09-01T20:00:00.000Z');

      await request(app)
        .post(storiesUrl())
        .send({
          castIds: [mara.id, theo.id],
          start: { choice: 'custom', customTime: '2026-09-08T20:00:00.000Z' },
        })
        .expect(201);

      expect(stores.threads.getThread(bureau.id, thread.id).archivedThrough).toBe(message.position);
    });

    it('commits messages and gives the cast offscreen life before a story starts', async () => {
      const thread = stores.threads.getOrCreateThread(bureau.id, mara.id);
      const message = stores.threads.addMessage(thread.id, {
        source: 'user',
        senderCastId: theo.id,
        content: 'See you at the light next week.',
        bureauTime: '2026-09-01T20:00:00.000Z',
      });
      stores.bureaus.setBureauTime(bureau.id, '2026-09-01T20:00:00.000Z');
      client.archiveRecord = {
        knowledge: [
          {
            character: 'Mara',
            content: 'Theo said he would visit the light next week.',
            importance: 3,
            supersedes: 0,
            passages: [message.position],
          },
        ],
        arc_notes: [],
        story_summary: '',
      };
      client.offscreenRecord = {
        entries: [{ character: 'Mara', content: 'Scraped the rust off the railings.' }],
      };

      const { body } = await request(app)
        .post(storiesUrl())
        .send({ start: { choice: 'custom', customTime: '2026-09-08T20:00:00.000Z' } })
        .expect(201);

      expect(body).toMatchObject({ archiveError: null, offscreenError: null });
      expect(stores.threads.getThread(bureau.id, thread.id).archivedThrough).toBe(message.position);
      expect(
        stores.memories
          .listMemories(bureau.id, mara.id, { layer: 'knowledge' })
          .map((memory) => memory.content),
      ).toEqual(['Theo said he would visit the light next week.']);
      expect(stores.memories.listMemories(bureau.id, mara.id, { layer: 'offscreen' })).toEqual([
        expect.objectContaining({
          content: 'Scraped the rust off the railings.',
          worldTime: '2026-09-08T19:59:59.999Z',
        }),
      ]);
      expect(client.archiveCalls.map((call) => call.tools[0].name)).toEqual([
        'record_memories',
        'record_offscreen',
      ]);
    });

    it('commits the other threads when one fails before a story starts', async () => {
      const ines = stores.bureaus.addCastMember(bureau.id, {
        seedCard: card('Ines'),
        libraryCharacterId: 'c3',
      });
      for (const member of [mara, ines]) {
        const thread = stores.threads.getOrCreateThread(bureau.id, member.id);
        stores.threads.addMessage(thread.id, {
          source: 'user',
          senderCastId: theo.id,
          content: 'Hello?',
          bureauTime: '2026-09-01T20:00:00.000Z',
        });
      }
      const answer = client.chat;
      let calls = 0;
      client.chat = async (options) => {
        calls += 1;
        if (calls === 1) throw new DeepSeekError('DeepSeek API error 502: Bad gateway');
        return answer(options);
      };

      const { body } = await request(app)
        .post(storiesUrl())
        .send({ castIds: [mara.id, ines.id, theo.id] })
        .expect(201);

      expect(body.archiveError).toBe('Mara: DeepSeek API error 502: Bad gateway');
      expect(stores.threads.getThreadForCast(bureau.id, ines.id).archivedThrough).toBe(0);
    });

    it('starts in another century and moves the clock there, but not past the year 9999', async () => {
      const story = await startStory({
        start: { choice: 'custom', customTime: '1350-06-01T20:00:00Z' },
      });

      expect(story.startTime).toBe('1350-06-01T20:00:00.000Z');
      expect(stores.bureaus.getBureau(bureau.id).bureauTime).toBe('1350-06-01T20:00:00.000Z');
      await request(app)
        .post(storiesUrl())
        .send({ start: { choice: 'custom', customTime: '+010000-01-01T00:00:00Z' } })
        .expect(400);
    });

    it('rejects an unknown time choice or cast member', async () => {
      await request(app)
        .post(storiesUrl())
        .send({ start: { choice: 'someday' } })
        .expect(400);
      await request(app)
        .post(storiesUrl())
        .send({ start: { choice: 'present' } })
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

      const { body: withScenario } = await request(app)
        .put(`${storiesUrl()}/${story.id}`)
        .send({ scenario: '  A storm cuts the power.  ' })
        .expect(200);
      expect(withScenario.story).toMatchObject({
        title: 'Lamplight',
        scenario: 'A storm cuts the power.',
      });
      await request(app).put(`${storiesUrl()}/${story.id}`).send({ scenario: 5 }).expect(400);

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

    it("lists greetings from the chapter's cast and opens the chapter with one", async () => {
      const june = stores.bureaus.addCastMember(bureau.id, {
        seedCard: {
          spec: 'chara_card_v2',
          spec_version: '2.0',
          data: {
            name: 'June',
            first_mes: 'June looks up at {{user}}.',
            alternate_greetings: ['![June](/api/assets/characters/c3/june.webp)\n\nJune waves.'],
          },
        },
        libraryCharacterId: 'c3',
      });
      const story = await startStory({ castIds: [june.id, mara.id, theo.id] });
      const url = `${storiesUrl()}/${story.id}/greetings`;

      const { body } = await request(app).get(url).expect(200);
      expect(body.greetings).toEqual([
        {
          castId: june.id,
          name: 'June',
          index: 0,
          label: 'First message',
          content: 'June looks up at Theo.',
        },
        {
          castId: june.id,
          name: 'June',
          index: 1,
          label: 'Alternate greeting 1',
          content: '![June](/api/assets/characters/c3/june.webp)\n\nJune waves.',
        },
      ]);

      // Kept as written, a greeting is prose from the reader, credited to no one.
      const { body: added } = await request(app)
        .post(url)
        .send({ content: body.greetings[1].content })
        .expect(201);
      expect(added.turn).toMatchObject({
        kind: 'prose',
        source: 'user',
        authorCastId: null,
        content: body.greetings[1].content,
      });

      await request(app).post(url).send({ content: ' ' }).expect(400);
      await request(app).post(`${storiesUrl()}/${story.id}/end`).send({}).expect(200);
      await request(app).post(url).send({ content: 'Hi.' }).expect(409);
    });

    it('lets time pass in a chapter, moving the Bureau clock forward with it', async () => {
      stores.bureaus.updateBureau(bureau.id, { timezone: 'UTC' });
      const story = await startStory({
        start: { choice: 'custom', customTime: '2026-10-27T22:15:00Z' },
      });
      const turnsUrl = `${storiesUrl()}/${story.id}/turns`;
      const clock = () => stores.bureaus.getBureau(bureau.id).bureauTime;

      const { body: morning } = await request(app)
        .post(turnsUrl)
        .send({ kind: 'time_passes', step: 'morning' })
        .expect(201);
      expect(morning.turn).toMatchObject({
        kind: 'time_passes',
        source: 'user',
        content: '',
        bureauTime: '2026-10-28T08:00:00.000Z',
      });
      expect(morning.bureau.bureauTime).toBe('2026-10-28T08:00:00.000Z');

      // Time passes from the chapter's time, even when Bureau time has moved on elsewhere since,
      // and then Bureau time stays where it is instead of going back.
      stores.bureaus.setBureauTime(bureau.id, '2026-12-01T00:00:00.000Z');
      const { body: picked } = await request(app)
        .post(turnsUrl)
        .send({ kind: 'time_passes', to: '2026-10-28T09:30:00Z' })
        .expect(201);
      expect(picked.turn.bureauTime).toBe('2026-10-28T09:30:00.000Z');
      expect(picked.bureau.bureauTime).toBe('2026-12-01T00:00:00.000Z');
      expect(clock()).toBe('2026-12-01T00:00:00.000Z');

      const { body: notLater } = await request(app)
        .post(turnsUrl)
        .send({ kind: 'time_passes', to: '2026-10-28T09:30:00Z' })
        .expect(400);
      expect(notLater.error).toMatch(/later than the chapter's time/);
      await request(app)
        .post(turnsUrl)
        .send({ kind: 'time_passes', step: 'fortnight' })
        .expect(400);
      await request(app).post(turnsUrl).send({ kind: 'time_passes' }).expect(400);

      const { body: edit } = await request(app)
        .put(`${turnsUrl}/${picked.turn.id}`)
        .send({ content: 'Later.' })
        .expect(400);
      expect(edit.error).toMatch(/can't be edited/);

      // Deleting it leaves the clock where it is.
      await request(app).delete(`${turnsUrl}/${picked.turn.id}`).expect(200);
      expect(clock()).toBe('2026-12-01T00:00:00.000Z');
      const { body: detail } = await request(app).get(`${storiesUrl()}/${story.id}`).expect(200);
      expect(detail.turns.map((turn) => turn.bureauTime)).toEqual(['2026-10-28T08:00:00.000Z']);
    });
  });

  describe('generation', () => {
    it("adds the reader's prose, then the Writer's reply", async () => {
      const story = await startStory();

      const { body } = await request(app)
        .post(`${storiesUrl()}/${story.id}/generate`)
        .send({ action: 'write', text: 'Theo knocked.' })
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
        authorCastId: null,
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
        'these instructions for what events they would like to see occur: She suggests the night market',
      );
    });

    it('continues for a character in the chapter, and again for another version', async () => {
      const story = await startStory();
      const url = `${storiesUrl()}/${story.id}/generate`;
      await request(app).post(url).send({ action: 'write', text: 'Theo knocked.' }).expect(201);

      await request(app).post(url).send({ action: 'character' }).expect(400);
      await request(app)
        .post(url)
        .send({ action: 'character', castId: 'someone-else' })
        .expect(400);
      client = fakeClient('Mara opened the door.');
      const { body } = await request(app)
        .post(url)
        .send({ action: 'character', castId: mara.id })
        .expect(201);

      expect(body.userTurn).toBeNull();
      expect(body.turn).toMatchObject({ source: 'generated', content: 'Mara opened the door.' });
      expect(client.calls[0].messages[1].content).toContain(
        "Write the next part of the story from Mara's perspective.",
      );

      client = fakeClient('Mara let him in.');
      await request(app)
        .post(`${storiesUrl()}/${story.id}/turns/${body.turn.id}/regenerate`)
        .send({})
        .expect(200);
      expect(client.calls[0].messages[1].content).toContain(
        "Write the next part of the story from Mara's perspective.",
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

    it('rewrites a greeting as the opening, and rewrites it again for another version', async () => {
      const story = await startStory();
      const url = `${storiesUrl()}/${story.id}/generate`;

      await request(app).post(url).send({ action: 'greeting', text: 'Mara waves.' }).expect(400);
      await request(app)
        .post(url)
        .send({ action: 'greeting', castId: 'someone-else', text: 'Mara waves.' })
        .expect(400);
      const { body } = await request(app)
        .post(url)
        .send({ action: 'greeting', castId: mara.id, text: 'Mara looks up as you come in.' })
        .expect(201);

      expect(body.userTurn).toBeNull();
      expect(body.turn).toMatchObject({
        kind: 'prose',
        source: 'generated',
        content: 'The lamp was lit.',
        authorCastId: null,
      });
      expect(client.calls[0].messages[1].content).toMatch(
        /^Rewrite the following text to be in third person narrative perspective/,
      );

      client = fakeClient('The lamp guttered out.');
      await request(app)
        .post(`${storiesUrl()}/${story.id}/turns/${body.turn.id}/regenerate`)
        .send({})
        .expect(200);
      expect(client.calls[0].messages[1].content).toContain(
        'Text to rewrite:\n\nMara looks up as you come in.',
      );
    });

    it('validates generation requests', async () => {
      const story = await startStory({ castIds: [theo.id] });
      const url = `${storiesUrl()}/${story.id}/generate`;

      await request(app).post(url).send({ action: 'sing' }).expect(400);
      await request(app).post(url).send({ action: 'write' }).expect(400);

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
      expect(client.calls[0].messages[1].content).toMatch(
        /Theo knocked\.\n\n---\n\nContinue the story naturally/,
      );

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

      expect(body.archive).toMatchObject({ passes: 1, added: 1 });
      expect(body.story).toMatchObject({ archivedThrough: 0, summary: 'Theo confesses.' });
      expect((await maraMemories()).map((memory) => memory.content)).toEqual(["Theo can't swim."]);

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

      expect((await maraMemories()).map((memory) => [memory.layer, memory.needsReview])).toEqual([
        ['knowledge', true],
      ]);
      const { body } = await request(app).get(`/api/bureaus/${bureau.id}/cast`).expect(200);
      expect(body.memoryCounts[mara.id]).toEqual({ current: 1, needsReview: 1 });
    });

    it("marks the chapter's summary for review when a passage it covers changes", async () => {
      const story = await storyWithConfession();
      await request(app).post(`${storiesUrl()}/${story.id}/archive`).send({}).expect(200);
      const url = `${storiesUrl()}/${story.id}`;
      const summaryState = async () => {
        const { body } = await request(app).get(url).expect(200);
        return [body.story.summary, body.story.summaryNeedsReview];
      };
      expect(await summaryState()).toEqual(['Theo confesses.', false]);

      // A passage added after the summary isn't covered by it.
      const { body: added } = await request(app)
        .post(`${url}/turns`)
        .send({ kind: 'prose', content: 'Mara laughed.' })
        .expect(201);
      await request(app).delete(`${url}/turns/${added.turn.id}`).expect(200);
      expect(await summaryState()).toEqual(['Theo confesses.', false]);

      const [turn] = stores.stories.listTurns(story.id);
      await request(app).delete(`${url}/turns/${turn.id}`).expect(200);
      expect(await summaryState()).toEqual(['Theo confesses.', true]);

      const { body: saved } = await request(app)
        .put(url)
        .send({ summary: ' Nothing happened yet. ' })
        .expect(200);
      expect(saved.story).toMatchObject({
        summary: 'Nothing happened yet.',
        summaryNeedsReview: false,
      });
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
