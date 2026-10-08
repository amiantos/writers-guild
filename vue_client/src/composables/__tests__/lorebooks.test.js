import { describe, it, expect } from 'vitest';
import {
  buildLorebookDeleteMessage,
  buildLorebookItems,
  entryLine,
  filterLorebookItems,
  lorebookColor,
  lorebookUseCounts,
  sortLorebookItems,
} from '../lorebooks.js';

const STORIES = [
  {
    id: 's1',
    title: 'Older',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 's2',
    title: 'Newer',
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-03-01T00:00:00.000Z',
  },
];

const LOREBOOKS = [
  {
    id: 'lb1',
    name: 'Saltmarsh Gazetteer',
    description: 'Towns, tides and the lighthouse.',
    entryCount: 24,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-09-01T00:00:00.000Z',
    characters: [{ id: 'mara', name: 'Mara Voss' }],
    storyIds: ['s1', 's2', 'gone'],
  },
  {
    id: 'lb2',
    name: 'Ship Names',
    description: '',
    entryCount: 3,
    created: '2026-05-01T00:00:00.000Z',
    modified: '2026-05-01T00:00:00.000Z',
    characters: [],
    storyIds: ['s1'],
  },
  {
    id: 'lb3',
    name: 'Abandoned Notes',
    entryCount: 0,
    created: '2026-06-01T00:00:00.000Z',
    modified: '2026-10-01T00:00:00.000Z',
  },
];

const items = () => buildLorebookItems({ lorebooks: LOREBOOKS, stories: STORIES });
const names = (list) => list.map((item) => item.name);

describe('buildLorebookItems', () => {
  it('finds the stories each is attached to, newest first, skipping ones that are gone', () => {
    expect(items()[0].stories.map((s) => s.id)).toEqual(['s2', 's1']);
  });

  it('fills in what an older list leaves out', () => {
    expect(items()[2]).toMatchObject({ description: '', characters: [], stories: [] });
  });

  it('colors a lorebook from its name, whatever its case', () => {
    expect(items()[0].color).toBe(lorebookColor('saltmarsh gazetteer '));
  });
});

describe('filterLorebookItems', () => {
  it('shows lorebooks by what uses them', () => {
    expect(names(filterLorebookItems(items(), { use: 'characters' }))).toEqual([
      'Saltmarsh Gazetteer',
    ]);
    expect(names(filterLorebookItems(items(), { use: 'stories' }))).toEqual([
      'Saltmarsh Gazetteer',
      'Ship Names',
    ]);
    expect(names(filterLorebookItems(items(), { use: 'unused' }))).toEqual(['Abandoned Notes']);
    expect(lorebookUseCounts(items())).toEqual({ all: 3, characters: 1, stories: 2, unused: 1 });
  });

  it('searches names and descriptions', () => {
    expect(names(filterLorebookItems(items(), { query: 'ship' }))).toEqual(['Ship Names']);
    expect(names(filterLorebookItems(items(), { query: 'lighthouse' }))).toEqual([
      'Saltmarsh Gazetteer',
    ]);
  });
});

describe('sortLorebookItems', () => {
  it('sorts by last edited, name, entries and date added', () => {
    expect(names(sortLorebookItems(items(), 'modified'))).toEqual([
      'Abandoned Notes',
      'Saltmarsh Gazetteer',
      'Ship Names',
    ]);
    expect(names(sortLorebookItems(items(), 'name'))[0]).toBe('Abandoned Notes');
    expect(names(sortLorebookItems(items(), 'entries'))[0]).toBe('Saltmarsh Gazetteer');
    expect(names(sortLorebookItems(items(), 'created'))[0]).toBe('Abandoned Notes');
  });
});

describe('buildLorebookDeleteMessage', () => {
  it('names what loses the lorebook', () => {
    const message = buildLorebookDeleteMessage({
      name: 'Saltmarsh Gazetteer',
      characters: [{ name: 'Mara Voss' }, { name: 'Ilse' }],
      stories: [{}, {}],
    });
    expect(message).toContain('linked to Mara Voss and Ilse and attached to 2 stories');
  });

  it('keeps to the plain prompt for an unused lorebook', () => {
    expect(buildLorebookDeleteMessage({ name: 'Notes' })).toBe(
      'Delete lorebook "Notes"?\n\nThis cannot be undone.',
    );
  });
});

describe('entryLine', () => {
  it('counts entries', () => {
    expect(entryLine(1)).toBe('1 entry');
    expect(entryLine(1200)).toBe('1,200 entries');
  });
});
