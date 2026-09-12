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

    it('rejects empty or missing updates', async () => {
      const bureau = await createBureau();

      await request(app).put(`/api/bureaus/${bureau.id}`).send({}).expect(400);
      await request(app).put(`/api/bureaus/${bureau.id}`).send({ name: '' }).expect(400);
      await request(app).put(`/api/bureaus/${bureau.id}`).send({ model: ' ' }).expect(400);
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
