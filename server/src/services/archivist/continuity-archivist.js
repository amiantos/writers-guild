/**
 * Continuity Archivist
 *
 * When a story or chat is in a Continuity, the Archivist keeps the Continuity
 * up to date instead of the cast's cards: it reads what happened and suggests
 * the Continuity's whole text again with the lasting developments worked in,
 * in the reader's own voice. The reader accepts, edits, or rejects it, and an
 * accepted one is kept in the Continuity's History.
 *
 * A long story is read in passes, each one working its part into the text the
 * pass before it wrote, so the run ends with one suggestion.
 */

import {
  ARCHIVE_CHUNK_CHARACTERS,
  MIN_CHUNK_CHARACTERS,
  archivistOptions,
  askArchivist,
  chunkText,
} from './card-archivist.js';

// The longest Continuity, as the Continuities routes allow it.
export const MAX_CONTINUITY_SUGGESTION_CHARACTERS = 20000;
const MAX_NOTE_CHARACTERS = 500;
const CHARACTERS_PER_TOKEN = 3;
const CONTEXT_MARGIN_TOKENS = 512;
// Room for the answer beyond the Continuity it repeats: what it adds, and the rationale.
const ANSWER_GROWTH_TOKENS = 2000;

/**
 * The system and user prompts for one pass.
 * @param {Object} params
 * @param {string} params.name - The Continuity's name.
 * @param {string} params.continuity - Its text as it stands, with earlier passes' changes.
 * @param {string} params.text - The stretch of story or chat to read.
 * @param {'story'|'chat'} params.kind
 * @param {{index: number, count: number}} [params.part]
 */
export function buildContinuityPrompt({ name, continuity, text, kind, part }) {
  const source = kind === 'chat' ? 'chat' : 'story';
  const system = [
    `You are the Archivist. The reader keeps a Continuity: a short account, in their own words, of what's true across a series of stories and chats, such as who is together, what has happened between them, and where things stand now. It is given ahead of each new story so the story picks up where things left off.`,
    `Read the ${source} and write the Continuity again with what happened in it worked in:`,
    [
      `- Add the ${source}'s lasting developments as the next part of the account: what happened, how it went, and what was left open or planned. Summarize the way the Continuity already does, in a few sentences, not scene by scene.`,
      `- Change anything the ${source} made untrue, and adjust words like "a couple days ago" if time has clearly passed.`,
      '- Keep everything else as it is, word for word where you can, in the same voice, tense and person. Keep placeholders such as {{char}} and {{user}} as they are.',
      `- Leave out passing details that won't matter to the next ${source}.`,
    ].join('\n'),
    'Answer with JSON only, no other text, in this shape:',
    `{"continuity": "the whole Continuity, updated", "rationale": "what you added or changed, in one sentence"}`,
    `Answer {"continuity": null} when nothing in the ${source} is worth carrying forward.`,
  ].join('\n\n');

  const later = part && part.index > 0;
  const heading =
    part && part.count > 1 ? `# The ${source}, part ${part.index + 1} of ${part.count}` : null;
  const user = [
    `# The Continuity: ${name}`,
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
 * @param {AbortSignal} [params.signal]
 * @param {(part: {index: number, count: number, characters: number}) => void} [params.onPart]
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
  signal,
  onPart,
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
    name,
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
      name,
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
    if (
      answer.continuity &&
      answer.continuity.length <= MAX_CONTINUITY_SUGGESTION_CHARACTERS &&
      normalized(answer.continuity) !== normalized(current)
    ) {
      current = answer.continuity;
      if (answer.rationale) rationales.push(answer.rationale);
    }
  }
  return found()[0] ?? null;
}
