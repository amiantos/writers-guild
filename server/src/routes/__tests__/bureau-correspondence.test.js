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

/** A fake DeepSeek client whose reply stream sends `text` as two content events. */
function fakeClient(text = 'Always.\n---\nStorm?', { failWith = null } = {}) {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    async *chatStream(options) {
      client.calls.push(options);
      if (failWith) throw failWith;
      const middle = Math.floor(text.length / 2);
      yield { type: 'content', text: text.slice(0, middle) };
      yield { type: 'content', text: text.slice(middle) };
      yield {
        type: 'done',
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

describe('Bureau correspondence routes', () => {
  let app;
  let tempDir;
  let stores;
  let client;
  let bureau;
  let mara;
  let theo;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-threads-'));
    stores = getBureauStores(tempDir);
  });

  afterAll(() => {
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    stores.bureaus.db.exec('DELETE FROM bureaus');
    bureau = stores.bureaus.createBureau({ name: 'Harbor', apiKey: 'sk-thread-routes' });
    mara = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Mara'),
      libraryCharacterId: 'c1',
    });
    theo = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Theo'),
      libraryCharacterId: 'c2',
      isPersona: true,
    });

    client = fakeClient();
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.locals.createBureauClient = () => client;
    app.use('/api/bureaus', bureausRouter);
    app.use(errorHandler);
  });

  const threadsUrl = () => `/api/bureaus/${bureau.id}/threads`;

  it('lists everyone the reader can write to', async () => {
    const { body } = await request(app).get(threadsUrl()).expect(200);

    expect(body.personaId).toBe(theo.id);
    expect(body.correspondents).toEqual([
      { castMember: expect.objectContaining({ id: mara.id, name: 'Mara' }), thread: null },
    ]);
  });

  it('sends a message at the present and streams the reply', async () => {
    const before = Date.now();

    const response = await request(app)
      .post(`${threadsUrl()}/${mara.id}/messages`)
      .set('Accept', 'text/event-stream')
      .send({ text: '  You up?  ' })
      .expect(200);

    const events = parseEvents(response.text);
    expect(events.map((event) => event.type)).toEqual([
      'message',
      'run',
      'content',
      'content',
      'done',
    ]);
    const done = events.at(-1);
    expect(done.message).toMatchObject({
      content: 'You up?',
      source: 'user',
      senderCastId: theo.id,
      position: 0,
    });
    expect(Date.parse(done.message.bureauTime)).toBeGreaterThanOrEqual(before - 1000);
    expect(done.replies.map((reply) => reply.content)).toEqual(['Always.', 'Storm?']);
    expect(done.bureau.bureauTime).toBe(done.replies[0].bureauTime);

    const { body } = await request(app).get(`${threadsUrl()}/${mara.id}`).expect(200);
    expect(body.castMember).toMatchObject({ id: mara.id, name: 'Mara' });
    expect(body.thread).toMatchObject({ castMemberId: mara.id, messageCount: 3 });
    expect(body.messages.map((message) => message.content)).toEqual([
      'You up?',
      'Always.',
      'Storm?',
    ]);
  });

  it("saves a message without a reply at the Bureau's present", async () => {
    stores.bureaus.updateBureau(bureau.id, { presentOffsetDays: -365 });

    const { body } = await request(app)
      .post(`${threadsUrl()}/${mara.id}/messages`)
      .send({ text: 'Night.', reply: false })
      .expect(201);

    expect(client.calls).toHaveLength(0);
    expect(Date.parse(body.message.bureauTime)).toBeLessThan(Date.now() - 364 * 86_400_000);
    expect(body.bureau.bureauTime).toBe(body.message.bureauTime);
  });

  it('answers with JSON when not streaming, and writes without a new message', async () => {
    const { body } = await request(app)
      .post(`${threadsUrl()}/${mara.id}/reply`)
      .send({})
      .expect(201);

    expect(body.message).toBeNull();
    expect(body.replies.map((reply) => reply.content)).toEqual(['Always.', 'Storm?']);
    expect(client.calls[0].messages[1].content).toContain(
      'Write the first message Mara sends Theo.',
    );
  });

  it("needs a message, someone to write to, a reader's character, and a key to reply", async () => {
    const url = `${threadsUrl()}/${mara.id}/messages`;

    await request(app).post(url).send({ text: ' ' }).expect(400);
    await request(app)
      .post(url)
      .send({ text: 'x'.repeat(8001) })
      .expect(400);
    await request(app).post(`${threadsUrl()}/${theo.id}/messages`).send({ text: 'Hi' }).expect(400);
    await request(app).post(`${threadsUrl()}/missing/messages`).send({ text: 'Hi' }).expect(404);
    await request(app).get(`${threadsUrl()}/${theo.id}`).expect(400);

    stores.bureaus.updateBureau(bureau.id, { apiKey: '' });
    await request(app).post(url).send({ text: 'Hi' }).expect(400);
    await request(app).post(`${threadsUrl()}/${mara.id}/reply`).send({}).expect(400);
    await request(app).post(url).send({ text: 'Hi', reply: false }).expect(201);

    stores.bureaus.updateCastMember(bureau.id, theo.id, { isPersona: false });
    await request(app).post(url).send({ text: 'Hi', reply: false }).expect(400);
  });

  it('keeps the message when the reply fails', async () => {
    client = fakeClient('', {
      failWith: new DeepSeekError('DeepSeek API error 429 (rate limited): Slow down'),
    });

    const { body } = await request(app)
      .post(`${threadsUrl()}/${mara.id}/messages`)
      .send({ text: 'Hello?' })
      .expect(502);

    expect(body.error).toMatch(/rate limited/);
    const thread = stores.threads.getThreadForCast(bureau.id, mara.id);
    expect(stores.threads.listMessages(thread.id).map((message) => message.content)).toEqual([
      'Hello?',
    ]);
  });

  it('edits and deletes messages, marking memories that cite them', async () => {
    const { body: sent } = await request(app)
      .post(`${threadsUrl()}/${mara.id}/messages`)
      .send({ text: 'Storm tonight.', reply: false })
      .expect(201);
    const thread = stores.threads.getThreadForCast(bureau.id, mara.id);
    const memory = stores.memories.addMemory(bureau.id, mara.id, {
      layer: 'knowledge',
      content: 'Theo warned Mara about the storm.',
      sourceType: 'correspondence',
      sourceId: thread.id,
      sourceTurnIds: [sent.message.id],
    });
    const url = `${threadsUrl()}/${mara.id}/messages/${sent.message.id}`;

    const { body } = await request(app).put(url).send({ content: 'Storm tomorrow.' }).expect(200);
    expect(body.message).toMatchObject({ content: 'Storm tomorrow.', edited: true });
    expect(stores.memories.getMemory(bureau.id, memory.id).needsReview).toBe(true);

    await request(app).put(url).send({ content: '' }).expect(400);
    await request(app).delete(url).expect(200);
    await request(app).delete(url).expect(404);
    await request(app)
      .put(`${threadsUrl()}/${theo.id}/messages/${sent.message.id}`)
      .send({ content: 'Hi' })
      .expect(404);
  });
});
