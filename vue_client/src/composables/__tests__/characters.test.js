import { describe, it, expect } from 'vitest';
import {
  appearanceLine,
  buildCharacterItems,
  characterFilters,
  filterCharacterItems,
  sortCharacterItems,
  tagKey,
} from '../characters.js';
import { castColor } from '../../../../shared/cover-colors.js';

const CHARACTERS = [
  {
    id: 'mara',
    name: 'Mara Voss',
    tags: ['Sailor', 'fantasy'],
    created: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'ilse',
    name: 'Ilse Brandt',
    tags: ['fantasy ', 'Fantasy'],
    created: '2026-03-01T00:00:00.000Z',
  },
  { id: 'rhee', name: 'Captain Rhee', tags: [], created: '2026-02-01T00:00:00.000Z' },
  { id: 'ash', name: 'Ash', created: '2026-04-01T00:00:00.000Z' },
];

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
    characterIds: ['rhee', 'mara'],
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
    messageCount: 12,
    created: '2026-10-01T00:00:00.000Z',
    modified: '2026-10-08T12:00:00.000Z',
  },
];

function items(chats = CHATS) {
  return buildCharacterItems({
    characters: CHARACTERS,
    stories: STORIES,
    chats,
    continuities: CONTINUITIES,
  });
}

const byId = (list) => new Map(list.map((item) => [item.id, item]));
const names = (list) => list.map((item) => item.name);

describe('buildCharacterItems', () => {
  it('counts each character’s stories, chats and words, the persona included', () => {
    const { mara, ash, rhee } = Object.fromEntries(byId(items()));
    expect(mara).toMatchObject({ storyCount: 2, chatCount: 0, wordCount: 58358 });
    expect(ash).toMatchObject({ storyCount: 1, chatCount: 0, wordCount: 18240 });
    expect(rhee).toMatchObject({ storyCount: 1, chatCount: 1, wordCount: 40118 });
  });

  it('lists appearances most recent first, and remembers the latest story', () => {
    const rhee = byId(items()).get('rhee');
    expect(rhee.appearances.map((a) => a.key)).toEqual(['chat:c1', 'story:s2']);
    expect(rhee.lastActive).toBe('2026-10-08T12:00:00.000Z');
    expect(rhee.latestStory.id).toBe('s2');
  });

  it('gives a character who is in nothing yet no activity', () => {
    const lone = buildCharacterItems({ characters: [CHARACTERS[3]] })[0];
    expect(lone).toMatchObject({ storyCount: 0, lastActive: null, latestStory: null });
    expect(lone.appearances).toEqual([]);
  });

  it('collects their Continuities, and colors them like their solo stories', () => {
    const { mara, rhee } = Object.fromEntries(byId(items()));
    expect(mara.continuities.map((c) => c.name)).toEqual(['Saltmarsh Cycle']);
    expect(rhee.continuities).toEqual([]);
    expect(mara.color).toBe(castColor(['mara'], 'mara'));
  });

  it('drops repeated and blank tags', () => {
    expect(byId(items()).get('ilse').tags).toEqual(['fantasy']);
  });
});

describe('filterCharacterItems', () => {
  it('filters by Continuity', () => {
    const shown = filterCharacterItems(items(), { filter: { kind: 'continuity', id: 'k1' } });
    expect(names(shown)).toEqual(['Mara Voss', 'Ilse Brandt', 'Ash']);
  });

  it('filters by tag, whatever its case', () => {
    const shown = filterCharacterItems(items(), { filter: { kind: 'tag', id: tagKey('Fantasy') } });
    expect(names(shown)).toEqual(['Mara Voss', 'Ilse Brandt']);
  });

  it('searches names and tags', () => {
    expect(names(filterCharacterItems(items(), { query: 'rhee' }))).toEqual(['Captain Rhee']);
    expect(names(filterCharacterItems(items(), { query: 'sail' }))).toEqual(['Mara Voss']);
  });
});

describe('sortCharacterItems', () => {
  it('puts the most recently active first, and those in nothing after, newest first', () => {
    const lone = { id: 'new', name: 'Newcomer', created: '2026-05-01T00:00:00.000Z' };
    const list = buildCharacterItems({
      characters: [...CHARACTERS, lone],
      stories: STORIES.slice(1),
    });
    // Rhee and Mara share their one story; the newer of them leads
    expect(names(sortCharacterItems(list, 'active'))).toEqual([
      'Captain Rhee',
      'Mara Voss',
      'Newcomer',
      'Ash',
      'Ilse Brandt',
    ]);
  });

  it('sorts by name, date added, stories and words', () => {
    const list = items();
    expect(names(sortCharacterItems(list, 'name'))).toEqual([
      'Ash',
      'Captain Rhee',
      'Ilse Brandt',
      'Mara Voss',
    ]);
    expect(names(sortCharacterItems(list, 'created'))[0]).toBe('Ash');
    expect(names(sortCharacterItems(list, 'stories')).slice(0, 2)).toEqual([
      'Captain Rhee',
      'Mara Voss',
    ]);
    expect(names(sortCharacterItems(list, 'words'))[0]).toBe('Mara Voss');
  });
});

describe('characterFilters', () => {
  it('counts the characters in each Continuity and with each tag, the most used tag first', () => {
    const { continuities, tags } = characterFilters(items());
    expect(continuities).toEqual([
      expect.objectContaining({ id: 'k1', name: 'Saltmarsh Cycle', count: 3 }),
    ]);
    expect(tags).toEqual([
      { id: 'fantasy', name: 'fantasy', count: 2 },
      { id: 'sailor', name: 'Sailor', count: 1 },
    ]);
  });
});

describe('appearanceLine', () => {
  it('names stories and chats, or says there are none', () => {
    expect(appearanceLine({ storyCount: 1, chatCount: 0 })).toBe('1 story');
    expect(appearanceLine({ storyCount: 3, chatCount: 2 })).toBe('3 stories · 2 chats');
    expect(appearanceLine({ storyCount: 0, chatCount: 0 })).toBe('No stories yet');
  });
});
