import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateWriterTurn, requestForRegeneration, RECORDED_STORY_TAIL } from '../writer-turn.js';
import { getBureauStores } from '../stores.js';
import { closeBureauDb } from '../bureau-db.js';
import { DeepSeekClient, DeepSeekError } from '../deepseek-client.js';

const START = '2026-10-27T07:30:00.000Z';

function card(name, description = '') {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name, description } };
}

function done(content, extra = {}) {
  return {
    type: 'done',
    content,
    reasoning: '',
    toolCalls: [],
    finishReason: 'stop',
    usage: { prompt_tokens: 120, completion_tokens: 20 },
    model: 'deepseek-flash',
    ...extra,
  };
}

function toolTurn(name, args) {
  return {
    content: '',
    reasoning: '',
    toolCalls: [
      { id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } },
    ],
    finishReason: 'tool_calls',
    usage: { prompt_tokens: 80, completion_tokens: 20 },
    model: 'deepseek-flash',
  };
}

/** Give a streaming client a chat() for the Director and Editor, answering in order. */
function withChat(client, answers) {
  client.chatCalls = [];
  client.chat = async (options) => {
    client.chatCalls.push(options);
    const answer = answers[client.chatCalls.length - 1];
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return client;
}

const BRIEF = {
  beats: ['Mara answers the door'],
  tone: 'warm',
  length: 'short',
  memories: [],
  notes: '',
};

const TWO_SPEAKERS = '"Coming?" Mara asked. "No," Theo said.';
const SPLIT_SPEAKERS = '"Coming?" Mara asked.\n\n"No," Theo said.';

/** A client that streams the given events, stopping with AbortError once aborted. */
function streamingClient(events, { failWith = null } = {}) {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    async *chatStream(options) {
      client.calls.push(options);
      for (const event of events) {
        if (options.signal?.aborted) {
          const abort = new Error('The operation was aborted');
          abort.name = 'AbortError';
          throw abort;
        }
        yield event;
      }
      if (failWith) throw failWith;
    },
  };
  return client;
}

describe('generateWriterTurn', () => {
  let tempDir;
  let stores;
  let bureau;
  let mara;
  let theo;
  let story;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'writer-turn-'));
    stores = getBureauStores(tempDir);
    const created = stores.bureaus.createBureau({ name: 'Harbor', apiKey: 'sk-test' });
    mara = stores.bureaus.addCastMember(created.id, {
      seedCard: card('Mara', 'Keeper of the lighthouse.'),
      libraryCharacterId: 'c1',
    });
    theo = stores.bureaus.addCastMember(created.id, {
      seedCard: card('Theo'),
      libraryCharacterId: 'c2',
      isPersona: true,
    });
    // Tests turn the Director on where they need it.
    stores.bureaus.updateSettings(created.id, { director: { enabled: false } });
    bureau = stores.bureaus.getBureau(created.id);
    story = stores.stories.createStory(bureau.id, {
      startTime: START,
      castIds: [mara.id, theo.id],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function generate(client, request, extra = {}) {
    return generateWriterTurn({
      stores,
      bureau: stores.bureaus.getBureau(bureau.id),
      story: stores.stories.getStory(bureau.id, story.id),
      client,
      request,
      ...extra,
    });
  }

  it('streams prose into a new generated turn and records the run', async () => {
    stores.stories.addTurn(story.id, { kind: 'prose', source: 'user', content: 'Theo knocked.' });
    const client = streamingClient([
      { type: 'reasoning', text: 'Mara answers.' },
      { type: 'content', text: 'Mara *opened* ' },
      { type: 'content', text: 'the door.' },
      done('Mara *opened* the door.'),
    ]);
    const events = [];

    const turn = await generate(
      client,
      { action: 'write' },
      { onEvent: (event) => events.push(event) },
    );

    expect(turn).toMatchObject({
      kind: 'prose',
      source: 'generated',
      content: 'Mara opened the door.',
      authorCastId: null,
    });
    expect(events).toEqual([
      { type: 'run', runId: turn.runId },
      { type: 'stage', stage: 'writing' },
      { type: 'reasoning', text: 'Mara answers.' },
      { type: 'content', text: 'Mara opened ' },
      { type: 'content', text: 'the door.' },
    ]);

    const run = stores.bureaus.getRun(bureau.id, turn.runId);
    expect(run).toMatchObject({
      purpose: 'turn',
      targetType: 'story',
      targetId: story.id,
      status: 'completed',
    });
    expect(run.steps.map((step) => [step.role, step.kind])).toEqual([
      ['writer', 'model'],
      ['lint', 'tool'],
    ]);
    expect(run.steps[1].response).toEqual({ findings: [] });
    expect(run.steps[0]).toMatchObject({
      role: 'writer',
      kind: 'model',
      reasoning: 'Mara answers.',
      usage: { prompt_tokens: 120, completion_tokens: 20 },
      response: { content: 'Mara opened the door.', finishReason: 'stop' },
    });
    expect(run.steps[0].request.messages[1].content).toContain(
      "Theo is the reader's character, so leave what Theo says, does, decides, and thinks to the reader",
    );
  });

  it("uses the Bureau's writer settings and the story's cast", async () => {
    stores.bureaus.updateSettings(bureau.id, {
      writer: { thinking: true, temperature: 1.4, maxTokens: 6000 },
    });
    const client = streamingClient([{ type: 'content', text: 'Dusk.' }, done('Dusk.')]);

    await generate(client, { action: 'continue' });

    expect(client.calls[0]).toMatchObject({
      thinking: true,
      reasoningEffort: 'high',
      temperature: 1.4,
      maxTokens: 6000,
    });
    expect(client.calls[0].messages[0].content).toContain(
      'Name: Mara\nDescription: Keeper of the lighthouse.',
    );
  });

  it('adds lore activated by the story from attached lorebooks', async () => {
    stores.library = {
      close: () => {},
      getLorebook: async (lorebookId) => {
        if (lorebookId !== 'lb-1') throw new Error(`Lorebook not found: ${lorebookId}`);
        return {
          id: 'lb-1',
          name: 'Harbor Lore',
          entries: [
            {
              id: 1,
              keys: ['lighthouse'],
              content: 'The lighthouse went dark in 1971.',
              enabled: true,
              insertionOrder: 0,
            },
          ],
        };
      },
    };
    stores.bureaus.attachLorebook(bureau.id, 'lb-deleted');
    stores.bureaus.attachLorebook(bureau.id, 'lb-1');
    stores.stories.addTurn(story.id, {
      kind: 'prose',
      source: 'user',
      content: 'Theo looked up at the lighthouse.',
    });
    const client = streamingClient([{ type: 'content', text: 'Dusk.' }, done('Dusk.')]);

    await generate(client, { action: 'write' });

    expect(client.calls[0].messages[0].content).toContain(
      '=== WORLD ===\nThe lighthouse went dark in 1971.',
    );
  });

  it('adds lore activated by a greeting being rewritten', async () => {
    stores.library = {
      close: () => {},
      getLorebook: async () => ({
        id: 'lb-1',
        name: 'Harbor Lore',
        entries: [
          {
            id: 1,
            keys: ['lighthouse'],
            content: 'The lighthouse went dark in 1971.',
            enabled: true,
            insertionOrder: 0,
          },
        ],
      }),
    };
    stores.bureaus.attachLorebook(bureau.id, 'lb-1');
    const client = streamingClient([{ type: 'content', text: 'Dusk.' }, done('Dusk.')]);

    await generate(client, {
      action: 'greeting',
      greeting: { name: 'Mara', content: 'Mara waves you up to the lighthouse.' },
    });

    expect(client.calls[0].messages[0].content).toContain(
      '=== WORLD ===\nThe lighthouse went dark in 1971.',
    );
  });

  it('reminds characters of earlier stories, but not of this one', async () => {
    const earlier = stores.stories.createStory(bureau.id, {
      startTime: '2026-10-01T20:00:00.000Z',
      castIds: [mara.id, theo.id],
      title: 'The Pier',
    });
    const fromStory = (castId, target, layer, content) =>
      stores.memories.addMemory(bureau.id, castId, {
        layer,
        content,
        sourceType: 'story',
        sourceId: target.id,
        worldTime: target.startTime,
      });
    fromStory(mara.id, earlier, 'knowledge', "Theo can't swim.");
    fromStory(mara.id, earlier, 'episode', 'Mara met Theo at the pier.');
    fromStory(mara.id, story, 'knowledge', 'Theo waded in up to his knees.');
    fromStory(theo.id, earlier, 'knowledge', 'Theo remembers the pier.');
    stores.arcNotes.addNote(bureau.id, mara.id, {
      content: 'Mara lets Theo take the oars now.',
      status: 'accepted',
      sourceType: 'story',
      sourceId: earlier.id,
      worldTime: earlier.startTime,
    });
    stores.arcNotes.addNote(bureau.id, mara.id, { content: 'Mara waits to be asked.' });
    const client = streamingClient([{ type: 'content', text: 'Dusk.' }, done('Dusk.')]);

    await generate(client, { action: 'continue' });

    const system = client.calls[0].messages[0].content;
    expect(system).toContain(
      "Mara knows:\n- Theo can't swim.\n\nMara remembers:\n- The Pier: Mara met Theo at the pier.",
    );
    expect(system).toContain('How Mara has changed:\n- Mara lets Theo take the oars now.');
    expect(system).not.toContain('waits to be asked');
    expect(system).not.toContain('waded in');
    // The reader's character remembers too.
    expect(system).toContain('Theo knows:\n- Theo remembers the pier.');
  });

  it('sets the opening at the story start time, in the Bureau time zone', async () => {
    stores.bureaus.updateBureau(bureau.id, { timezone: 'America/Los_Angeles' });
    const client = streamingClient([{ type: 'content', text: 'Midnight.' }, done('Midnight.')]);

    await generate(client, { action: 'continue' });

    expect(client.calls[0].messages[1].content).toContain(
      'This chapter begins at exactly 12:30 AM on Tuesday, October 27, 2026.',
    );
  });

  it("regenerates a passage at the chapter's time as of that passage", async () => {
    stores.bureaus.updateBureau(bureau.id, { timezone: 'UTC' });
    const addProse = (content) =>
      stores.stories.addTurn(story.id, { kind: 'prose', source: 'generated', content });
    const passTo = (bureauTime) =>
      stores.stories.addTurn(story.id, { kind: 'time_passes', source: 'user', bureauTime });
    addProse('Night fell.');
    passTo('2026-10-28T08:00:00.000Z');
    const morning = addProse('Morning came grey.');
    passTo('2026-10-31T08:00:00.000Z');
    const client = streamingClient([{ type: 'content', text: 'Fog.' }, done('Fog.')]);

    await generate(client, { action: 'continue' }, { regenerateTurnId: morning.id });

    const user = client.calls[0].messages[1].content;
    expect(user).toContain(
      "Time has just passed: it's now exactly 8:00 AM on Wednesday, October 28, 2026.",
    );
    expect(user).not.toContain('October 31');
  });

  it('restores images the model refers to', async () => {
    stores.stories.addTurn(story.id, {
      kind: 'prose',
      source: 'user',
      content: 'Theo unrolled the map. ![map](https://example.com/map.png)',
    });
    const client = streamingClient([
      { type: 'content', text: 'Mara traced [WG_IMAGE_0] with a finger.' },
      done('Mara traced [WG_IMAGE_0] with a finger.'),
    ]);

    const turn = await generate(client, { action: 'write' });

    expect(client.calls[0].messages[1].content).toContain('[WG_IMAGE_0]');
    expect(turn.content).toBe('Mara traced ![map](https://example.com/map.png) with a finger.');
  });

  it('streams images as soon as their markers are written', async () => {
    stores.stories.addTurn(story.id, {
      kind: 'prose',
      source: 'user',
      content: 'Theo unrolled the map. ![map](https://example.com/map.png)',
    });
    const client = streamingClient([
      { type: 'content', text: 'Mara traced [WG_IMA' },
      { type: 'content', text: 'GE_0] with a finger.' },
      done('Mara traced [WG_IMAGE_0] with a finger.'),
    ]);
    const events = [];

    await generate(client, { action: 'write' }, { onEvent: (event) => events.push(event) });

    expect(events.filter((event) => event.type === 'content').map((event) => event.text)).toEqual([
      'Mara traced ',
      '![map](https://example.com/map.png) with a finger.',
    ]);
  });

  it('regenerates a turn as a new variant, writing from the turns before it', async () => {
    stores.stories.addTurn(story.id, { kind: 'prose', source: 'user', content: 'Before.' });
    const original = stores.stories.addTurn(story.id, {
      kind: 'prose',
      source: 'generated',
      content: 'First try.',
    });
    stores.stories.addTurn(story.id, { kind: 'prose', source: 'user', content: 'After.' });
    const client = streamingClient([{ type: 'content', text: 'Second try.' }, done('Second try.')]);

    const turn = await generate(client, { action: 'write' }, { regenerateTurnId: original.id });

    expect(turn).toMatchObject({ id: original.id, content: 'Second try.' });
    expect(turn.variants).toHaveLength(2);
    const prompt = client.calls[0].messages[1].content;
    expect(prompt).toContain('Before.');
    expect(prompt).not.toContain('After.');
    expect(prompt).not.toContain('First try.');
  });

  it('keeps the text written so far when cancelled', async () => {
    const controller = new AbortController();
    const client = streamingClient([
      { type: 'content', text: 'The lamp flickered' },
      { type: 'content', text: ' and went out.' },
      done('The lamp flickered and went out.'),
    ]);

    const turn = await generate(
      client,
      { action: 'continue' },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'content') controller.abort();
        },
      },
    );

    expect(turn.content).toBe('The lamp flickered');
    const run = stores.bureaus.getRun(bureau.id, turn.runId);
    expect(run).toMatchObject({ status: 'cancelled' });
    expect(run.steps[0]).toMatchObject({ error: 'Cancelled' });
  });

  it('saves nothing when cancelled before any text arrives', async () => {
    const controller = new AbortController();
    const client = streamingClient([{ type: 'content', text: 'Too late.' }, done('Too late.')]);
    let runId;

    const turn = await generate(
      client,
      { action: 'continue' },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'run') {
            runId = event.runId;
            controller.abort();
          }
        },
      },
    );

    expect(turn).toBeNull();
    expect(stores.stories.listTurns(story.id)).toEqual([]);
    expect(stores.bureaus.getRun(bureau.id, runId).status).toBe('cancelled');
  });

  it('records a failed run and saves nothing when the model call fails', async () => {
    const failure = new DeepSeekError('DeepSeek API error 402 (insufficient balance): Top up');
    const client = streamingClient([], { failWith: failure });
    let runId;

    await expect(
      generate(client, { action: 'continue' }, { onEvent: (event) => (runId ??= event.runId) }),
    ).rejects.toBe(failure);

    expect(stores.stories.listTurns(story.id)).toEqual([]);
    expect(stores.bureaus.getRun(bureau.id, runId)).toMatchObject({
      status: 'failed',
      error: failure.message,
    });
  });

  it('fails the run, rather than cancelling it, when DeepSeek stops responding', async () => {
    // A real client, whose request never gets a response.
    const client = new DeepSeekClient({
      apiKey: 'sk-test',
      idleTimeoutMs: 20,
      fetch: (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    });
    let runId;

    await expect(
      generate(client, { action: 'continue' }, { onEvent: (event) => (runId ??= event.runId) }),
    ).rejects.toThrow(DeepSeekError);

    expect(stores.stories.listTurns(story.id)).toEqual([]);
    expect(stores.bureaus.getRun(bureau.id, runId)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/^DeepSeek stopped responding/),
    });
  });

  it('fails when the Writer returns no text', async () => {
    const client = streamingClient([done('')]);

    await expect(generate(client, { action: 'continue' })).rejects.toThrow(
      'The Writer returned no text',
    );
    expect(stores.stories.listTurns(story.id)).toEqual([]);
  });

  it('records only the end of a long story, while sending all of it', async () => {
    const longText = `${'Waves broke on the rocks. '.repeat(400)}The end of the page.`;
    stores.stories.addTurn(story.id, { kind: 'prose', source: 'user', content: longText });
    const client = streamingClient([{ type: 'content', text: 'Dawn.' }, done('Dawn.')]);

    const turn = await generate(client, { action: 'write' });

    expect(client.calls[0].messages[1].content).toContain(longText);
    const recorded = stores.bureaus.getRun(bureau.id, turn.runId).steps[0].request.messages[1];
    expect(recorded.content).toContain('earlier characters not recorded');
    expect(recorded.content).toContain('The end of the page.');
    expect(recorded.content.length).toBeLessThan(RECORDED_STORY_TAIL + 2500);
  });

  it('marks the run failed when the turn cannot be saved', async () => {
    vi.spyOn(stores.stories, 'addTurn').mockImplementation(() => {
      throw new Error('FOREIGN KEY constraint failed');
    });
    const client = streamingClient([{ type: 'content', text: 'Dusk.' }, done('Dusk.')]);
    let runId;

    await expect(
      generate(client, { action: 'continue' }, { onEvent: (event) => (runId ??= event.runId) }),
    ).rejects.toThrow('FOREIGN KEY constraint failed');

    expect(stores.bureaus.getRun(bureau.id, runId)).toMatchObject({
      status: 'failed',
      error: 'FOREIGN KEY constraint failed',
    });
  });

  describe('with the Director and Editor', () => {
    it('plans with the Director, then writes from its brief', async () => {
      stores.bureaus.updateSettings(bureau.id, { director: { enabled: true } });
      stores.stories.addTurn(story.id, { kind: 'prose', source: 'user', content: 'Theo knocked.' });
      const client = withChat(
        streamingClient([
          { type: 'content', text: 'Mara opened the door.' },
          done('Mara opened the door.'),
        ]),
        [toolTurn('submit_brief', BRIEF)],
      );
      const events = [];

      const turn = await generate(
        client,
        { action: 'write' },
        { onEvent: (event) => events.push(event) },
      );

      expect(events.filter((event) => ['stage', 'brief'].includes(event.type))).toEqual([
        { type: 'stage', stage: 'directing' },
        { type: 'brief', brief: BRIEF },
        { type: 'stage', stage: 'writing' },
      ]);
      expect(client.chatCalls[0]).toMatchObject({ thinking: true, strict: true, stream: true });
      expect(client.calls[0].messages[1].content).toContain(
        'Scene brief from the Director:\n- Mara answers the door',
      );
      const steps = stores.bureaus.getRun(bureau.id, turn.runId).steps;
      expect(steps.map((step) => [step.role, step.kind])).toEqual([
        ['director', 'model'],
        ['director', 'tool'],
        ['writer', 'model'],
        ['lint', 'tool'],
      ]);
    });

    it('ends the turn when the Director times out, rather than waiting on the Writer too', async () => {
      stores.bureaus.updateSettings(bureau.id, { director: { enabled: true } });
      const stalled = new DeepSeekError(
        'DeepSeek stopped responding: nothing arrived for 2 minutes',
        { timedOut: true },
      );
      const client = withChat(
        streamingClient([{ type: 'content', text: 'Dusk.' }, done('Dusk.')]),
        [stalled],
      );
      let runId;

      await expect(
        generate(
          client,
          { action: 'direct', direction: 'Rain starts' },
          { onEvent: (event) => (runId ??= event.runId) },
        ),
      ).rejects.toBe(stalled);

      expect(client.calls).toHaveLength(0);
      expect(stores.stories.listTurns(story.id)).toEqual([]);
      expect(stores.bureaus.getRun(bureau.id, runId)).toMatchObject({
        status: 'failed',
        error: stalled.message,
      });
    });

    it('skips the Director on a plain Continue, and writes without a brief if it fails', async () => {
      stores.bureaus.updateSettings(bureau.id, { director: { enabled: true } });
      const client = withChat(
        streamingClient([{ type: 'content', text: 'Dusk.' }, done('Dusk.')]),
        [new DeepSeekError('DeepSeek API error 503')],
      );

      await generate(client, { action: 'continue' });
      expect(client.chatCalls).toHaveLength(0);

      const turn = await generate(client, { action: 'direct', direction: 'Rain starts' });

      expect(turn.content).toBe('Dusk.');
      expect(client.calls[1].messages[1].content).not.toContain('Scene brief');
      const run = stores.bureaus.getRun(bureau.id, turn.runId);
      expect(run.status).toBe('completed');
      expect(run.steps[0]).toMatchObject({ role: 'director', error: 'DeepSeek API error 503' });
    });

    it('rewrites a greeting without the Director, keeping an image the Writer leaves out', async () => {
      stores.bureaus.updateSettings(bureau.id, {
        director: { enabled: true, skipOnContinue: false },
      });
      const greeting = {
        name: 'Mara',
        content:
          '![Mara at the lamp](/api/assets/characters/c1/lamp.webp)\n\nMara looks up as you come in.',
      };
      const client = withChat(
        streamingClient([
          { type: 'content', text: 'Mara looked up as Theo came in.' },
          done('Mara looked up as Theo came in.'),
        ]),
        [],
      );

      const turn = await generate(client, { action: 'greeting', greeting });

      expect(client.chatCalls).toHaveLength(0);
      expect(client.calls[0].messages[1].content).toContain(
        'Greeting:\n[WG_IMAGE_0]\n\nMara looks up as you come in.',
      );
      expect(turn.content).toBe(
        'Mara looked up as Theo came in.\n\n![Mara at the lamp](/api/assets/characters/c1/lamp.webp)',
      );
      const run = stores.bureaus.getRun(bureau.id, turn.runId);
      expect(run.steps.map((step) => step.role)).toEqual(['greeting', 'writer', 'lint']);
      expect(requestForRegeneration([turn], 0, run)).toEqual({ action: 'greeting', greeting });
    });

    it('fixes flagged paragraphs with the Editor and records each fix', async () => {
      const client = withChat(
        streamingClient([{ type: 'content', text: TWO_SPEAKERS }, done(TWO_SPEAKERS)]),
        [toolTurn('edit_paragraphs', { edits: [{ paragraph: 0, replacement: SPLIT_SPEAKERS }] })],
      );
      const events = [];

      const turn = await generate(
        client,
        { action: 'continue' },
        { onEvent: (event) => events.push(event) },
      );

      expect(turn.content).toBe(SPLIT_SPEAKERS);
      expect(events.find((event) => event.type === 'edits').edits).toMatchObject([
        {
          paragraph: 0,
          rules: ['multiple_speakers'],
          original: TWO_SPEAKERS,
          replacement: SPLIT_SPEAKERS,
        },
      ]);
      const run = stores.bureaus.getRun(bureau.id, turn.runId);
      expect(run.steps.map((step) => [step.role, step.kind])).toEqual([
        ['writer', 'model'],
        ['lint', 'tool'],
        ['editor', 'model'],
        ['editor', 'tool'],
      ]);
      expect(run.steps[1].response.findings).toHaveLength(1);
      // The Writer revises in its own conversation: what it was sent, its passage, then the request.
      const revision = client.chatCalls[0].messages;
      expect(revision.slice(0, 2)).toEqual(client.calls[0].messages);
      expect(revision[2]).toMatchObject({ role: 'assistant', content: TWO_SPEAKERS });
      expect(revision[3].content).toContain('=== REVISE ===');
    });

    it("doesn't flag the reader's character speaking, on any action", async () => {
      stores.bureaus.updateSettings(bureau.id, { editor: { enabled: false } });
      const rulesFor = async (request) => {
        const client = withChat(
          streamingClient([{ type: 'content', text: TWO_SPEAKERS }, done(TWO_SPEAKERS)]),
          [],
        );
        const turn = await generate(client, request);
        const lint = stores.bureaus
          .getRun(bureau.id, turn.runId)
          .steps.find((step) => step.role === 'lint');
        return lint.response.findings.map((finding) => finding.rule);
      };

      expect(await rulesFor({ action: 'direct', direction: 'Theo says no' })).toEqual([
        'multiple_speakers',
      ]);
      expect(await rulesFor({ action: 'continue' })).toEqual(['multiple_speakers']);
    });

    it('keeps the unedited text when the Editor is off or fails', async () => {
      stores.bureaus.updateSettings(bureau.id, { editor: { enabled: false } });
      const off = withChat(
        streamingClient([{ type: 'content', text: TWO_SPEAKERS }, done(TWO_SPEAKERS)]),
        [],
      );
      expect((await generate(off, { action: 'continue' })).content).toBe(TWO_SPEAKERS);
      expect(off.chatCalls).toHaveLength(0);

      stores.bureaus.updateSettings(bureau.id, { editor: { enabled: true } });
      const failing = withChat(
        streamingClient([{ type: 'content', text: TWO_SPEAKERS }, done(TWO_SPEAKERS)]),
        [new DeepSeekError('DeepSeek API error 500')],
      );
      const turn = await generate(failing, { action: 'continue' });

      expect(turn.content).toBe(TWO_SPEAKERS);
      expect(stores.bureaus.getRun(bureau.id, turn.runId).status).toBe('completed');
    });
  });
});

describe('requestForRegeneration', () => {
  const generated = {
    kind: 'prose',
    source: 'generated',
    content: 'Reply.',
  };

  it('regenerates a reply to a direction as a direction', () => {
    const turns = [{ kind: 'direction', source: 'user', content: 'Rain starts.' }, generated];

    expect(requestForRegeneration(turns, 1)).toEqual({
      action: 'direct',
      direction: 'Rain starts.',
    });
  });

  it("regenerates a reply to the reader's prose as a write", () => {
    const turns = [{ kind: 'prose', source: 'user', content: 'Theo waved.' }, generated];

    expect(requestForRegeneration(turns, 1)).toEqual({ action: 'write' });
  });

  it('regenerates anything else as a continue', () => {
    expect(requestForRegeneration([generated], 0)).toEqual({ action: 'continue' });
    expect(requestForRegeneration([generated, generated], 1)).toEqual({ action: 'continue' });
  });

  it('rewrites a greeting again, from the one its run recorded', () => {
    const greeting = { name: 'Mara', content: 'Mara waves.' };
    const run = {
      steps: [
        { role: 'greeting', kind: 'tool', response: greeting },
        { role: 'writer', kind: 'model' },
      ],
    };

    expect(requestForRegeneration([generated], 0, run)).toEqual({ action: 'greeting', greeting });
    expect(requestForRegeneration([generated], 0, { steps: [] })).toEqual({ action: 'continue' });
  });
});
