/**
 * Continuity Archivist
 *
 * When a story or chat is in a Continuity, the Archivist keeps the Continuity
 * up to date alongside the cast's cards: it reads what happened and suggests
 * the Continuity's whole text again with the lasting developments worked in,
 * in the reader's own voice. The reader accepts, edits, or rejects it, and an
 * accepted one is kept in the Continuity's History.
 *
 * A long story is read in passes, each one working its part into the text the
 * pass before it wrote, so the run ends with one suggestion. When that leaves
 * the Continuity long, one more pass condenses it (see compactContinuity),
 * which the reader can also ask for on its own from the Continuity's editor.
 */

import {
  ARCHIVE_CHUNK_CHARACTERS,
  MIN_CHUNK_CHARACTERS,
  archivistOptions,
  askArchivist,
  chunkText,
  describeError,
} from './card-archivist.js';

// The longest Continuity, as the Continuities routes allow it.
export const MAX_CONTINUITY_SUGGESTION_CHARACTERS = 20000;
// A Continuity longer than this after an update is condensed in the same run, to about half.
export const COMPACT_AT_CHARACTERS = 6000;
export const COMPACT_TARGET_CHARACTERS = 3000;
const MAX_NOTE_CHARACTERS = 500;
const CHARACTERS_PER_TOKEN = 3;
const CONTEXT_MARGIN_TOKENS = 512;
// Room for the answer beyond the Continuity it repeats: what it adds, and the rationale.
const ANSWER_GROWTH_TOKENS = 2000;
// Room for a condensed answer's rationale and JSON.
const COMPACT_NOTE_TOKENS = 500;

/**
 * The system and user prompts for one pass.
 * @param {Object} params
 * @param {string} params.continuity - Its text as it stands, with earlier passes' changes.
 * @param {string} params.text - The stretch of story or chat to read.
 * @param {'story'|'chat'} params.kind
 * @param {{index: number, count: number}} [params.part]
 */
export function buildContinuityPrompt({ continuity, text, kind, part }) {
  const source = kind === 'chat' ? 'chat' : 'story';
  const system = [
    `You are the Archivist. The reader keeps a Continuity: a short account, in their own words, of what's true across a series of stories and chats, such as who is together, what has happened between them, and where things stand now. It is given ahead of each new story so the story picks up where things left off.`,
    `Read the ${source} and write the Continuity again with what happened in it worked in:`,
    [
      `- Add the ${source}'s lasting developments as the next part of the account: what happened, how it went, and what was left open or planned. Summarize the way the Continuity already does, in a few sentences, not scene by scene.`,
      `- Change anything the ${source} made untrue, and adjust words like "a couple days ago" if time has clearly passed.`,
      '- Keep everything else as it is, word for word where you can, in the same voice, tense and person. Keep placeholders such as {{char}} and {{user}} as they are.',
      `- Leave out passing details that won't matter to the next ${source}, and facts about a character that would be true in any story, such as their past, job or tastes; those belong on their character card.`,
      '- Write the text only: no title or heading of your own.',
    ].join('\n'),
    'Answer with JSON only, no other text, in this shape:',
    `{"continuity": "the whole Continuity, updated", "rationale": "what you added or changed, in one sentence"}`,
    `Answer {"continuity": null} when nothing in the ${source} is worth carrying forward.`,
  ].join('\n\n');

  const later = part && part.index > 0;
  const heading =
    part && part.count > 1 ? `# The ${source}, part ${part.index + 1} of ${part.count}` : null;
  const user = [
    '# The Continuity',
    continuity.trim() || '(empty so far)',
    ...(later
      ? [`The Continuity above already includes what the earlier parts of the ${source} added.`]
      : []),
    heading ?? `# The ${source}`,
    text,
    '# Your answer',
    'Write the updated Continuity, as JSON.',
  ].join('\n\n');

  return { system, user };
}

/**
 * The model's answer as `{continuity, rationale}`, with `continuity` null when it found nothing to
 * carry forward; or null when the answer holds no JSON of that shape.
 */
export function parseContinuity(answer) {
  const text = String(answer ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || !('continuity' in parsed)) return null;
  const { continuity, rationale } = parsed;
  if (continuity !== null && typeof continuity !== 'string') return null;
  return {
    continuity: continuity?.trim() || null,
    rationale: typeof rationale === 'string' ? rationale.trim().slice(0, MAX_NOTE_CHARACTERS) : '',
  };
}

function normalized(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function headingText(line) {
  return normalized(
    line
      .replace(/^#+\s*/, '')
      .replace(/^[*_]+|[*_]+$/g, '')
      .replace(/^(the\s+)?continuity\s*:\s*/i, ''),
  ).toLowerCase();
}

/**
 * An answer's text without a title the model put on it: a first line that is just the
 * Continuity's name (as a heading, in bold, or after "Continuity:"), or that is a bare
 * "Continuity" heading or a "Continuity:" label, unless the Continuity itself started with that line.
 */
export function withoutTitle(answer, name, before = '') {
  const [first, ...rest] = answer.split('\n');
  if (rest.length === 0) return answer;
  const ownFirst = normalized(before.split('\n')[0] ?? '');
  if (ownFirst && normalized(first) === ownFirst) return answer;
  const isName = Boolean(name) && headingText(first) === normalized(name).toLowerCase();
  const isTitle = /^[#*_\s]*(the\s+)?continuity[*_\s]*(:.*)?$/i.test(first.trim());
  if (!isName && !isTitle) return answer;
  return rest.join('\n').trim() || answer;
}

/**
 * Character cards as the condensing prompt shows them, as many as fit in `room` characters. A
 * card too long for what's left is skipped, so shorter ones after it can still be shown.
 */
function cardsThatFit(cast, room) {
  const shown = [];
  for (const member of cast) {
    const card = [
      `## ${member.name}`,
      ...['description', 'personality']
        .filter((field) => member[field]?.trim())
        .map((field) => member[field].trim()),
    ].join('\n');
    if (card.length + 2 > room) continue;
    room -= card.length + 2;
    shown.push(card);
  }
  return shown;
}

/**
 * The system and user prompts for condensing a Continuity.
 * @param {Object} params
 * @param {string} params.continuity - Its text now.
 * @param {Array<string>} [params.cards] - Its characters' cards, from cardsThatFit.
 */
export function buildCompactPrompt({ continuity, cards = [] }) {
  const system = [
    `You are the Archivist. The reader keeps a Continuity: a short account, in their own words, of what's true across a series of stories and chats, such as who is together, what has happened between them, and where things stand now. It is given ahead of each new story so the story picks up where things left off. It has grown long, and you condense it.`,
    [
      '- Keep the most recent developments, and anything left open or planned, close to as they are.',
      '- Condense older events into a sentence or two each, keeping what still shapes where things stand. Merge what repeats, and drop details that no longer matter.',
      "- Drop what a character's card below already says; the card is given with every story too.",
      '- Keep the same voice, tense and person, and keep placeholders such as {{char}} and {{user}} as they are. Write the text only: no title or heading of your own.',
      `- Aim for about ${COMPACT_TARGET_CHARACTERS} characters, shorter if it reads well.`,
    ].join('\n'),
    'Answer with JSON only, no other text, in this shape:',
    `{"continuity": "the whole Continuity, condensed", "rationale": "what you condensed or dropped, in one sentence"}`,
  ].join('\n\n');

  const user = [
    ...(cards.length > 0 ? ['# Character cards', cards.join('\n\n')] : []),
    '# The Continuity',
    continuity.trim(),
    '# Your answer',
    'Write the condensed Continuity, as JSON.',
  ].join('\n\n');

  return { system, user };
}

/**
 * Condense a Continuity in one pass, with its characters' cards to leave out what they say.
 * @param {Object} params
 * @param {Object} params.provider - A regular-mode provider.
 * @param {Object} params.preset - Its preset, for generation settings.
 * @param {string} params.name - The Continuity's name, to drop if the answer repeats it.
 * @param {string} params.continuity - Its text now.
 * @param {Array<{name: string, description: string, personality: string}>} [params.cast]
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{replace: string, rationale: string}|null>} The shorter text, or null when the
 *   answer wasn't shorter.
 * @throws {ArchivistRunError} When the pass fails, unless the run was cancelled.
 */
export async function compactContinuity({ provider, preset, name, continuity, cast = [], signal }) {
  // The answer is condensed, so it needs room for the target with some slack, and the rationale;
  // the Continuity itself only has to fit the prompt.
  const answerRoomTokens =
    Math.ceil((COMPACT_TARGET_CHARACTERS * 1.5) / CHARACTERS_PER_TOKEN) + COMPACT_NOTE_TOKENS;
  const { options, contextTokens, answerTokens } = await archivistOptions(
    provider,
    preset,
    signal,
    answerRoomTokens,
  );
  const bare = buildCompactPrompt({ continuity });
  const room =
    (contextTokens - answerTokens - CONTEXT_MARGIN_TOKENS) * CHARACTERS_PER_TOKEN -
    bare.system.length -
    bare.user.length;
  if (room < 0 || answerTokens < answerRoomTokens) {
    throw new Error(
      "This preset's context is too small for the Archivist to condense the Continuity. Try a preset with a larger context.",
    );
  }
  // The cards get what's left, minus room for the heading over them.
  const { system, user } = buildCompactPrompt({ continuity, cards: cardsThatFit(cast, room - 32) });
  const answer = await askArchivist({
    provider,
    system,
    user,
    options,
    signal,
    part: { index: 0, count: 1 },
    found: [],
    answerTokens,
    parse: parseContinuity,
  });
  if (!answer.continuity) return null;
  const replace = withoutTitle(answer.continuity, name, continuity);
  if (replace.length >= continuity.trim().length) return null;
  return { replace, rationale: answer.rationale };
}

/**
 * Read a story or chat and return the Continuity's text with it worked in, or null when nothing
 * changed.
 * @param {Object} params
 * @param {Object} params.provider - A regular-mode provider.
 * @param {Object} params.preset - Its preset, for generation settings.
 * @param {string} params.name - The Continuity's name.
 * @param {string} params.continuity - Its text now.
 * @param {string} params.text - The whole story or chat transcript.
 * @param {'story'|'chat'} params.kind
 * @param {Array<Object>} [params.cast] - The source's characters' cards, for condensing.
 * @param {AbortSignal} [params.signal]
 * @param {(part: {index: number, count: number, characters: number}) => void} [params.onPart]
 * @param {() => void} [params.onCompact] - Called as the condensing pass starts.
 * @returns {Promise<{replace: string, rationale: string}|null>}
 * @throws {ArchivistRunError} When a pass fails, unless the run was cancelled. Its `found` holds
 *   the text as the passes before it left it, when they changed it.
 */
export async function runContinuityArchivist({
  provider,
  preset,
  name,
  continuity,
  text,
  kind,
  cast = [],
  signal,
  onPart,
  onCompact,
}) {
  // The answer repeats the whole Continuity, so it needs room for it and for what it adds.
  const repeatTokens = Math.ceil(continuity.length / CHARACTERS_PER_TOKEN) + ANSWER_GROWTH_TOKENS;
  const { options, contextTokens, answerTokens } = await archivistOptions(
    provider,
    preset,
    signal,
    repeatTokens,
  );

  // Each pass repeats the Continuity, which grows as passes add to it.
  const overhead = buildContinuityPrompt({
    continuity,
    text: '',
    kind,
    part: { index: 1, count: 2 },
  });
  const overheadTokens =
    Math.ceil((overhead.system.length + overhead.user.length) / CHARACTERS_PER_TOKEN) +
    ANSWER_GROWTH_TOKENS;
  const budget = Math.min(
    ARCHIVE_CHUNK_CHARACTERS,
    (contextTokens - answerTokens - overheadTokens - CONTEXT_MARGIN_TOKENS) * CHARACTERS_PER_TOKEN,
  );
  if (budget < MIN_CHUNK_CHARACTERS || answerTokens < repeatTokens) {
    throw new Error(
      "This preset's context is too small for the Archivist to read the Continuity and the story together. Try a preset with a larger context.",
    );
  }
  const chunks = chunkText(text, budget);

  let current = continuity;
  const rationales = [];
  const found = () =>
    normalized(current) === normalized(continuity)
      ? []
      : [{ replace: current, rationale: rationales.join(' ') }];

  for (const [index, chunk] of chunks.entries()) {
    signal?.throwIfAborted();
    const { system, user } = buildContinuityPrompt({
      continuity: current,
      text: chunk,
      kind,
      part: { index, count: chunks.length },
    });
    const part = { index, count: chunks.length, characters: chunk.length };
    onPart?.(part);
    const answer = await askArchivist({
      provider,
      system,
      user,
      options,
      signal,
      part,
      found: found(),
      answerTokens,
      parse: parseContinuity,
    });
    const next = answer.continuity && withoutTitle(answer.continuity, name, current);
    if (
      next &&
      next.length <= MAX_CONTINUITY_SUGGESTION_CHARACTERS &&
      normalized(next) !== normalized(current)
    ) {
      current = next;
      if (answer.rationale) rationales.push(answer.rationale);
    }
  }

  // Only an update that leaves the Continuity long is condensed, so a run that found nothing to
  // add still suggests nothing. Condensing that fails leaves the update as it was.
  if (found().length > 0 && current.length > COMPACT_AT_CHARACTERS) {
    signal?.throwIfAborted();
    onCompact?.();
    try {
      const compacted = await compactContinuity({
        provider,
        preset,
        name,
        continuity: current,
        cast,
        signal,
      });
      if (compacted) {
        current = compacted.replace;
        rationales.push(compacted.rationale || 'Condensed the Continuity.');
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      rationales.push(`It's long, but condensing it failed: ${describeError(error)}`);
    }
  }
  return found()[0] ?? null;
}
