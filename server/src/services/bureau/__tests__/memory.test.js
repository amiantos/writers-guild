import { describe, it, expect } from 'vitest';
import {
  isBeforeStory,
  memoriesAsOf,
  memoriesAtTime,
  notesAtTime,
  selectForPrompt,
} from '../memory.js';

let nextId = 1;

function memory(fields = {}) {
  return {
    id: nextId++,
    layer: 'knowledge',
    content: 'A fact.',
    importance: 3,
    worldTime: null,
    sourceType: 'manual',
    sourceId: null,
    sourcePosition: null,
    supersededBy: null,
    pinned: false,
    retired: false,
    ...fields,
  };
}

function fromStory(story, fields = {}) {
  return memory({
    sourceType: 'story',
    sourceId: story.id,
    sourcePosition: story.position,
    worldTime: story.startTime,
    ...fields,
  });
}

const first = { id: 's1', position: 0, startTime: '2026-10-01T20:00:00.000Z' };
const second = { id: 's2', position: 1, startTime: '2026-10-08T20:00:00.000Z' };
const flashback = { id: 's3', position: 2, startTime: '2026-09-01T20:00:00.000Z' };
const sameTime = { id: 's4', position: 3, startTime: second.startTime };

describe('memories at the same Bureau time', () => {
  it('are listed in the order they were written', () => {
    // Recorded out of order, as when a chapter goes into memory after later messages.
    const messages = memory({
      layer: 'episode',
      content: 'Theo wrote about the pier.',
      worldTime: second.startTime,
      sourceType: 'correspondence',
      sourceId: 'thread-1',
      sourceCreated: '2026-09-12T10:00:00.000Z',
      created: '2026-09-12T10:10:00.000Z',
    });
    const laterChapter = fromStory(sameTime, {
      layer: 'episode',
      content: 'They rebuilt the pier.',
      sourceCreated: '2026-09-12T11:00:00.000Z',
      created: '2026-09-12T11:30:00.000Z',
    });
    const earlierChapter = fromStory(second, {
      layer: 'episode',
      content: 'The storm took the pier.',
      sourceCreated: '2026-09-12T09:00:00.000Z',
      created: '2026-09-12T12:00:00.000Z',
    });

    const { episodes } = selectForPrompt([laterChapter, messages, earlierChapter], {
      knowledgeCharacters: 1000,
      recentEpisodes: 5,
    });

    expect(episodes.map((episode) => episode.content)).toEqual([
      'The storm took the pier.',
      'Theo wrote about the pier.',
      'They rebuilt the pier.',
    ]);
  });
});

describe('isBeforeStory', () => {
  it('always counts backstory', () => {
    expect(isBeforeStory(memory(), flashback)).toBe(true);
  });

  it('counts stories that start earlier, not later', () => {
    expect(isBeforeStory(fromStory(first), second)).toBe(true);
    expect(isBeforeStory(fromStory(second), flashback)).toBe(false);
  });

  it('breaks a tie in time by story order', () => {
    expect(isBeforeStory(fromStory(second), sameTime)).toBe(true);
    expect(isBeforeStory(fromStory(sameTime), second)).toBe(false);
  });

  it('counts messages at the same time only if they were written before the story started', () => {
    const story = { ...second, created: '2026-09-12T10:00:00.000Z' };
    const fromMessages = (sourceCreated) =>
      memory({
        sourceType: 'correspondence',
        sourceId: 'thread-1',
        worldTime: second.startTime,
        sourceCreated,
      });

    expect(isBeforeStory(fromMessages('2026-09-12T09:59:00.000Z'), story)).toBe(true);
    expect(isBeforeStory(fromMessages('2026-09-12T10:01:00.000Z'), story)).toBe(false);
    // Nothing cited to go on.
    expect(isBeforeStory(fromMessages(null), story)).toBe(false);
    // An earlier time still counts, whenever the messages were written.
    expect(
      isBeforeStory(
        { ...fromMessages('2026-09-12T10:01:00.000Z'), worldTime: first.startTime },
        story,
      ),
    ).toBe(true);
  });

  it("leaves out the story's own memories", () => {
    expect(isBeforeStory(fromStory(second), second)).toBe(false);
  });
});

describe('memoriesAtTime', () => {
  const between = '2026-10-05T12:00:00.000Z';

  it('sees backstory and everything dated up to the moment', () => {
    const backstory = memory({ content: 'Mara keeps the light.' });
    const early = fromStory(first, { content: "Theo can't swim." });
    const later = fromStory(second, { content: 'Theo went to the fair.' });

    expect(memoriesAtTime([backstory, early, later], between)).toEqual([backstory, early]);
    expect(memoriesAtTime([backstory, early, later], new Date(second.startTime))).toEqual([
      backstory,
      early,
      later,
    ]);
  });

  it('keeps a memory whose replacement comes after the moment', () => {
    const replacement = fromStory(second, { content: 'Theo swims now.' });
    const original = fromStory(first, {
      content: "Theo can't swim.",
      supersededBy: replacement.id,
    });

    expect(memoriesAtTime([replacement, original], between)).toEqual([original]);
    expect(memoriesAtTime([replacement, original], '2026-10-09T12:00:00.000Z')).toEqual([
      replacement,
    ]);
    expect(memoriesAtTime([memory({ retired: true })], between)).toEqual([]);
  });
});

describe('a memory held for disagreeing with a profile', () => {
  it('stays out of what a story or a moment can see', () => {
    const held = memory({ content: 'Mara lives across town.', conflict: 'Her profile disagrees.' });
    const kept = memory({ content: 'Mara lives above the bakery.' });

    expect(memoriesAtTime([held, kept], second.startTime)).toEqual([kept]);
    expect(memoriesAsOf([held, kept], second)).toEqual([kept]);
  });
});

describe('notesAtTime', () => {
  it('sees accepted notes dated up to the moment', () => {
    const written = { id: 1, status: 'accepted', worldTime: null };
    const early = { id: 2, status: 'accepted', worldTime: first.startTime };
    const later = { id: 3, status: 'accepted', worldTime: second.startTime };
    const proposed = { id: 4, status: 'proposed', worldTime: first.startTime };

    expect(notesAtTime([written, early, later, proposed], '2026-10-05T12:00:00.000Z')).toEqual([
      written,
      early,
    ]);
  });
});

describe('memoriesAsOf', () => {
  it('uses the newest version of a memory that the story can see', () => {
    const replacement = fromStory(second, { content: 'Theo swims now.' });
    const original = fromStory(first, {
      content: 'Theo is afraid of water.',
      supersededBy: replacement.id,
    });
    const between = { id: 's5', position: 4, startTime: '2026-10-04T20:00:00.000Z' };

    expect(memoriesAsOf([original, replacement], sameTime)).toEqual([replacement]);
    // A story set between the two comes before the change.
    expect(memoriesAsOf([original, replacement], between)).toEqual([original]);
  });

  it("doesn't bring back a memory whose replacement was retired", () => {
    const replacement = fromStory(first, { retired: true });
    const original = fromStory(first, { supersededBy: replacement.id });

    expect(memoriesAsOf([original, replacement], second)).toEqual([]);
  });

  it("includes the story's own memories for the Archivist", () => {
    const own = fromStory(second);

    expect(memoriesAsOf([own], second)).toEqual([]);
    expect(memoriesAsOf([own], second, { includeOwnStory: true })).toEqual([own]);
  });
});

describe('selectForPrompt', () => {
  it('keeps pinned, then the most important knowledge that fits, oldest first', () => {
    const pinned = memory({
      content: 'P'.repeat(50),
      importance: 1,
      pinned: true,
      worldTime: '2026-10-05T00:00:00.000Z',
    });
    const important = memory({
      content: 'I'.repeat(30),
      importance: 5,
      worldTime: '2026-10-03T00:00:00.000Z',
    });
    const minor = memory({ content: 'M'.repeat(30), importance: 2 });
    const small = memory({ content: 'S'.repeat(5), importance: 1 });

    const { knowledge } = selectForPrompt([minor, small, important, pinned], {
      knowledgeCharacters: 100,
      recentEpisodes: 3,
    });

    expect(knowledge).toEqual([small, important, pinned]);
  });

  it('keeps pinned knowledge even past the budget', () => {
    const pinned = memory({ content: 'P'.repeat(500), pinned: true });

    expect(
      selectForPrompt([pinned], { knowledgeCharacters: 10, recentEpisodes: 0 }).knowledge,
    ).toEqual([pinned]);
  });

  it('takes the latest episodes', () => {
    const episodes = [first, second, sameTime].map((story) =>
      fromStory(story, { layer: 'episode' }),
    );

    expect(
      selectForPrompt(episodes.toReversed(), { knowledgeCharacters: 0, recentEpisodes: 2 })
        .episodes,
    ).toEqual([episodes[1], episodes[2]]);
    expect(
      selectForPrompt(episodes, { knowledgeCharacters: 0, recentEpisodes: 0 }).episodes,
    ).toEqual([]);
  });

  it('includes the latest time away, unless an episode has happened since', () => {
    const limits = { knowledgeCharacters: 0, recentEpisodes: 3 };
    const away = memory({ layer: 'offscreen', worldTime: '2026-10-07T19:59:59.999Z' });
    const earlierAway = memory({ layer: 'offscreen', worldTime: '2026-09-30T19:59:59.999Z' });

    expect(
      selectForPrompt([away, earlierAway, fromStory(first, { layer: 'episode' })], limits),
    ).toMatchObject({ offscreen: away });
    expect(selectForPrompt([away, fromStory(second, { layer: 'episode' })], limits).offscreen).toBe(
      null,
    );
    expect(selectForPrompt([], limits).offscreen).toBeNull();
  });
});
