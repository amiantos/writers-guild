import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import bureausRouter from '../bureaus.js';
import { MAX_ROUTINE_CHARACTERS } from '../bureau-profiles.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { getBureauStores } from '../../services/bureau/stores.js';
import { closeBureauDb } from '../../services/bureau/bureau-db.js';

function card(name, fields = {}) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name, ...fields } };
}

function parseEvents(text) {
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)));
}

/** A fake DeepSeek client: each question streams the next of `questions`; write-ups return `profile`. */
function fakeClient() {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    questions: ['Who taught Mara the light?', 'What does she do on Fridays?', 'Why the harbor?'],
    profile: {
      description: 'Keeps the light her father kept.',
      personality: 'Dry.',
      routine: 'Keeps the light from dusk to dawn.',
      changes: 'Adds her father.',
      relationships: [{ name: 'Ines', addition: 'Ines saves Mara a stool on Fridays.' }],
    },
    async *chatStream(options) {
      client.calls.push(options);
      yield { type: 'content', text: client.questions.shift() ?? 'Anything else?' };
      yield { type: 'done', finishReason: 'stop', usage: null, model: 'deepseek-flash' };
    },
    async chat(options) {
      client.calls.push(options);
      return {
        content: '',
        reasoning: '',
        finishReason: 'tool_calls',
        model: 'deepseek-flash',
        usage: null,
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'write_profile', arguments: JSON.stringify(client.profile) },
          },
        ],
      };
    },
  };
  return client;
}

describe('Bureau profile routes', () => {
  let app;
  let tempDir;
  let stores;
  let client;
  let bureau;
  let mara;
  let ines;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-profiles-'));
    stores = getBureauStores(tempDir);
  });

  afterAll(() => {
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    stores.bureaus.db.exec('DELETE FROM bureaus');
    bureau = stores.bureaus.createBureau({ name: 'Harbor', apiKey: 'sk-profile-routes' });
    mara = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Mara', { description: 'Keeps the light.', personality: 'Dry.' }),
      libraryCharacterId: 'c1',
    });
    ines = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Ines', { description: 'Runs the pub.' }),
    });

    client = fakeClient();
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.locals.createBureauClient = () => client;
    app.use('/api/bureaus', bureausRouter);
    app.use(errorHandler);
  });

  const profileUrl = (castId = mara.id) => `/api/bureaus/${bureau.id}/cast/${castId}/profile`;
  const interviewUrl = (castId = mara.id) => `/api/bureaus/${bureau.id}/cast/${castId}/interview`;

  describe('profiles', () => {
    it('shows a profile, changes it by hand, and restores an earlier version', async () => {
      const { body: shown } = await request(app).get(profileUrl()).expect(200);
      expect(shown.castMember).toMatchObject({ id: mara.id, name: 'Mara' });
      expect(shown.castMember).not.toHaveProperty('seedCard');
      expect(shown.profile).toMatchObject({ description: 'Keeps the light.', routine: '' });
      expect(shown.versions).toEqual([]);

      const { body: edited } = await request(app)
        .put(profileUrl())
        .send({ routine: '  Nights at the light.  ', personality: 'Dry, kind.' })
        .expect(200);
      expect(edited.profile).toMatchObject({
        routine: 'Nights at the light.',
        personality: 'Dry, kind.',
      });
      expect(edited.versions.map((version) => version.source)).toEqual(['original', 'manual']);
      expect(stores.bureaus.getCastMember(bureau.id, mara.id).routine).toEqual({
        text: 'Nights at the light.',
      });

      const { body: restored } = await request(app)
        .post(`${profileUrl()}/versions/${edited.versions[0].id}/restore`)
        .expect(200);
      expect(restored.profile).toMatchObject({ routine: '', personality: 'Dry.' });
      expect(restored.versions.map((version) => version.source)).toEqual([
        'original',
        'manual',
        'restore',
      ]);
    });

    it('validates changes and versions', async () => {
      await request(app).put(profileUrl()).send({}).expect(400);
      await request(app).put(profileUrl()).send({ routine: 42 }).expect(400);
      await request(app)
        .put(profileUrl())
        .send({ routine: 'x'.repeat(MAX_ROUTINE_CHARACTERS + 1) })
        .expect(400);
      await request(app).post(`${profileUrl()}/versions/999/restore`).expect(404);
      await request(app).post(`${profileUrl()}/versions/latest/restore`).expect(404);
      await request(app).get(profileUrl('nobody')).expect(404);
    });
  });

  describe('interviews', () => {
    it('starts an interview, answers questions, writes it up, and accepts it', async () => {
      const { body: before } = await request(app).get(interviewUrl()).expect(200);
      expect(before.interview).toBeNull();
      expect(before.castMember).not.toHaveProperty('seedCard');
      expect(before.focuses.map((focus) => focus.key)).toEqual([
        'flesh_out',
        'relationships',
        'routine',
      ]);

      const started = await request(app)
        .post(interviewUrl())
        .set('Accept', 'text/event-stream')
        .send({ focus: 'routine', note: ' Her nights ' })
        .expect(200);
      const startEvents = parseEvents(started.text);
      expect(startEvents.map((event) => event.type)).toEqual([
        'interview',
        'run',
        'content',
        'done',
      ]);
      expect(startEvents.at(-1).interview).toMatchObject({
        focus: 'routine',
        note: 'Her nights',
        messages: [
          expect.objectContaining({ source: 'generated', content: 'Who taught Mara the light?' }),
        ],
      });

      const answered = await request(app)
        .post(`${interviewUrl()}/answers`)
        .set('Accept', 'text/event-stream')
        .send({ text: 'Her father.' })
        .expect(200);
      const answerEvents = parseEvents(answered.text);
      expect(answerEvents[0].interview.messages.at(-1)).toMatchObject({
        source: 'user',
        content: 'Her father.',
      });
      expect(answerEvents.at(-1).interview.messages.map((message) => message.content)).toEqual([
        'Who taught Mara the light?',
        'Her father.',
        'What does she do on Fridays?',
      ]);

      const { body: again } = await request(app).post(`${interviewUrl()}/ask-again`).expect(201);
      expect(again.interview.messages.map((message) => message.content)).toEqual([
        'Who taught Mara the light?',
        'Her father.',
        'Why the harbor?',
      ]);

      const { body: written } = await request(app).post(`${interviewUrl()}/write-up`).expect(200);
      expect(written.interview.proposal).toMatchObject({
        routine: 'Keeps the light from dusk to dawn.',
        relationships: [
          { castId: ines.id, name: 'Ines', addition: 'Ines saves Mara a stool on Fridays.' },
        ],
      });

      const { body: accepted } = await request(app)
        .post(`${interviewUrl()}/accept`)
        .send({
          description: 'Keeps the light her father kept.',
          personality: 'Dry.',
          routine: 'Nights.',
          relationships: [{ castId: ines.id, addition: 'Ines saves Mara a stool on Fridays.' }],
        })
        .expect(200);
      expect(accepted.castMember).not.toHaveProperty('seedCard');
      expect(accepted.interview.status).toBe('accepted');
      expect(accepted.updated.map((member) => member.name)).toEqual(['Ines']);

      const { body: profile } = await request(app).get(profileUrl()).expect(200);
      expect(profile.profile).toMatchObject({
        description: 'Keeps the light her father kept.',
        routine: 'Nights.',
      });
      expect(stores.bureaus.getCastMember(bureau.id, ines.id).seedCard.data.description).toBe(
        'Runs the pub.\n\nInes saves Mara a stool on Fridays.',
      );
      const { body: after } = await request(app).get(interviewUrl()).expect(200);
      expect(after.interview).toBeNull();
    });

    it('checks what each step needs', async () => {
      await request(app).post(`${interviewUrl()}/answers`).send({ text: 'Hi' }).expect(404);
      await request(app).post(interviewUrl()).send({ focus: 'gossip' }).expect(400);
      await request(app).post(interviewUrl()).send({}).expect(201);
      await request(app).post(interviewUrl()).send({}).expect(409);
      await request(app).post(`${interviewUrl()}/answers`).send({ text: ' ' }).expect(400);
      await request(app).post(`${interviewUrl()}/write-up`).expect(400);
      await request(app).post(`${interviewUrl()}/accept`).send({}).expect(400);

      // An answer needs a question waiting for it.
      const { id } = stores.interviews.getOpenInterview(bureau.id, mara.id);
      stores.interviews.addMessage(bureau.id, id, { source: 'user', content: 'Her father.' });
      await request(app).post(`${interviewUrl()}/answers`).send({ text: 'Hi' }).expect(409);
    });

    it('holds a write-up accepted as it came to the same limits', async () => {
      client.profile = { ...client.profile, routine: 'x'.repeat(MAX_ROUTINE_CHARACTERS + 1) };
      await request(app).post(interviewUrl()).send({}).expect(201);
      await request(app)
        .post(`${interviewUrl()}/answers`)
        .send({ text: 'Her father.' })
        .expect(201);
      await request(app).post(`${interviewUrl()}/write-up`).expect(200);

      await request(app).post(`${interviewUrl()}/accept`).send({}).expect(400);
      const { body } = await request(app).get(profileUrl()).expect(200);
      expect(body.profile.routine).toBe('');
    });

    it("won't accept a write-up once the profile has changed", async () => {
      await request(app).post(interviewUrl()).send({}).expect(201);
      await request(app)
        .post(`${interviewUrl()}/answers`)
        .send({ text: 'Her father.' })
        .expect(201);
      await request(app).post(`${interviewUrl()}/write-up`).expect(200);
      await request(app).put(profileUrl()).send({ routine: 'Days.' }).expect(200);

      const { body } = await request(app).post(`${interviewUrl()}/accept`).send({}).expect(409);
      expect(body.error).toContain('changed');
    });

    it('discards an interview, and needs an API key to start one', async () => {
      await request(app).post(interviewUrl()).send({}).expect(201);
      await request(app).delete(interviewUrl()).expect(200);
      await request(app).delete(interviewUrl()).expect(404);

      stores.bureaus.updateBureau(bureau.id, { apiKey: '' });
      await request(app).post(interviewUrl()).send({}).expect(400);
    });
  });
});
