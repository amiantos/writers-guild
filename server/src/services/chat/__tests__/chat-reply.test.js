import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SqliteStorageService } from '../../sqliteStorage.js';
import { ChatStorage } from '../chat-storage.js';
import { activateChatLore, generateChatReply, stopLabels } from '../chat-reply.js';

const layla = { id: 'layla', data: { name: 'Layla' } };
const bradley = { id: 'bradley', data: { name: 'Bradley' } };

/** A provider that streams the given chunks. */
function streamingProvider(chunks, { onGenerate } = {}) {
  return {
    resolveContextTokens: () => 8000,
    getCapabilities: () => ({ streaming: true }),
    generateStreaming: vi.fn(async (system, user, options) => {
      onGenerate?.(options);
      return {
        stream: (async function* () {
          for (const chunk of chunks) {
            if (chunk instanceof Error) throw chunk;
            yield chunk;
          }
        })(),
      };
    }),
  };
}

describe('generateChatReply', () => {
  let tempDir;
  let storage;
  let chats;
  let chat;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-reply-test-'));
    storage = new SqliteStorageService(tempDir);
    chats = new ChatStorage(storage.db);
    await storage.saveCharacter('layla', { data: { name: 'Layla' } });
    chat = chats.createChat({ title: 'x', characterIds: ['layla'] });
    chats.addTurn(chat.id, { source: 'user', senderName: 'Bradley', messages: ['you up?'] });
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function reply(provider, overrides = {}) {
    return generateChatReply({
      chats,
      chat,
      speaker: layla,
      characters: [layla],
      persona: bradley,
      lorebooks: [],
      preset: { provider: 'deepseek', generationSettings: { maxTokens: 100 } },
      provider,
      ...overrides,
    });
  }

  it('streams a reply, reports it, and saves its messages as a turn', async () => {
    const events = [];
    const turn = await reply(
      streamingProvider([
        { reasoning: 'She is awake.' },
        { content: 'yeah\n---\n*yawns* ' },
        { content: 'why?', finished: true },
      ]),
      { onEvent: (event) => events.push(event) },
    );

    expect(turn).toMatchObject({
      source: 'character',
      characterId: 'layla',
      senderName: 'Layla',
      messages: ['yeah', 'yawns why?'],
    });
    expect(turn.swipes[0].reasoning).toBe('She is awake.');
    expect(events[0]).toMatchObject({ type: 'prompt' });
    expect(events[0].user).toContain('Bradley: you up?');
    expect(events.slice(1)).toEqual([
      { type: 'reasoning', text: 'She is awake.' },
      { type: 'content', text: 'yeah\n---\nyawns ' },
      { type: 'content', text: 'why?' },
    ]);
    expect(chats.listTurns(chat.id)).toHaveLength(2);
  });

  it('adds a swipe when regenerating', async () => {
    const first = await reply(streamingProvider([{ content: 'hi' }]));
    const second = await reply(streamingProvider([{ content: 'hello' }]), { regenerate: first });
    expect(second.id).toBe(first.id);
    expect(second.swipes.map((swipe) => swipe.messages)).toEqual([['hi'], ['hello']]);
    // The regenerated reply doesn't see the reply it replaces.
    const provider = streamingProvider([{ content: 'hey' }]);
    await reply(provider, { regenerate: second });
    expect(provider.generateStreaming.mock.calls[0][1]).not.toContain('Layla: hi');
  });

  it('drops a regenerated version when the chat moved on while it was written', async () => {
    const first = await reply(streamingProvider([{ content: 'hi' }]));
    const provider = {
      resolveContextTokens: () => 8000,
      getCapabilities: () => ({ streaming: true }),
      generateStreaming: async () => ({
        stream: (async function* () {
          yield { content: 'hello' };
          // Someone sends a message mid-generation.
          chats.addTurn(chat.id, { source: 'user', senderName: 'Bradley', messages: ['wait'] });
        })(),
      }),
    };

    await expect(reply(provider, { regenerate: first })).rejects.toThrow('The chat moved on');
    expect(chats.getTurn(chat.id, first.id).swipes).toHaveLength(1);
  });

  it('saves what was written so far when cancelled, and nothing when nothing was', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const partial = await reply(streamingProvider([{ content: 'wait' }, abort]));
    expect(partial.messages).toEqual(['wait']);

    expect(await reply(streamingProvider([abort]))).toBeNull();
    expect(chats.listTurns(chat.id)).toHaveLength(2);
  });

  it('fails on an empty reply and on provider errors', async () => {
    await expect(reply(streamingProvider([{ content: '  ' }]))).rejects.toThrow(
      "Layla's reply came back empty",
    );
    await expect(reply(streamingProvider([new Error('rate limited')]))).rejects.toThrow(
      'rate limited',
    );
    expect(chats.listTurns(chat.id)).toHaveLength(1);
  });

  it('uses the queue for polling providers, with the context their workers take', async () => {
    const events = [];
    let options;
    const provider = {
      resolveContextTokens: async () => 4096,
      getCapabilities: () => ({ streaming: false, requiresPolling: true }),
      generateStreamingWithStatus: async function* (_system, _user, requestOptions) {
        options = requestOptions;
        yield { type: 'status', queuePosition: 3, waitTime: 20 };
        yield { type: 'complete', content: 'on my way' };
      },
    };
    const turn = await reply(provider, {
      preset: { provider: 'aihorde', generationSettings: { maxContextTokens: 16000 } },
      onEvent: (event) => events.push(event),
    });
    expect(turn.messages).toEqual(['on my way']);
    expect(options.maxContextLength).toBe(4096);
    expect(events).toContainEqual({ type: 'queue', position: 3, waitTime: 20 });
  });

  it('falls back to a single call for providers that neither stream nor poll', async () => {
    const provider = {
      resolveContextTokens: () => 8000,
      getCapabilities: () => ({ streaming: false }),
      generate: async () => ({ content: 'ok\n---\nsure', reasoning: 'r' }),
    };
    const turn = await reply(provider);
    expect(turn.messages).toEqual(['ok', 'sure']);
    expect(turn.swipes[0].reasoning).toBe('r');
  });

  it('primes text-completion backends and stops them at anyone else’s label', async () => {
    let options;
    const provider = streamingProvider([{ content: ' omw\nBradley: great' }], {
      onGenerate: (value) => (options = value),
    });
    const turn = await reply(provider, {
      preset: { provider: 'KoboldCpp', generationSettings: { stop_sequences: ['###'] } },
    });
    expect(provider.generateStreaming.mock.calls[0][1].endsWith('\n\nLayla:')).toBe(true);
    expect(options.stop_sequences).toEqual(['###', '\nBradley:']);
    // KoboldCpp and Ollama read maxContextTokens: the context the prompt was budgeted for.
    expect(options.maxContextTokens).toBe(8000);
    expect(turn.messages).toEqual(['omw']);
  });
});

describe('stopLabels', () => {
  it('stops at everyone else’s full and first names, never at the speaker’s own', () => {
    expect(stopLabels('Layla Hart', ['Brad Root', 'Sam', 'Layla Jones'])).toEqual([
      '\nBrad Root:',
      '\nBrad:',
      '\nSam:',
      '\nLayla Jones:',
    ]);
  });

  it('matches names case-insensitively, keeping their own spelling', () => {
    expect(stopLabels('Layla', ['layla Jones', 'Sam', 'SAM'])).toEqual([
      '\nlayla Jones:',
      '\nSam:',
    ]);
  });
});

describe('activateChatLore', () => {
  const lorebooks = [
    {
      name: 'World',
      entries: [
        { id: 1, keys: ['hospital'], content: 'St. Jude is short-staffed.', enabled: true },
        { id: 2, keys: ['airport'], content: 'The airport is closed.', enabled: true },
      ],
    },
  ];

  it('activates entries named in the scenario or the recent conversation', () => {
    const entries = activateChatLore(
      lorebooks,
      {},
      {
        chat: { scenario: 'Layla is at the hospital.' },
        turns: [{ messages: ['how was the airport'] }],
      },
    );
    expect(entries.map((entry) => entry.content).toSorted()).toEqual([
      'St. Jude is short-staffed.',
      'The airport is closed.',
    ]);
    expect(activateChatLore([], {}, { chat: {}, turns: [] })).toEqual([]);
  });
});
