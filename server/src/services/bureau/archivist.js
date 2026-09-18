/**
 * Archivist
 *
 * Reads a story's turns, or a thread's messages, and records what the characters
 * will remember (see "Archivist" in docs/bureau-design.md). Each pass is one
 * forced call to a strict record_memories tool, which returns knowledge, arc
 * notes, proposed facts, and a story's running summary. What happened in a
 * chapter lives in its summary, so knowledge keeps only what later chapters and
 * messages will need: promises, plans, matters left open, turning points, and
 * lasting things learned about someone.
 *
 * Memories apply without review, because every memory is visible, sourced, and
 * editable in the memory browser. Arc notes, which change how a character is
 * written, are only proposed: the reader accepts or rejects each one. The
 * reader's character remembers like everyone else.
 *
 * A story and a thread differ only in their source: what a pass reads, and how
 * its memories are dated and cited. A thread is read one session at a time.
 */

import { chapterTime, describeBureauTime, describeTimePassing } from './bureau-time.js';
import { labelImages } from './images.js';
import {
  factsAsOf,
  factsAtTime,
  isBeforeStory,
  memoriesAsOf,
  memoriesAtTime,
  notesAtTime,
  selectForPrompt,
} from './memory.js';
import { bureauText, profileLines } from './profile-text.js';
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
        description:
          'What later chapters will need: promises and plans, matters left open, turning points, and lasting things learned about someone. Usually few, and empty when nothing lasting happened.',
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
              description:
                "Number of the character's memory this resolves, updates, or corrects, or 0.",
            },
            passages: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Numbers of the passages this comes from.',
            },
            conflict: {
              type: 'string',
              description:
                "What in a character's profile or an established fact this disagrees with, in one sentence, or an empty string when nothing does.",
            },
          },
          required: ['character', 'content', 'importance', 'supersedes', 'passages', 'conflict'],
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
      facts: {
        type: 'array',
        description:
          'Established facts the passages clearly add or change, for the reader to review. Usually empty.',
        items: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The whole fact as it now stands, in a sentence or two, using names.',
            },
            replaces: {
              type: 'integer',
              description: 'Number of the established fact this changes, or 0 for a new fact.',
            },
            rationale: { type: 'string', description: 'What in the passages shows it.' },
            passages: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Numbers of the passages that show it.',
            },
          },
          required: ['content', 'replaces', 'rationale', 'passages'],
          additionalProperties: false,
        },
      },
      story_summary: {
        type: 'string',
        description: 'What has happened in the whole chapter so far, at most 250 words.',
      },
    },
    required: ['knowledge', 'arc_notes', 'facts', 'story_summary'],
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
    kept: 'the chapter keeps its summary',
    summary:
      'story_summary: what has happened in the whole chapter so far, in at most 250 words, updating the previous summary. Later chapters are written from it, so cover the whole chapter in order: who was there, what happened, and how things were left.',
  },
  correspondence: {
    units: 'messages',
    unit: 'Message',
    kept: 'the messages stay in the thread',
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
 *   kind, title, openingTime, timePassedTo, summary, and timeZone.
 * @param {Array<Object>} params.characters - Cast members who remember.
 * @param {Object|null} params.persona - The reader's character, if present.
 * @param {Map<string, Array<Object>>} params.knownByCast - Knowledge each character has now.
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
      `Knowledge: what later chapters and messages will need, so the characters stay consistent and nothing left open gets dropped. What happened is kept elsewhere (${wording.kept}), so knowledge is only for what will still matter afterward:`,
      `- Promises, plans, and arrangements that reach past these ${wording.units}: a date set, a favor owed, a trip planned, something someone said they would do.`,
      '- Matters left open: a question not yet answered, a problem not yet solved, a secret someone is keeping, something someone is waiting on.',
      '- Turning points between people: a confession, a falling-out, a making-up, a line crossed, a secret revealed.',
      `- Lasting things learned for the first time about ${about}: their history, family, work, and what they love or can't stand.`,
      '- Before recording one, ask: would a later chapter get something wrong, or drop a thread, without it? If not, leave it out.',
      '- Leave out what happened in the scene, who said what, gestures, meals, clothes, scenery, passing moods, the time something happened, anything the character already knows, and anything a profile or established fact already says.',
      '- One fact per memory, in the third person with names, never "I" or "you". Record only what that character saw, heard, or was told.',
      '- Each memory must make sense on its own, read months later: say who and what, never "this" or "that" for something in another memory.',
      `- The profiles and the established facts are true. Record what the ${wording.units} say outright, not what they only seem to suggest: someone heading home, or writing from somewhere else, tells you nothing new about where anyone lives.`,
      "- When a fact disagrees with a character's profile or an established fact, set conflict to what it disagrees with, in a sentence: the reader checks it before anyone remembers it. Otherwise leave conflict empty.",
      "- When one of the character's numbered memories is resolved or changes, such as a promise kept, a plan dropped, or a question answered, or when a fact contradicts it, set supersedes to its number and write how it stands now, complete. Otherwise set supersedes to 0.",
      '- Importance: 1 trivia, 2 minor detail, 3 useful, 4 significant, 5 defining (a milestone in a relationship, a secret revealed).',
      `- passages lists the numbers of the ${wording.units} the fact comes from.`,
      '- Usually none to three per character in a pass. Recording none is fine when nothing lasting happened.',
    ].join('\n'),
    `Arc notes: only when the ${wording.units} change who a character is, such as a new habit, a stance that softened or hardened, or a lasting decision about themselves or someone else. Not a fact they learned (that's knowledge), and not a passing mood. Write how they have changed in one or two sentences, with a rationale naming what in the ${wording.units} shows it. Don't repeat a change they already have, one waiting for review, or one the reader turned down. Most ${wording.units} call for none; the reader reviews every one.`,
    `Facts: lasting truths about the world and the cast that hold whoever remembers them, such as where someone lives and with whom, their work, a relationship, or a place. Propose one only when the ${wording.units} clearly establish something lasting that the established facts don't cover, or clearly change one of them: then set replaces to its number and write the whole fact as it now stands. Not something only one character learned (that's knowledge), and not a change in who someone is (that's an arc note). Don't repeat an established fact, one waiting for review, or one the reader turned down. Most ${wording.units} call for none; the reader reviews every one.`,
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
      return `[${wording.unit} ${turn.position}]\n${turn.speaker ? `${turn.speaker}: ` : ''}${labelImages(turn.content)}`;
    });

  let user;
  if (source.kind === 'story') {
    const storyLines = [`Title: ${source.title}`];
    if (source.openingTime) storyLines.push(`Begins: ${source.openingTime}`);
    // A pass reads only its own passages, so it's told when time last passed before them.
    if (source.timePassedTo) {
      storyLines.push(`Before these passages, time passed to: ${source.timePassedTo}`);
    }
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
  if (characters.length > 0) {
    user.push(
      section(
        'PROFILES',
        characters
          .map((member) => [nameOf(member), ...profileLines(member, personaName)].join('\n'))
          .join('\n\n'),
      ),
    );
  }
  const facts = source.facts ?? { current: [], proposed: [], rejected: [] };
  const factText = (fact) => bureauText(fact.content, personaName);
  const factLines =
    facts.current.length > 0
      ? facts.current.map((fact) => `[${fact.id}] ${factText(fact)}`)
      : ['(None yet.)'];
  if (facts.proposed.length > 0) {
    factLines.push('Waiting for review:', ...facts.proposed.map((fact) => `- ${factText(fact)}`));
  }
  if (facts.rejected.length > 0) {
    factLines.push(
      'Turned down by the reader (never propose these again):',
      ...facts.rejected.slice(-REJECTED_NOTES_SHOWN).map((fact) => `- ${factText(fact)}`),
    );
  }
  user.push(section('ESTABLISHED FACTS', factLines.join('\n')));
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
 * The facts a pass works with: the established facts its source can see, to keep to and replace,
 * and every proposal waiting and fact the reader turned down, so none is proposed again.
 * @param {(facts: Array<Object>) => Array<Object>} visible - Picks the established facts.
 */
function factsForPass(stores, bureauId, visible) {
  const facts = stores.facts.listFacts(bureauId);
  return {
    current: visible(facts),
    proposed: facts.filter((fact) => fact.status === 'proposed'),
    rejected: facts.filter((fact) => fact.status === 'rejected'),
  };
}

/**
 * What a story pass reads, loaded fresh for each pass: the previous pass updated
 * the story's summary.
 * @param {Object} [options]
 * @param {number} [options.before] - The position the pass starts reading at, for when time last
 *   passed in the chapter before it.
 */
function storySource(stores, bureau, storyId, { before = Infinity } = {}) {
  const story = stores.stories.getStory(bureau.id, storyId);
  if (!story) {
    throw new SourceDeletedError('story');
  }
  const cast = story.castIds
    .map((castId) => stores.bureaus.getCastMember(bureau.id, castId))
    .filter(Boolean);
  const persona = cast.find((member) => member.isPersona) ?? null;
  const turns = stores.stories.listTurns(storyId);
  const clock = chapterTime(
    story,
    turns.filter((turn) => turn.position < before),
  );
  return {
    kind: 'story',
    id: story.id,
    title: story.title,
    openingTime: describeBureauTime(story.startTime, bureau.timezone),
    timePassedTo: clock.passed ? describeBureauTime(clock.time, bureau.timezone) : null,
    summary: story.summary,
    timeZone: bureau.timezone,
    worldTime: story.startTime,
    // The chapter's time at a passage: when time last passed before it, or the chapter's start.
    timeAt: (position) =>
      chapterTime(
        story,
        turns.filter((turn) => turn.position <= position),
      ).time,
    // The reader's character remembers too.
    characters: cast,
    persona,
    // A story's own facts count, like its memories.
    facts: factsForPass(stores, bureau.id, (facts) =>
      factsAsOf(facts, story, { includeOwnStory: true }),
    ),
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
    // A session's facts are dated to its first message, like its memories.
    timeAt: () => first.bureauTime,
    characters: people,
    persona,
    facts: factsForPass(stores, bureau.id, (facts) => factsAtTime(facts, last.bureauTime)),
    exists: () => Boolean(stores.threads.getThread(bureau.id, thread.id)),
    currentContent: (messageId) => stores.threads.getMessage(thread.id, messageId)?.content,
    saveProgress: (archivedThrough) =>
      stores.threads.setArchiveProgress(thread.id, archivedThrough),
    visibleMemories: (memories) => memoriesAtTime(memories, last.bureauTime),
    acceptedNotes: (notes) => notesAtTime(notes, last.bureauTime),
  };
}

// ==================== Applying a record ====================

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Save one pass's record, skipping anything that doesn't check out. held counts memories kept for
 * review because they disagree with a profile or fact; added counts the rest. facts counts the
 * facts proposed.
 * @returns {{ added: number, held: number, superseded: number, arcNotes: number, facts: number,
 *   warnings: string[] }}
 */
function applyRecord({
  stores,
  bureauId,
  source,
  record,
  characters,
  knownByCast,
  notesByCast,
  turns,
  runId,
  archivedThrough,
}) {
  const { memories } = stores;
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
  const result = {
    added: 0,
    held: 0,
    superseded: 0,
    arcNotes: 0,
    facts: 0,
    warnings: [],
  };

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
      // A fact that disagrees with a profile or an established fact waits for the reader. What it
      // would replace stays current until the reader keeps it.
      const conflict = text(item.conflict);

      let supersedes = null;
      let pendingSupersedes = null;
      if (item.supersedes) {
        const seen = (knownByCast.get(member.id) ?? []).find(
          (memory) => memory.id === item.supersedes,
        );
        if (seen && canReplace(member.id, seen)) {
          replaced.add(seen.id);
          if (conflict) {
            pendingSupersedes = seen.id;
            result.warnings.push(
              `Kept memory ${seen.id} for ${nameOf(member)} for now: what would replace it disagrees with a profile or fact`,
            );
          } else {
            supersedes = seen.id;
            result.superseded += 1;
          }
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
        pendingSupersedes,
        conflict,
      });
      if (conflict) {
        result.held += 1;
      } else {
        result.added += 1;
      }
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

    // Facts are proposals for the reader too, skipping any already established, waiting, or turned
    // down. A change can only replace an established fact this pass could see.
    const readerName = source.persona ? nameOf(source.persona) : null;
    const { current, proposed, rejected } = source.facts;
    const knownFacts = new Set(
      [...current, ...proposed, ...rejected].map((fact) =>
        bureauText(fact.content, readerName).toLowerCase(),
      ),
    );
    const replaceable = new Set(current.map((fact) => fact.id));
    for (const item of Array.isArray(record.facts) ? record.facts : []) {
      const content = text(item?.content);
      if (!content || knownFacts.has(content.toLowerCase())) continue;
      knownFacts.add(content.toLowerCase());

      const replaces = replaceable.has(item.replaces) ? item.replaces : null;
      if (item.replaces && replaces === null) {
        result.warnings.push(
          `Proposed a fact without replacing fact ${item.replaces}, which isn't established`,
        );
      }
      // Dated to the chapter's time at the latest passage it cites, or at the end of what was read,
      // so a change after time passes in a chapter doesn't reach back to its start.
      const cited = (Array.isArray(item.passages) ? item.passages : []).filter((position) =>
        turnIdByPosition.has(position),
      );
      stores.facts.addFact(bureauId, {
        ...base,
        worldTime: source.timeAt(cited.length > 0 ? Math.max(...cited) : turns.at(-1).position),
        content,
        rationale: text(item.rationale),
        status: 'proposed',
        replaces,
        sourceTurnIds: turnIdsFor(item.passages),
      });
      result.facts += 1;
    }

    if (changedTurnIds.length > 0) {
      memories.flagTurnsChanged(bureauId, source.id, changedTurnIds, source.kind);
      stores.arcNotes.flagTurnsChanged(bureauId, source.id, changedTurnIds, source.kind);
      stores.facts.flagTurnsChanged(bureauId, source.id, changedTurnIds, source.kind);
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
 * What each character remembering in this pass knows now, and their arc notes: accepted ones the
 * source can see, every proposal still waiting, and every change the reader rejected.
 */
function currentMemories(stores, bureauId, source, characters) {
  const knownByCast = new Map();
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
      selectForPrompt(asOf, { knowledgeCharacters: KNOWN_CHARACTERS_PER_CHARACTER }).knowledge,
    );
  }
  return { knownByCast, notesByCast };
}

async function readChunk({ stores, bureau, loadSource, client, recorder, chunk, signal }) {
  const source = loadSource();
  const { characters, persona } = source;
  const { knownByCast, notesByCast } = currentMemories(stores, bureau.id, source, characters);

  const messages = buildArchivistMessages({
    source,
    characters,
    persona,
    knownByCast,
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
    held: 0,
    superseded: 0,
    arcNotes: 0,
    facts: 0,
    warnings: [],
    archivedThrough,
    runId: null,
  };
}

function addToTotals(totals, result) {
  totals.passes += 1;
  totals.added += result.added;
  totals.held += result.held;
  totals.superseded += result.superseded;
  totals.arcNotes += result.arcNotes;
  totals.facts += result.facts;
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
 * @returns {Promise<Object|null>} Totals for the passes ({ passes, added, held, superseded,
 *   arcNotes, facts, warnings, archivedThrough, runId }), or null when there was nothing to
 *   read.
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
            loadSource: () => storySource(stores, bureau, storyId, { before: chunk[0].position }),
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
 * character remembers. Each session is dated to its first message.
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
