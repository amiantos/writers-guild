/**
 * Archivist
 *
 * Reads a story's turns, or a thread's messages, and records what the characters
 * will remember (see "Archivist" in docs/bureau-design.md). Each pass is one
 * forced call to a strict record_memories tool, which returns knowledge, an
 * episode per character, arc notes, and a story's running summary.
 *
 * Memories apply without review, because every memory is visible, sourced, and
 * editable in the memory browser. Arc notes, which change how a character is
 * written, are only proposed: the reader accepts or rejects each one. The
 * reader's character remembers like everyone else.
 *
 * A story and a thread differ only in their source: what a pass reads, how its
 * memories are dated and cited, and which episode it rewrites. A thread is read
 * one session at a time, and each session gets an episode of its own.
 */

import { describeBureauTime, describeTimePassing } from './bureau-time.js';
import {
  isBeforeStory,
  memoriesAsOf,
  memoriesAtTime,
  notesAtTime,
  selectForPrompt,
} from './memory.js';
import { RunRecorder } from './run-recorder.js';

// The latest turns may still be regenerated or edited, so automatic passes leave them.
export const SETTLE_TURNS = 6;
// Settled prose turns that must be waiting before an automatic pass runs.
export const MIN_SETTLED_PROSE = 6;
// Story text per pass; longer stretches are read in several passes.
export const ARCHIVE_CHUNK_CHARACTERS = 60_000;
// Existing knowledge shown per character, so the Archivist updates rather than repeats.
export const KNOWN_CHARACTERS_PER_CHARACTER = 12_000;
// Messages further apart than this, in Bureau time, belong to different sessions.
export const SESSION_GAP_MS = 3 * 60 * 60 * 1000;
// Rejected arc notes shown per character, most recent first; all of them still block repeats.
const REJECTED_NOTES_SHOWN = 30;

export const RECORD_MEMORIES_TOOL = {
  name: 'record_memories',
  description: 'Record what the characters will remember from the new passages.',
  parameters: {
    type: 'object',
    properties: {
      knowledge: {
        type: 'array',
        description: 'Lasting facts the characters learned. Empty when nothing lasting happened.',
        items: {
          type: 'object',
          properties: {
            character: {
              type: 'string',
              description: 'Name of the character who remembers this.',
            },
            content: {
              type: 'string',
              description: 'One fact, in the third person, using names.',
            },
            importance: {
              type: 'integer',
              description: '1 trivia, 2 minor, 3 useful, 4 significant, 5 defining.',
            },
            supersedes: {
              type: 'integer',
              description: "Number of the character's memory this updates or corrects, or 0.",
            },
            passages: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Numbers of the passages this comes from.',
            },
          },
          required: ['character', 'content', 'importance', 'supersedes', 'passages'],
          additionalProperties: false,
        },
      },
      episodes: {
        type: 'array',
        description:
          'One per character, telling what has happened so far in this chapter or exchange of messages, from their point of view, in the third person.',
        items: {
          type: 'object',
          properties: {
            character: { type: 'string', description: 'Name of the character.' },
            content: {
              type: 'string',
              description: 'At most 120 words, in the third person and past tense.',
            },
          },
          required: ['character', 'content'],
          additionalProperties: false,
        },
      },
      arc_notes: {
        type: 'array',
        description:
          'Ways a character changed in these passages, for the reader to review. Usually empty.',
        items: {
          type: 'object',
          properties: {
            character: { type: 'string', description: 'Name of the character who changed.' },
            content: {
              type: 'string',
              description: 'How they have changed, in one or two sentences, in the third person.',
            },
            rationale: { type: 'string', description: 'What in the passages shows it.' },
            passages: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Numbers of the passages that show it.',
            },
          },
          required: ['character', 'content', 'rationale', 'passages'],
          additionalProperties: false,
        },
      },
      story_summary: {
        type: 'string',
        description: 'What has happened in the whole chapter so far, at most 150 words.',
      },
    },
    required: ['knowledge', 'episodes', 'arc_notes', 'story_summary'],
    additionalProperties: false,
  },
};

class SourceDeletedError extends Error {
  constructor(kind) {
    super(`The ${kind === 'story' ? 'story' : 'thread'} was deleted while it was being archived`);
    this.name = 'SourceDeletedError';
  }
}

// ==================== Deciding what to read ====================

/**
 * The position an automatic pass should read through, or null when too little
 * has settled since the last pass.
 * @param {Array<Object>} turns - The story's turns in order.
 * @param {Object} story - Uses archivedThrough.
 */
export function autoArchiveThrough(turns, story) {
  const settled = turns.slice(0, Math.max(0, turns.length - SETTLE_TURNS));
  const waiting = settled.filter(
    (turn) => turn.kind === 'prose' && turn.position > story.archivedThrough,
  );
  return waiting.length >= MIN_SETTLED_PROSE ? settled.at(-1).position : null;
}

/** Split turns into passes of about `budget` characters of text, at least one turn each. */
export function chunkTurns(turns, budget = ARCHIVE_CHUNK_CHARACTERS) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const turn of turns) {
    const turnSize = turn.content.length + 16;
    if (current.length > 0 && size + turnSize > budget) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(turn);
    size += turnSize;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function timestampOf(value) {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/**
 * Whether a message starts a new session after the previous one: Bureau time went back or moved
 * on more than SESSION_GAP_MS, or a chapter started after the previous message was written and
 * no later than this one. A message with no created time counts as written after every chapter
 * start.
 * @param {Object} previous - Uses bureauTime and created.
 * @param {{ bureauTime: Date|string, created?: string }} next
 * @param {Array<number>} breakTimes - When chapters started, as timestamps.
 */
function startsSession(previous, { bureauTime, created }, breakTimes) {
  const gap = timestampOf(bureauTime) - Date.parse(previous.bureauTime);
  if (!(gap >= 0 && gap <= SESSION_GAP_MS)) return true;
  const written = Date.parse(previous.created);
  const nextWritten = created === undefined ? Infinity : Date.parse(created);
  return breakTimes.some((time) => written < time && time <= nextWritten);
}

/**
 * A thread's messages split into sessions. A new session starts when Bureau time moves on more
 * than SESSION_GAP_MS or goes back between two messages, or when a chapter started between them,
 * so messages from before a chapter never share a session with messages from after it.
 * @param {Array<Object>} messages - Oldest first.
 * @param {Object} [options]
 * @param {Array<string>} [options.breaks] - When the Bureau's chapters started (see chapterBreaks).
 * @returns {Array<Array<Object>>}
 */
export function threadSessions(messages, { breaks = [] } = {}) {
  const breakTimes = breaks.map((time) => Date.parse(time));
  const sessions = [];
  for (const message of messages) {
    const session = sessions.at(-1);
    if (session && !startsSession(session.at(-1), message, breakTimes)) {
      session.push(message);
    } else {
      sessions.push([message]);
    }
  }
  return sessions;
}

/**
 * Whether a session is over at a Bureau time, so a message sent now would start a new one: Bureau
 * time has moved on more than SESSION_GAP_MS past its last message or back before it, or a chapter
 * started after it.
 * @param {Array<Object>} session - From threadSessions.
 * @param {Date|string} bureauTime
 * @param {Array<string>} [breaks] - When the Bureau's chapters started (see chapterBreaks).
 */
export function isSessionOver(session, bureauTime, breaks = []) {
  return startsSession(
    session.at(-1),
    { bureauTime },
    breaks.map((time) => Date.parse(time)),
  );
}

/** When each of the Bureau's chapters started, in real time: the sessions breaks between. */
export function chapterBreaks(stores, bureauId) {
  return stores.stories.listStories(bureauId).map((story) => story.created);
}

// ==================== Prompt ====================

const WORDING = {
  story: {
    units: 'passages',
    unit: 'Passage',
    scope: 'this chapter',
    episodes:
      'Episodes: one for each character who remembers, telling what happened in this chapter so far from their point of view, in the third person and past tense, in at most 120 words. When they already have an episode for this chapter, rewrite it to include the new passages.',
    summary:
      'story_summary: what has happened in the whole chapter so far, in at most 150 words, updating the previous summary.',
  },
  correspondence: {
    units: 'messages',
    unit: 'Message',
    scope: 'this exchange',
    episodes:
      'Episodes: one for each character who remembers, telling what happened in this exchange of messages from their point of view, in the third person and past tense, in at most 60 words, such as "Theo texted late one night about swimming out to the buoy, and Mara talked him out of it." When they already have an episode for this exchange, rewrite it to include the new messages.',
    summary: 'story_summary: leave it empty.',
  },
};

function nameOf(member) {
  return member.seedCard?.data?.name || member.name;
}

function listNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function section(title, body) {
  return `=== ${title} ===\n${body}`;
}

/**
 * @param {Object} params
 * @param {Object} params.source - What the pass reads (see storySource and threadSource): uses
 *   kind, title, openingTime, summary, and timeZone.
 * @param {Array<Object>} params.characters - Cast members who remember.
 * @param {Object|null} params.persona - The reader's character, if present.
 * @param {Map<string, Array<Object>>} params.knownByCast - Knowledge each character has now.
 * @param {Map<string, Object>} params.episodeByCast - Each character's episode for this story, or
 *   for this session of a thread.
 * @param {Map<string, {accepted: Array<Object>, proposed: Array<Object>, rejected: Array<Object>}>}
 *   [params.notesByCast] - Each character's accepted arc notes, the proposals waiting for review,
 *   and the changes the reader rejected.
 * @param {Array<Object>} params.turns - The turns or messages to read, in order. A message
 *   carries its speaker.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildArchivistMessages({
  source,
  characters,
  persona,
  knownByCast,
  episodeByCast,
  notesByCast = new Map(),
  turns,
}) {
  const wording = WORDING[source.kind];
  const names = characters.map(nameOf);
  const personaName = persona ? nameOf(persona) : null;
  const about = personaName ? `the people around them (including ${personaName})` : 'each other';

  const system = [
    `You are the Archivist for an ongoing story told in chapters. Read the new ${wording.units}, then call record_memories once with what the characters will remember.`,
    `Characters who remember: ${names.length > 0 ? listNames(names) : 'none'}.`,
  ];
  if (personaName) {
    system.push(
      `${personaName} is the reader's character and remembers like everyone else. Record ${personaName}'s memories and changes only from what the ${wording.units} show ${personaName} saying, doing, or learning, never from guesses at their thoughts.`,
    );
  }
  system.push(
    [
      'Knowledge:',
      `- Lasting facts a character learned, or that changed: about ${about}, their relationships, promises, plans, preferences, places, and running jokes.`,
      '- One fact per memory, in the third person with names, never "I" or "you". Record only what that character saw, heard, or was told.',
      '- Each memory must make sense on its own, read months later: say who and what, never "this" or "that" for something in another memory.',
      '- Skip passing actions, scenery, incidental details such as the exact time something happened, short-lived plans, and anything the character already knows. The episode tells what happened; knowledge keeps what will still matter later.',
      "- When a fact updates or contradicts one of the character's numbered memories, set supersedes to that number and write the complete updated fact. Otherwise set supersedes to 0.",
      '- Importance: 1 trivia, 2 minor detail, 3 useful, 4 significant, 5 defining (a milestone in a relationship, a secret revealed).',
      `- passages lists the numbers of the ${wording.units} the fact comes from.`,
      '- Recording no knowledge is fine when nothing lasting happened.',
    ].join('\n'),
    wording.episodes,
    `Arc notes: only when the ${wording.units} change who a character is, such as a new habit, a stance that softened or hardened, or a lasting decision about themselves or someone else. Not a fact they learned (that's knowledge), and not a passing mood. Write how they have changed in one or two sentences, with a rationale naming what in the ${wording.units} shows it. Don't repeat a change they already have, one waiting for review, or one the reader turned down. Most ${wording.units} call for none; the reader reviews every one.`,
    wording.summary,
  );

  const present = characters.map((member) =>
    member.id === persona?.id ? `${nameOf(member)} (the reader's character)` : nameOf(member),
  );
  if (persona && !characters.some((member) => member.id === persona.id)) {
    present.push(`${personaName} (the reader's character)`);
  }

  const known = characters.map((member) => {
    const lines = [`${nameOf(member)}:`];
    const knowledge = knownByCast.get(member.id) ?? [];
    lines.push(
      ...(knowledge.length > 0
        ? knowledge.map((memory) => `[${memory.id}] ${memory.content}`)
        : ['(nothing yet)']),
    );
    const episode = episodeByCast.get(member.id);
    if (episode) {
      lines.push(`Episode for ${wording.scope} so far: ${episode.content}`);
    }
    const notes = notesByCast.get(member.id);
    if (notes?.accepted.length > 0) {
      lines.push(
        `How ${nameOf(member)} has changed so far:`,
        ...notes.accepted.map((note) => `- ${note.content}`),
      );
    }
    if (notes?.proposed.length > 0) {
      lines.push(
        'Changes already waiting for review:',
        ...notes.proposed.map((note) => `- ${note.content}`),
      );
    }
    if (notes?.rejected.length > 0) {
      lines.push(
        'Changes the reader turned down (never propose these again):',
        ...notes.rejected.slice(-REJECTED_NOTES_SHOWN).map((note) => `- ${note.content}`),
      );
    }
    return lines.join('\n');
  });

  const passages = turns
    .filter((turn) => ['prose', 'scene_break', 'time_passes'].includes(turn.kind))
    .map((turn) => {
      if (turn.kind === 'scene_break') return '---';
      if (turn.kind === 'time_passes') {
        return `---\n\n${describeTimePassing(turn.bureauTime, source.timeZone)}`;
      }
      return `[${wording.unit} ${turn.position}]\n${turn.speaker ? `${turn.speaker}: ` : ''}${turn.content}`;
    });

  let user;
  if (source.kind === 'story') {
    const storyLines = [`Title: ${source.title}`];
    if (source.openingTime) storyLines.push(`Begins: ${source.openingTime}`);
    storyLines.push(`Present: ${present.length > 0 ? listNames(present) : 'no one in the cast'}`);
    user = [
      section('CHAPTER', storyLines.join('\n')),
      section(
        'SUMMARY SO FAR',
        source.summary || 'Nothing has been summarized yet; these are the first passages.',
      ),
    ];
  } else {
    const lines = [`Between: ${present.length > 0 ? listNames(present) : 'no one in the cast'}`];
    if (source.openingTime) lines.push(`Begins: ${source.openingTime}`);
    user = [section('MESSAGES', lines.join('\n'))];
  }
  if (known.length > 0) {
    user.push(section('WHAT THEY ALREADY KNOW', known.join('\n\n')));
  }
  user.push(section(`NEW ${wording.units.toUpperCase()}`, passages.join('\n\n')));

  return [
    { role: 'system', content: system.join('\n\n') },
    { role: 'user', content: user.join('\n\n') },
  ];
}

// ==================== Sources ====================

/**
 * What a story pass reads, loaded fresh for each pass: the previous pass updated
 * the story's summary.
 */
function storySource(stores, bureau, storyId) {
  const story = stores.stories.getStory(bureau.id, storyId);
  if (!story) {
    throw new SourceDeletedError('story');
  }
  const cast = story.castIds
    .map((castId) => stores.bureaus.getCastMember(bureau.id, castId))
    .filter(Boolean);
  const persona = cast.find((member) => member.isPersona) ?? null;
  return {
    kind: 'story',
    id: story.id,
    title: story.title,
    openingTime: describeBureauTime(story.startTime, bureau.timezone),
    summary: story.summary,
    timeZone: bureau.timezone,
    worldTime: story.startTime,
    // The reader's character remembers too.
    characters: cast,
    persona,
    exists: () => Boolean(stores.stories.getStory(bureau.id, storyId)),
    currentContent: (turnId) => stores.stories.getTurn(storyId, turnId)?.content,
    saveProgress: (archivedThrough, summary) =>
      stores.stories.setArchiveProgress(storyId, { archivedThrough, summary }),
    // A story's own memories count, since the Archivist updates them as the story goes on.
    visibleMemories: (memories) => memoriesAsOf(memories, story, { includeOwnStory: true }),
    acceptedNotes: (notes) =>
      notes.filter(
        (note) =>
          note.status === 'accepted' &&
          (isBeforeStory(note, story) ||
            (note.sourceType === 'story' && note.sourceId === story.id)),
      ),
    isOwnEpisode: (memory) =>
      memory.layer === 'episode' && memory.sourceType === 'story' && memory.sourceId === story.id,
  };
}

/** What a thread pass reads: one session, dated to its first message. */
function threadSource(stores, bureau, { thread, member, persona, session }) {
  if (!stores.threads.getThread(bureau.id, thread.id)) {
    throw new SourceDeletedError('thread');
  }
  const first = session[0];
  const last = session.at(-1);
  const people = [member, persona].filter(
    (castMember, index, all) =>
      castMember && all.findIndex((other) => other?.id === castMember.id) === index,
  );
  const names = people.map(nameOf);
  return {
    kind: 'correspondence',
    id: thread.id,
    title: `Messages between ${listNames(names)}`,
    openingTime: describeBureauTime(first.bureauTime, bureau.timezone),
    summary: '',
    worldTime: first.bureauTime,
    characters: people,
    persona,
    exists: () => Boolean(stores.threads.getThread(bureau.id, thread.id)),
    currentContent: (messageId) => stores.threads.getMessage(thread.id, messageId)?.content,
    saveProgress: (archivedThrough) =>
      stores.threads.setArchiveProgress(thread.id, archivedThrough),
    visibleMemories: (memories) => memoriesAtTime(memories, last.bureauTime),
    acceptedNotes: (notes) => notesAtTime(notes, last.bureauTime),
    // A session's episode cites its first message, which stays put as the session grows.
    isOwnEpisode: (memory) =>
      memory.layer === 'episode' &&
      memory.sourceType === 'correspondence' &&
      memory.sourceId === thread.id &&
      memory.sourceTurnIds.includes(first.id),
  };
}

// ==================== Applying a record ====================

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Save one pass's record, skipping anything that doesn't check out.
 * @returns {{ added: number, superseded: number, episodes: number, arcNotes: number,
 *   warnings: string[] }}
 */
function applyRecord({
  stores,
  bureauId,
  source,
  record,
  characters,
  knownByCast,
  episodeByCast,
  notesByCast,
  turns,
  runId,
  archivedThrough,
}) {
  const { memories } = stores;
  const wording = WORDING[source.kind];
  const byName = new Map(characters.map((member) => [nameOf(member).toLowerCase(), member]));
  const turnIdByPosition = new Map(
    turns.filter((turn) => turn.kind === 'prose').map((turn) => [turn.position, turn.id]),
  );
  const turnIdsFor = (passages) => [
    ...new Set(
      (Array.isArray(passages) ? passages : [])
        .map((position) => turnIdByPosition.get(position))
        .filter(Boolean),
    ),
  ];
  const result = { added: 0, superseded: 0, episodes: 0, arcNotes: 0, warnings: [] };

  const memberFor = (name, what) => {
    const member = byName.get(text(name).toLowerCase());
    if (!member) {
      result.warnings.push(
        `Skipped ${what} for "${text(name)}", who isn't a character that remembers`,
      );
    }
    return member;
  };

  const base = {
    sourceType: source.kind,
    sourceId: source.id,
    worldTime: source.worldTime,
    runId,
  };

  // The model read memories as they were before its call, which can take a while. Replace one
  // only if it's still that memory: not pinned, edited, retired, or replaced since, including
  // by an earlier item in this record. Call inside the transaction.
  const replaced = new Set();
  const canReplace = (castId, seen) => {
    const current = memories.getMemory(bureauId, seen.id);
    return (
      Boolean(current) &&
      current.castMemberId === castId &&
      !current.pinned &&
      !current.retired &&
      current.supersededBy === null &&
      current.content === seen.content &&
      current.modified === seen.modified &&
      !replaced.has(seen.id)
    );
  };

  stores.bureaus.db.transaction(() => {
    if (!source.exists()) {
      throw new SourceDeletedError(source.kind);
    }

    // Turns or messages edited, regenerated, or deleted while the model was reading them.
    const changedTurnIds = turns
      .filter((turn) => source.currentContent(turn.id) !== turn.content)
      .map((turn) => turn.id);

    for (const item of Array.isArray(record.knowledge) ? record.knowledge : []) {
      const member = memberFor(item?.character, 'a memory');
      const content = text(item?.content);
      if (!member || !content) continue;

      let supersedes = null;
      if (item.supersedes) {
        const seen = (knownByCast.get(member.id) ?? []).find(
          (memory) => memory.id === item.supersedes,
        );
        if (seen && canReplace(member.id, seen)) {
          supersedes = seen.id;
          replaced.add(seen.id);
          result.superseded += 1;
        } else {
          result.warnings.push(
            `Kept memory ${item.supersedes} for ${nameOf(member)}: it can't be replaced`,
          );
        }
      }

      memories.addMemory(bureauId, member.id, {
        ...base,
        layer: 'knowledge',
        content,
        importance: item.importance,
        sourceTurnIds: turnIdsFor(item.passages),
        supersedes,
      });
      result.added += 1;
    }

    // One episode per character per story or session; a later one in the same record wins.
    const episodes = new Map();
    for (const item of Array.isArray(record.episodes) ? record.episodes : []) {
      const member = memberFor(item?.character, 'an episode');
      const content = text(item?.content);
      if (member && content) episodes.set(member.id, content);
    }
    const proseTurnIds = turns.filter((turn) => turn.kind === 'prose').map((turn) => turn.id);
    for (const [castId, content] of episodes) {
      const previous = episodeByCast.get(castId) ?? null;
      if (previous && !canReplace(castId, previous)) {
        const name = nameOf(characters.find((member) => member.id === castId));
        result.warnings.push(
          `Kept ${name}'s episode for ${wording.scope}: it was pinned or changed during the pass`,
        );
        continue;
      }
      memories.addMemory(bureauId, castId, {
        ...base,
        layer: 'episode',
        content,
        // An episode covers everything read so far, so a change to any of it flags the episode.
        sourceTurnIds: [...new Set([...(previous?.sourceTurnIds ?? []), ...proseTurnIds])],
        supersedes: previous?.id ?? null,
      });
      result.episodes += 1;
    }

    // Arc notes are proposals for the reader, skipping changes the character already has, that
    // are already waiting, or that the reader rejected.
    const seenNotes = new Set(
      [...notesByCast.entries()].flatMap(([castId, notes]) =>
        [...notes.accepted, ...notes.proposed, ...notes.rejected].map(
          (note) => `${castId}:${note.content.toLowerCase()}`,
        ),
      ),
    );
    for (const item of Array.isArray(record.arc_notes) ? record.arc_notes : []) {
      const member = memberFor(item?.character, 'an arc note');
      const content = text(item?.content);
      if (!member || !content) continue;
      const key = `${member.id}:${content.toLowerCase()}`;
      if (seenNotes.has(key)) continue;
      seenNotes.add(key);

      stores.arcNotes.addNote(bureauId, member.id, {
        ...base,
        content,
        rationale: text(item.rationale),
        status: 'proposed',
        sourceTurnIds: turnIdsFor(item.passages),
      });
      result.arcNotes += 1;
    }

    if (changedTurnIds.length > 0) {
      memories.flagTurnsChanged(bureauId, source.id, changedTurnIds, source.kind);
      stores.arcNotes.flagTurnsChanged(bureauId, source.id, changedTurnIds, source.kind);
      const units = source.kind === 'story' ? 'passage(s)' : 'message(s)';
      result.warnings.push(
        `Marked for review: ${changedTurnIds.length} ${units} changed while the Archivist read them`,
      );
    }

    source.saveProgress(archivedThrough, text(record.story_summary) || source.summary);
  })();

  return result;
}

// ==================== Running passes ====================

// One archive at a time per story (keyed by its id) and per thread ("thread:" and its id).
const sourceLocks = new Map();

/** Run `work` after any archive already running for the same source. */
function withLock(key, work) {
  const previous = sourceLocks.get(key) ?? Promise.resolve();
  const run = previous.then(work);
  const tail = run.catch(() => {});
  sourceLocks.set(key, tail);
  tail.finally(() => {
    if (sourceLocks.get(key) === tail) sourceLocks.delete(key);
  });
  return run;
}

/** Whether an archive is running or queued for a story. */
export function isArchiving(storyId) {
  return sourceLocks.has(storyId);
}

/**
 * What each character remembering in this pass knows now, their episode for this story or
 * session, and their arc notes: accepted ones the source can see, every proposal still waiting,
 * and every change the reader rejected.
 */
function currentMemories(stores, bureauId, source, characters) {
  const knownByCast = new Map();
  const episodeByCast = new Map();
  const notesByCast = new Map();
  for (const member of characters) {
    const notes = stores.arcNotes.listNotes(bureauId, member.id);
    notesByCast.set(member.id, {
      accepted: source.acceptedNotes(notes),
      proposed: notes.filter((note) => note.status === 'proposed'),
      rejected: notes.filter((note) => note.status === 'rejected'),
    });

    const asOf = source.visibleMemories(
      stores.memories.listMemories(bureauId, member.id, { status: 'all' }),
    );
    knownByCast.set(
      member.id,
      selectForPrompt(asOf, {
        knowledgeCharacters: KNOWN_CHARACTERS_PER_CHARACTER,
        recentEpisodes: 0,
      }).knowledge,
    );
    const episode = asOf.find(source.isOwnEpisode);
    if (episode) episodeByCast.set(member.id, episode);
  }
  return { knownByCast, episodeByCast, notesByCast };
}

async function readChunk({ stores, bureau, loadSource, client, recorder, chunk, signal }) {
  const source = loadSource();
  const { characters, persona } = source;
  const { knownByCast, episodeByCast, notesByCast } = currentMemories(
    stores,
    bureau.id,
    source,
    characters,
  );

  const messages = buildArchivistMessages({
    source,
    characters,
    persona,
    knownByCast,
    episodeByCast,
    notesByCast,
    turns: chunk,
  });
  const options = {
    messages,
    tools: [RECORD_MEMORIES_TOOL],
    strict: true,
    toolChoice: { name: RECORD_MEMORIES_TOOL.name },
    thinking: false,
    maxTokens: 8000,
    signal,
  };
  const recordedRequest = { model: client.model, thinking: false, maxTokens: 8000, messages };

  const started = Date.now();
  let response;
  try {
    response = await client.chat(options);
  } catch (error) {
    recorder.recordStep({
      role: 'archivist',
      kind: 'model',
      request: recordedRequest,
      error: error.message,
      durationMs: Date.now() - started,
    });
    throw error;
  }
  recorder.recordStep({
    role: 'archivist',
    kind: 'model',
    request: recordedRequest,
    response: { finishReason: response.finishReason, model: response.model },
    toolCalls: response.toolCalls,
    usage: response.usage,
    durationMs: Date.now() - started,
  });

  const call = response.toolCalls.find(
    (toolCall) => toolCall.function?.name === RECORD_MEMORIES_TOOL.name,
  );
  if (!call) {
    throw new Error("The Archivist didn't record anything");
  }
  let record;
  try {
    record = JSON.parse(call.function.arguments);
  } catch {
    const cutOff = response.finishReason === 'length' ? ' (it ran out of tokens)' : '';
    throw new Error(`The Archivist's record wasn't valid JSON${cutOff}`);
  }

  const result = applyRecord({
    stores,
    bureauId: bureau.id,
    source,
    record,
    characters,
    knownByCast,
    episodeByCast,
    notesByCast,
    turns: chunk,
    runId: recorder.runId,
    archivedThrough: chunk.at(-1).position,
  });
  recorder.recordStep({
    role: 'archivist',
    kind: 'tool',
    request: { id: call.id, name: RECORD_MEMORIES_TOOL.name, arguments: record },
    response: result,
  });
  return result;
}

function emptyTotals(archivedThrough) {
  return {
    passes: 0,
    added: 0,
    superseded: 0,
    episodes: 0,
    arcNotes: 0,
    warnings: [],
    archivedThrough,
    runId: null,
  };
}

function addToTotals(totals, result) {
  totals.passes += 1;
  totals.added += result.added;
  totals.superseded += result.superseded;
  totals.episodes += result.episodes;
  totals.arcNotes += result.arcNotes;
  totals.warnings.push(...result.warnings);
}

/**
 * Read a story's unread turns through a position and record what the characters remember.
 *
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {string} params.bureauId
 * @param {string} params.storyId
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {number} [params.through] - Last position to read; defaults to the end of the story.
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object|null>} Totals for the passes ({ passes, added, superseded, episodes,
 *   arcNotes, warnings, archivedThrough, runId }), or null when there was nothing to read.
 */
export function archiveStory({ stores, bureauId, storyId, client, through = Infinity, signal }) {
  return withLock(storyId, async () => {
    const bureau = stores.bureaus.getBureau(bureauId);
    const story = bureau ? stores.stories.getStory(bureauId, storyId) : null;
    if (!story) return null;

    const unread = stores.stories
      .listTurns(storyId)
      .filter((turn) => turn.position > story.archivedThrough && turn.position <= through);
    if (unread.length === 0) return null;

    const totals = emptyTotals(story.archivedThrough);
    let recorder = null;

    try {
      for (const chunk of chunkTurns(unread)) {
        const last = chunk.at(-1).position;
        if (!chunk.some((turn) => turn.kind === 'prose')) {
          // Only directions and scene breaks: nothing to remember.
          const current = stores.stories.getStory(bureauId, storyId);
          if (!current) throw new SourceDeletedError('story');
          stores.stories.setArchiveProgress(storyId, {
            archivedThrough: last,
            summary: current.summary,
          });
        } else {
          recorder ??= new RunRecorder(stores.bureaus, {
            bureauId,
            purpose: 'archive',
            targetType: 'story',
            targetId: storyId,
          });
          totals.runId = recorder.runId;
          const result = await readChunk({
            stores,
            bureau,
            loadSource: () => storySource(stores, bureau, storyId),
            client,
            recorder,
            chunk,
            signal,
          });
          addToTotals(totals, result);
        }
        totals.archivedThrough = last;
      }
    } catch (error) {
      recorder?.fail(error);
      throw error;
    }

    recorder?.complete();
    return totals;
  });
}

/**
 * Read a thread's unread messages, one session at a time, and record what the
 * character remembers. Each session is dated to its first message and gets its
 * own episode.
 *
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {string} params.bureauId
 * @param {string} params.threadId
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {boolean} [params.settledOnly] - Leave the last session while it may still be going (see
 *   isSessionOver).
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object|null>} Totals like archiveStory's, or null when there was nothing to
 *   read.
 */
export function archiveThread({ stores, bureauId, threadId, client, settledOnly = false, signal }) {
  return withLock(`thread:${threadId}`, async () => {
    const bureau = stores.bureaus.getBureau(bureauId);
    const thread = bureau ? stores.threads.getThread(bureauId, threadId) : null;
    if (!thread) return null;

    const breaks = chapterBreaks(stores, bureauId);
    const sessions = threadSessions(stores.threads.listMessages(threadId), { breaks });
    const toRead = sessions
      .filter(
        (session, index) =>
          !settledOnly ||
          index < sessions.length - 1 ||
          isSessionOver(session, bureau.bureauTime, breaks),
      )
      .map((session) => ({
        session,
        unread: session.filter((message) => message.position > thread.archivedThrough),
      }))
      .filter(({ unread }) => unread.length > 0);
    if (toRead.length === 0) return null;

    const member = stores.bureaus.getCastMember(bureauId, thread.castMemberId);
    const currentPersona = stores.bureaus.listCast(bureauId).find((cast) => cast.isPersona) ?? null;
    // The reader's side of a session is whoever sent its messages, which stays true if the reader
    // picks another character later.
    const senderOf = (message) =>
      (message.senderCastId && stores.bureaus.getCastMember(bureauId, message.senderCastId)) ||
      currentPersona;
    const readerOf = (session) => {
      const sent = session.find((message) => message.source === 'user');
      return sent ? senderOf(sent) : currentPersona;
    };
    const speakerOf = (message) => {
      if (message.source !== 'user') return nameOf(member ?? { name: 'They' });
      const sender = senderOf(message);
      return sender ? nameOf(sender) : 'The reader';
    };

    const totals = emptyTotals(thread.archivedThrough);
    const recorder = new RunRecorder(stores.bureaus, {
      bureauId,
      purpose: 'archive',
      targetType: 'thread',
      targetId: threadId,
    });
    totals.runId = recorder.runId;

    try {
      for (const { session, unread } of toRead) {
        const units = unread.map((message) => ({
          ...message,
          kind: 'prose',
          speaker: speakerOf(message),
        }));
        for (const chunk of chunkTurns(units)) {
          const result = await readChunk({
            stores,
            bureau,
            loadSource: () =>
              threadSource(stores, bureau, { thread, member, persona: readerOf(session), session }),
            client,
            recorder,
            chunk,
            signal,
          });
          addToTotals(totals, result);
          totals.archivedThrough = chunk.at(-1).position;
        }
      }
    } catch (error) {
      recorder.fail(error);
      throw error;
    }

    recorder.complete();
    return totals;
  });
}

const backgroundArchives = new Set();

function inBackground(task, description) {
  const tracked = task
    .catch((error) => {
      console.error(`[Bureau] Automatic archive of ${description} failed:`, error.message);
      return null;
    })
    .finally(() => backgroundArchives.delete(tracked));
  backgroundArchives.add(tracked);
  return tracked;
}

/**
 * Start an automatic pass over a story's settled turns, if enough have settled
 * and no archive is already running. It runs in the background: failures are
 * logged and recorded in the run, never thrown.
 *
 * @returns {Promise<Object|null>|null} The pass, or null when none started.
 */
export function archiveSettledTurns({ stores, bureauId, storyId, client }) {
  if (isArchiving(storyId)) return null;
  const story = stores.stories.getStory(bureauId, storyId);
  if (!story) return null;
  const through = autoArchiveThrough(stores.stories.listTurns(storyId), story);
  if (through === null) return null;

  return inBackground(
    archiveStory({ stores, bureauId, storyId, client, through }),
    `story ${storyId}`,
  );
}

/**
 * Start an automatic pass over a thread's finished sessions, unless an archive
 * of the thread is already running. Like archiveSettledTurns, it runs in the
 * background.
 *
 * @returns {Promise<Object|null>|null} The pass, or null when none started.
 */
export function archiveSettledSessions({ stores, bureauId, threadId, client }) {
  if (sourceLocks.has(`thread:${threadId}`)) return null;
  return inBackground(
    archiveThread({ stores, bureauId, threadId, client, settledOnly: true }),
    `thread ${threadId}`,
  );
}

/** Wait for automatic passes to finish. */
export async function settleBackgroundArchives() {
  await Promise.all(backgroundArchives);
}
