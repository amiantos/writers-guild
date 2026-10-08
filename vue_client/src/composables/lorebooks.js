/**
 * The Lorebooks section: the lorebook library as a shelf of book covers, with the filters and
 * sorts around it. Plain functions over the lists the API returns, like the home page's library
 * (./library.js), so the view stays thin.
 */
import { coverColor } from '../../../shared/cover-colors.js';

export const LOREBOOK_SORTS = [
  { key: 'modified', label: 'Last edited' },
  { key: 'name', label: 'Name' },
  { key: 'entries', label: 'Entries' },
  { key: 'created', label: 'Added' },
];

// What a lorebook is used by. Characters link one through their card; stories attach them directly.
export const LOREBOOK_USES = [
  { key: 'all', label: 'All' },
  { key: 'characters', label: 'Linked to characters' },
  { key: 'stories', label: 'In stories' },
  { key: 'unused', label: 'Unused' },
];

/** A lorebook's cover color, from its name. Case and surrounding spaces don't count. */
export function lorebookColor(name) {
  return coverColor(
    `lorebook:${String(name ?? '')
      .trim()
      .toLowerCase()}`,
  );
}

/**
 * One card per lorebook, with what the shelf shows and filters on, plus the lorebook itself as
 * `source`. `stories` are the stories it's attached to, most recently edited first.
 */
export function buildLorebookItems({ lorebooks = [], stories = [] }) {
  const storiesById = new Map(stories.map((s) => [s.id, s]));
  return lorebooks.map((lorebook) => {
    const name = lorebook.name || 'Untitled Lorebook';
    return {
      id: lorebook.id,
      name,
      description: lorebook.description || '',
      entryCount: lorebook.entryCount || 0,
      created: lorebook.created ?? null,
      modified: lorebook.modified || lorebook.created || null,
      color: lorebookColor(name),
      characters: lorebook.characters ?? [],
      stories: (lorebook.storyIds ?? [])
        .map((id) => storiesById.get(id))
        .filter(Boolean)
        .toSorted((a, b) =>
          String(b.modified || b.created).localeCompare(String(a.modified || a.created)),
        ),
      source: lorebook,
    };
  });
}

/** Whether a card is used in this LOREBOOK_USES way. */
function isUsed(item, use) {
  switch (use) {
    case 'characters':
      return item.characters.length > 0;
    case 'stories':
      return item.stories.length > 0;
    case 'unused':
      return item.characters.length === 0 && item.stories.length === 0;
    default:
      return true;
  }
}

/** How many cards each LOREBOOK_USES choice shows. */
export function lorebookUseCounts(items) {
  return Object.fromEntries(
    LOREBOOK_USES.map(({ key }) => [key, items.filter((item) => isUsed(item, key)).length]),
  );
}

/**
 * The cards to show.
 * @param {Object} options
 * @param {string} [options.use] - A LOREBOOK_USES key.
 * @param {string} [options.query] - Matched against names and descriptions.
 */
export function filterLorebookItems(items, { use = 'all', query = '' } = {}) {
  const needle = query.trim().toLowerCase();
  return items.filter(
    (item) =>
      isUsed(item, use) &&
      (!needle ||
        [item.name, item.description].some((text) => text.toLowerCase().includes(needle))),
  );
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
const byNewest = (field) => (a, b) => String(b[field] ?? '').localeCompare(String(a[field] ?? ''));

/** The cards in a LOREBOOK_SORTS order. */
export function sortLorebookItems(items, sort = 'modified') {
  switch (sort) {
    case 'name':
      return items.toSorted(byName);
    case 'entries':
      return items.toSorted((a, b) => b.entryCount - a.entryCount || byName(a, b));
    case 'created':
      return items.toSorted((a, b) => byNewest('created')(a, b) || byName(a, b));
    default:
      return items.toSorted((a, b) => byNewest('modified')(a, b) || byName(a, b));
  }
}

/** "1 entry", "24 entries". */
export function entryLine(count) {
  return `${count.toLocaleString()} ${count === 1 ? 'entry' : 'entries'}`;
}

/**
 * The delete prompt, naming what loses the lorebook: the characters linked to it and the
 * stories it's attached to keep everything else.
 */
export function buildLorebookDeleteMessage({ name, characters = [], stories = [] }) {
  const uses = [];
  if (characters.length) uses.push(`linked to ${listNames(characters.map((c) => c.name))}`);
  if (stories.length) {
    uses.push(`attached to ${stories.length === 1 ? '1 story' : `${stories.length} stories`}`);
  }
  const lead = `Delete lorebook "${name}"?`;
  if (!uses.length) return `${lead}\n\nThis cannot be undone.`;
  return (
    `${lead}\n\nIt's ${uses.join(' and ')}, which will no longer use it. ` +
    'Nothing else about them changes.\n\nThis cannot be undone.'
  );
}

function listNames(names) {
  if (names.length <= 2) return names.join(' and ');
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} others`;
}
