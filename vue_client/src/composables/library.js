/**
 * The home page's library: stories and chats as one shelf of cards, with the filters, sorts and
 * recent setups around it. Plain functions over the lists the API returns, so the view stays thin.
 */
import { castColor, continuityColor, hashString } from '../../../shared/cover-colors.js';

export const LIBRARY_SORTS = [
  { key: 'modified', label: 'Last active' },
  { key: 'title', label: 'Title' },
  { key: 'created', label: 'Created' },
  { key: 'words', label: 'Word count' },
];

export const LIBRARY_TYPES = [
  { key: 'all', label: 'All' },
  { key: 'story', label: 'Stories' },
  { key: 'chat', label: 'Chats' },
];

/**
 * One card per story and chat, most recently active first. A card carries what the shelf shows
 * and filters on, plus the story or chat itself as `source`.
 */
export function buildLibraryItems({ stories = [], chats = [], continuities = [] }) {
  const continuityNames = new Map(continuities.map((c) => [c.id, c.name]));

  const toItem = (kind, source) => {
    const continuityName = continuityNames.get(source.continuityId) ?? null;
    const characterIds = source.characterIds ?? [];
    return {
      kind,
      key: `${kind}:${source.id}`,
      id: source.id,
      title: source.title || (kind === 'story' ? 'Untitled Story' : 'Untitled Chat'),
      characterIds,
      personaCharacterId: source.personaCharacterId ?? null,
      continuityId: continuityName ? source.continuityId : null,
      continuityName,
      color: continuityName
        ? continuityColor(continuityName)
        : kind === 'story'
          ? castColor(characterIds, source.id)
          : null,
      created: source.created,
      modified: source.modified || source.created,
      wordCount: kind === 'story' ? source.wordCount || 0 : null,
      messageCount: kind === 'chat' ? source.messageCount || 0 : null,
      lastMessage: kind === 'chat' ? (source.lastMessage ?? null) : null,
      source,
    };
  };

  return sortLibraryItems(
    [...stories.map((s) => toItem('story', s)), ...chats.map((c) => toItem('chat', c))],
    'modified',
  );
}

/** Whether a card has this character, in its cast or as its persona. */
export function hasCharacter(item, characterId) {
  return item.characterIds.includes(characterId) || item.personaCharacterId === characterId;
}

/**
 * The cards to show.
 * @param {Object} options
 * @param {'all'|'story'|'chat'} [options.type]
 * @param {{kind: 'continuity'|'character', id: string}|null} [options.filter]
 * @param {string} [options.query] - Matched against titles, Continuity names and character names.
 * @param {Map<string, Object>} [options.charactersById]
 */
export function filterLibraryItems(
  items,
  { type = 'all', filter = null, query = '', charactersById = new Map() } = {},
) {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    if (type !== 'all' && item.kind !== type) return false;
    if (filter?.kind === 'continuity' && item.continuityId !== filter.id) return false;
    if (filter?.kind === 'character' && !hasCharacter(item, filter.id)) return false;
    if (!needle) return true;
    const names = [...item.characterIds, item.personaCharacterId]
      .map((id) => charactersById.get(id)?.name)
      .filter(Boolean);
    return [item.title, item.continuityName, ...names].some((text) =>
      text?.toLowerCase().includes(needle),
    );
  });
}

const byModified = (a, b) => String(b.modified).localeCompare(String(a.modified));
const byCount = (a, b) => b.count - a.count || a.name.localeCompare(b.name);

/** The cards in a LIBRARY_SORTS order. Word count puts chats, which have none, last. */
export function sortLibraryItems(items, sort = 'modified') {
  switch (sort) {
    case 'title':
      return items.toSorted((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
    case 'created':
      return items.toSorted((a, b) => String(b.created).localeCompare(String(a.created)));
    case 'words':
      return items.toSorted(
        (a, b) => (b.wordCount ?? -1) - (a.wordCount ?? -1) || byModified(a, b),
      );
    default:
      return items.toSorted(byModified);
  }
}

/**
 * The filter chips: each Continuity and character on the shelf, with how many cards have it, the
 * most used first.
 */
export function libraryFilters(items, charactersById) {
  const continuities = new Map();
  const characterCounts = new Map();
  for (const item of items) {
    if (item.continuityId) {
      const entry = continuities.get(item.continuityId) ?? {
        id: item.continuityId,
        name: item.continuityName,
        color: item.color,
        count: 0,
      };
      entry.count++;
      continuities.set(item.continuityId, entry);
    }
    for (const id of new Set([...item.characterIds, item.personaCharacterId].filter(Boolean))) {
      characterCounts.set(id, (characterCounts.get(id) ?? 0) + 1);
    }
  }

  return {
    continuities: [...continuities.values()].toSorted(byCount),
    characters: [...characterCounts]
      .filter(([id]) => charactersById.has(id))
      .map(([id, count]) => ({ id, name: charactersById.get(id).name, count }))
      .toSorted(byCount),
  };
}

/** What "New story with this setup" copies, as one comparable key. */
export function setupKey(story) {
  return JSON.stringify([
    (story.characterIds ?? []).toSorted(),
    story.personaCharacterId ?? null,
    story.configPresetId ?? null,
    story.continuityId ?? null,
    story.perspective ?? null,
    story.perspectiveTense ?? null,
    story.perspectiveCharacterId ?? null,
  ]);
}

/**
 * The latest story of each distinct setup that has characters, newest first, with how many
 * stories share it.
 * @returns {Array<{story: Object, count: number}>}
 */
export function recentSetups(stories, limit = 4) {
  const setups = new Map();
  const newestFirst = stories.toSorted((a, b) =>
    String(b.modified || b.created).localeCompare(String(a.modified || a.created)),
  );
  for (const story of newestFirst) {
    if (!story.characterIds?.length) continue;
    const key = setupKey(story);
    const setup = setups.get(key);
    if (setup) setup.count++;
    else setups.set(key, { story, count: 1 });
  }
  return [...setups.values()].slice(0, limit);
}

/** A card's cast in a few words: "Mara", "Mara & Ilse", "Mara, Ilse & Tov", "Mara, Ilse & 3 more". */
export function castLine(names) {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} & ${names[2]}`;
  return `${names[0]}, ${names[1]} & ${names.length - 2} more`;
}

/** How long ago, briefly: "just now", "5m ago", "3h ago", "yesterday", "4d ago", "2w ago", a date. */
export function timeAgo(value, now = Date.now()) {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const minutes = Math.floor((now - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return 'yesterday';
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 35) return `${Math.floor(days / 7)}w ago`;
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** A character's picture for a card: the medium thumbnail where there is one. */
export function portraitUrl(character) {
  return character?.thumbnailMediumUrl || character?.imageUrl || null;
}

/** A small round avatar's picture: the small thumbnail where there is one. */
export function avatarUrl(character) {
  return character?.thumbnailUrl || character?.imageUrl || null;
}

/** The muted backdrop behind a character without a picture, from their name. */
export function placeholderColor(name) {
  return `hsl(${hashString(name ?? '') % 360} 30% 40%)`;
}
