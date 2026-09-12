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

function card(name) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name } };
}

describe('Bureau memory routes', () => {
  let app;
  let tempDir;
  let stores;
  let bureau;
  let mara;
  let theo;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-memories-'));
    stores = getBureauStores(tempDir);
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.use('/api/bureaus', bureausRouter);
    app.use(errorHandler);
  });

  afterAll(() => {
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    stores.bureaus.db.exec('DELETE FROM bureaus');
    bureau = stores.bureaus.createBureau({ name: 'Harbor' });
    mara = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Mara'),
      libraryCharacterId: 'c1',
    });
    theo = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Theo'),
      libraryCharacterId: 'c2',
      isPersona: true,
    });
  });

  const castMemoriesUrl = (castId = mara.id) => `/api/bureaus/${bureau.id}/cast/${castId}/memories`;
  const memoryUrl = (memoryId) => `/api/bureaus/${bureau.id}/memories/${memoryId}`;

  function remember(content, fields = {}) {
    return stores.memories.addMemory(bureau.id, mara.id, {
      layer: 'knowledge',
      content,
      ...fields,
    });
  }

  it('lists current and retired memories, and searches them', async () => {
    const old = remember('Theo is afraid of deep water.');
    const replacement = remember('Theo swims to the buoy every morning.', { supersedes: old.id });

    const { body: current } = await request(app).get(castMemoriesUrl()).expect(200);
    expect(current.memories.map((memory) => memory.id)).toEqual([replacement.id]);

    const { body: retired } = await request(app)
      .get(castMemoriesUrl())
      .query({ status: 'retired' })
      .expect(200);
    expect(retired.memories.map((memory) => memory.id)).toEqual([old.id]);

    const { body: found } = await request(app)
      .get(castMemoriesUrl())
      .query({ q: 'swimming' })
      .expect(200);
    expect(found.memories.map((memory) => memory.id)).toEqual([replacement.id]);

    await request(app).get(castMemoriesUrl()).query({ status: 'lost' }).expect(400);
    await request(app).get(castMemoriesUrl('missing')).expect(404);
  });

  it("writes backstory for a character, but not for the reader's character", async () => {
    const { body } = await request(app)
      .post(castMemoriesUrl())
      .send({ content: ' Mara grew up on the island. ', importance: 4 })
      .expect(201);

    expect(body.memory).toMatchObject({
      castMemberId: mara.id,
      layer: 'knowledge',
      content: 'Mara grew up on the island.',
      importance: 4,
      sourceType: 'manual',
      worldTime: null,
    });

    await request(app).post(castMemoriesUrl(theo.id)).send({ content: 'Nope.' }).expect(400);
    await request(app).post(castMemoriesUrl()).send({ content: ' ' }).expect(400);
    await request(app).post(castMemoriesUrl()).send({ content: 'Hm.', importance: 7 }).expect(400);
  });

  it('edits, pins, retires, restores, and deletes memories', async () => {
    const memory = remember('Theo hates tea.', { sourceTurnIds: [] });

    const { body: edited } = await request(app)
      .put(memoryUrl(memory.id))
      .send({ content: 'Theo drinks tea.', pinned: true, importance: 5 })
      .expect(200);
    expect(edited.memory).toMatchObject({
      content: 'Theo drinks tea.',
      pinned: true,
      importance: 5,
    });

    await request(app).put(memoryUrl(memory.id)).send({ retired: true }).expect(200);
    const { body: retired } = await request(app)
      .get(castMemoriesUrl())
      .query({ status: 'retired' })
      .expect(200);
    expect(retired.memories.map((item) => item.id)).toEqual([memory.id]);
    const { body: restored } = await request(app)
      .put(memoryUrl(memory.id))
      .send({ retired: false })
      .expect(200);
    expect(restored.memory.retired).toBe(false);

    await request(app).put(memoryUrl(memory.id)).send({}).expect(400);
    await request(app).put(memoryUrl(memory.id)).send({ pinned: 'yes' }).expect(400);
    await request(app).put(memoryUrl(memory.id)).send({ content: '' }).expect(400);

    await request(app).delete(memoryUrl(memory.id)).expect(200);
    await request(app).delete(memoryUrl(memory.id)).expect(404);
    await request(app).put(memoryUrl('abc')).send({ pinned: true }).expect(404);
  });

  it('keeps memories inside their own Bureau', async () => {
    const memory = remember('Secret.');
    const other = stores.bureaus.createBureau({ name: 'Other' });

    await request(app)
      .put(`/api/bureaus/${other.id}/memories/${memory.id}`)
      .send({ pinned: true })
      .expect(404);
    await request(app).delete(`/api/bureaus/${other.id}/memories/${memory.id}`).expect(404);
    await request(app).get(`/api/bureaus/${other.id}/cast/${mara.id}/memories`).expect(404);
  });

  it('counts current memories and those needing review with the cast', async () => {
    remember('One.');
    const flagged = remember('Two.');
    stores.memories.updateMemory(bureau.id, flagged.id, { needsReview: true });

    const { body } = await request(app).get(`/api/bureaus/${bureau.id}/cast`).expect(200);

    expect(body.memoryCounts).toEqual({ [mara.id]: { current: 2, needsReview: 1 } });
  });
});
