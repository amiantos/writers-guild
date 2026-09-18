/**
 * Offscreen Life
 *
 * When Bureau time moves on without a character, they get a short account of
 * how they spent the gap (see "Offscreen life" in docs/bureau-design.md), saved
 * as an offscreen memory just before the new time. Each character's gap runs
 * from when they were last seen: their latest dated memory, their latest
 * message, or the end of a story they were in. One forced call to a strict
 * record_offscreen tool covers everyone at once. Nothing runs in the
 * background, so a month away is one account, not thirty days of invented drama.
 */

import { describeBureauTime, describeGap, settingYear } from './bureau-time.js';
import {
  earlierChapters,
  factsAtTime,
  memoriesAtTime,
  notesAtTime,
  selectForPrompt,
} from './memory.js';
import { bureauText, profileLines } from './profile-text.js';
import { RunRecorder } from './run-recorder.js';

// Shorter gaps aren't worth an account.
export const OFFSCREEN_MIN_GAP_HOURS = 12;
export const OFFSCREEN_MAX_TOKENS = 3000;
const OFFSCREEN_IMPORTANCE = 2;
const KNOWLEDGE_CHARACTERS = 1500;
// Summaries of the latest chapters each character was in.
const RECENT_CHAPTERS = 2;

export const RECORD_OFFSCREEN_TOOL = {
  name: 'record_offscreen',
  description: 'Record how each character spent the time that passed.',
  parameters: {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        description: 'One entry for each character listed.',
        items: {
          type: 'object',
          properties: {
            character: { type: 'string', description: 'Name of the character.' },
            content: {
              type: 'string',
              description: 'How they spent the time: two to four sentences, past tense.',
            },
          },
          required: ['character', 'content'],
          additionalProperties: false,
        },
      },
    },
    required: ['entries'],
    additionalProperties: false,
  },
};

function nameOf(member) {
  return member.seedCard?.data?.name || member.name;
}

function section(title, body) {
  return `=== ${title} ===\n${body}`;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampOf(value) {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/** Whether time moving from `from` to `to` leaves a gap worth an account. */
export function isOffscreenGap(from, to) {
  const hours = (timestampOf(to) - timestampOf(from)) / 3_600_000;
  return Number.isFinite(hours) && hours >= OFFSCREEN_MIN_GAP_HOURS;
}

/**
 * When a character was last seen at or before a moment: their latest dated
 * memory, their latest message, or the end of a story they were in (a story
 * still going counts from its start). Null when there's nothing to go on.
 *
 * @param {Object} [options]
 * @param {string|null} [options.ignoreStoryId] - A story that doesn't count, such as the one
 *   starting.
 * @returns {Date|null}
 */
export function lastSeen(stores, bureau, member, to, { ignoreStoryId = null } = {}) {
  const times = stores.memories
    .listMemories(bureau.id, member.id, { status: 'all' })
    .filter((memory) => memory.worldTime)
    .map((memory) => Date.parse(memory.worldTime));
  const thread = stores.threads.getThreadForCast(bureau.id, member.id);
  if (thread) {
    for (const message of stores.threads.listMessages(thread.id)) {
      if (message.source === 'generated') times.push(Date.parse(message.bureauTime));
    }
  }
  for (const story of stores.stories.listStories(bureau.id)) {
    if (story.id === ignoreStoryId || !story.castIds.includes(member.id)) continue;
    times.push(Date.parse(story.endTime ?? story.startTime));
  }

  const limit = timestampOf(to);
  const seen = times.filter((time) => time <= limit);
  return seen.length > 0 ? new Date(Math.max(...seen)) : null;
}

/**
 * The characters owed an account of time away before a moment, each with when
 * they were last seen. Leaves out anyone in a story that's still going (the
 * story is their time), anyone with nothing to go on, and anyone seen less than
 * OFFSCREEN_MIN_GAP_HOURS before.
 *
 * @param {Array<Object>} members - Cast members, with seed cards.
 * @param {string} to - The new time (ISO).
 * @param {Object} [options]
 * @param {string|null} [options.ignoreStoryId] - A story that doesn't count, such as the one
 *   starting.
 * @returns {Array<{ member: Object, from: string }>}
 */
export function findOffscreenGaps(stores, bureau, members, to, { ignoreStoryId = null } = {}) {
  const limit = timestampOf(to);
  const openStories = stores.stories
    .listStories(bureau.id)
    .filter(
      (story) =>
        story.status === 'active' &&
        story.id !== ignoreStoryId &&
        Date.parse(story.startTime) <= limit,
    );
  return members
    .filter((member) => !openStories.some((story) => story.castIds.includes(member.id)))
    .map((member) => ({ member, since: lastSeen(stores, bureau, member, to, { ignoreStoryId }) }))
    .filter(({ since }) => since && isOffscreenGap(since, to))
    .map(({ member, since }) => ({ member, from: since.toISOString() }));
}

/**
 * @param {Object} params
 * @param {Object} params.bureau - Uses timezone.
 * @param {Array<{member: Object, from: string}>} params.gaps - Characters to account for, with
 *   seed cards and routines, and when each was last seen.
 * @param {string} params.to - The new time (ISO).
 * @param {Map<string, {knowledge: Array<Object>, offscreen: Object|null}>} [params.memoriesByCast]
 * @param {Map<string, Array<{summary: string}>>} [params.chaptersByCast] - Summaries of the latest
 *   chapters each character was in, oldest first.
 * @param {Map<string, Array<{content: string}>>} [params.notesByCast] - Accepted arc notes.
 * @param {string|null} [params.readerName] - The reader's character's name, for {{user}} in cards.
 * @param {Array<{content: string}>} [params.facts] - Established facts as of the new time.
 * @param {Date} [params.now] - Real time, to tell whether the Bureau is set in another year.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildOffscreenMessages({
  bureau,
  gaps,
  to,
  memoriesByCast = new Map(),
  chaptersByCast = new Map(),
  notesByCast = new Map(),
  readerName = null,
  facts = [],
  now = new Date(),
}) {
  const system = [
    'You keep track of what the characters in an ongoing story do between the scenes the reader sees. Call record_offscreen once, with one entry for each character listed.',
    [
      '- Write two to four sentences for each character, in the past tense and the third person, about how they spent the time since they were last seen: work, errands, habits, small pleasures and annoyances, people they ran into.',
      '- Keep it mostly mundane and true to who they are: their routine, what they know, and how they have changed. At most one thing in an entry can be notable, and nothing that settles or invents a major turn in their story.',
      "- Keep to their profiles and the established facts: where they live, who they live with, and their work don't change offscreen. When something they know disagrees with a profile or fact, the profile or fact is right.",
      '- Fit the length of the gap: an evening holds a little, a few weeks hold more.',
    ].join('\n'),
  ];

  const nowLines = [`It's ${describeBureauTime(to, bureau.timezone)}.`];
  const year = settingYear(bureau, to, now);
  if (year) nowLines.push(`The year is ${year}.`);
  const user = [section('NOW', nowLines.join('\n'))];
  const establishedFacts = facts
    .map((fact) => bureauText(fact.content, readerName))
    .filter(Boolean);
  if (establishedFacts.length > 0) {
    user.push(section('ESTABLISHED FACTS', establishedFacts.map((fact) => `- ${fact}`).join('\n')));
  }

  for (const { member, from } of gaps) {
    const lines = [
      `Last seen: ${describeBureauTime(from, bureau.timezone)} (${describeGap(from, to) ?? 'a few hours'} ago)`,
      ...profileLines(member, readerName),
    ];
    const routine = text(member.routine?.text);
    if (routine) lines.push(`Usual routine: ${routine}`);
    const notes = notesByCast.get(member.id) ?? [];
    if (notes.length > 0) {
      lines.push(
        `How ${nameOf(member)} has changed:\n${notes.map((note) => `- ${note.content}`).join('\n')}`,
      );
    }
    const memories = memoriesByCast.get(member.id);
    if (memories?.knowledge.length > 0) {
      lines.push(`Knows:\n${memories.knowledge.map((memory) => `- ${memory.content}`).join('\n')}`);
    }
    const chapters = chaptersByCast.get(member.id) ?? [];
    if (chapters.length > 0) {
      const name = nameOf(member);
      const recaps = chapters.map((chapter) => `- ${bureauText(chapter.summary, readerName)}`);
      lines.push(
        `Recently, in chapters ${name} was in (${name} knows only what happened while ${name} was there):\n${recaps.join('\n')}`,
      );
    }
    if (memories?.offscreen) {
      lines.push(`The last time away: ${memories.offscreen.content}`);
    }
    user.push(section(nameOf(member).toUpperCase(), lines.join('\n')));
  }

  return [
    { role: 'system', content: system.join('\n\n') },
    { role: 'user', content: user.join('\n\n') },
  ];
}

/**
 * Write and save offscreen life for the characters owed it (see findOffscreenGaps).
 *
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {Object} params.bureau
 * @param {Array<{member: Object, from: string}>} params.gaps - From findOffscreenGaps.
 * @param {string} params.to - The new time (ISO); accounts are dated just before it.
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {import('./run-recorder.js').RunRecorder} [params.recorder] - Record into this run (a
 *   reply's) instead of a run of its own.
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Array<Object>>} The saved memories; empty when no one is owed an account.
 */
export async function generateOffscreenLife({
  stores,
  bureau,
  gaps,
  to,
  client,
  recorder = null,
  signal,
}) {
  if (gaps.length === 0) return [];
  const characters = gaps.map(({ member }) => member);

  const allChapters = stores.stories.listStories(bureau.id);
  const chaptersByCast = new Map(
    characters.map((member) => [
      member.id,
      earlierChapters(allChapters, { time: to }, { castId: member.id }),
    ]),
  );
  const memoriesByCast = new Map(
    characters.map((member) => [
      member.id,
      selectForPrompt(
        memoriesAtTime(stores.memories.listMemories(bureau.id, member.id, { status: 'all' }), to),
        { knowledgeCharacters: KNOWLEDGE_CHARACTERS },
        { lastChapterTime: chaptersByCast.get(member.id).at(-1)?.startTime ?? null },
      ),
    ]),
  );
  const notesByCast = new Map(
    characters.map((member) => [
      member.id,
      notesAtTime(stores.arcNotes.listNotes(bureau.id, member.id, { status: 'accepted' }), to),
    ]),
  );
  const persona = stores.bureaus.listCast(bureau.id).find((member) => member.isPersona);
  const messages = buildOffscreenMessages({
    bureau,
    gaps,
    to,
    memoriesByCast,
    chaptersByCast: new Map(
      [...chaptersByCast].map(([castId, chapters]) => [castId, chapters.slice(-RECENT_CHAPTERS)]),
    ),
    notesByCast,
    readerName: persona?.name ?? null,
    facts: factsAtTime(stores.facts.listFacts(bureau.id), to),
  });

  const ownRun = !recorder;
  const run =
    recorder ??
    new RunRecorder(stores.bureaus, {
      bureauId: bureau.id,
      purpose: 'offscreen',
      targetType: 'bureau',
      targetId: bureau.id,
    });
  const failWith = (error) => {
    if (ownRun) run.fail(error);
    return error;
  };

  const recordedRequest = {
    model: client.model,
    thinking: false,
    maxTokens: OFFSCREEN_MAX_TOKENS,
    messages,
  };
  const started = Date.now();
  let response;
  try {
    response = await client.chat({
      messages,
      tools: [RECORD_OFFSCREEN_TOOL],
      strict: true,
      toolChoice: { name: RECORD_OFFSCREEN_TOOL.name },
      thinking: false,
      maxTokens: OFFSCREEN_MAX_TOKENS,
      signal,
    });
  } catch (error) {
    run.recordStep({
      role: 'offscreen',
      kind: 'model',
      request: recordedRequest,
      error: error.message,
      durationMs: Date.now() - started,
    });
    throw failWith(error);
  }
  run.recordStep({
    role: 'offscreen',
    kind: 'model',
    request: recordedRequest,
    response: { finishReason: response.finishReason, model: response.model },
    toolCalls: response.toolCalls,
    usage: response.usage,
    durationMs: Date.now() - started,
  });

  const call = response.toolCalls.find(
    (toolCall) => toolCall.function?.name === RECORD_OFFSCREEN_TOOL.name,
  );
  if (!call) {
    throw failWith(new Error("The offscreen account didn't come back"));
  }
  let record;
  try {
    record = JSON.parse(call.function.arguments);
  } catch {
    const cutOff = response.finishReason === 'length' ? ' (it ran out of tokens)' : '';
    throw failWith(new Error(`The offscreen account wasn't valid JSON${cutOff}`));
  }

  // One account per character; a later entry for the same character wins.
  const byName = new Map(characters.map((member) => [nameOf(member).toLowerCase(), member]));
  const accounts = new Map();
  const skipped = [];
  for (const entry of Array.isArray(record.entries) ? record.entries : []) {
    const member = byName.get(text(entry?.character).toLowerCase());
    const content = text(entry?.content);
    if (member && content) {
      accounts.set(member.id, content);
    } else {
      skipped.push(text(entry?.character));
    }
  }

  const worldTime = new Date(timestampOf(to) - 1).toISOString();
  const saved = [];
  stores.bureaus.db.transaction(() => {
    for (const [castId, content] of accounts) {
      saved.push(
        stores.memories.addMemory(bureau.id, castId, {
          layer: 'offscreen',
          content,
          importance: OFFSCREEN_IMPORTANCE,
          worldTime,
          sourceType: 'offscreen',
          runId: run.runId,
        }),
      );
    }
  })();
  run.recordStep({
    role: 'offscreen',
    kind: 'tool',
    request: { id: call.id, name: RECORD_OFFSCREEN_TOOL.name, arguments: record },
    response: { saved: saved.length, skipped },
  });
  if (ownRun) run.complete();
  return saved;
}
