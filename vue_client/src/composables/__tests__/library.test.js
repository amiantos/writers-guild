import { describe, it, expect } from 'vitest';
import {
  buildLibraryItems,
  castLine,
  filterLibraryItems,
  libraryFilters,
  recentSetups,
  setupKey,
  sortLibraryItems,
  timeAgo,
} from '../library.js';
import { castColor, continuityColor } from '../../../../shared/cover-colors.js';

const CHARACTERS = [
  { id: 'mara', name: 'Mara Voss' },
  { id: 'ilse', name: 'Ilse Brandt' },
  { id: 'rhee', name: 'Captain Rhee' },
  { id: 'ash', name: 'Ash' },
];
const charactersById = new Map(CHARACTERS.map((c) => [c.id, c]));

const CONTINUITIES = [{ id: 'k1', name: 'Saltmarsh Cycle' }];

const STORIES = [
  {
    id: 's1',
    title: 'The Lantern at Saltmarsh',
    characterIds: ['mara', 'ilse'],
    personaCharacterId: 'ash',
    continuityId: 'k1',
    wordCount: 18240,
    created: '2026-09-01T00:00:00.000Z',
    modified: '2026-10-07T10:00:00.000Z',
  },
  {
    id: 's2',
    title: 'A Quiet Coup',
    characterIds: ['rhee'],
    wordCount: 40118,
    created: '2026-08-01T00:00:00.000Z',
    modified: '2026-09-20T00:00:00.000Z',
  },
];

const CHATS = [
  {
    id: 'c1',
    title: 'Chat with Captain Rhee',
    characterIds: ['rhee'],
    continuityId: null,
    messageCount: 12,
    lastMessage: { senderName: 'Captain Rhee', content: 'Hold the line.' },
    created: '2026-10-01T00:00:00.000Z',
    modified: '2026-10-07T12:00:00.000Z',
  },
];

function items() {
  return buildLibraryItems({ stories: STORIES, chats: CHATS, continuities: CONTINUITIES });
}

describe('buildLibraryItems', () => {
  it('mixes stories and chats, most recently active first', () => {
    expect(items().map((item) => item.key)).toEqual(['chat:c1', 'story:s1', 'story:s2']);
  });

  it('names and colors a card from its Continuity', () => {
    const lantern = items().find((item) => item.id === 's1');
    expect(lantern.continuityName).toBe('Saltmarsh Cycle');
    expect(lantern.color).toBe(continuityColor('Saltmarsh Cycle'));
  });

  it('colors a story outside a Continuity by its cast, and leaves a chat neutral', () => {
    const [chat, , coup] = items();
    expect(coup.continuityName).toBeNull();
    expect(coup.color).toBe(castColor(['rhee'], 's2'));
    expect(chat.color).toBeNull();
  });

  it('ignores a Continuity that no longer exists', () => {
    const [story] = buildLibraryItems({ stories: [{ ...STORIES[0] }], continuities: [] });
    expect(story.continuityId).toBeNull();
    expect(story.continuityName).toBeNull();
  });
});

describe('filterLibraryItems', () => {
  it('keeps only stories or only chats', () => {
    expect(filterLibraryItems(items(), { type: 'chat' }).map((i) => i.id)).toEqual(['c1']);
    expect(filterLibraryItems(items(), { type: 'story' })).toHaveLength(2);
  });

  it('filters by Continuity', () => {
    const filter = { kind: 'continuity', id: 'k1' };
    expect(filterLibraryItems(items(), { filter }).map((i) => i.id)).toEqual(['s1']);
  });

  it('filters by character, counting the persona', () => {
    const filter = { kind: 'character', id: 'ash' };
    expect(filterLibraryItems(items(), { filter }).map((i) => i.id)).toEqual(['s1']);
  });

  it('searches titles, Continuity names and character names', () => {
    const search = (query) =>
      filterLibraryItems(items(), { query, charactersById }).map((i) => i.id);
    expect(search('coup')).toEqual(['s2']);
    expect(search('saltmarsh')).toEqual(['s1']);
    expect(search('rhee')).toEqual(['c1', 's2']);
    expect(search('  ')).toHaveLength(3);
  });
});

describe('sortLibraryItems', () => {
  it('sorts by title', () => {
    expect(sortLibraryItems(items(), 'title').map((i) => i.id)).toEqual(['s2', 'c1', 's1']);
  });

  it('sorts by word count with chats last', () => {
    expect(sortLibraryItems(items(), 'words').map((i) => i.id)).toEqual(['s2', 's1', 'c1']);
  });

  it('leaves the list it was given alone', () => {
    const list = items();
    sortLibraryItems(list, 'title');
    expect(list[0].id).toBe('c1');
  });
});

describe('libraryFilters', () => {
  it('counts each Continuity and character, the most recently active first', () => {
    const { continuities, characters } = libraryFilters(items(), charactersById);
    expect(continuities).toEqual([
      { id: 'k1', name: 'Saltmarsh Cycle', color: continuityColor('Saltmarsh Cycle'), count: 1 },
    ]);
    expect(characters[0]).toEqual({ id: 'rhee', name: 'Captain Rhee', count: 2 });
    expect(characters.map((c) => c.id)).toEqual(['rhee', 'mara', 'ilse', 'ash']);
  });

  it('leaves out characters that no longer exist', () => {
    const { characters } = libraryFilters(items(), new Map([['mara', CHARACTERS[0]]]));
    expect(characters.map((c) => c.id)).toEqual(['mara']);
  });
});

describe('recentSetups', () => {
  it('keeps the newest story of each setup and counts the rest', () => {
    const again = {
      ...STORIES[0],
      id: 's3',
      title: 'Saltmarsh, Again',
      characterIds: ['ilse', 'mara'],
      modified: '2026-10-01T00:00:00.000Z',
    };
    const setups = recentSetups([again, ...STORIES]);
    expect(setups.map((s) => [s.story.id, s.count])).toEqual([
      ['s1', 2],
      ['s2', 1],
    ]);
  });

  it('skips stories without characters', () => {
    expect(recentSetups([{ id: 'blank', characterIds: [] }])).toEqual([]);
  });

  it('tells setups apart by preset, persona, Continuity and perspective', () => {
    const base = STORIES[0];
    expect(setupKey({ ...base, configPresetId: 'p2' })).not.toBe(setupKey(base));
    expect(setupKey({ ...base, personaCharacterId: null })).not.toBe(setupKey(base));
    expect(setupKey({ ...base, continuityId: null })).not.toBe(setupKey(base));
    expect(setupKey({ ...base, perspective: 'first' })).not.toBe(setupKey(base));
  });
});

describe('castLine', () => {
  it('shortens long casts', () => {
    expect(castLine([])).toBe('');
    expect(castLine(['Mara'])).toBe('Mara');
    expect(castLine(['Mara', 'Ilse'])).toBe('Mara & Ilse');
    expect(castLine(['Mara', 'Ilse', 'Tov'])).toBe('Mara, Ilse & Tov');
    expect(castLine(['Mara', 'Ilse', 'Tov', 'Rhee', 'Wren'])).toBe('Mara, Ilse & 3 more');
  });
});

describe('timeAgo', () => {
  const now = new Date('2026-10-08T12:00:00.000Z').getTime();
  const ago = (ms) => timeAgo(new Date(now - ms).toISOString(), now);
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it('reads briefly', () => {
    expect(ago(10_000)).toBe('just now');
    expect(ago(5 * MINUTE)).toBe('5m ago');
    expect(ago(3 * HOUR)).toBe('3h ago');
    expect(ago(30 * HOUR)).toBe('yesterday');
    expect(ago(4 * DAY)).toBe('4d ago');
    expect(ago(15 * DAY)).toBe('2w ago');
  });

  it('gives a date past a month, and nothing for a bad date', () => {
    expect(ago(90 * DAY)).not.toMatch(/ago/);
    expect(timeAgo('not a date', now)).toBe('');
  });
});
