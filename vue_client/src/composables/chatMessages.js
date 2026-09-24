/**
 * Chat Message Helpers
 */

const SEPARATOR_LINE = /^[ \t]*---[ \t]*$/m;

/** A reply being written, split into the messages it will likely be saved as. */
export function splitReply(text) {
  return text
    .split(SEPARATOR_LINE)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Whether a turn's sender should be named above it: in a group chat, when a character's turn
 * follows someone else's.
 * @param {Array<Object>} turns - Oldest first.
 * @param {number} index
 * @param {boolean} isGroup
 */
export function showsSender(turns, index, isGroup) {
  const turn = turns[index];
  if (!isGroup || turn.source !== 'character') return false;
  const previous = turns[index - 1];
  return !previous || previous.source !== 'character' || previous.characterId !== turn.characterId;
}

/** "Waiting in line (position 3, about 20s)" for an AI Horde queue update. */
export function describeQueue({ position, waitTime }) {
  const details = [];
  if (Number.isFinite(position) && position > 0) details.push(`position ${position}`);
  if (Number.isFinite(waitTime) && waitTime > 0) details.push(`about ${Math.round(waitTime)}s`);
  return details.length > 0 ? `Waiting in line (${details.join(', ')})...` : 'Waiting in line...';
}
