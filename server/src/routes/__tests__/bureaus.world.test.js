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
import { DEFAULT_SETTINGS } from '../../services/bureau/bureau-settings.js';

describe('Bureau settings and world routes', () => {
  let app;
  let tempDir;
  let stores;
  let bureau;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-world-routes-'));
    stores = getBureauStores(tempDir);
  });

  afterAll(() => {
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    stores.bureaus.db.exec('DELETE FROM bureaus');
    stores.library.db.exec('DELETE FROM characters; DELETE FROM lorebooks');
    bureau = stores.bureaus.createBureau({ name: 'Harbor' });

    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.use('/api/bureaus', bureausRouter);
    app.use(errorHandler);
  });

  const bureauUrl = () => `/api/bureaus/${bureau.id}`;

  describe('settings and time zone', () => {
    it('updates writer settings and the time zone', async () => {
      const { body } = await request(app)
        .put(bureauUrl())
        .send({ timezone: 'Europe/Lisbon', settings: { writer: { thinking: true } } })
        .expect(200);

      expect(body.bureau.timezone).toBe('Europe/Lisbon');
      expect(body.bureau.settings.writer).toEqual({ ...DEFAULT_SETTINGS.writer, thinking: true });
    });

    it('rejects an unknown time zone', async () => {
      await request(app).put(bureauUrl()).send({ timezone: 'Atlantis/Central' }).expect(400);
    });

    it('rejects invalid settings without saving the rest of the update', async () => {
      const { body } = await request(app)
        .put(bureauUrl())
        .send({ name: 'Renamed', settings: { writer: { temperature: 9 } } })
        .expect(400);

      expect(body.error).toMatch(/writer.temperature/);
      expect(stores.bureaus.getBureau(bureau.id).name).toBe('Harbor');
    });
  });

  describe('lorebooks', () => {
    async function seedLorebook(id, name) {
      await stores.library.saveLorebook(id, { name, entries: [{ keys: ['k'], content: 'c' }] });
    }

    it('attaches, lists, and detaches library lorebooks', async () => {
      await seedLorebook('lb-1', 'Harbor Lore');

      const { body: attached } = await request(app)
        .post(`${bureauUrl()}/lorebooks`)
        .send({ lorebookId: 'lb-1' })
        .expect(201);
      expect(attached.lorebooks).toEqual([
        expect.objectContaining({ id: 'lb-1', name: 'Harbor Lore', missing: false }),
      ]);

      const { body: detached } = await request(app)
        .delete(`${bureauUrl()}/lorebooks/lb-1`)
        .expect(200);
      expect(detached.lorebooks).toEqual([]);
      await request(app).delete(`${bureauUrl()}/lorebooks/lb-1`).expect(404);
    });

    it('rejects lorebooks that are not in the library', async () => {
      await request(app).post(`${bureauUrl()}/lorebooks`).send({ lorebookId: 'nope' }).expect(404);
      await request(app).post(`${bureauUrl()}/lorebooks`).send({}).expect(400);
    });

    it('marks an attached lorebook that was deleted from the library as missing', async () => {
      await seedLorebook('lb-1', 'Harbor Lore');
      await request(app).post(`${bureauUrl()}/lorebooks`).send({ lorebookId: 'lb-1' }).expect(201);
      await stores.library.deleteLorebook('lb-1');

      const { body } = await request(app).get(`${bureauUrl()}/lorebooks`).expect(200);

      expect(body.lorebooks).toEqual([expect.objectContaining({ id: 'lb-1', missing: true })]);
    });

    it("attaches a new cast member's linked lorebook", async () => {
      await seedLorebook('lb-1', 'Harbor Lore');
      await stores.library.saveCharacter(
        'char-1',
        {
          spec: 'chara_card_v2',
          spec_version: '2.0',
          data: { name: 'Mara', extensions: { ursceal_lorebook_id: 'lb-1' } },
        },
        null,
      );

      const { body } = await request(app)
        .post(`${bureauUrl()}/cast`)
        .send({ characterId: 'char-1' })
        .expect(201);

      expect(body.attachedLorebookId).toBe('lb-1');
      expect(stores.bureaus.listLorebookIds(bureau.id)).toEqual(['lb-1']);
    });
  });
});
