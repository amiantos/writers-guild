import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MemoryStorage, clampImportance, toFtsQuery } from '../memory-storage.js';
import { BureauStorage } from '../bureau-storage.js';
import { StoryStorage } from '../story-storage.js';
import { closeBureauDb } from '../bureau-db.js';

const START = '2026-10-27T07:30:00.000Z';

function card(name) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name } };
}

describe('MemoryStorage', () => {
  let tempDir;
  let bureaus;
  let stories;
  let memories;
  let bureau;
  let mara;
  let story;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-storage-'));
    bureaus = new BureauStorage(tempDir);
    stories = new StoryStorage(tempDir);
    memories = new MemoryStorage(tempDir);
    bureau = bureaus.createBureau({ name: 'Harbor' });
    mara = bureaus.addCastMember(bureau.id, { seedCard: card('Mara'), libraryCharacterId: 'c1' });
    story = stories.createStory(bureau.id, {
      startTime: START,
      castIds: [mara.id],
      title: 'Lamplight',
    });
  });

  afterEach(() => {
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function remember(content, fields = {}) {
    return memories.addMemory(bureau.id, mara.id, {
      layer: 'knowledge',
      content,
      sourceType: 'story',
      sourceId: story.id,
      worldTime: START,
      ...fields,
    });
  }

  function search(text) {
    return memories.searchMemories(bureau.id, mara.id, text).map((memory) => memory.content);
  }

  function assertSearchIndexIntact() {
    memories.db.prepare("INSERT INTO memories_fts (memories_fts) VALUES ('integrity-check')").run();
  }

  it('adds a memory with its source story and turns', () => {
    const turn = stories.addTurn(story.id, { kind: 'prose', source: 'generated', content: 'x' });

    const memory = remember('Theo is afraid of deep water.', {
      importance: 4,
      sourceTurnIds: [turn.id],
    });

    expect(memory).toMatchObject({
      castMemberId: mara.id,
      layer: 'knowledge',
      content: 'Theo is afraid of deep water.',
      importance: 4,
      worldTime: START,
      sourceType: 'story',
      sourceId: story.id,
      sourceTitle: 'Lamplight',
      sourcePosition: 0,
      sourceTurnIds: [turn.id],
      supersededBy: null,
      pinned: false,
      retired: false,
      needsReview: false,
    });
  });

  it('writes backstory with no time or story', () => {
    const memory = memories.addMemory(bureau.id, mara.id, {
      layer: 'knowledge',
      content: 'Mara grew up on the island.',
    });

    expect(memory).toMatchObject({
      sourceType: 'manual',
      sourceId: null,
      sourceTitle: null,
      worldTime: null,
      importance: 3,
    });
  });

  it('rejects unknown layers and sources', () => {
    expect(() => remember('x', { layer: 'dream' })).toThrow(/Unknown memory layer/);
    expect(() => remember('x', { sourceType: 'rumor' })).toThrow(/Unknown memory source/);
  });

  it('lists newest first with backstory last, and filters by layer', () => {
    memories.addMemory(bureau.id, mara.id, { layer: 'knowledge', content: 'Backstory' });
    remember('Early', { worldTime: '2026-01-01T00:00:00.000Z' });
    remember('Late');
    const episode = remember('Episode', { layer: 'episode' });

    expect(memories.listMemories(bureau.id, mara.id).map((memory) => memory.content)).toEqual([
      'Episode',
      'Late',
      'Early',
      'Backstory',
    ]);
    expect(
      memories.listMemories(bureau.id, mara.id, { layer: 'episode' }).map((memory) => memory.id),
    ).toEqual([episode.id]);
    expect(() => memories.listMemories(bureau.id, mara.id, { status: 'lost' })).toThrow(
      /Unknown memory status/,
    );
  });

  it('supersedes a memory, and restores it when the replacement is deleted', () => {
    const old = remember('Theo has never seen the night market.');
    const replacement = remember('Theo went to the night market with Mara.', {
      supersedes: old.id,
    });

    expect(memories.getMemory(bureau.id, old.id).supersededBy).toBe(replacement.id);
    expect(memories.listMemories(bureau.id, mara.id).map((memory) => memory.id)).toEqual([
      replacement.id,
    ]);
    expect(
      memories.listMemories(bureau.id, mara.id, { status: 'retired' }).map((memory) => memory.id),
    ).toEqual([old.id]);
    expect(memories.listMemories(bureau.id, mara.id, { status: 'all' })).toHaveLength(2);

    memories.deleteMemory(bureau.id, replacement.id);

    expect(memories.getMemory(bureau.id, old.id).supersededBy).toBeNull();
  });

  it("ignores superseding someone else's memory or one already replaced", () => {
    const ines = bureaus.addCastMember(bureau.id, {
      seedCard: card('Ines'),
      libraryCharacterId: 'c2',
    });
    const theirs = memories.addMemory(bureau.id, ines.id, {
      layer: 'knowledge',
      content: 'Ines keeps bees.',
    });
    remember('Mara keeps bees.', { supersedes: theirs.id });
    expect(memories.getMemory(bureau.id, theirs.id).supersededBy).toBeNull();

    const old = remember('A');
    const first = remember('B', { supersedes: old.id });
    remember('C', { supersedes: old.id });
    expect(memories.getMemory(bureau.id, old.id).supersededBy).toBe(first.id);
  });

  it('edits, pins, retires, and restores memories', () => {
    const old = remember('Theo hates tea.');
    const replacement = remember('Theo likes tea now.', { supersedes: old.id });

    expect(
      memories.updateMemory(bureau.id, replacement.id, {
        content: 'Theo drinks tea.',
        importance: 9,
        pinned: true,
      }),
    ).toMatchObject({ content: 'Theo drinks tea.', importance: 5, pinned: true });
    expect(memories.updateMemory(bureau.id, replacement.id, { retired: true }).retired).toBe(true);
    expect(memories.updateMemory(bureau.id, old.id, { retired: false })).toMatchObject({
      retired: false,
      supersededBy: null,
    });
    expect(memories.updateMemory(bureau.id, 9999, { pinned: true })).toBeNull();
  });

  it('flags memories citing changed turns until they are reviewed', () => {
    const cited = stories.addTurn(story.id, { kind: 'prose', source: 'user', content: 'Knock.' });
    const other = stories.addTurn(story.id, { kind: 'prose', source: 'user', content: 'Lamp.' });
    const flagged = remember('Theo knocked twice.', { sourceTurnIds: [cited.id] });
    const untouched = remember('Mara lit the lamp.', { sourceTurnIds: [other.id] });

    expect(memories.flagTurnsChanged(bureau.id, story.id, [cited.id])).toBe(1);
    expect(memories.flagTurnsChanged(bureau.id, story.id, [])).toBe(0);

    expect(memories.getMemory(bureau.id, flagged.id).needsReview).toBe(true);
    expect(memories.getMemory(bureau.id, untouched.id).needsReview).toBe(false);
    expect(memories.countsByCast(bureau.id)).toEqual({ [mara.id]: { current: 2, needsReview: 1 } });
    expect(
      memories.updateMemory(bureau.id, flagged.id, { content: 'Theo knocked three times.' })
        .needsReview,
    ).toBe(false);
  });

  it('searches with stemming and without passing query syntax through', () => {
    const ines = bureaus.addCastMember(bureau.id, {
      seedCard: card('Ines'),
      libraryCharacterId: 'c2',
    });
    remember('Theo is afraid of deep water.');
    remember('Mara swims every morning.');
    memories.addMemory(bureau.id, ines.id, { layer: 'knowledge', content: 'Ines swims too.' });

    expect(search('swimming')).toEqual(['Mara swims every morning.']);
    expect(search('AFRAID" OR (water')).toEqual(['Theo is afraid of deep water.']);
    expect(search(' *** ')).toEqual([]);
  });

  it('keeps the search index in step with edits and deletes', () => {
    const memory = remember('Theo is afraid of deep water.');

    memories.updateMemory(bureau.id, memory.id, { content: 'Theo learned to swim.' });
    expect(search('afraid')).toEqual([]);
    expect(search('swim')).toEqual(['Theo learned to swim.']);

    memories.deleteMemory(bureau.id, memory.id);
    expect(search('swim')).toEqual([]);
    assertSearchIndexIntact();
  });

  it("deletes a story's memories and brings back what they replaced", () => {
    const later = stories.createStory(bureau.id, { startTime: START, castIds: [mara.id] });
    const old = remember('Theo has never seen the sea.');
    memories.addMemory(bureau.id, mara.id, {
      layer: 'knowledge',
      content: 'Theo saw the sea.',
      sourceType: 'story',
      sourceId: later.id,
      worldTime: START,
      supersedes: old.id,
    });

    expect(memories.deleteStoryMemories(bureau.id, later.id)).toBe(1);

    expect(memories.listMemories(bureau.id, mara.id).map((memory) => memory.id)).toEqual([old.id]);
    expect(search('sea')).toEqual(['Theo has never seen the sea.']);
  });

  it('removes memories with their cast member or Bureau', () => {
    remember('Gone with Mara.');
    bureaus.removeCastMember(bureau.id, mara.id);
    expect(memories.db.prepare('SELECT COUNT(*) AS n FROM memories').get().n).toBe(0);

    const ines = bureaus.addCastMember(bureau.id, {
      seedCard: card('Ines'),
      libraryCharacterId: 'c2',
    });
    memories.addMemory(bureau.id, ines.id, {
      layer: 'knowledge',
      content: 'Gone with the Bureau.',
    });
    bureaus.deleteBureau(bureau.id);
    expect(memories.db.prepare('SELECT COUNT(*) AS n FROM memories').get().n).toBe(0);
    assertSearchIndexIntact();
  });

  it('keeps memories inside their own Bureau', () => {
    const other = bureaus.createBureau({ name: 'Other' });
    const memory = remember('Secret.');

    expect(memories.getMemory(other.id, memory.id)).toBeNull();
    expect(memories.updateMemory(other.id, memory.id, { pinned: true })).toBeNull();
    expect(memories.deleteMemory(other.id, memory.id)).toBe(false);
    expect(memories.listMemories(other.id, mara.id)).toEqual([]);
    expect(memories.searchMemories(other.id, mara.id, 'secret')).toEqual([]);
  });
});

describe('clampImportance', () => {
  it('rounds into 1 to 5, defaulting to 3', () => {
    expect([clampImportance(9), clampImportance(0), clampImportance(3.6)]).toEqual([5, 1, 4]);
    expect(clampImportance('often')).toBe(3);
  });
});

describe('toFtsQuery', () => {
  it('quotes each word and drops everything else', () => {
    expect(toFtsQuery('deep "water" OR sea*')).toBe('"deep" OR "water" OR "OR" OR "sea"');
    expect(toFtsQuery('')).toBe('');
  });
});
