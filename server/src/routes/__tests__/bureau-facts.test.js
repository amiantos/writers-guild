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

const START = '2026-10-27T07:30:00.000Z';

describe('Bureau fact routes', () => {
  let app;
  let tempDir;
  let stores;
  let bureau;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-facts-'));
    stores = getBureauStores(tempDir);
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.locals.bureauAutoArchive = false;
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
  });

  const factsUrl = () => `/api/bureaus/${bureau.id}/facts`;
  const factUrl = (factId) => `${factsUrl()}/${factId}`;

  function chapter() {
    return stores.stories.createStory(bureau.id, {
      startTime: START,
      castIds: [],
      title: 'Moving day',
    });
  }

  it('adds a fact as written, and lists facts with or without a status', async () => {
    const { body: added } = await request(app)
      .post(factsUrl())
      .send({ content: '  Mara and Theo live above the bakery. ' })
      .expect(201);
    expect(added.fact).toMatchObject({
      content: 'Mara and Theo live above the bakery.',
      status: 'accepted',
      sourceType: 'manual',
    });
    stores.facts.addFact(bureau.id, { content: 'Theo works nights.', rationale: 'He said so.' });

    const { body: all } = await request(app).get(factsUrl()).expect(200);
    expect(all.facts.map((fact) => fact.status)).toEqual(['accepted', 'proposed']);
    const { body: waiting } = await request(app).get(`${factsUrl()}?status=proposed`).expect(200);
    expect(waiting.facts.map((fact) => fact.content)).toEqual(['Theo works nights.']);

    await request(app).get(`${factsUrl()}?status=maybe`).expect(400);
    await request(app).post(factsUrl()).send({ content: '   ' }).expect(400);
    await request(app).get('/api/bureaus/nowhere/facts').expect(404);
  });

  it('accepts with edits, rejects, marks reviewed, and deletes', async () => {
    const shift = stores.facts.addFact(bureau.id, { content: 'Theo works nights.' });

    const { body: accepted } = await request(app)
      .put(factUrl(shift.id))
      .send({ content: 'Theo works days.', status: 'accepted' })
      .expect(200);
    expect(accepted.fact).toMatchObject({
      content: 'Theo works days.',
      proposedContent: 'Theo works nights.',
      status: 'accepted',
    });
    const { body: rejected } = await request(app)
      .put(factUrl(shift.id))
      .send({ status: 'rejected' })
      .expect(200);
    expect(rejected.fact.status).toBe('rejected');
    const { body: reviewed } = await request(app)
      .put(factUrl(shift.id))
      .send({ needsReview: false })
      .expect(200);
    expect(reviewed.fact.needsReview).toBe(false);

    await request(app).put(factUrl(shift.id)).send({}).expect(400);
    await request(app).put(factUrl(shift.id)).send({ content: '' }).expect(400);
    await request(app).put(factUrl(shift.id)).send({ status: 'maybe' }).expect(400);
    await request(app).put(factUrl(shift.id)).send({ needsReview: 'no' }).expect(400);
    await request(app).put(factUrl(999)).send({ status: 'accepted' }).expect(404);
    await request(app).put(factUrl('first')).send({ status: 'accepted' }).expect(404);

    await request(app).delete(factUrl(shift.id)).expect(200);
    await request(app).delete(factUrl(shift.id)).expect(404);
  });

  it('keeps facts inside their own Bureau', async () => {
    const elsewhere = stores.bureaus.createBureau({ name: 'Elsewhere' });
    const theirs = stores.facts.addFact(elsewhere.id, {
      content: 'Ines runs the pub.',
      status: 'accepted',
    });

    await request(app).put(factUrl(theirs.id)).send({ status: 'rejected' }).expect(404);
    await request(app).delete(factUrl(theirs.id)).expect(404);
    expect(stores.facts.getFact(elsewhere.id, theirs.id).status).toBe('accepted');
  });

  it("deletes a chapter's facts with it, and the facts they replaced stand again", async () => {
    const home = stores.facts.addFact(bureau.id, {
      content: 'Mara lives above the bakery.',
      status: 'accepted',
    });
    const story = chapter();
    stores.facts.addFact(bureau.id, {
      content: 'Mara lives by the harbor.',
      status: 'accepted',
      replaces: home.id,
      sourceType: 'story',
      sourceId: story.id,
      worldTime: START,
    });
    expect(stores.facts.getFact(bureau.id, home.id).replacedBy).not.toBeNull();

    await request(app).delete(`/api/bureaus/${bureau.id}/stories/${story.id}`).expect(200);

    expect(stores.facts.listFacts(bureau.id).map((fact) => fact.content)).toEqual([
      'Mara lives above the bakery.',
    ]);
    expect(stores.facts.getFact(bureau.id, home.id).replacedBy).toBeNull();
  });

  it('marks facts citing an edited turn or message for review', async () => {
    const story = chapter();
    const turn = stores.stories.addTurn(story.id, {
      kind: 'prose',
      source: 'generated',
      content: 'They moved.',
    });
    const fromChapter = stores.facts.addFact(bureau.id, {
      content: 'They moved.',
      status: 'accepted',
      sourceType: 'story',
      sourceId: story.id,
      worldTime: START,
      sourceTurnIds: [turn.id],
    });
    const mara = stores.bureaus.addCastMember(bureau.id, {
      seedCard: { spec: 'chara_card_v2', spec_version: '2.0', data: { name: 'Mara' } },
      libraryCharacterId: 'c1',
    });
    const thread = stores.threads.getOrCreateThread(bureau.id, mara.id);
    const message = stores.threads.addMessage(thread.id, {
      source: 'generated',
      senderCastId: mara.id,
      content: 'We signed the lease.',
      bureauTime: START,
    });
    const fromMessages = stores.facts.addFact(bureau.id, {
      content: 'They signed a lease.',
      status: 'accepted',
      sourceType: 'correspondence',
      sourceId: thread.id,
      worldTime: START,
      sourceTurnIds: [message.id],
    });

    await request(app)
      .put(`/api/bureaus/${bureau.id}/stories/${story.id}/turns/${turn.id}`)
      .send({ content: 'They stayed.' })
      .expect(200);
    await request(app)
      .delete(`/api/bureaus/${bureau.id}/threads/${mara.id}/messages/${message.id}`)
      .expect(200);

    expect(stores.facts.getFact(bureau.id, fromChapter.id).needsReview).toBe(true);
    expect(stores.facts.getFact(bureau.id, fromMessages.id).needsReview).toBe(true);
  });

  it('keeps the facts the reader wrote through a reset, and deletes the proposed ones', async () => {
    stores.facts.addFact(bureau.id, {
      content: 'Mara and Theo live above the bakery.',
      status: 'accepted',
    });
    const story = chapter();
    stores.facts.addFact(bureau.id, {
      content: 'From the chapter.',
      sourceType: 'story',
      sourceId: story.id,
      worldTime: START,
    });

    await request(app).post(`/api/bureaus/${bureau.id}/reset`).expect(200);

    expect(stores.facts.listFacts(bureau.id).map((fact) => fact.content)).toEqual([
      'Mara and Theo live above the bakery.',
    ]);
  });
});
