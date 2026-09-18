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

/**
 * Unretired visible memories, leaving out any replaced by another visible memory. A memory held for
 * disagreeing with a profile or an established fact isn't visible until the reader keeps it.
 */
function currentAmong(memories, isVisible) {
  const visibleIds = new Set(
    memories.filter((memory) => !memory.conflict && isVisible(memory)).map((memory) => memory.id),
  );
  return memories.filter(
    (memory) =>
      !memory.retired &&
      visibleIds.has(memory.id) &&
      (memory.supersededBy === null || !visibleIds.has(memory.supersededBy)),
  );
}

/**
 * When a memory's source was written: its chapter was created, the earliest message it cites was
 * written, or else the memory itself was recorded.
 */
function writtenOf(memory) {
  return Date.parse(memory.sourceCreated ?? memory.created);
}

/**
 * Oldest first: by Bureau time (backstory first), then what was written first, then when
 * recorded. Messages don't move the clock, so a conversation often shares its time with the
 * chapters around it.
 */
export function compareChronological(a, b) {
  return timeOf(a) - timeOf(b) || writtenOf(a) - writtenOf(b) || a.id - b.id;
}

/**
 * Whether a memory comes from before a story starts. Backstory always does, and
 * so does anything dated earlier. At the same Bureau time, what was written first
 * comes first: a memory from another story does if that story is earlier in the
 * Bureau's order (the usual case when a story ends without moving the clock), and
 * one from messages does if they were written before the story started (or, once
 * the messages are deleted, if it was recorded before). A story's own memories
 * never do: its text is already in the prompt.
 *
 * @param {Object} memory - A memory, arc note, or fact.
 * @param {Object} story - Uses id, startTime, position, and created.
 */
export function isBeforeStory(memory, story) {
  if (memory.sourceType === 'story' && memory.sourceId === story.id) return false;
  if (!memory.worldTime) return true;

  const memoryTime = Date.parse(memory.worldTime);
  const storyTime = Date.parse(story.startTime);
  if (memoryTime !== storyTime) return memoryTime < storyTime;
  if (memory.sourceType === 'correspondence') {
    return writtenOf(memory) < Date.parse(story.created);
  }
  return memory.sourcePosition !== null && memory.sourcePosition < story.position;
}

/**
 * A character's memories as they stood when a story starts. A memory replaced
 * by one from later still counts, so a flashback remembers the old version.
 *
 * @param {Array<Object>} memories - All of the character's memories, retired and replaced
 *   ones included (listMemories with status 'all').
 * @param {Object} story - Uses id, startTime, position, and created.
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
 * @param {Object} story - Uses id, startTime, position, and created.
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

/** Later by Bureau time, then accepted later, then written later. */
function compareFacts(a, b) {
  return (
    timeOf(a) - timeOf(b) ||
    (Date.parse(a.decided) || 0) - (Date.parse(b.decided) || 0) ||
    a.id - b.id
  );
}

/**
 * Which accepted facts stand. Facts that replace one another, directly or through others, form a
 * line back to the fact they began with, and the latest visible accepted fact in each line stands
 * for it. A change rejected or deleted from the middle of a line, or two changes accepted for the
 * same fact, still leave one fact standing.
 *
 * @param {Array<Object>} facts - The Bureau's facts, every status.
 * @param {(fact: Object) => boolean} [isVisible]
 * @returns {{ lineOf: Map<number, number>, standing: Map<number, Object> }} Each fact's line, as the
 *   id of the fact it began with, and the fact standing for each line.
 */
export function standingFacts(facts, isVisible = () => true) {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  const lineOf = new Map();
  for (const fact of facts) {
    let first = fact;
    const seen = new Set([fact.id]);
    while (byId.has(first.replaces) && !seen.has(first.replaces)) {
      first = byId.get(first.replaces);
      seen.add(first.id);
    }
    lineOf.set(fact.id, first.id);
  }

  const standing = new Map();
  for (const fact of facts) {
    if (fact.status !== 'accepted' || !isVisible(fact)) continue;
    const line = lineOf.get(fact.id);
    const other = standing.get(line);
    if (!other || compareFacts(fact, other) > 0) standing.set(line, fact);
  }
  return { lineOf, standing };
}

/** The visible accepted facts that stand, in the order given. */
function currentFacts(facts, isVisible) {
  const { standing } = standingFacts(facts, isVisible);
  const kept = new Set([...standing.values()].map((fact) => fact.id));
  return facts.filter((fact) => kept.has(fact.id));
}

/**
 * The established facts a story can draw on: written by the reader, or accepted from before it
 * (see isBeforeStory). A fact gives way to a change the story can see, so a flashback set before
 * the change keeps the old fact.
 *
 * @param {Array<Object>} facts - The Bureau's facts (see fact-storage.js).
 * @param {Object} story - Uses id, startTime, position, and created.
 * @param {Object} [options]
 * @param {boolean} [options.includeOwnStory] - Count facts from this story too, for the Archivist.
 * @returns {Array<Object>} In the order given.
 */
export function factsAsOf(facts, story, { includeOwnStory = false } = {}) {
  return currentFacts(
    facts,
    (fact) =>
      isBeforeStory(fact, story) ||
      (includeOwnStory && fact.sourceType === 'story' && fact.sourceId === story.id),
  );
}

/**
 * The established facts as they stand at a moment, for correspondence and offscreen life.
 * @param {Array<Object>} facts - The Bureau's facts.
 * @param {Date|string} time
 */
export function factsAtTime(facts, time) {
  const moment = timestampOf(time);
  return currentFacts(facts, (fact) => !fact.worldTime || Date.parse(fact.worldTime) <= moment);
}

/**
 * What goes in a prompt for one character: pinned knowledge, then the most important knowledge
 * that fits the budget, and what they did the last time Bureau time jumped forward. What happened
 * in earlier chapters comes from their summaries instead (see earlierChapters).
 *
 * @param {Array<Object>} memories - From memoriesAsOf or memoriesAtTime.
 * @param {Object} limits
 * @param {number} limits.knowledgeCharacters
 * @param {Object} [options]
 * @param {string|null} [options.lastChapterTime] - When the latest chapter they were in began
 *   (ISO), from earlierChapters: an account of time away before it is out of date.
 * @returns {{ knowledge: Array<Object>, offscreen: Object|null }} Knowledge oldest first.
 */
export function selectForPrompt(
  memories,
  { knowledgeCharacters },
  { lastChapterTime = null } = {},
) {
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

  // The latest account of time away, unless a chapter they were in has happened since. Chapters
  // used to leave an episode for each character, so one of those counts too.
  const episodes = memories.filter((memory) => memory.layer === 'episode');
  const since = Math.max(
    lastChapterTime ? Date.parse(lastChapterTime) : -Infinity,
    ...episodes.map(timeOf),
  );
  const offscreen =
    memories
      .filter((memory) => memory.layer === 'offscreen' && timeOf(memory) >= since)
      .toSorted(compareChronological)
      .at(-1) ?? null;

  return { knowledge: knowledge.toSorted(compareChronological), offscreen };
}

/** Oldest first: by when a chapter began, then by the Bureau's order. */
function compareChapters(a, b) {
  return Date.parse(a.startTime) - Date.parse(b.startTime) || a.position - b.position;
}

/**
 * Whether a chapter comes before a story: it began earlier, or at the same Bureau time and earlier
 * in the Bureau's order, as its memories do (see isBeforeStory).
 */
function isChapterBefore(chapter, story) {
  return chapter.id !== story.id && compareChapters(chapter, story) < 0;
}

/**
 * The summaries of earlier chapters: what happened in them, as the Archivist wrote it up. A chapter
 * counts once it has a summary, ended or not.
 *
 * @param {Array<Object>} chapters - The Bureau's chapters (listStories in story-storage.js).
 * @param {Object} when - Exactly one of:
 * @param {Object} [when.story] - Chapters before this one (see isChapterBefore), for its Writer.
 * @param {Date|string} [when.time] - Chapters begun at or before this moment, for replies,
 *   offscreen accounts, and interviews.
 * @param {Object} [options]
 * @param {string|null} [options.castId] - Only chapters this cast member was in.
 * @returns {Array<{ id: string, title: string, startTime: string, summary: string }>} Oldest
 *   first; take the end of the list for the most recent.
 */
export function earlierChapters(chapters, { story = null, time = null }, { castId = null } = {}) {
  const moment = time === null ? null : timestampOf(time);
  return chapters
    .filter(
      (chapter) =>
        chapter.summary?.trim() &&
        (story ? isChapterBefore(chapter, story) : Date.parse(chapter.startTime) <= moment) &&
        (!castId || chapter.castIds.includes(castId)),
    )
    .toSorted(compareChapters)
    .map(({ id, title, startTime, summary }) => ({ id, title, startTime, summary }));
}
