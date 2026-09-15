import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DEFAULT_CORRESPONDENCE_STYLE,
  buildCorrespondenceMessages,
  generateReply,
  splitMessages,
} from '../correspondence.js';
import { getBureauStores } from '../stores.js';
import { closeBureauDb } from '../bureau-db.js';

function card(name, description = '') {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name, description } };
}

function message(source, content, bureauTime) {
  return { source, content, bureauTime };
}

/** Gives a streaming client a chat call answering with one offscreen account for Mara. */
function withOffscreen(client, content) {
  client.chat = async (options) => {
    client.calls.push(options);
    const entries = [{ character: 'Mara', content }];
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
          function: { name: 'record_offscreen', arguments: JSON.stringify({ entries }) },
        },
      ],
    };
  };
  return client;
}

/** A client whose stream sends each chunk as content, then throws `fail` or finishes. */
function streamingClient(chunks, { fail = null } = {}) {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    async *chatStream(options) {
      client.calls.push(options);
      for (const text of chunks) {
        yield { type: 'content', text };
      }
      if (fail) throw fail;
      yield {
        type: 'done',
        finishReason: 'stop',
        usage: { prompt_tokens: 300, completion_tokens: 20 },
        model: 'deepseek-flash',
      };
    },
  };
  return client;
}

describe('splitMessages', () => {
  it('splits a reply at separator lines and drops name labels', () => {
    expect(
      splitMessages('Mara: You up?\n---\n\nmara quinn: The light is out.\n---\n', 'Mara Quinn'),
    ).toEqual(['You up?', 'The light is out.']);
  });

  it('keeps paragraphs within a message and joins messages past the limit', () => {
    expect(splitMessages('Dear Theo,\n\nThe fog lifted.')).toEqual([
      'Dear Theo,\n\nThe fog lifted.',
    ]);
    const many = Array.from({ length: 8 }, (_, index) => `m${index}`).join('\n---\n');
    expect(splitMessages(many)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5\n\nm6\n\nm7']);
    expect(splitMessages(' \n---\n ')).toEqual([]);
  });
});

describe('buildCorrespondenceMessages', () => {
  const bureau = {
    timezone: 'UTC',
    settings: { correspondence: { style: '' } },
  };
  const mara = { id: 'c1', name: 'Mara', seedCard: card('Mara', 'Keeps the light for {{user}}.') };
  const theo = {
    id: 'c2',
    name: 'Theo',
    isPersona: true,
    seedCard: card('Theo', 'A cartographer.'),
  };
  const now = new Date('2026-10-27T22:30:00Z');

  it('gives the character, the reader, memories, and the conversation with exact times', () => {
    const [system, user] = buildCorrespondenceMessages({
      bureau,
      member: mara,
      persona: theo,
      time: now,
      now,
      memories: {
        knowledge: [{ content: "Theo can't swim." }],
        episodes: [{ content: 'Theo fixed the lamp.', sourceTitle: 'The Lamp Room' }],
      },
      arcNotes: [{ content: 'Mara lets Theo help now.' }],
      history: [
        message('user', 'You up?', '2026-10-24T21:00:00Z'),
        message('generated', 'Always.', '2026-10-24T21:02:00Z'),
        message('user', 'Storm coming.', '2026-10-27T22:00:00Z'),
      ],
    });

    expect(system.content).toContain(DEFAULT_CORRESPONDENCE_STYLE);
    expect(system.content).toContain('Keeps the light for Theo.');
    expect(system.content).toContain('How Mara has changed:\n- Mara lets Theo help now.');
    expect(system.content).toContain("Mara knows:\n- Theo can't swim.");
    expect(system.content).toContain('Mara remembers:\n- The Lamp Room: Theo fixed the lamp.');
    expect(system.content).toContain(
      "Writing to each other doesn't mean they live apart, or even that they're apart right now",
    );
    expect(system.content).toContain(
      'When a memory disagrees with a profile or an established fact, the profile or fact is right.',
    );
    expect(system.content).not.toContain('The year is');
    expect(user.content).toContain(
      [
        '(9:00 PM on Saturday, October 24, 2026)',
        'Theo: You up?',
        'Mara: Always.',
        '(a few days later: 10:00 PM on Tuesday, October 27, 2026)',
        'Theo: Storm coming.',
      ].join('\n'),
    );
    expect(user.content).toContain("It's exactly 10:30 PM on Tuesday, October 27, 2026.");
    expect(user.content).toContain("Write Mara's reply to Theo.");
    expect(user.content).not.toContain('since the last message');
  });

  it('mentions a long silence and the year of another era, and asks for a follow-up', () => {
    const [system, user] = buildCorrespondenceMessages({
      bureau: {
        ...bureau,
        settings: { correspondence: { style: 'Letters.' } },
      },
      member: mara,
      persona: theo,
      time: new Date('1996-09-10T08:00:00Z'),
      now,
      history: [message('generated', 'Night.', '1996-09-01T23:00:00Z')],
    });

    expect(system.content).toContain('=== CORRESPONDENCE STYLE ===\nLetters.');
    expect(system.content).toContain('The year is 1996.');
    expect(user.content).toContain('It has been about a week since the last message.');
    expect(user.content).toContain("Theo hasn't answered yet. Write a short follow-up from Mara.");
  });

  it('adds the established facts, with the reader named', () => {
    const [system] = buildCorrespondenceMessages({
      bureau,
      member: mara,
      persona: theo,
      time: now,
      now,
      history: [],
      facts: [{ content: 'Mara and {{user}} live above the bakery.' }],
    });

    expect(system.content).toContain(
      '=== ESTABLISHED FACTS ===\n- Mara and Theo live above the bakery.',
    );
    expect(system.content).toContain(
      'from their profiles, the established facts, and the conversation',
    );
  });

  it('asks for a first message in an empty thread', () => {
    const [, user] = buildCorrespondenceMessages({
      bureau,
      member: mara,
      persona: theo,
      time: now,
      now,
      history: [],
    });

    expect(user.content).toContain('=== CONVERSATION ===\n(No messages yet.)');
    expect(user.content).toContain('Write the first message Mara sends Theo.');
  });

  it('gives images in cards, lore, and messages as labels', () => {
    const [system, user] = buildCorrespondenceMessages({
      bureau,
      member: {
        ...mara,
        seedCard: card('Mara', 'Keeps the light. ![Mara](/api/assets/characters/c1/mara.webp)'),
      },
      persona: theo,
      time: now,
      now,
      loreEntries: [
        { content: 'The lamp room: ![the lens](/api/assets/lorebooks/lb-1/lens.webp)' },
      ],
      history: [
        message('user', 'Look ![a gull](https://example.com/gull.png)', '2026-10-27T22:00:00Z'),
      ],
    });

    expect(system.content).toContain('Keeps the light. [image: Mara]');
    expect(system.content).toContain('The lamp room: [image: the lens]');
    expect(user.content).toContain('Theo: Look [image: a gull]');
    expect(system.content + user.content).not.toMatch(/\/api\/assets\/|example\.com/);
  });
});

describe('generateReply', () => {
  let tempDir;
  let stores;
  let bureau;
  let mara;
  let theo;
  let thread;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'correspondence-'));
    stores = getBureauStores(tempDir);
    bureau = stores.bureaus.createBureau({ name: 'Harbor', apiKey: 'sk-test' });
    mara = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Mara', 'Keeps the light.'),
      libraryCharacterId: 'c1',
    });
    theo = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Theo', 'A cartographer.'),
      libraryCharacterId: 'c2',
      isPersona: true,
    });
    thread = stores.threads.getOrCreateThread(bureau.id, mara.id);
    stores.threads.addMessage(thread.id, {
      source: 'user',
      senderCastId: theo.id,
      content: 'You up?',
      bureauTime: '2026-10-27T22:00:00.000Z',
    });
  });

  afterEach(() => {
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function reply(client, options = {}) {
    return generateReply({
      stores,
      bureau: stores.bureaus.getBureau(bureau.id),
      thread,
      member: stores.bureaus.getCastMember(bureau.id, mara.id),
      persona: stores.bureaus.getCastMember(bureau.id, theo.id),
      client,
      ...options,
    });
  }

  it('gives thinking mode room to reason beyond the reply', async () => {
    stores.bureaus.updateSettings(bureau.id, {
      correspondence: { thinking: true, reasoningEffort: 'high' },
    });
    const client = streamingClient(['Hi.']);

    await reply(client);

    expect(client.calls[0]).toMatchObject({
      thinking: true,
      reasoningEffort: 'high',
      maxTokens: 9000,
    });
  });

  it('saves the reply as messages at Bureau time, without moving the clock', async () => {
    const client = streamingClient(['Always *yawns*.', '\n---\n', 'Storm?']);
    const events = [];
    stores.bureaus.setBureauTime(bureau.id, '2026-10-27T22:10:00.000Z');

    const saved = await reply(client, { onEvent: (event) => events.push(event) });

    expect(saved.map((message) => message.content)).toEqual(['Always yawns.', 'Storm?']);
    expect(saved[0]).toMatchObject({ source: 'generated', senderCastId: mara.id, position: 1 });
    expect(saved.map((item) => item.bureauTime)).toEqual([
      '2026-10-27T22:10:00.000Z',
      '2026-10-27T22:10:00.000Z',
    ]);
    expect(stores.bureaus.getBureau(bureau.id).bureauTime).toBe('2026-10-27T22:10:00.000Z');
    expect(events[0]).toEqual({ type: 'run', runId: saved[0].runId });
    expect(
      events
        .filter((event) => event.type === 'content')
        .map((event) => event.text)
        .join(''),
    ).toBe('Always yawns.\n---\nStorm?');
    expect(client.calls[0]).toMatchObject({ thinking: false, maxTokens: 1000 });
    expect(client.calls[0].messages[1].content).toContain('Theo: You up?');
    const run = stores.bureaus.getRun(bureau.id, saved[0].runId);
    expect(run.status).toBe('completed');
    expect(run.steps.map((step) => step.role)).toEqual(['writer']);
  });

  it('first writes what the character did during a long silence', async () => {
    stores.bureaus.updateProfile(bureau.id, mara.id, { routine: 'Nights at the light.' });
    stores.threads.addMessage(thread.id, {
      source: 'generated',
      senderCastId: mara.id,
      content: 'Night.',
      bureauTime: '2026-10-27T23:00:00.000Z',
    });
    // Nine days later in Bureau time, whatever the real clock says.
    stores.bureaus.setBureauTime(bureau.id, '2026-11-05T20:00:00.000Z');
    const client = streamingClient(['Back from the mainland.']);
    client.chat = async (options) => {
      client.calls.push(options);
      const entries = [{ character: 'Mara', content: 'Took the ferry to the mainland for parts.' }];
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
            function: { name: 'record_offscreen', arguments: JSON.stringify({ entries }) },
          },
        ],
      };
    };
    const events = [];

    const saved = await reply(client, { onEvent: (event) => events.push(event) });

    expect(client.calls[0].tools[0].name).toBe('record_offscreen');
    expect(client.calls[1].messages[0].content).toContain(
      'Mara lately: Took the ferry to the mainland for parts.',
    );
    expect(client.calls[1].messages[0].content).toContain('Usual routine: Nights at the light.');
    expect(events.filter((event) => event.type === 'stage').map((event) => event.stage)).toEqual([
      'catching-up',
      'writing',
    ]);
    const run = stores.bureaus.getRun(bureau.id, saved[0].runId);
    expect(run.steps.map((step) => step.role)).toEqual(['offscreen', 'offscreen', 'writer']);
  });

  it('dates time away to just before the session began', async () => {
    const day = 24 * 3_600_000;
    stores.threads.addMessage(thread.id, {
      source: 'generated',
      senderCastId: mara.id,
      content: 'Night.',
      bureauTime: new Date(Date.now() - 9 * day).toISOString(),
    });
    const opened = new Date(Date.now() - 60_000).toISOString();
    stores.threads.addMessage(thread.id, {
      source: 'user',
      senderCastId: theo.id,
      content: 'Back yet?',
      bureauTime: opened,
    });

    await reply(withOffscreen(streamingClient(['Yes.']), 'Mended nets on the pier.'));

    const [away] = stores.memories.listMemories(bureau.id, mara.id, { layer: 'offscreen' });
    expect(away.worldTime).toBe(new Date(Date.parse(opened) - 1).toISOString());
  });

  it("doesn't write time away that a story covered", async () => {
    const day = 24 * 3_600_000;
    const story = stores.stories.createStory(bureau.id, {
      startTime: new Date(Date.now() - 5 * day).toISOString(),
      castIds: [mara.id, theo.id],
    });
    stores.stories.endStory(bureau.id, story.id, {
      endTime: new Date(Date.now() - 3_600_000).toISOString(),
    });
    stores.threads.addMessage(thread.id, {
      source: 'generated',
      senderCastId: mara.id,
      content: 'Night.',
      bureauTime: new Date(Date.now() - 9 * day).toISOString(),
    });
    const client = withOffscreen(streamingClient(['Hi.']), 'Should not be written.');

    await reply(client);

    expect(client.calls.map((call) => call.tools?.[0]?.name ?? 'reply')).toEqual(['reply']);
  });

  it("uses the character's memories as they stand at Bureau time", async () => {
    stores.bureaus.updateSettings(bureau.id, { memory: { offscreenLife: false } });
    stores.bureaus.setBureauTime(bureau.id, '2026-10-27T22:10:00.000Z');
    const remember = (content, worldTime) =>
      stores.memories.addMemory(bureau.id, mara.id, { layer: 'knowledge', content, worldTime });
    remember("Theo can't swim.", '2026-01-01T00:00:00.000Z');
    remember('Theo won the regatta.', '2026-12-01T00:00:00.000Z');
    const client = streamingClient(['Hi.']);

    await reply(client);

    expect(client.calls[0].messages[0].content).toContain("Theo can't swim.");
    expect(client.calls[0].messages[0].content).not.toContain('regatta');
  });

  it('keeps what was written when cancelled', async () => {
    const abort = Object.assign(new Error('Aborted'), { name: 'AbortError' });

    const saved = await reply(streamingClient(['On my way'], { fail: abort }));

    expect(saved.map((message) => message.content)).toEqual(['On my way']);
    expect(stores.bureaus.getRun(bureau.id, saved[0].runId).status).toBe('cancelled');
  });

  it('records a failure and saves nothing', async () => {
    const before = stores.bureaus.getBureau(bureau.id).bureauTime;

    await expect(
      reply(streamingClient(['Half'], { fail: new Error('Network down') })),
    ).rejects.toThrow('Network down');

    expect(stores.threads.listMessages(thread.id)).toHaveLength(1);
    expect(stores.bureaus.getBureau(bureau.id).bureauTime).toBe(before);
    expect(stores.bureaus.listRuns(bureau.id)[0].status).toBe('failed');
  });

  it('fails when the reply is empty', async () => {
    await expect(reply(streamingClient([' \n---\n ']))).rejects.toThrow(
      "Mara's reply came back empty",
    );
  });
});
