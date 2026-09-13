/**
 * Correspondence Helpers for Bureau Views
 */

const SEPARATOR_LINE = /^[ \t]*---[ \t]*$/m;
// Messages further apart than this start a new session, shown with its own time.
export const SESSION_GAP_MS = 3 * 60 * 60 * 1000;

/** A reply being written, split into the messages it will be saved as. */
export function splitReply(text) {
  return text
    .split(SEPARATOR_LINE)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Messages grouped into sessions: runs with no gap longer than SESSION_GAP_MS.
 * @param {Array<{bureauTime: string}>} messages - Oldest first.
 * @returns {Array<{ startTime: string, messages: Array<Object> }>}
 */
export function groupSessions(messages) {
  const sessions = [];
  for (const message of messages) {
    const session = sessions.at(-1);
    const previous = session?.messages.at(-1);
    if (
      previous &&
      Date.parse(message.bureauTime) - Date.parse(previous.bureauTime) <= SESSION_GAP_MS
    ) {
      session.messages.push(message);
    } else {
      sessions.push({ startTime: message.bureauTime, messages: [message] });
    }
  }
  return sessions;
}
