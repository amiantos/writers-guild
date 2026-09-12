import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ARCHIVE_CHUNK_CHARACTERS,
  RECORD_MEMORIES_TOOL,
  archiveSettledTurns,
  archiveStory,
  autoArchiveThrough,
  chunkTurns,
  settleBackgroundArchives,
} from '../archivist.js';
import { getBureauStores } from '../stores.js';
import { closeBureauDb } from '../bureau-db.js';
import { DeepSeekError, assertStrictSchema } from '../deepseek-client.js';

const START = '2026-10-27T07:30:00.000Z';

function card(name) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name } };
}

function record(fields = {}) {
  return { knowledge: [], episodes: [], story_summary: '', ...fields };
}

/** A client that answers each chat call with the next record as a record_memories call. */
function archivistClient(records, { failWith = null } = {}) {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    async chat(options) {
      client.calls.push(options);
      if (failWith) throw failWith;
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
    expect(call.messages[0].content).toContain('Characters who remember: Mara.');
    expect(call.messages[0].content).toContain("Theo is the reader's character.");
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
    expect(prompt).toContain('Episode for this story so far: First episode.');
    expect(prompt).not.toContain('Theo waded in');
    expect(second.warnings).toEqual([`Kept memory ${pinned.id} for Mara: it can't be replaced`]);
    expect(maraMemories('episode').map((memory) => memory.content)).toEqual(['Second episode.']);
    expect(stores.memories.getMemory(bureau.id, pinned.id).supersededBy).toBeNull();
  });

  it("skips memories for anyone who isn't a character that remembers", async () => {
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

    expect(result.added).toBe(0);
    expect(result.warnings).toHaveLength(2);
    expect(stores.memories.listMemories(bureau.id, theo.id)).toEqual([]);
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
