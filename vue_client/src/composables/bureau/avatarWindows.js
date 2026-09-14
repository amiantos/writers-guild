/**
 * Avatar Windows
 *
 * Character portraits that float over a Bureau's chapters, as story mode's avatar windows float
 * over a story. The Bureau remembers its windows, so they stay put from chapter to chapter.
 */

export const DEFAULT_WINDOW_SIZE = { width: 300, height: 400 };
// The most windows the server saves for a Bureau, as for a story in story mode.
export const MAX_AVATAR_WINDOWS = 20;

const FIRST_POSITION = { x: 20, y: 100 };
// Each new window opens this far down and to the right of the furthest one.
const CASCADE = 30;

function avatarWindowId() {
  // randomUUID needs a secure context, and LAN mode serves plain http.
  return (
    globalThis.crypto?.randomUUID?.() ??
    `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
}

/**
 * Who a window can show: everyone in the Bureau's cast, the chapter's cast first, each with the
 * portrait of their library character when there is one.
 *
 * @param {Array<Object>} cast - The Bureau's cast members.
 * @param {string[]} chapterCastIds
 * @param {Map<string, Object>} libraryCharacters - The character list's entries, by id.
 * @returns {Array<{ id: string, name: string, imageUrl: string|null,
 *   thumbnailMediumUrl: string|null }>}
 */
export function windowCharacters(cast, chapterCastIds, libraryCharacters) {
  const inChapter = (member) => chapterCastIds.includes(member.id);
  return [...cast.filter(inChapter), ...cast.filter((member) => !inChapter(member))].map(
    (member) => {
      const character = libraryCharacters.get(member.libraryCharacterId);
      return {
        id: member.id,
        name: member.name,
        imageUrl: character?.imageUrl ?? null,
        thumbnailMediumUrl: character?.thumbnailMediumUrl ?? null,
      };
    },
  );
}

/**
 * A new window, cascaded from the windows already open like story mode's. It shows the first
 * character in the chapter who isn't the reader's, or else anyone in the chapter or the cast.
 *
 * @param {Object} params
 * @param {Array<Object>} params.cast - The Bureau's cast members.
 * @param {string[]} params.chapterCastIds
 * @param {Array<Object>} params.windows - The windows already open.
 * @returns {{ id: string, castId: string, x: number, y: number, width: number,
 *   height: number } | null} Null when the cast is empty, or when as many windows are open as the
 *   Bureau can keep.
 */
export function newAvatarWindow({ cast, chapterCastIds, windows }) {
  if (windows.length >= MAX_AVATAR_WINDOWS) return null;
  const inChapter = cast.filter((member) => chapterCastIds.includes(member.id));
  const shown = inChapter.find((member) => !member.isPersona) ?? inChapter[0] ?? cast[0];
  if (!shown) return null;

  const furthest = Math.max(
    -1,
    ...windows.map((win) => Math.round((win.x - FIRST_POSITION.x) / CASCADE)),
  );
  const step = furthest + 1;
  return {
    id: avatarWindowId(),
    castId: shown.id,
    x: FIRST_POSITION.x + step * CASCADE,
    y: FIRST_POSITION.y + step * CASCADE,
    ...DEFAULT_WINDOW_SIZE,
  };
}
