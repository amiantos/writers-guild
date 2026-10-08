/**
 * The Characters section: the character library as a shelf of portrait cards, with the filters
 * and sorts around it. Plain functions over the lists the API returns, like the home page's
 * library (./library.js), so the view stays thin.
 */
import { castColor } from '../../../shared/cover-colors.js';
import { buildLibraryItems } from './library.js';

export const CHARACTER_SORTS = [
  { key: 'active', label: 'Last active' },
  { key: 'name', label: 'Name' },
  { key: 'created', label: 'Added' },
  { key: 'stories', label: 'Stories' },
  { key: 'words', label: 'Word count' },
];

/**
 * One card per character, with what the shelf shows and filters on, plus the character itself as
 * `source`. `appearances` are the stories and chats they're in, as buildLibraryItems() cards, most
 * recently active first.
 */
export function buildCharacterItems({
  characters = [],
  stories = [],
  chats = [],
  continuities = [],
}) {
  const appearancesOf = new Map(characters.map((c) => [c.id, []]));
  for (const item of buildLibraryItems({ stories, chats, continuities })) {
    for (const id of new Set([...item.characterIds, item.personaCharacterId])) {
      appearancesOf.get(id)?.push(item);
    }
  }

  return characters.map((character) => {
    const appearances = appearancesOf.get(character.id);
    const storyItems = appearances.filter((item) => item.kind === 'story');
    // Continuities they've been in, the most recent first
    const continuityList = [];
    for (const item of appearances) {
      if (item.continuityId && !continuityList.some((c) => c.id === item.continuityId)) {
        continuityList.push({
          id: item.continuityId,
          name: item.continuityName,
          color: item.color,
        });
      }
    }
    return {
      id: character.id,
      name: character.name || 'Unknown',
      created: character.created ?? null,
      // Their solo stories' cover color, so the two match
      color: castColor([character.id], character.id),
      storyCount: storyItems.length,
      chatCount: appearances.length - storyItems.length,
      wordCount: storyItems.reduce((sum, item) => sum + (item.wordCount ?? 0), 0),
      lastActive: appearances[0]?.modified ?? null,
      latestStory: storyItems[0]?.source ?? null,
      continuities: continuityList,
      appearances,
      source: character,
    };
  });
}

/**
 * The cards to show.
 * @param {Object} options
 * @param {{kind: 'continuity', id: string}|null} [options.filter]
 * @param {string} [options.query] - Matched against names.
 */
export function filterCharacterItems(items, { filter = null, query = '' } = {}) {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter?.kind === 'continuity' && !item.continuities.some((c) => c.id === filter.id)) {
      return false;
    }
    return !needle || item.name.toLowerCase().includes(needle);
  });
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
const byNewest = (field) => (a, b) => String(b[field] ?? '').localeCompare(String(a[field] ?? ''));

/**
 * The cards in a CHARACTER_SORTS order. Last active puts characters who haven't been in anything
 * after those who have, the newest first.
 */
export function sortCharacterItems(items, sort = 'active') {
  switch (sort) {
    case 'name':
      return items.toSorted(byName);
    case 'created':
      return items.toSorted((a, b) => byNewest('created')(a, b) || byName(a, b));
    case 'stories':
      return items.toSorted(
        (a, b) =>
          b.storyCount + b.chatCount - (a.storyCount + a.chatCount) ||
          byNewest('lastActive')(a, b) ||
          byName(a, b),
      );
    case 'words':
      return items.toSorted((a, b) => b.wordCount - a.wordCount || byName(a, b));
    default:
      return items.toSorted(
        (a, b) => byNewest('lastActive')(a, b) || byNewest('created')(a, b) || byName(a, b),
      );
  }
}

/**
 * The filters: each Continuity the characters have been in, with how many characters, the most
 * recently active first.
 * @param {Array} items - Cards from buildCharacterItems(), most recently active first.
 */
export function characterFilters(items) {
  const continuities = new Map();
  for (const item of items) {
    for (const continuity of item.continuities) {
      const entry = continuities.get(continuity.id) ?? { ...continuity, count: 0 };
      entry.count++;
      continuities.set(continuity.id, entry);
    }
  }
  return { continuities: [...continuities.values()] };
}

/** "3 stories", "1 story · 2 chats", or "No stories yet". */
export function appearanceLine({ storyCount, chatCount }) {
  const parts = [];
  if (storyCount) parts.push(`${storyCount} ${storyCount === 1 ? 'story' : 'stories'}`);
  if (chatCount) parts.push(`${chatCount} ${chatCount === 1 ? 'chat' : 'chats'}`);
  return parts.length ? parts.join(' · ') : 'No stories yet';
}
