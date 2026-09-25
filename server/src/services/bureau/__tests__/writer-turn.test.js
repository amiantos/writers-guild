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
    // The Writer's text is saved as written, with no checks or fixes after it.
    expect(run.steps.map((step) => [step.role, step.kind])).toEqual([['writer', 'model']]);
    expect(run.steps[0]).toMatchObject({
      role: 'writer',
      kind: 'model',
      reasoning: 'Mara answers.',
      usage: { prompt_tokens: 120, completion_tokens: 20 },
      response: { content: 'Mara opened the door.', finishReason: 'stop' },
    });
    // Writing a passage and generating is story mode's Continue.
    expect(run.steps[0].request.messages[1].content).toMatch(
      /^Here is the current story so far:\n\nTheo knocked\.\n\n---\n\nContinue the story naturally from where it left off\. Write the next 7 paragraphs/,
    );
  });

  it('starts with thinking off, temperature 0.5, and 8000 tokens', async () => {
    const client = streamingClient([{ type: 'content', text: 'Dusk.' }, done('Dusk.')]);

    await generate(client, { action: 'continue' });

    expect(client.calls[0]).toMatchObject({ thinking: false, temperature: 0.5, maxTokens: 8000 });
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
      '=== WORLD INFORMATION ===\nThe lighthouse went dark in 1971.',
    );
  });

  it("gives the Writer the chapter's scenario, which activates lore too", async () => {
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
    stores.stories.updateStory(bureau.id, story.id, {
      scenario: 'Theo spends a stormy night at the lighthouse.',
    });
    const client = streamingClient([{ type: 'content', text: 'Dusk.' }, done('Dusk.')]);

    await generate(client, { action: 'continue' });

    const system = client.calls[0].messages[0].content;
    expect(system).toContain('=== SCENARIO ===\nTheo spends a stormy night at the lighthouse.');
    expect(system).toContain('=== WORLD INFORMATION ===\nThe lighthouse went dark in 1971.');
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
      '=== WORLD INFORMATION ===\nThe lighthouse went dark in 1971.',
    );
  });

  it('reminds characters of earlier stories, but not of this one', async () => {
    // Pinned, so chapter times format the same on any machine.
    stores.bureaus.updateBureau(bureau.id, { timezone: 'America/Los_Angeles' });
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
    // Chapters used to leave episodes; their summaries tell what happened instead.
    fromStory(mara.id, earlier, 'episode', 'An episode from before summaries.');
    stores.stories.setArchiveProgress(earlier.id, {
      archivedThrough: -1,
      summary: 'Mara met Theo at the pier.',
    });
    const later = stores.stories.createStory(bureau.id, {
      startTime: '2026-11-20T20:00:00.000Z',
      castIds: [mara.id],
      title: 'Later',
    });
    stores.stories.setArchiveProgress(later.id, { archivedThrough: -1, summary: 'Not yet.' });
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
    expect(system).toContain("Mara knows:\n- Theo can't swim.\n");
    expect(system).toContain(
      'The Pier (began 1:00 PM on Thursday, October 1, 2026):\nMara met Theo at the pier.',
    );
    expect(system).not.toMatch(/An episode from before summaries|Not yet\./);
    expect(system).toContain('How Mara has changed:\n- Mara lets Theo take the oars now.');
    expect(system).not.toContain('waits to be asked');
    expect(system).not.toContain('waded in');
    // The reader's character remembers too.
    expect(system).toContain('Theo knows:\n- Theo remembers the pier.');
  });

  it('gives the Writer as many earlier chapters as the settings say', async () => {
    const chapter = (title, startTime) => {
      const created = stores.stories.createStory(bureau.id, { startTime, castIds: [mara.id] });
      stores.stories.updateStory(bureau.id, created.id, { title });
      stores.stories.setArchiveProgress(created.id, {
        archivedThrough: -1,
        summary: `What happened in ${title}.`,
      });
    };
    chapter('First', '2026-10-01T20:00:00.000Z');
    chapter('Second', '2026-10-08T20:00:00.000Z');
    stores.bureaus.updateSettings(bureau.id, { memory: { recentChapters: 1 } });
    const client = streamingClient([{ type: 'content', text: 'Dusk.' }, done('Dusk.')]);

    await generate(client, { action: 'continue' });

    const system = client.calls[0].messages[0].content;
    expect(system).toContain('What happened in Second.');
    expect(system).not.toContain('What happened in First.');

    stores.bureaus.updateSettings(bureau.id, { memory: { recentChapters: 0 } });
    const none = streamingClient([{ type: 'content', text: 'Dusk.' }, done('Dusk.')]);
    await generate(none, { action: 'continue' });
    expect(none.calls[0].messages[0].content).not.toContain('EARLIER CHAPTERS');
  });

  it('sets the opening at the story start time, in the Bureau time zone', async () => {
    stores.bureaus.updateBureau(bureau.id, { timezone: 'America/Los_Angeles' });
    const client = streamingClient([{ type: 'content', text: 'Midnight.' }, done('Midnight.')]);

    await generate(client, { action: 'continue' });

    expect(client.calls[0].messages[0].content).toContain(
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

    const [system, user] = client.calls[0].messages.map((message) => message.content);
    expect(system).toContain(
      "Time has just passed: it's now exactly 8:00 AM on Wednesday, October 28, 2026.",
    );
    expect(system).not.toContain('October 31');
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

  it('rewrites a greeting, keeping an image the Writer leaves out', async () => {
    const greeting = {
      name: 'Mara',
      content:
        '![Mara at the lamp](/api/assets/characters/c1/lamp.webp)\n\nMara looks up as you come in.',
    };
    const client = streamingClient([
      { type: 'content', text: 'Mara looked up as Theo came in.' },
      done('Mara looked up as Theo came in.'),
    ]);

    const turn = await generate(client, { action: 'greeting', greeting });

    expect(client.calls[0].messages[1].content).toContain(
      'Text to rewrite:\n\n[WG_IMAGE_0]\n\nMara looks up as you come in.',
    );
    expect(turn.content).toBe(
      'Mara looked up as Theo came in.\n\n![Mara at the lamp](/api/assets/characters/c1/lamp.webp)',
    );
    const run = stores.bureaus.getRun(bureau.id, turn.runId);
    expect(run.steps.map((step) => step.role)).toEqual(['greeting', 'writer']);
    expect(requestForRegeneration([turn], 0, run)).toEqual({ action: 'greeting', greeting });
  });

  it('continues for one character, and records who for writing another version', async () => {
    const ivo = stores.bureaus.addCastMember(bureau.id, { seedCard: card('Ivo', 'Harbormaster.') });
    stores.stories.updateStory(bureau.id, story.id, { castIds: [mara.id, ivo.id, theo.id] });
    stores.stories.addTurn(story.id, { kind: 'prose', source: 'user', content: 'Theo knocked.' });
    const client = streamingClient([
      { type: 'content', text: 'Ivo grunted.' },
      done('Ivo grunted.'),
    ]);
    const character = { castId: ivo.id, name: 'Ivo' };

    const turn = await generate(client, { action: 'character', character });

    const [system, user] = client.calls[0].messages.map((message) => message.content);
    // Everyone's card stays in the prompt; only the instruction changes.
    expect(system).toContain('Character 1: Mara');
    expect(system).toContain('Character 2: Ivo');
    expect(user).toContain("Write the next part of the story from Ivo's perspective.");
    const run = stores.bureaus.getRun(bureau.id, turn.runId);
    expect(run.steps[0].request.character).toEqual(character);
    const turns = stores.stories.listTurns(story.id);
    expect(requestForRegeneration(turns, 1, run)).toEqual({ action: 'character', character });
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

  it('continues for the same character again, from the one its Writer step recorded', () => {
    const character = { castId: 'cast-ivo', name: 'Ivo' };
    const turns = [{ kind: 'prose', source: 'user', content: 'Theo waved.' }, generated];
    const run = { steps: [{ role: 'writer', kind: 'model', request: { character } }] };

    expect(requestForRegeneration(turns, 1, run)).toEqual({ action: 'character', character });
    const plain = { steps: [{ role: 'writer', kind: 'model', request: {} }] };
    expect(requestForRegeneration(turns, 1, plain)).toEqual({ action: 'write' });
  });
});
