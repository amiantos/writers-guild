import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteStorageService } from '../../services/sqliteStorage.js';
import { DeepSeekProvider } from '../../services/providers/deepseek-provider.js';
import chatsRouter from '../chats.js';

// The router keeps its storage in module scope, so every test in this file shares one directory.
let tempDir;
let storage;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chats-routes-test-'));
  storage = new SqliteStorageService(tempDir);
});

afterAll(() => {
  storage.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function createApp() {
  const app = express();
  app.use(express.json());
  app.locals.dataRoot = tempDir;
  app.use('/api/chats', chatsRouter);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

let counter = 0;
async function character(name, data = {}) {
  counter += 1;
  const id = `char-${counter}`;
  await storage.saveCharacter(id, { spec: 'chara_card_v2', data: { name, ...data } });
  return id;
}

async function preset() {
  counter += 1;
  const id = `preset-${counter}`;
  await storage.savePreset(id, {
    name: 'Test',
    provider: 'deepseek',
    apiConfig: { apiKey: 'test-key', model: 'deepseek-v4-flash' },
    generationSettings: { maxTokens: 100, maxContextTokens: 8000 },
  });
  return id;
}

/** Stub DeepSeek's stream with the given chunks, each call in turn. */
function streamReplies(...replies) {
  const spy = vi.spyOn(DeepSeekProvider.prototype, 'generateStreaming');
  for (const chunks of replies) {
    spy.mockImplementationOnce(async () => ({
      stream: (async function* () {
        for (const chunk of chunks) yield chunk;
      })(),
    }));
  }
  return spy;
}

function events(text) {
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)));
}

describe('Chats API', () => {
  let app;
  let layla;
  let sam;
  let bradley;
  let presetId;

  beforeEach(async () => {
    app = createApp();
    layla = await character('Layla', { description: 'A nurse.' });
    sam = await character('Sam');
    bradley = await character('Bradley');
    presetId = await preset();
  });

  async function createChat(body = {}) {
    const response = await request(app)
      .post('/api/chats')
      .send({ characterIds: [layla], configPresetId: presetId, ...body })
      .expect(201);
    return response.body.chat;
  }

  describe('chats', () => {
    it('creates a chat titled after its characters, with the default persona', async () => {
      await storage.saveSettings({ ...(await storage.getSettings()), defaultPersonaId: bradley });
      const chat = await createChat({ characterIds: [layla, sam], scenario: '  Midnight.  ' });
      expect(chat).toMatchObject({
        title: 'Chat with Layla and Sam',
        scenario: 'Midnight.',
        characterIds: [layla, sam],
        personaCharacterId: bradley,
      });
      await storage.saveSettings({ ...(await storage.getSettings()), defaultPersonaId: null });
    });

    it('lists, reads, updates, and deletes chats', async () => {
      const chat = await createChat({ title: 'Late night' });
      const list = await request(app).get('/api/chats').expect(200);
      expect(list.body.chats.some((item) => item.id === chat.id)).toBe(true);

      const updated = await request(app)
        .put(`/api/chats/${chat.id}`)
        .send({ scenario: 'Dawn.', personaCharacterId: bradley, characterIds: [layla, sam] })
        .expect(200);
      expect(updated.body.chat).toMatchObject({
        title: 'Late night',
        scenario: 'Dawn.',
        personaCharacterId: bradley,
        characterIds: [layla, sam],
      });

      const read = await request(app).get(`/api/chats/${chat.id}`).expect(200);
      expect(read.body).toMatchObject({ chat: { id: chat.id }, turns: [] });

      await request(app).delete(`/api/chats/${chat.id}`).expect(200);
      await request(app).get(`/api/chats/${chat.id}`).expect(404);
      await request(app).delete(`/api/chats/${chat.id}`).expect(404);
    });

    it('rejects unknown characters, presets, and a persona who is also in the chat', async () => {
      await request(app)
        .post('/api/chats')
        .send({ characterIds: ['nobody'] })
        .expect(400);
      await request(app).post('/api/chats').send({ configPresetId: 'nothing' }).expect(400);
      await request(app)
        .post('/api/chats')
        .send({ characterIds: [layla], personaCharacterId: layla })
        .expect(400);
      const chat = await createChat({ personaCharacterId: bradley });
      await request(app)
        .put(`/api/chats/${chat.id}`)
        .send({ characterIds: [bradley] })
        .expect(400);
    });
  });

  describe('writing', () => {
    it('saves the message and streams the reply', async () => {
      const chat = await createChat({ personaCharacterId: bradley, scenario: 'Midnight.' });
      const spy = streamReplies([
        { content: 'hey\n---\n' },
        { content: 'why are you up', finished: true },
      ]);

      const response = await request(app)
        .post(`/api/chats/${chat.id}/messages`)
        .set('Accept', 'text/event-stream')
        .send({ text: 'you up?' })
        .expect(200);

      const [system, user] = spy.mock.calls[0];
      expect(system).toContain('=== SCENARIO ===\nMidnight.');
      expect(user).toContain('Bradley: you up?');

      const stream = events(response.text);
      expect(stream.map((event) => event.type)).toEqual([
        'turn',
        'speaker',
        'prompt',
        'content',
        'content',
        'done',
      ]);
      expect(stream[0].turn).toMatchObject({ source: 'user', messages: ['you up?'] });
      expect(stream.at(-1).turn).toMatchObject({
        source: 'character',
        characterId: layla,
        messages: ['hey', 'why are you up'],
      });

      const read = await request(app).get(`/api/chats/${chat.id}`).expect(200);
      expect(read.body.turns.map((turn) => turn.messages)).toEqual([
        ['you up?'],
        ['hey', 'why are you up'],
      ]);
    });

    it('answers with JSON when the client does not stream', async () => {
      const chat = await createChat();
      streamReplies([{ content: 'hi' }]);
      const response = await request(app)
        .post(`/api/chats/${chat.id}/messages`)
        .send({ text: 'hello' })
        .expect(201);
      expect(response.body.userTurn.messages).toEqual(['hello']);
      expect(response.body.turn.messages).toEqual(['hi']);
    });

    it('saves a message without a reply', async () => {
      const chat = await createChat();
      const spy = vi.spyOn(DeepSeekProvider.prototype, 'generateStreaming');
      const response = await request(app)
        .post(`/api/chats/${chat.id}/messages`)
        .send({ text: 'hello', reply: false })
        .expect(201);
      expect(response.body.userTurn.messages).toEqual(['hello']);
      expect(spy).not.toHaveBeenCalled();
    });

    it('has the character the user names reply in a group chat, or the one asked for', async () => {
      const chat = await createChat({ characterIds: [layla, sam] });
      streamReplies([{ content: 'sup' }], [{ content: 'hi' }]);

      const named = await request(app)
        .post(`/api/chats/${chat.id}/messages`)
        .send({ text: 'sam, you there?' })
        .expect(201);
      expect(named.body.turn.characterId).toBe(sam);

      const chosen = await request(app)
        .post(`/api/chats/${chat.id}/messages`)
        .send({ text: 'anyone?', characterId: layla })
        .expect(201);
      expect(chosen.body.turn.characterId).toBe(layla);

      await request(app)
        .post(`/api/chats/${chat.id}/messages`)
        .send({ text: 'x', characterId: bradley })
        .expect(400);
      const read = await request(app).get(`/api/chats/${chat.id}`).expect(200);
      expect(read.body.turns).toHaveLength(4);
    });

    it('lets a character write first', async () => {
      const chat = await createChat();
      const spy = streamReplies([{ content: 'hey stranger' }]);
      const response = await request(app).post(`/api/chats/${chat.id}/reply`).send({}).expect(201);
      expect(response.body.turn.messages).toEqual(['hey stranger']);
      expect(spy.mock.calls[0][1]).toContain('Write the first message Layla sends.');
    });

    it('regenerates the last reply as a new swipe, and switches between swipes', async () => {
      const chat = await createChat();
      streamReplies([{ content: 'first' }], [{ content: 'second' }]);
      const sent = await request(app)
        .post(`/api/chats/${chat.id}/messages`)
        .send({ text: 'hi' })
        .expect(201);
      const turnId = sent.body.turn.id;

      const regenerated = await request(app)
        .post(`/api/chats/${chat.id}/turns/${turnId}/regenerate`)
        .expect(201);
      expect(regenerated.body.turn).toMatchObject({ id: turnId, activeSwipe: 1 });
      expect(regenerated.body.turn.messages).toEqual(['second']);

      const swiped = await request(app)
        .put(`/api/chats/${chat.id}/turns/${turnId}/swipe`)
        .send({ index: 0 })
        .expect(200);
      expect(swiped.body.turn.messages).toEqual(['first']);
      await request(app)
        .put(`/api/chats/${chat.id}/turns/${turnId}/swipe`)
        .send({ index: 9 })
        .expect(400);

      await request(app)
        .post(`/api/chats/${chat.id}/turns/${sent.body.userTurn.id}/regenerate`)
        .expect(400);
    });

    it('only regenerates the last reply', async () => {
      const chat = await createChat();
      streamReplies([{ content: 'hi' }]);
      const sent = await request(app)
        .post(`/api/chats/${chat.id}/messages`)
        .send({ text: 'hi' })
        .expect(201);
      await request(app)
        .post(`/api/chats/${chat.id}/messages`)
        .send({ text: 'more', reply: false })
        .expect(201);
      const response = await request(app)
        .post(`/api/chats/${chat.id}/turns/${sent.body.turn.id}/regenerate`)
        .expect(400);
      expect(response.body.error).toContain('last reply');
    });

    it('reports a failed reply as an error event, keeping the user’s message', async () => {
      const chat = await createChat();
      vi.spyOn(DeepSeekProvider.prototype, 'generateStreaming').mockRejectedValue(
        new Error('Rate limited'),
      );
      const response = await request(app)
        .post(`/api/chats/${chat.id}/messages`)
        .set('Accept', 'text/event-stream')
        .send({ text: 'hi' })
        .expect(200);
      expect(events(response.text).at(-1)).toEqual({ type: 'error', error: 'Rate limited' });
      const read = await request(app).get(`/api/chats/${chat.id}`).expect(200);
      expect(read.body.turns).toHaveLength(1);
    });

    it('needs a message, a preset, and a character', async () => {
      const chat = await createChat();
      await request(app).post(`/api/chats/${chat.id}/messages`).send({ text: ' ' }).expect(400);

      const empty = await createChat({ characterIds: [] });
      const noCharacters = await request(app)
        .post(`/api/chats/${empty.id}/reply`)
        .send({})
        .expect(400);
      expect(noCharacters.body.error).toContain('Add a character');

      await request(app).post('/api/chats/missing/reply').send({}).expect(404);
    });
  });

  describe('messages', () => {
    it('edits and deletes single messages, and whole turns', async () => {
      const chat = await createChat();
      streamReplies([{ content: 'a\n---\nb' }]);
      const sent = await request(app)
        .post(`/api/chats/${chat.id}/messages`)
        .send({ text: 'hi' })
        .expect(201);
      const turnId = sent.body.turn.id;

      const edited = await request(app)
        .put(`/api/chats/${chat.id}/turns/${turnId}/messages/1`)
        .send({ content: 'B' })
        .expect(200);
      expect(edited.body.turn.messages).toEqual(['a', 'B']);
      await request(app)
        .put(`/api/chats/${chat.id}/turns/${turnId}/messages/5`)
        .send({ content: 'x' })
        .expect(404);

      const deleted = await request(app)
        .delete(`/api/chats/${chat.id}/turns/${turnId}/messages/0`)
        .expect(200);
      expect(deleted.body.turn.messages).toEqual(['B']);

      await request(app).delete(`/api/chats/${chat.id}/turns/${sent.body.userTurn.id}`).expect(200);
      const read = await request(app).get(`/api/chats/${chat.id}`).expect(200);
      expect(read.body.turns.map((turn) => turn.id)).toEqual([turnId]);
    });
  });
});

describe('Chats API without a default preset', () => {
  it('asks for a preset before replying', async () => {
    const app = createApp();
    const layla = await character('Layla');
    const chat = await request(app)
      .post('/api/chats')
      .send({ characterIds: [layla] })
      .expect(201);
    const response = await request(app)
      .post(`/api/chats/${chat.body.chat.id}/messages`)
      .send({ text: 'hi' })
      .expect(400);
    expect(response.body.error).toContain('preset');
    const read = await request(app).get(`/api/chats/${chat.body.chat.id}`).expect(200);
    expect(read.body.turns).toEqual([]);
  });
});
