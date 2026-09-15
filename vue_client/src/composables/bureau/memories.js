/**
 * Labels shared by the memory browser's components.
 */

export const IMPORTANCE_LEVELS = [
  { value: 1, label: '1 · Trivia' },
  { value: 2, label: '2 · Minor' },
  { value: 3, label: '3 · Useful' },
  { value: 4, label: '4 · Significant' },
  { value: 5, label: '5 · Defining' },
];

export const DEFAULT_IMPORTANCE = 3;

/**
 * What an archive pass committed to memory, for a toast.
 * @param {{ passes: number, added: number, superseded: number, held?: number,
 *   facts?: number }|null} archive
 */
export function describeArchive(archive) {
  if (!archive || archive.passes === 0) return 'Nothing new to commit to memory';
  const learned = archive.added === 1 ? '1 thing learned' : `${archive.added} things learned`;
  const updated = archive.superseded > 0 ? `, ${archive.superseded} updated` : '';
  const held = archive.held > 0 ? `, ${archive.held} held for you to check` : '';
  const proposed = archive.facts === 1 ? '1 fact' : `${archive.facts} facts`;
  const facts = archive.facts > 0 ? `, ${proposed} proposed` : '';
  return `Committed to memory: ${learned}${updated}${held}${facts}`;
}
