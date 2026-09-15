import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import bureausRouter from '../bureaus.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { SqliteStorageService } from '../../services/sqliteStorage.js';
import { BureauStorage } from '../../services/bureau/bureau-storage.js';
import { getBureauStores } from '../../services/bureau/stores.js';
import { closeBureauDb } from '../../services/bureau/bureau-db.js';
import { RunRecorder } from '../../services/bureau/run-recorder.js';

const API_KEY = 'sk-route-test-key-5678';

describe('Bureau routes', () => {
  let app;
  let tempDir;
  let library;
  let bureaus;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-routes-'));
    library = new SqliteStorageService(tempDir);
    bureaus = new BureauStorage(tempDir);
  });

  afterAll(() => {
    closeBureauDb(tempDir);
    library.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Deleting Bureaus cascades to their cast and run records.
    bureaus.db.exec('DELETE FROM bureaus');
    bureaus.setSharedApiKey('');
    library.db.exec('DELETE FROM characters');

    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.use('/api/bureaus', bureausRouter);
    app.use(errorHandler);
  });

  async function createBureau(fields = {}) {
    const { body } = await request(app)
      .post('/api/bureaus')
      .send({ name: 'Harbor', apiKey: API_KEY, ...fields })
      .expect(201);
    return body.bureau;
  }

  async function seedCharacter(id, name) {
    await library.saveCharacter(
      id,
      {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name, description: `${name} from the library` },
      },
      null,
    );
  }

  describe('Bureaus', () => {
    it('creates a Bureau with a masked key and the default model', async () => {
      const bureau = await createBureau({ description: 'Seaside' });

      expect(bureau).toMatchObject({
        name: 'Harbor',
        description: 'Seaside',
        model: 'deepseek-flash',
        hasApiKey: true,
        apiKeyPreview: 'sk-…5678',
      });
    });

    it('never returns the API key', async () => {
      const bureau = await createBureau();

      const responses = [
        await request(app).get('/api/bureaus').expect(200),
        await request(app).get(`/api/bureaus/${bureau.id}`).expect(200),
        await request(app).put(`/api/bureaus/${bureau.id}`).send({ name: 'Renamed' }).expect(200),
      ];

      for (const response of responses) {
        expect(response.text).not.toContain(API_KEY);
      }
    });

    it('requires a name', async () => {
      const { body } = await request(app).post('/api/bureaus').send({ name: '   ' }).expect(400);

      expect(body.error).toBe('Name is required');
    });

    it('rejects a key that is not a string', async () => {
      await request(app).post('/api/bureaus').send({ name: 'Harbor', apiKey: 12345 }).expect(400);
    });

    it('lists Bureaus', async () => {
      await createBureau({ name: 'Harbor' });
      await createBureau({ name: 'Lighthouse' });

      const { body } = await request(app).get('/api/bureaus').expect(200);

      expect(body.bureaus.map((bureau) => bureau.name).toSorted()).toEqual([
        'Harbor',
        'Lighthouse',
      ]);
    });

    it('updates a Bureau and removes its key with an empty string', async () => {
      const bureau = await createBureau();

      const { body } = await request(app)
        .put(`/api/bureaus/${bureau.id}`)
        .send({ model: 'deepseek-v4-pro', apiKey: '' })
        .expect(200);

      expect(body.bureau).toMatchObject({
        name: 'Harbor',
        model: 'deepseek-v4-pro',
        hasApiKey: false,
      });
    });

    it('saves a shared key for Bureaus without their own, and never returns it', async () => {
      const sharedKey = 'sk-route-shared-key-4321';
      await createBureau();
      const borrowing = await createBureau({ name: 'Lighthouse', apiKey: '' });

      expect((await request(app).get('/api/bureaus/shared-key').expect(200)).body).toEqual({
        sharedKey: { hasApiKey: false, apiKeyPreview: '' },
      });
      const saved = await request(app)
        .put('/api/bureaus/shared-key')
        .send({ apiKey: `  ${sharedKey}  ` })
        .expect(200);
      expect(saved.body).toEqual({ sharedKey: { hasApiKey: true, apiKeyPreview: 'sk-…4321' } });

      const listed = await request(app).get('/api/bureaus').expect(200);
      const byName = Object.fromEntries(listed.body.bureaus.map((bureau) => [bureau.name, bureau]));
      expect(byName.Lighthouse).toMatchObject({ hasApiKey: true, apiKeySource: 'shared' });
      expect(byName.Harbor).toMatchObject({ apiKeySource: 'bureau', apiKeyPreview: 'sk-…5678' });
      const read = await request(app).get('/api/bureaus/shared-key').expect(200);
      for (const response of [saved, listed, read]) {
        expect(response.text).not.toContain(sharedKey);
      }

      await request(app).put('/api/bureaus/shared-key').send({ apiKey: '' }).expect(200);
      const { body } = await request(app).get(`/api/bureaus/${borrowing.id}`).expect(200);
      expect(body.bureau).toMatchObject({ hasApiKey: false, apiKeySource: null });
    });

    it('requires the shared key as a string', async () => {
      await request(app).put('/api/bureaus/shared-key').send({}).expect(400);
      await request(app).put('/api/bureaus/shared-key').send({ apiKey: 5 }).expect(400);
    });

    it('calls the model with the shared key for a Bureau without its own', async () => {
      const bureau = await createBureau({ apiKey: '' });
      bureaus.setSharedApiKey('sk-route-shared-key-4321');
      const credentials = [];
      app.locals.createBureauClient = (config) => {
        credentials.push(config);
        return {};
      };

      // Letting time pass commits finished messages to memory, which makes a client.
      await request(app).post(`/api/bureaus/${bureau.id}/time`).send({ step: 'hour' }).expect(200);

      expect(credentials).toEqual([
        { apiKey: 'sk-route-shared-key-4321', model: 'deepseek-flash' },
      ]);
    });

    it('rejects empty or missing updates', async () => {
      const bureau = await createBureau();

      await request(app).put(`/api/bureaus/${bureau.id}`).send({}).expect(400);
      await request(app).put(`/api/bureaus/${bureau.id}`).send({ name: '' }).expect(400);
      await request(app).put(`/api/bureaus/${bureau.id}`).send({ model: ' ' }).expect(400);
    });

    it('sets Bureau time to any year from 1 to 9999, earlier or later', async () => {
      const bureau = await createBureau();

      const { body } = await request(app)
        .put(`/api/bureaus/${bureau.id}`)
        .send({ bureauTime: '1350-06-01T20:00:00Z', presentOffsetDays: -365 })
        .expect(200);

      expect(body.bureau.bureauTime).toBe('1350-06-01T20:00:00.000Z');
      expect(body.bureau).not.toHaveProperty('presentOffsetDays');
      for (const bureauTime of [
        'soon',
        1350,
        null,
        '0000-06-01T00:00:00Z',
        '+010000-01-01T00:00:00Z',
      ]) {
        await request(app)
          .put(`/api/bureaus/${bureau.id}`)
          .send({ name: 'Renamed', bureauTime })
          .expect(400);
      }
      expect(bureaus.getBureau(bureau.id)).toMatchObject({
        name: 'Harbor',
        bureauTime: '1350-06-01T20:00:00.000Z',
      });
    });

    it('lets time pass by a step or to a later time, and only forward', async () => {
      const bureau = await createBureau();
      bureaus.updateBureau(bureau.id, { timezone: 'UTC', bureauTime: '2026-09-12T22:15:00.000Z' });
      const pass = (body) => request(app).post(`/api/bureaus/${bureau.id}/time`).send(body);

      expect((await pass({ step: 'hour' }).expect(200)).body.bureau.bureauTime).toBe(
        '2026-09-12T23:15:00.000Z',
      );
      expect((await pass({ step: 'morning' }).expect(200)).body.bureau.bureauTime).toBe(
        '2026-09-13T08:00:00.000Z',
      );
      expect((await pass({ to: '2026-09-20T12:00:00Z' }).expect(200)).body.bureau.bureauTime).toBe(
        '2026-09-20T12:00:00.000Z',
      );

      const { body } = await pass({ to: '2026-09-19T12:00:00Z' }).expect(400);
      expect(body.error).toMatch(/only moves forward/);
      for (const bad of [
        {},
        { step: 'fortnight' },
        { to: 'soon' },
        { step: 'hour', to: '2026-09-21T00:00:00Z' },
      ]) {
        await pass(bad).expect(400);
      }
      expect(bureaus.getBureau(bureau.id).bureauTime).toBe('2026-09-20T12:00:00.000Z');
      await request(app).post('/api/bureaus/missing/time').send({ step: 'hour' }).expect(404);
    });

    it('saves avatar windows, checking each one', async () => {
      const bureau = await createBureau();
      const url = `/api/bureaus/${bureau.id}/avatar-windows`;
      const win = { id: 'w1', castId: 'c1', x: -40, y: 100, width: 300, height: 400 };

      const { body } = await request(app)
        .put(url)
        .send({ avatarWindows: [{ ...win, characterId: 'stray' }] })
        .expect(200);
      expect(body.avatarWindows).toEqual([win]);
      const { body: fetched } = await request(app).get(`/api/bureaus/${bureau.id}`).expect(200);
      expect(fetched.bureau.avatarWindows).toEqual([win]);

      for (const bad of [
        'windows',
        [null],
        [{ ...win, castId: '' }],
        [{ ...win, x: '20' }],
        [{ ...win, width: 0 }],
        [{ ...win, height: 5001 }],
        [{ ...win, y: 10001 }],
        Array.from({ length: 21 }, (_, index) => ({ ...win, id: `w${index}` })),
      ]) {
        await request(app).put(url).send({ avatarWindows: bad }).expect(400);
      }
      expect(bureaus.getBureau(bureau.id).avatarWindows).toEqual([win]);
      await request(app)
        .put('/api/bureaus/missing/avatar-windows')
        .send({ avatarWindows: [] })
        .expect(404);
    });

    it('returns 404 for a Bureau that does not exist', async () => {
      await request(app).get('/api/bureaus/missing').expect(404);
      await request(app).put('/api/bureaus/missing').send({ name: 'Nope' }).expect(404);
      await request(app).delete('/api/bureaus/missing').expect(404);
    });

    it('deletes a Bureau', async () => {
      const bureau = await createBureau();

      await request(app).delete(`/api/bureaus/${bureau.id}`).expect(200);
      await request(app).get(`/api/bureaus/${bureau.id}`).expect(404);
    });
  });

  describe('cast', () => {
    it('adds a character as a copy without changing the library character', async () => {
      await seedCharacter('char-1', 'Mara');
      const before = await library.getCharacter('char-1');
      const bureau = await createBureau();

      const { body } = await request(app)
        .post(`/api/bureaus/${bureau.id}/cast`)
        .send({ characterId: 'char-1' })
        .expect(201);
      expect(body.castMember).toMatchObject({
        name: 'Mara',
        libraryCharacterId: 'char-1',
        isPersona: false,
      });

      const { body: detail } = await request(app)
        .get(`/api/bureaus/${bureau.id}/cast/${body.castMember.id}`)
        .expect(200);
      expect(detail.castMember.seedCard.data).toMatchObject({
        name: 'Mara',
        description: 'Mara from the library',
      });
      expect(await library.getCharacter('char-1')).toEqual(before);
    });

    it('adds a persona', async () => {
      await seedCharacter('char-2', 'Theo');
      const bureau = await createBureau();

      const { body } = await request(app)
        .post(`/api/bureaus/${bureau.id}/cast`)
        .send({ characterId: 'char-2', isPersona: true })
        .expect(201);

      expect(body.castMember.isPersona).toBe(true);
    });

    it('rejects a character already in the cast', async () => {
      await seedCharacter('char-1', 'Mara');
      const bureau = await createBureau();
      const { body: added } = await request(app)
        .post(`/api/bureaus/${bureau.id}/cast`)
        .send({ characterId: 'char-1' })
        .expect(201);

      const { body } = await request(app)
        .post(`/api/bureaus/${bureau.id}/cast`)
        .send({ characterId: 'char-1' })
        .expect(409);

      expect(body.castMemberId).toBe(added.castMember.id);
    });

    it('validates the request', async () => {
      const bureau = await createBureau();

      await request(app).post(`/api/bureaus/${bureau.id}/cast`).send({}).expect(400);
      await request(app)
        .post(`/api/bureaus/${bureau.id}/cast`)
        .send({ characterId: 'char-1', isPersona: 'yes' })
        .expect(400);
      await request(app)
        .post(`/api/bureaus/${bureau.id}/cast`)
        .send({ characterId: 'missing' })
        .expect(404);
      await request(app)
        .post('/api/bureaus/missing/cast')
        .send({ characterId: 'char-1' })
        .expect(404);
    });

    it('lists, updates, and removes cast members', async () => {
      await seedCharacter('char-1', 'Mara');
      const bureau = await createBureau();
      const { body: added } = await request(app)
        .post(`/api/bureaus/${bureau.id}/cast`)
        .send({ characterId: 'char-1' })
        .expect(201);
      const memberUrl = `/api/bureaus/${bureau.id}/cast/${added.castMember.id}`;

      const { body: list } = await request(app).get(`/api/bureaus/${bureau.id}/cast`).expect(200);
      expect(list.cast.map((member) => member.name)).toEqual(['Mara']);
      expect(list.cast[0]).not.toHaveProperty('seedCard');

      const { body: updated } = await request(app)
        .put(memberUrl)
        .send({ isPersona: true })
        .expect(200);
      expect(updated.castMember.isPersona).toBe(true);

      await request(app).put(memberUrl).send({}).expect(400);
      await request(app).put(memberUrl).send({ isPersona: 'yes' }).expect(400);
      // The routine changes through the profile (see bureau-profiles.test.js).
      await request(app).put(memberUrl).send({ routine: 'Nights at the light.' }).expect(400);

      await request(app).delete(memberUrl).expect(200);
      await request(app).get(memberUrl).expect(404);
      await request(app).delete(memberUrl).expect(404);
    });

    it('exports a cast member to the library as a new character', async () => {
      await seedCharacter('char-1', 'Mara');
      const bureau = await createBureau();
      const { body: added } = await request(app)
        .post(`/api/bureaus/${bureau.id}/cast`)
        .send({ characterId: 'char-1' })
        .expect(201);
      const castId = added.castMember.id;
      const before = await library.getCharacter('char-1');
      const { arcNotes } = getBureauStores(tempDir);
      arcNotes.addNote(bureau.id, castId, { content: 'Mara lets Theo steer.', status: 'accepted' });
      arcNotes.addNote(bureau.id, castId, { content: 'Still waiting.', status: 'proposed' });

      const { body } = await request(app)
        .post(`/api/bureaus/${bureau.id}/cast/${castId}/export`)
        .send({})
        .expect(201);

      expect(body).toMatchObject({ name: 'Mara', arcNotes: 1 });
      expect(body.characterId).not.toBe('char-1');
      const exported = await library.getCharacter(body.characterId);
      expect(exported.data.description).toBe(
        'Mara from the library\n\nHow Mara has changed:\n- Mara lets Theo steer.',
      );
      expect(exported.data.tags).toContain('bureau');
      expect(await library.getCharacter('char-1')).toEqual(before);
      await request(app).post(`/api/bureaus/${bureau.id}/cast/missing/export`).send({}).expect(404);
    });

    it('adds a generated card as a draft, then saves it to the library', async () => {
      const bureau = await createBureau();
      const card = {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name: 'Ines Varga', description: 'Runs the harbor pub.' },
      };

      const { body: added } = await request(app)
        .post(`/api/bureaus/${bureau.id}/cast`)
        .send({ card })
        .expect(201);
      expect(added.castMember).toMatchObject({
        name: 'Ines Varga',
        isDraft: true,
        libraryCharacterId: null,
      });
      await request(app)
        .post(`/api/bureaus/${bureau.id}/cast`)
        .send({ card: { data: {} } })
        .expect(400);

      const promoteUrl = `/api/bureaus/${bureau.id}/cast/${added.castMember.id}/promote`;
      const { body: promoted } = await request(app).post(promoteUrl).send({}).expect(201);
      expect(promoted.castMember).toMatchObject({
        isDraft: false,
        libraryCharacterId: promoted.characterId,
      });
      expect((await library.getCharacter(promoted.characterId)).data.name).toBe('Ines Varga');
      await request(app).post(promoteUrl).send({}).expect(400);
    });

    it('saves a draft to the library once when asked twice at the same time', async () => {
      const bureau = await createBureau();
      const { body: added } = await request(app)
        .post(`/api/bureaus/${bureau.id}/cast`)
        .send({ card: { spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Ines' } } })
        .expect(201);
      const promoteUrl = `/api/bureaus/${bureau.id}/cast/${added.castMember.id}/promote`;
      // A slow library save keeps the first request in flight while the second arrives.
      const routeLibrary = getBureauStores(tempDir).library;
      const saveCharacter = routeLibrary.saveCharacter;
      routeLibrary.saveCharacter = async (...args) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return saveCharacter.apply(routeLibrary, args);
      };

      let responses;
      try {
        responses = await Promise.all([
          request(app).post(promoteUrl).send({}),
          request(app).post(promoteUrl).send({}),
        ]);
      } finally {
        routeLibrary.saveCharacter = saveCharacter;
      }

      expect(responses.map((response) => response.status).toSorted()).toEqual([201, 409]);
    });

    it('generates a character card without saving it', async () => {
      const bureau = await createBureau();
      const generated = {
        name: 'Ines Varga',
        description: 'Runs the harbor pub.',
        personality: 'Nosy.',
        scenario: '',
        first_message: 'Ines waved.',
        example_dialogue: '"Well?"',
        tags: ['pub'],
        appearance: {
          age_range: '',
          build: '',
          hair: '',
          eyes: '',
          clothing: '',
          distinguishing_marks: '',
        },
      };
      app.locals.createBureauClient = () => ({
        model: 'deepseek-flash',
        chat: async () => ({
          content: '',
          reasoning: '',
          finishReason: 'tool_calls',
          model: 'deepseek-flash',
          usage: null,
          toolCalls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'create_character', arguments: JSON.stringify(generated) },
            },
          ],
        }),
      });
      const generateUrl = `/api/bureaus/${bureau.id}/characters/generate`;

      const { body } = await request(app)
        .post(generateUrl)
        .send({ idea: 'A harbor pub owner' })
        .expect(200);

      expect(body.card.data).toMatchObject({ name: 'Ines Varga', first_mes: 'Ines waved.' });
      const { body: cast } = await request(app).get(`/api/bureaus/${bureau.id}/cast`).expect(200);
      expect(cast.cast).toEqual([]);
      await request(app).post(generateUrl).send({}).expect(400);
    });
  });

  describe('runs', () => {
    it('lists runs and returns one with its steps', async () => {
      const bureau = await createBureau();
      await RunRecorder.record(
        bureaus,
        { bureauId: bureau.id, purpose: 'smoke_test' },
        async (recorder) => {
          recorder.recordStep({
            role: 'director',
            kind: 'model',
            request: { messages: [] },
            response: { content: 'ok' },
          });
          recorder.recordStep({
            role: 'director',
            kind: 'tool',
            request: { name: 'recall' },
            response: '{}',
          });
        },
      );

      const { body: list } = await request(app).get(`/api/bureaus/${bureau.id}/runs`).expect(200);
      expect(list.runs).toHaveLength(1);
      expect(list.runs[0]).toMatchObject({
        purpose: 'smoke_test',
        status: 'completed',
        stepCount: 2,
      });

      const { body } = await request(app)
        .get(`/api/bureaus/${bureau.id}/runs/${list.runs[0].id}`)
        .expect(200);
      expect(body.run.steps.map((step) => step.kind)).toEqual(['model', 'tool']);
    });

    it('keeps runs inside their own Bureau', async () => {
      const bureau = await createBureau();
      const other = await createBureau({ name: 'Other' });
      const runId = bureaus.createRun({ bureauId: bureau.id, purpose: 'smoke_test' });

      await request(app).get(`/api/bureaus/${other.id}/runs/${runId}`).expect(404);
      const { body } = await request(app).get(`/api/bureaus/${other.id}/runs`).expect(200);
      expect(body.runs).toEqual([]);
    });
  });
});
