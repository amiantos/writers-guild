import { describe, it, expect } from 'vitest';
import { factsAsOf, factsAtTime } from '../memory.js';

let nextId = 1;

function fact(fields = {}) {
  return {
    id: nextId++,
    content: 'A fact.',
    status: 'accepted',
    replaces: null,
    worldTime: null,
    sourceType: 'manual',
    sourceId: null,
    sourcePosition: null,
    sourceCreated: null,
    ...fields,
  };
}

function fromStory(story, fields = {}) {
  return fact({
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

describe('factsAsOf', () => {
  it('sees accepted facts written by the reader or from earlier chapters', () => {
    const written = fact({ content: 'Mara and Theo live above the bakery.' });
    const earlier = fromStory(first, { content: 'Theo works days.' });
    const waiting = fact({ content: 'Theo works nights.', status: 'proposed' });
    const rejected = fact({ content: 'Mara lives alone.', status: 'rejected' });
    const own = fromStory(second, { content: 'From this chapter.' });

    expect(factsAsOf([written, earlier, waiting, rejected, own], second)).toEqual([
      written,
      earlier,
    ]);
    expect(factsAsOf([written, own], second, { includeOwnStory: true })).toEqual([written, own]);
  });

  it('gives way to a change the chapter can see, and keeps the old fact in a flashback', () => {
    const home = fact({ content: 'Mara lives above the bakery.' });
    const move = fromStory(first, { content: 'Mara lives by the harbor.', replaces: home.id });

    expect(factsAsOf([home, move], second)).toEqual([move]);
    expect(factsAsOf([home, move], flashback)).toEqual([home]);
  });

  it('keeps a fact whose change is waiting or was rejected', () => {
    const home = fact({ content: 'Mara lives above the bakery.' });
    const waiting = fact({ status: 'proposed', replaces: home.id });
    const rejected = fact({ status: 'rejected', replaces: home.id });

    expect(factsAsOf([home, waiting, rejected], second)).toEqual([home]);
  });

  it('keeps the latest fact in a line standing when a change in the middle was rejected', () => {
    const boston = fact({ content: 'Mara lives in Boston.' });
    const chicago = fromStory(first, {
      content: 'Mara lives in Chicago.',
      replaces: boston.id,
      status: 'rejected',
    });
    const denver = fromStory(first, { content: 'Mara lives in Denver.', replaces: chicago.id });

    expect(factsAsOf([boston, chicago, denver], second)).toEqual([denver]);
  });

  it('lets only the later of two accepted changes to the same fact stand', () => {
    const boston = fact({ content: 'Mara lives in Boston.' });
    const chicago = fromStory(first, { content: 'Mara lives in Chicago.', replaces: boston.id });
    const denver = fromStory(second, { content: 'Mara lives in Denver.', replaces: boston.id });
    const third = { id: 's4', position: 3, startTime: '2026-10-15T20:00:00.000Z' };

    expect(factsAsOf([boston, chicago, denver], third)).toEqual([denver]);
    expect(factsAsOf([boston, chicago, denver], second)).toEqual([chicago]);
  });

  it('keeps a fact from messages written before the chapter once the messages are deleted', () => {
    const chapter = { ...second, created: '2026-09-14T12:00:00.000Z' };
    // With the messages gone, only when the fact was recorded says when they were written.
    const before = fact({
      content: 'Mara lives by the harbor.',
      sourceType: 'correspondence',
      worldTime: second.startTime,
      created: '2026-09-14T11:00:00.000Z',
    });
    const after = fact({
      content: 'Theo works days.',
      sourceType: 'correspondence',
      worldTime: second.startTime,
      created: '2026-09-14T13:00:00.000Z',
    });

    expect(factsAsOf([before, after], chapter)).toEqual([before]);
  });
});

describe('factsAtTime', () => {
  it('sees facts dated up to the moment, each giving way to a change made by then', () => {
    const home = fact({ content: 'Mara lives above the bakery.' });
    const move = fact({
      content: 'Mara lives by the harbor.',
      replaces: home.id,
      sourceType: 'correspondence',
      worldTime: second.startTime,
    });

    expect(factsAtTime([home, move], first.startTime)).toEqual([home]);
    expect(factsAtTime([home, move], second.startTime)).toEqual([move]);
  });
});
