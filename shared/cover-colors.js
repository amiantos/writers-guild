/**
 * Cover colors for the library's story and chat cards. A Continuity's color comes from its name,
 * so every story and chat in it shares one; a story outside a Continuity takes its color from its
 * cast, so stories with the same characters match too.
 *
 * Every color is dark enough for the cards' light text (#f6efe6) to read at 7:1 or better.
 */

export const COVER_COLORS = [
  '#5b2a2a', // oxblood
  '#1f2e45', // ink
  '#3d2a45', // plum
  '#2f3a3a', // slate
  '#24392c', // forest
  '#523e1c', // ochre
  '#283448', // steel
  '#4a2834', // wine
  '#342c46', // indigo
  '#3a4024', // moss
  '#5a3220', // rust
  '#1c3a3c', // deep teal
];

/** A 32-bit FNV-1a hash of a string: quick, and stable across server and browser. */
export function hashString(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The cover color for a key, the same each time. */
export function coverColor(key) {
  return COVER_COLORS[hashString(String(key)) % COVER_COLORS.length];
}

/** A Continuity's color, from its name. Case and surrounding spaces don't count. */
export function continuityColor(name) {
  return coverColor(
    `continuity:${String(name ?? '')
      .trim()
      .toLowerCase()}`,
  );
}

/** A story's own color, outside any Continuity: from its cast, in any order, else its id. */
export function castColor(characterIds, fallbackKey) {
  const ids = (characterIds ?? []).toSorted();
  return coverColor(ids.length > 0 ? `cast:${ids.join(',')}` : `story:${fallbackKey}`);
}
