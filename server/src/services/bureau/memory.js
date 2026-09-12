/**
 * Memory
 *
 * Which memories a story can draw on, and which of those fit in a prompt (see
 * "Time and memory" in docs/bureau-design.md). Pure functions over the memory
 * objects from memory-storage.js.
 */

function timeOf(memory) {
  return memory.worldTime ? Date.parse(memory.worldTime) : -Infinity;
}

function timestampOf(time) {
  return time instanceof Date ? time.getTime() : Date.parse(time);
}

/** Unretired visible memories, leaving out any replaced by another visible memory. */
function currentAmong(memories, isVisible) {
  const visibleIds = new Set(memories.filter(isVisible).map((memory) => memory.id));
  return memories.filter(
    (memory) =>
      !memory.retired &&
      visibleIds.has(memory.id) &&
      (memory.supersededBy === null || !visibleIds.has(memory.supersededBy)),
  );
}

/** Oldest first: by Bureau time (backstory first), then story order, then when recorded. */
export function compareChronological(a, b) {
  return (
    timeOf(a) - timeOf(b) || (a.sourcePosition ?? -1) - (b.sourcePosition ?? -1) || a.id - b.id
  );
}

/**
 * Whether a memory comes from before a story starts. Backstory always does. A
 * memory from another story does if that story starts earlier, or at the same
 * time but earlier in the Bureau's order (the usual case when a story ends
 * without moving the clock). A story's own memories never do: its text is
 * already in the prompt.
 *
 * @param {Object} memory
 * @param {Object} story - Uses id, startTime, and position.
 */
export function isBeforeStory(memory, story) {
  if (memory.sourceType === 'story' && memory.sourceId === story.id) return false;
  if (!memory.worldTime) return true;

  const memoryTime = Date.parse(memory.worldTime);
  const storyTime = Date.parse(story.startTime);
  if (memoryTime !== storyTime) return memoryTime < storyTime;
  return memory.sourcePosition !== null && memory.sourcePosition < story.position;
}

/**
 * A character's memories as they stood when a story starts. A memory replaced
 * by one from later still counts, so a flashback remembers the old version.
 *
 * @param {Array<Object>} memories - All of the character's memories, retired and replaced
 *   ones included (listMemories with status 'all').
 * @param {Object} story - Uses id, startTime, and position.
 * @param {Object} [options]
 * @param {boolean} [options.includeOwnStory] - Count memories from this story too, for the
 *   Archivist, which updates them as the story goes on.
 * @returns {Array<Object>} Unretired memories, in the order given.
 */
export function memoriesAsOf(memories, story, { includeOwnStory = false } = {}) {
  return currentAmong(
    memories,
    (memory) =>
      isBeforeStory(memory, story) ||
      (includeOwnStory && memory.sourceType === 'story' && memory.sourceId === story.id),
  );
}

/**
 * A character's memories as they stand at a moment, for correspondence:
 * backstory and everything dated at or before it, including stories that
 * started earlier and haven't ended.
 *
 * @param {Array<Object>} memories - All of the character's memories (status 'all').
 * @param {Date|string} time
 * @returns {Array<Object>} Unretired memories, in the order given.
 */
export function memoriesAtTime(memories, time) {
  const moment = timestampOf(time);
  return currentAmong(
    memories,
    (memory) => !memory.worldTime || Date.parse(memory.worldTime) <= moment,
  );
}

/**
 * Accepted arc notes a story can draw on: written by the reader, or from stories
 * before it (see isBeforeStory). A story's own notes are left out, like its memories.
 * @param {Array<Object>} notes - A character's arc notes (see arc-note-storage.js).
 * @param {Object} story - Uses id, startTime, and position.
 */
export function notesAsOf(notes, story) {
  return notes.filter((note) => note.status === 'accepted' && isBeforeStory(note, story));
}

/**
 * Accepted arc notes as they stand at a moment, for correspondence.
 * @param {Array<Object>} notes - A character's arc notes.
 * @param {Date|string} time
 */
export function notesAtTime(notes, time) {
  const moment = timestampOf(time);
  return notes.filter(
    (note) =>
      note.status === 'accepted' && (!note.worldTime || Date.parse(note.worldTime) <= moment),
  );
}

/**
 * What goes in the Writer prompt for one character: pinned knowledge, then the
 * most important knowledge that fits the budget, and the latest episodes.
 *
 * @param {Array<Object>} memories - From memoriesAsOf.
 * @param {Object} limits
 * @param {number} limits.knowledgeCharacters
 * @param {number} limits.recentEpisodes
 * @returns {{ knowledge: Array<Object>, episodes: Array<Object>, offscreen: Object|null }}
 *   Knowledge and episodes oldest first; offscreen is what they did the last time Bureau time
 *   jumped forward, if no episode has happened since.
 */
export function selectForPrompt(memories, { knowledgeCharacters, recentEpisodes }) {
  const ranked = memories
    .filter((memory) => memory.layer === 'knowledge')
    .toSorted(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.importance - a.importance ||
        compareChronological(b, a),
    );

  const knowledge = [];
  let used = 0;
  for (const memory of ranked) {
    const size = memory.content.length + 3;
    if (!memory.pinned && used + size > knowledgeCharacters) continue;
    knowledge.push(memory);
    used += size;
  }

  const episodes = memories
    .filter((memory) => memory.layer === 'episode')
    .toSorted(compareChronological);

  // The latest account of time away, unless an episode has happened since.
  const since = episodes.length > 0 ? timeOf(episodes.at(-1)) : -Infinity;
  const offscreen =
    memories
      .filter((memory) => memory.layer === 'offscreen' && timeOf(memory) >= since)
      .toSorted(compareChronological)
      .at(-1) ?? null;

  return {
    knowledge: knowledge.toSorted(compareChronological),
    episodes: recentEpisodes > 0 ? episodes.slice(-recentEpisodes) : [],
    offscreen,
  };
}
