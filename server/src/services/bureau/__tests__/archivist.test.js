import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ARCHIVE_CHUNK_CHARACTERS,
  RECORD_MEMORIES_TOOL,
  archiveSettledTurns,
  archiveStory,
  archiveThread,
  autoArchiveThrough,
  chunkTurns,
  isSessionOver,
  settleBackgroundArchives,
  threadSessions,
} from '../archivist.js';
import { memoriesAsOf } from '../memory.js';
import { getBureauStores } from '../stores.js';
import { closeBureauDb } from '../bureau-db.js';
import { DeepSeekError, assertStrictSchema } from '../deepseek-client.js';

const START = '2026-10-27T07:30:00.000Z';

function card(name) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name } };
}

function record(fields = {}) {
  return { knowledge: [], episodes: [], arc_notes: [], story_summary: '', ...fields };
}

/** A knowledge item in which Mara replaces memory `id` with `content`. */
function replacement(id, content) {
  return { character: 'Mara', content, importance: 3, supersedes: id, passages: [0] };
}

/**
 * A client that answers each chat call with the next record as a record_memories call.
 * Set `client.beforeAnswer` to change things while the model is "reading".
 */
function archivistClient(records, { failWith = null } = {}) {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    beforeAnswer: null,
    async chat(options) {
      client.calls.push(options);
      if (failWith) throw failWith;
      client.beforeAnswer?.();
      const next = records[client.calls.length - 1] ?? records.at(-1);
      return {
        content: '',
        reasoning: '',
        finishReason: 'tool_calls',
        model: 'deepseek-flash',
        usage: { prompt_tokens: 900, completion_tokens: 120 },
        toolCalls: [
          {
            id: `call-${client.calls.length}`,
            type: 'function',
            function: {
              name: 'record_memories',
              arguments: typeof next === 'string' ? next : JSON.stringify(next),
            },
          },
        ],
      };
    },
  };
  return client;
}

describe('archiveStory', () => {
  let tempDir;
  let stores;
  let bureau;
  let mara;
  let theo;
  let story;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivist-'));
    stores = getBureauStores(tempDir);
    bureau = stores.bureaus.createBureau({ name: 'Harbor', apiKey: 'sk-test' });
    mara = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Mara'),
      libraryCharacterId: 'c1',
    });
    theo = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Theo'),
      libraryCharacterId: 'c2',
      isPersona: true,
    });
    story = stores.stories.createStory(bureau.id, {
      startTime: START,
      castIds: [mara.id, theo.id],
      title: 'Lamplight',
    });
  });

  afterEach(() => {
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function addProse(content, source = 'generated') {
    return stores.stories.addTurn(story.id, { kind: 'prose', source, content });
  }

  function archive(client, extra = {}) {
    return archiveStory({ stores, bureauId: bureau.id, storyId: story.id, client, ...extra });
  }

  function maraMemories(layer) {
    return stores.memories.listMemories(bureau.id, mara.id, { layer });
  }

  it('uses a schema that strict mode accepts', () => {
    expect(() => assertStrictSchema(RECORD_MEMORIES_TOOL.parameters)).not.toThrow();
  });

  it('reads images in passages as labels', async () => {
    addProse(
      'Theo unrolled the chart.\n\n![the harbor chart](/api/assets/lorebooks/lb-1/chart.webp)',
      'user',
    );
    const client = archivistClient([record({ story_summary: 'Theo unrolls a chart.' })]);

    await archive(client);

    const user = client.calls[0].messages[1].content;
    expect(user).toContain('Theo unrolled the chart.\n\n[image: the harbor chart]');
    expect(user).not.toContain('/api/assets/');
  });

  it('records knowledge, episodes, and the summary from a pass', async () => {
    const confession = addProse("Theo admitted he couldn't swim.", 'user');
    stores.stories.addTurn(story.id, {
      kind: 'direction',
      source: 'user',
      content: 'Make it rain',
    });
    const promise = addProse('Mara promised to teach him before summer.');
    const client = archivistClient([
      record({
        knowledge: [
          {
            character: 'mara',
            content: "Theo can't swim.",
            importance: 4,
            supersedes: 0,
            passages: [confession.position],
          },
          {
            character: 'Mara',
            content: 'Mara promised to teach Theo to swim before summer.',
            importance: 7,
            supersedes: 0,
            passages: [promise.position, 99],
          },
        ],
        episodes: [{ character: 'Mara', content: 'Theo confided in Mara at the pier.' }],
        story_summary: 'Theo confesses he cannot swim; Mara promises lessons.',
      }),
    ]);

    const result = await archive(client);

    expect(result).toMatchObject({
      passes: 1,
      added: 2,
      superseded: 0,
      episodes: 1,
      warnings: [],
      archivedThrough: promise.position,
    });
    expect(maraMemories('knowledge').map((memory) => [memory.content, memory.importance])).toEqual([
      ['Mara promised to teach Theo to swim before summer.', 5],
      ["Theo can't swim.", 4],
    ]);
    expect(maraMemories('knowledge')[0]).toMatchObject({
      sourceType: 'story',
      sourceId: story.id,
      worldTime: START,
      sourceTurnIds: [promise.id],
      runId: result.runId,
    });
    expect(maraMemories('episode').map((memory) => memory.content)).toEqual([
      'Theo confided in Mara at the pier.',
    ]);
    expect(stores.memories.listMemories(bureau.id, theo.id)).toEqual([]);
    expect(stores.stories.getStory(bureau.id, story.id)).toMatchObject({
      archivedThrough: promise.position,
      summary: 'Theo confesses he cannot swim; Mara promises lessons.',
    });

    const [call] = client.calls;
    expect(call).toMatchObject({
      strict: true,
      toolChoice: { name: 'record_memories' },
      thinking: false,
    });
    expect(call.messages[0].content).toContain('Characters who remember: Mara and Theo.');
    expect(call.messages[0].content).toContain(
      "Theo is the reader's character and remembers like everyone else.",
    );
    expect(call.messages[1].content).toContain(`[Passage 0]\nTheo admitted he couldn't swim.`);
    expect(call.messages[1].content).not.toContain('Make it rain');

    const run = stores.bureaus.getRun(bureau.id, result.runId);
    expect(run).toMatchObject({ purpose: 'archive', targetId: story.id, status: 'completed' });
    expect(run.steps.map((step) => [step.role, step.kind])).toEqual([
      ['archivist', 'model'],
      ['archivist', 'tool'],
    ]);
  });

  it('updates what characters know on later passes', async () => {
    const earlier = stores.stories.createStory(bureau.id, {
      startTime: '2026-10-01T20:00:00.000Z',
      castIds: [mara.id, theo.id],
    });
    const afraid = stores.memories.addMemory(bureau.id, mara.id, {
      layer: 'knowledge',
      content: 'Theo is afraid of water.',
      sourceType: 'story',
      sourceId: earlier.id,
      worldTime: earlier.startTime,
    });
    const pinned = stores.memories.addMemory(bureau.id, mara.id, {
      layer: 'knowledge',
      content: 'Theo hates boats.',
      pinned: true,
    });

    addProse('Theo waded in up to his knees.');
    const firstClient = archivistClient([
      record({
        knowledge: [
          {
            character: 'Mara',
            content: 'Theo is getting braver about water.',
            importance: 3,
            supersedes: afraid.id,
            passages: [0],
          },
        ],
        episodes: [{ character: 'Mara', content: 'First episode.' }],
        story_summary: 'Summary one.',
      }),
    ]);
    const first = await archive(firstClient);
    expect(first.superseded).toBe(1);

    addProse('Theo swam to the buoy and back.');
    const secondClient = archivistClient([
      record({
        knowledge: [
          {
            character: 'Mara',
            content: 'Theo likes boats now.',
            importance: 3,
            supersedes: pinned.id,
            passages: [1],
          },
        ],
        episodes: [{ character: 'Mara', content: 'Second episode.' }],
        story_summary: 'Summary two.',
      }),
    ]);
    const second = await archive(secondClient);

    const prompt = secondClient.calls[0].messages[1].content;
    expect(prompt).toContain('=== SUMMARY SO FAR ===\nSummary one.');
    expect(prompt).toContain('Theo is getting braver about water.');
    expect(prompt).not.toContain('Theo is afraid of water.');
    expect(prompt).toContain(`[${pinned.id}] Theo hates boats.`);
    expect(prompt).toContain('Episode for this chapter so far: First episode.');
    expect(prompt).not.toContain('Theo waded in');
    expect(second.warnings).toEqual([`Kept memory ${pinned.id} for Mara: it can't be replaced`]);
    expect(maraMemories('episode').map((memory) => memory.content)).toEqual(['Second episode.']);
    expect(stores.memories.getMemory(bureau.id, pinned.id).supersededBy).toBeNull();
  });

  it('flags what it recorded from a passage that changed while it was reading', async () => {
    const turn = addProse("Theo admitted he couldn't swim.");
    const client = archivistClient([
      record({
        knowledge: [
          {
            character: 'Mara',
            content: "Theo can't swim.",
            importance: 4,
            supersedes: 0,
            passages: [turn.position],
          },
        ],
        episodes: [{ character: 'Mara', content: 'Theo confided in Mara.' }],
      }),
    ]);
    client.beforeAnswer = () =>
      stores.stories.editTurn(story.id, turn.id, 'Theo admitted he could swim a little.');

    const result = await archive(client);

    expect(maraMemories().map((memory) => [memory.layer, memory.needsReview])).toEqual([
      ['episode', true],
      ['knowledge', true],
    ]);
    expect(result.warnings).toEqual([
      'Marked for review: 1 passage(s) changed while the Archivist read them',
    ]);
  });

  it('leaves memories alone that were pinned, edited, or already replaced during the pass', async () => {
    const add = (content) =>
      stores.memories.addMemory(bureau.id, mara.id, { layer: 'knowledge', content });
    const pinnedLater = add('Theo hates boats.');
    const editedLater = add('Theo hates tea.');
    const replacedTwice = add('Theo lives inland.');
    addProse('Theo rowed out alone and drank his tea on the water.');
    const client = archivistClient([
      record({
        knowledge: [
          replacement(pinnedLater.id, 'Theo likes boats now.'),
          replacement(editedLater.id, 'Theo drinks tea on the water.'),
          replacement(replacedTwice.id, 'Theo lives by the sea.'),
          replacement(replacedTwice.id, 'Theo moved to the coast.'),
        ],
      }),
    ]);
    client.beforeAnswer = () => {
      stores.memories.updateMemory(bureau.id, pinnedLater.id, { pinned: true });
      stores.memories.updateMemory(bureau.id, editedLater.id, {
        content: 'Theo hates strong tea.',
      });
    };

    const result = await archive(client);

    expect(result).toMatchObject({ added: 4, superseded: 1 });
    expect(result.warnings).toHaveLength(3);
    expect(stores.memories.getMemory(bureau.id, pinnedLater.id).supersededBy).toBeNull();
    expect(stores.memories.getMemory(bureau.id, editedLater.id)).toMatchObject({
      content: 'Theo hates strong tea.',
      supersededBy: null,
    });
    expect(stores.memories.getMemory(bureau.id, replacedTwice.id).supersededBy).not.toBeNull();
  });

  it('cites every passage in an episode, and keeps a pinned episode', async () => {
    const episode = (content) => record({ episodes: [{ character: 'Mara', content }] });
    const first = addProse('Theo waded in.');
    await archive(archivistClient([episode('First.')]));
    const second = addProse('Theo swam to the buoy.');
    await archive(archivistClient([episode('Second.')]));

    const [current] = maraMemories('episode');
    expect(current).toMatchObject({ content: 'Second.', sourceTurnIds: [first.id, second.id] });

    stores.memories.updateMemory(bureau.id, current.id, { pinned: true });
    addProse('Theo floated on his back.');
    const result = await archive(archivistClient([episode('Third.')]));

    expect(result.episodes).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(maraMemories('episode').map((memory) => memory.content)).toEqual(['Second.']);
  });

  it('proposes arc notes for review, skipping changes already had, waiting, or rejected', async () => {
    stores.arcNotes.addNote(bureau.id, mara.id, {
      content: 'Mara trusts Theo with the boat.',
      status: 'accepted',
    });
    stores.arcNotes.addNote(bureau.id, mara.id, {
      content: 'Mara has softened toward Theo.',
      status: 'rejected',
    });
    stores.arcNotes.addNote(bureau.id, mara.id, {
      content: 'Mara laughs more easily.',
      sourceType: 'story',
      sourceId: story.id,
      worldTime: START,
    });
    const turn = addProse('Mara handed Theo the oars without a word.');
    const note = (content, character = 'Mara') => ({
      character,
      content,
      rationale: 'She gave him the oars.',
      passages: [turn.position],
    });
    const client = archivistClient([
      record({
        arc_notes: [
          note('Mara lets Theo steer now.'),
          note('mara trusts theo with the boat.'),
          note('Mara laughs more easily.'),
          note('Mara has softened toward Theo.'),
          note('Theo is braver.', 'Theo'),
        ],
      }),
    ]);

    const result = await archive(client);

    expect(result.arcNotes).toBe(2);
    // The reader's character changes too, and the reader reviews it like any other note.
    expect(
      stores.arcNotes
        .listNotes(bureau.id, theo.id, { status: 'proposed' })
        .map((item) => item.content),
    ).toEqual(['Theo is braver.']);
    const proposed = stores.arcNotes.listNotes(bureau.id, mara.id, { status: 'proposed' });
    expect(proposed.map((item) => item.content)).toEqual([
      'Mara laughs more easily.',
      'Mara lets Theo steer now.',
    ]);
    expect(proposed[1]).toMatchObject({
      rationale: 'She gave him the oars.',
      sourceId: story.id,
      sourceTurnIds: [turn.id],
      runId: result.runId,
    });
    const [system, user] = client.calls[0].messages;
    expect(system.content).toContain('Arc notes: only when the passages change who a character is');
    expect(user.content).toContain(
      'How Mara has changed so far:\n- Mara trusts Theo with the boat.',
    );
    expect(user.content).toContain(
      'Changes already waiting for review:\n- Mara laughs more easily.',
    );
    expect(user.content).toContain(
      'Changes the reader turned down (never propose these again):\n- Mara has softened toward Theo.',
    );
    // Theo's note is kept: the reader's character changes like anyone else.
    expect(result.warnings).toEqual([]);
  });

  it("skips memories for anyone who isn't in the chapter, but keeps the reader's character's", async () => {
    addProse('Theo waved from the dock.');
    const client = archivistClient([
      record({
        knowledge: [
          { character: 'Theo', content: 'Theo waved.', importance: 2, supersedes: 0, passages: [] },
          { character: 'Nobody', content: 'Hm.', importance: 2, supersedes: 0, passages: [] },
          { character: 'Mara', content: '  ', importance: 2, supersedes: 0, passages: [] },
        ],
      }),
    ]);

    const result = await archive(client);

    expect(result.added).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(
      stores.memories.listMemories(bureau.id, theo.id).map((memory) => memory.content),
    ).toEqual(['Theo waved.']);
  });

  it('reads long stretches in several passes', async () => {
    const third = Math.ceil(ARCHIVE_CHUNK_CHARACTERS / 2.5);
    for (const letter of ['A', 'B', 'C']) addProse(letter.repeat(third));
    const client = archivistClient([
      record({ story_summary: 'Part one.' }),
      record({ story_summary: 'Parts one and two.' }),
    ]);

    const result = await archive(client);

    expect(client.calls).toHaveLength(2);
    expect(client.calls[1].messages[1].content).toContain('Part one.');
    expect(result).toMatchObject({ passes: 2, archivedThrough: 2 });
    expect(stores.stories.getStory(bureau.id, story.id).summary).toBe('Parts one and two.');
  });

  it('only reads through the given position', async () => {
    addProse('One.');
    addProse('Two.');
    const client = archivistClient([record()]);

    const result = await archive(client, { through: 0 });

    expect(result.archivedThrough).toBe(0);
    expect(client.calls[0].messages[1].content).not.toContain('Two.');
  });

  it('fails the run and records nothing when the call fails', async () => {
    addProse('Theo knocked.');
    const failure = new DeepSeekError('DeepSeek API error 402 (insufficient balance): Top up');
    const client = archivistClient([], { failWith: failure });

    await expect(archive(client)).rejects.toBe(failure);

    expect(maraMemories()).toEqual([]);
    expect(stores.stories.getStory(bureau.id, story.id).archivedThrough).toBe(-1);
    const [run] = stores.bureaus.listRuns(bureau.id);
    expect(run).toMatchObject({ purpose: 'archive', status: 'failed', error: failure.message });
  });

  it("fails on a record that isn't valid JSON", async () => {
    addProse('Theo knocked.');

    await expect(archive(archivistClient(['{"knowledge": [']))).rejects.toThrow(/valid JSON/);
    expect(stores.stories.getStory(bureau.id, story.id).archivedThrough).toBe(-1);
  });

  it('skips the model when there is nothing to remember', async () => {
    const client = archivistClient([record()]);
    expect(await archive(client)).toBeNull();

    stores.stories.addTurn(story.id, { kind: 'direction', source: 'user', content: 'Rain.' });
    stores.stories.addTurn(story.id, { kind: 'scene_break', source: 'user' });
    const result = await archive(client);

    expect(client.calls).toHaveLength(0);
    expect(result).toMatchObject({ passes: 0, archivedThrough: 1, runId: null });
    expect(stores.bureaus.listRuns(bureau.id)).toEqual([]);
  });

  it('reads time passing in the chapter as a scene break with the new time', async () => {
    stores.bureaus.updateBureau(bureau.id, { timezone: 'UTC' });
    addProse('Theo knocked.');
    stores.stories.addTurn(story.id, {
      kind: 'time_passes',
      source: 'user',
      bureauTime: '2026-10-28T08:00:00.000Z',
    });
    addProse('Morning came grey.');
    const client = archivistClient([record()]);

    await archive(client);

    const user = client.calls[0].messages[1].content;
    expect(user).toContain(
      "Theo knocked.\n\n---\n\n[Time passes. It's now exactly 8:00 AM on Wednesday, October 28, 2026.]\n\n",
    );
    expect(user).toContain('Morning came grey.');
  });

  it('tells a later pass when time last passed before its passages', async () => {
    stores.bureaus.updateBureau(bureau.id, { timezone: 'UTC' });
    addProse('Theo knocked.');
    stores.stories.addTurn(story.id, {
      kind: 'time_passes',
      source: 'user',
      bureauTime: '2026-10-28T08:00:00.000Z',
    });
    const client = archivistClient([record(), record()]);
    await archive(client);
    addProse('Morning came grey.');

    await archive(client);

    const [first, later] = client.calls.map((call) => call.messages[1].content);
    expect(first).not.toContain('Before these passages');
    expect(later).toContain(
      'Before these passages, time passed to: 8:00 AM on Wednesday, October 28, 2026',
    );
    expect(later).not.toContain('[Time passes.');
  });

  it('runs one archive at a time per story', async () => {
    addProse('Theo knocked.');
    const client = archivistClient([record()]);

    const [first, second] = await Promise.all([archive(client), archive(client)]);

    expect(first.passes).toBe(1);
    expect(second).toBeNull();
    expect(client.calls).toHaveLength(1);
  });

  it('archives settled turns in the background once enough have settled', async () => {
    for (let index = 0; index < 11; index += 1) addProse(`Passage ${index}.`);
    const client = archivistClient([record()]);
    const start = () =>
      archiveSettledTurns({ stores, bureauId: bureau.id, storyId: story.id, client });

    expect(start()).toBeNull();

    addProse('Passage 11.');
    expect(start()).not.toBeNull();
    await settleBackgroundArchives();

    expect(stores.stories.getStory(bureau.id, story.id).archivedThrough).toBe(5);
    expect(client.calls[0].messages[1].content).not.toContain('Passage 6.');
  });
});

function prose(position) {
  return { position, kind: 'prose', content: '' };
}

function direction(position) {
  return { position, kind: 'direction', content: '' };
}

function textTurn(length) {
  return { content: 'x'.repeat(length) };
}

describe('archiveThread', () => {
  let tempDir;
  let stores;
  let bureau;
  let mara;
  let theo;
  let thread;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivist-threads-'));
    stores = getBureauStores(tempDir);
    bureau = stores.bureaus.createBureau({ name: 'Harbor', apiKey: 'sk-test' });
    mara = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Mara'),
      libraryCharacterId: 'c1',
    });
    theo = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Theo'),
      libraryCharacterId: 'c2',
      isPersona: true,
    });
    thread = stores.threads.getOrCreateThread(bureau.id, mara.id);
  });

  afterEach(() => {
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function send(source, content, bureauTime) {
    return stores.threads.addMessage(thread.id, {
      source,
      content,
      bureauTime,
      senderCastId: source === 'user' ? theo.id : mara.id,
    });
  }

  function archive(client, extra = {}) {
    return archiveThread({ stores, bureauId: bureau.id, threadId: thread.id, client, ...extra });
  }

  it('reads each session into memories dated to its first message', async () => {
    const question = send('user', "Can't sleep. Storm's loud.", '2026-10-01T06:00:00.000Z');
    send('generated', 'Come up to the lamp room then.', '2026-10-01T06:05:00.000Z');
    const later = send('user', 'Made it home.', '2026-10-03T19:00:00.000Z');
    const client = archivistClient([
      record({
        knowledge: [
          {
            character: 'Mara',
            content: 'Theo has trouble sleeping in storms.',
            importance: 3,
            supersedes: 0,
            passages: [question.position],
          },
        ],
        episodes: [{ character: 'Mara', content: 'Theo texted before dawn during the storm.' }],
        story_summary: 'Ignored for threads.',
      }),
      record({ episodes: [{ character: 'Mara', content: 'Theo let her know he got home.' }] }),
    ]);

    const result = await archive(client);

    expect(result).toMatchObject({
      passes: 2,
      added: 1,
      episodes: 2,
      archivedThrough: later.position,
    });
    expect(
      stores.memories.listMemories(bureau.id, mara.id, { layer: 'knowledge' })[0],
    ).toMatchObject({
      sourceType: 'correspondence',
      sourceId: thread.id,
      worldTime: '2026-10-01T06:00:00.000Z',
      sourceTurnIds: [question.id],
    });
    expect(
      stores.memories
        .listMemories(bureau.id, mara.id, { layer: 'episode' })
        .map((memory) => [memory.content, memory.worldTime]),
    ).toEqual([
      ['Theo let her know he got home.', '2026-10-03T19:00:00.000Z'],
      ['Theo texted before dawn during the storm.', '2026-10-01T06:00:00.000Z'],
    ]);
    expect(stores.threads.getThread(bureau.id, thread.id).archivedThrough).toBe(later.position);

    const [first] = client.calls;
    expect(first.messages[0].content).toContain('Read the new messages');
    expect(first.messages[0].content).toContain('exchange of messages');
    expect(first.messages[1].content).toContain(
      "=== MESSAGES ===\nBetween: Mara and Theo (the reader's character)",
    );
    expect(first.messages[1].content).toContain(
      `[Message ${question.position}]\nTheo: Can't sleep. Storm's loud.`,
    );
    expect(first.messages[1].content).not.toContain('Made it home.');
    expect(stores.bureaus.getRun(bureau.id, result.runId)).toMatchObject({
      purpose: 'archive',
      targetId: thread.id,
      status: 'completed',
    });
  });

  it("gives the reader's character memories from their messages, as whoever sent them", async () => {
    const message = send('user', "I'm leaving the island.", '2026-10-01T06:00:00.000Z');
    send('generated', 'Take the early ferry.', '2026-10-01T06:05:00.000Z');
    // The reader picks someone else before the messages are committed.
    const ines = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Ines'),
      libraryCharacterId: 'c3',
      isPersona: true,
    });
    const client = archivistClient([
      record({
        knowledge: [
          {
            character: 'Theo',
            content: 'Theo told Mara he is leaving the island.',
            importance: 4,
            supersedes: 0,
            passages: [message.position],
          },
        ],
        episodes: [
          { character: 'Theo', content: 'Theo texted Mara that he was leaving.' },
          { character: 'Ines', content: 'Ines read the messages.' },
        ],
      }),
    ]);

    const result = await archive(client);

    const theoMemories = stores.memories
      .listMemories(bureau.id, theo.id)
      .map((memory) => memory.content);
    expect(theoMemories).toHaveLength(2);
    expect(theoMemories).toEqual(
      expect.arrayContaining([
        'Theo told Mara he is leaving the island.',
        'Theo texted Mara that he was leaving.',
      ]),
    );
    expect(stores.memories.listMemories(bureau.id, ines.id)).toEqual([]);
    expect(result.warnings).toEqual([expect.stringContaining('"Ines"')]);
    const [system, user] = client.calls[0].messages;
    expect(system.content).toContain('Characters who remember: Mara and Theo.');
    expect(user.content).toContain(`[Message ${message.position}]\nTheo: I'm leaving the island.`);
  });

  it('leaves a session that may still be going when only settled ones are read', async () => {
    // Decades have passed on the real clock; only Bureau time moving on settles a session.
    stores.bureaus.setBureauTime(bureau.id, '1996-10-01T07:00:00.000Z');
    const earlier = send('user', 'Up early?', '1996-09-30T08:00:00.000Z');
    send('user', 'Storm again.', '1996-10-01T06:30:00.000Z');
    const client = archivistClient([record()]);

    expect(await archive(client, { settledOnly: true })).toMatchObject({ passes: 1 });
    expect(stores.threads.getThread(bureau.id, thread.id).archivedThrough).toBe(earlier.position);
    expect(await archive(client, { settledOnly: true })).toBeNull();
    stores.bureaus.setBureauTime(bureau.id, '1996-10-01T10:00:00.000Z');
    expect(await archive(client, { settledOnly: true })).toMatchObject({ passes: 1 });
  });

  it('ends a session when Bureau time is set back before it', async () => {
    stores.bureaus.setBureauTime(bureau.id, '2026-10-01T20:00:00.000Z');
    const message = send('user', 'Lamp lit?', '2026-10-01T20:00:00.000Z');
    const client = archivistClient([record()]);

    expect(await archive(client, { settledOnly: true })).toBeNull();
    stores.bureaus.setBureauTime(bureau.id, '2026-10-01T19:00:00.000Z');
    expect(await archive(client, { settledOnly: true })).toMatchObject({
      passes: 1,
      archivedThrough: message.position,
    });
  });

  it('keeps messages before a chapter apart from those after it, at the same Bureau time', async () => {
    const at = '2026-10-01T20:00:00.000Z';
    stores.bureaus.setBureauTime(bureau.id, at);
    const client = archivistClient([
      record({ episodes: [{ character: 'Mara', content: 'Theo said the ferry was in.' }] }),
      record({ episodes: [{ character: 'Mara', content: 'Theo said he got home.' }] }),
    ]);
    // The messages and the chapter are written a few minutes apart.
    vi.useFakeTimers({ toFake: ['Date'] });
    let before;
    let story;
    try {
      vi.setSystemTime('2026-09-12T10:00:00.000Z');
      before = send('user', 'Ferry is in.', at);
      expect(await archive(client, { settledOnly: true })).toBeNull();

      vi.setSystemTime('2026-09-12T10:05:00.000Z');
      story = stores.stories.createStory(bureau.id, { startTime: at, castIds: [mara.id, theo.id] });
      vi.setSystemTime('2026-09-12T10:10:00.000Z');
      send('user', 'Home now.', at);

      // The chapter starting ended the first session, though the clock never moved.
      expect(await archive(client, { settledOnly: true })).toMatchObject({
        passes: 1,
        archivedThrough: before.position,
      });
      expect(await archive(client)).toMatchObject({ passes: 1 });
    } finally {
      vi.useRealTimers();
    }

    const episodes = stores.memories.listMemories(bureau.id, mara.id, {
      status: 'all',
      layer: 'episode',
    });
    expect(episodes.map((memory) => memory.content).toSorted()).toEqual([
      'Theo said he got home.',
      'Theo said the ferry was in.',
    ]);
    // The chapter remembers the exchange written before it started, not the one after.
    expect(memoriesAsOf(episodes, story).map((memory) => memory.content)).toEqual([
      'Theo said the ferry was in.',
    ]);
  });

  it("rewrites a session's episode when the session grows", async () => {
    const opening = send('user', 'Lamp lit?', '2026-10-01T20:00:00.000Z');
    const client = archivistClient([
      record({ episodes: [{ character: 'Mara', content: 'Theo checked on the lamp.' }] }),
      record({
        episodes: [
          { character: 'Mara', content: 'Theo checked on the lamp, then said goodnight.' },
        ],
      }),
    ]);

    await archive(client);
    const goodnight = send('user', 'Goodnight.', '2026-10-01T20:30:00.000Z');
    await archive(client);

    const episodes = stores.memories.listMemories(bureau.id, mara.id, { layer: 'episode' });
    expect(episodes.map((memory) => memory.content)).toEqual([
      'Theo checked on the lamp, then said goodnight.',
    ]);
    expect(episodes[0].sourceTurnIds).toEqual([opening.id, goodnight.id]);
    expect(client.calls[1].messages[1].content).toContain(
      'Episode for this exchange so far: Theo checked on the lamp.',
    );
  });

  it('flags what it recorded from a message that changed while it was reading', async () => {
    const message = send('user', 'The ferry is late.', '2026-10-01T20:00:00.000Z');
    const client = archivistClient([
      record({
        knowledge: [
          {
            character: 'Mara',
            content: 'The ferry was late.',
            importance: 2,
            supersedes: 0,
            passages: [message.position],
          },
        ],
      }),
    ]);
    client.beforeAnswer = () =>
      stores.threads.editMessage(thread.id, message.id, 'The ferry is cancelled.');

    const result = await archive(client);

    expect(result.warnings).toContain(
      'Marked for review: 1 message(s) changed while the Archivist read them',
    );
    expect(stores.memories.listMemories(bureau.id, mara.id)[0].needsReview).toBe(true);
  });
});

const idsOf = (sessions) => sessions.map((session) => session.map((message) => message.id));

/** A message sent at a Bureau time and written at a real time. */
const messageAt = (id, bureauTime, created) => ({ id, bureauTime, created });

describe('threadSessions', () => {
  it('splits messages at gaps over three hours', () => {
    const sessions = threadSessions([
      { id: 'a', bureauTime: '2026-10-01T06:00:00Z' },
      { id: 'b', bureauTime: '2026-10-01T09:00:00Z' },
      { id: 'c', bureauTime: '2026-10-01T12:01:00Z' },
    ]);

    expect(idsOf(sessions)).toEqual([['a', 'b'], ['c']]);
  });

  it('splits messages where a chapter started between them or Bureau time went back', () => {
    const sessions = threadSessions(
      [
        messageAt('a', '2026-10-01T06:00:00Z', '2026-09-12T10:00:00Z'),
        messageAt('b', '2026-10-01T06:00:00Z', '2026-09-12T10:10:00Z'),
        // A chapter started at 10:20, at the same Bureau time.
        messageAt('c', '2026-10-01T06:00:00Z', '2026-09-12T10:30:00Z'),
        // Then the clock was set back an hour.
        messageAt('d', '2026-10-01T05:00:00Z', '2026-09-12T10:40:00Z'),
        messageAt('e', '2026-10-01T05:30:00Z', '2026-09-12T10:50:00Z'),
      ],
      { breaks: ['2026-09-12T10:20:00Z', '2026-09-12T11:00:00Z'] },
    );

    expect(idsOf(sessions)).toEqual([['a', 'b'], ['c'], ['d', 'e']]);
  });
});

describe('isSessionOver', () => {
  const session = [
    { id: 'a', bureauTime: '2026-10-01T06:00:00Z', created: '2026-09-12T10:00:00Z' },
  ];

  it('ends a session once Bureau time moves on more than three hours, or back before it', () => {
    expect(isSessionOver(session, '2026-10-01T09:00:00Z')).toBe(false);
    expect(isSessionOver(session, '2026-10-01T09:01:00Z')).toBe(true);
    expect(isSessionOver(session, '2026-10-01T05:59:00Z')).toBe(true);
  });

  it('ends a session once a chapter starts after it, at any Bureau time', () => {
    expect(isSessionOver(session, '2026-10-01T06:00:00Z', ['2026-09-12T09:00:00Z'])).toBe(false);
    expect(isSessionOver(session, '2026-10-01T06:00:00Z', ['2026-09-12T10:05:00Z'])).toBe(true);
  });
});

describe('autoArchiveThrough', () => {
  it('waits until enough prose has settled behind the latest turns', () => {
    const turns = Array.from({ length: 12 }, (_, position) => prose(position));

    expect(autoArchiveThrough(turns.slice(0, 11), { archivedThrough: -1 })).toBeNull();
    expect(autoArchiveThrough(turns, { archivedThrough: -1 })).toBe(5);
    expect(autoArchiveThrough(turns, { archivedThrough: 0 })).toBeNull();
  });

  it("doesn't count directions toward what has settled", () => {
    const turns = [
      ...Array.from({ length: 5 }, (_, position) => prose(position)),
      direction(5),
      ...Array.from({ length: 6 }, (_, index) => prose(index + 6)),
    ];

    expect(autoArchiveThrough(turns, { archivedThrough: -1 })).toBeNull();
  });
});

describe('chunkTurns', () => {
  it('splits by text length, keeping at least one turn per chunk', () => {
    const chunks = chunkTurns([textTurn(30), textTurn(30), textTurn(200), textTurn(10)], 100);

    expect(chunks.map((chunk) => chunk.length)).toEqual([2, 1, 1]);
    expect(chunkTurns([])).toEqual([]);
  });
});
