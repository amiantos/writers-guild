/**
 * Offscreen Life
 *
 * When Bureau time jumps forward, the characters involved get a short account of
 * how they spent the gap (see "Offscreen life" in docs/bureau-design.md), saved
 * as an offscreen memory just before the new time. One forced call to a strict
 * record_offscreen tool covers everyone at once. Nothing runs in the background,
 * so a month away is one account, not thirty days of invented drama.
 */

import { describeBureauTime, describeGap, settingYear } from './bureau-time.js';
import { memoriesAtTime, notesAtTime, selectForPrompt } from './memory.js';
import { RunRecorder } from './run-recorder.js';

// Shorter jumps aren't worth an account.
export const OFFSCREEN_MIN_GAP_HOURS = 12;
export const OFFSCREEN_MAX_TOKENS = 3000;
const OFFSCREEN_IMPORTANCE = 2;
const DESCRIPTION_CHARACTERS = 1200;
const KNOWLEDGE_CHARACTERS = 1500;
const RECENT_EPISODES = 2;

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

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;
}

function timestampOf(value) {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/** Whether Bureau time moving from `from` to `to` leaves a gap worth an account. */
export function isOffscreenGap(from, to) {
  const hours = (timestampOf(to) - timestampOf(from)) / 3_600_000;
  return Number.isFinite(hours) && hours >= OFFSCREEN_MIN_GAP_HOURS;
}

/**
 * @param {Object} params
 * @param {Object} params.bureau - Uses timezone and presentOffsetDays.
 * @param {Array<Object>} params.members - Characters to account for, with seed cards and routines.
 * @param {Object|null} [params.persona] - The reader's character, left out of every account.
 * @param {string} params.from - Bureau time before the jump (ISO).
 * @param {string} params.to - Bureau time after it (ISO).
 * @param {Map<string, {knowledge: Array<Object>, episodes: Array<Object>, offscreen: Object|null}>}
 *   [params.memoriesByCast]
 * @param {Map<string, Array<{content: string}>>} [params.notesByCast] - Accepted arc notes.
 * @param {Date} [params.now] - Real time, to tell whether the Bureau is set in another year.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildOffscreenMessages({
  bureau,
  members,
  persona = null,
  from,
  to,
  memoriesByCast = new Map(),
  notesByCast = new Map(),
  now = new Date(),
}) {
  const personaName = persona ? nameOf(persona) : null;
  const system = [
    'You keep track of what the characters in an ongoing series of stories do between the scenes the reader sees. Call record_offscreen once, with one entry for each character listed.',
    [
      '- Write two to four sentences for each character, in the past tense and the third person, about how they spent the time: work, errands, habits, small pleasures and annoyances, people they ran into.',
      '- Keep it mostly mundane and true to who they are: their routine, what they know, and how they have changed. At most one thing in an entry can be notable, and nothing that settles or invents a major turn in their story.',
      '- Fit the length of the gap: an evening holds a little, a few weeks hold more.',
      personaName
        ? `- Leave ${personaName} out entirely: the reader decides what ${personaName} did.`
        : null,
    ]
      .filter(Boolean)
      .join('\n'),
  ];

  const time = [
    `From ${describeBureauTime(from, bureau.timezone)} to ${describeBureauTime(to, bureau.timezone)}: ${describeGap(from, to) ?? 'a few hours'}.`,
  ];
  const year = settingYear(bureau, to, now);
  if (year) time.push(`The year is ${year}.`);
  const user = [section('TIME THAT PASSED', time.join('\n'))];

  for (const member of members) {
    const lines = [];
    const description = text(member.seedCard?.data?.description);
    if (description) lines.push(`Description: ${truncate(description, DESCRIPTION_CHARACTERS)}`);
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
    if (memories?.episodes.length > 0) {
      lines.push(
        `Recently:\n${memories.episodes.map((memory) => `- ${memory.content}`).join('\n')}`,
      );
    }
    if (memories?.offscreen) {
      lines.push(`The last time away: ${memories.offscreen.content}`);
    }
    user.push(section(nameOf(member).toUpperCase(), lines.join('\n') || '(Nothing known yet.)'));
  }

  return [
    { role: 'system', content: system.join('\n\n') },
    { role: 'user', content: user.join('\n\n') },
  ];
}

/**
 * Write and save offscreen life for characters across a jump in Bureau time.
 *
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {Object} params.bureau
 * @param {Array<Object>} params.members - Characters to account for, with seed cards. The
 *   reader's character is skipped.
 * @param {string} params.from - Bureau time before the jump (ISO).
 * @param {string} params.to - Bureau time after it (ISO).
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {import('./run-recorder.js').RunRecorder} [params.recorder] - Record into this run (a
 *   reply's) instead of a run of its own.
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Array<Object>>} The saved memories; empty when the gap is too short or no one
 *   is left to account for.
 */
export async function generateOffscreenLife({
  stores,
  bureau,
  members,
  from,
  to,
  client,
  recorder = null,
  signal,
}) {
  const characters = members.filter((member) => !member.isPersona);
  if (characters.length === 0 || !isOffscreenGap(from, to)) return [];

  const persona = stores.bureaus.listCast(bureau.id).find((member) => member.isPersona) ?? null;
  const memoriesByCast = new Map(
    characters.map((member) => [
      member.id,
      selectForPrompt(
        memoriesAtTime(stores.memories.listMemories(bureau.id, member.id, { status: 'all' }), to),
        { knowledgeCharacters: KNOWLEDGE_CHARACTERS, recentEpisodes: RECENT_EPISODES },
      ),
    ]),
  );
  const notesByCast = new Map(
    characters.map((member) => [
      member.id,
      notesAtTime(stores.arcNotes.listNotes(bureau.id, member.id, { status: 'accepted' }), to),
    ]),
  );
  const messages = buildOffscreenMessages({
    bureau,
    members: characters,
    persona,
    from,
    to,
    memoriesByCast,
    notesByCast,
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
