/**
 * Card Archivist
 *
 * Reads a finished story or chat and suggests small edits to the library cards
 * of the characters in it, so a card keeps up with what happened: a new
 * relationship, a change in circumstances, a new goal, or a lasting shift in
 * who someone is. Cards keep their format: a suggestion replaces one span of a
 * card's description or personality, or adds a sentence to the end, and waits
 * for the reader to accept, edit, or reject it.
 *
 * Regular-mode providers can't be forced to call a tool, so the model is asked
 * for JSON in plain text and its answer is read leniently. Anything that doesn't
 * fit a card as it stands is dropped rather than guessed at.
 */

// The card fields the Archivist may suggest changes to.
export const CARD_SUGGESTION_FIELDS = ['description', 'personality'];
// Story or chat text per pass at most; longer stories are read in several passes, and a preset
// with a small context reads smaller ones.
export const ARCHIVE_CHUNK_CHARACTERS = 60_000;
// The least story text worth a pass.
export const MIN_CHUNK_CHARACTERS = 1_000;
// A cautious estimate, so a pass fits the context even for text that tokenizes poorly.
const CHARACTERS_PER_TOKEN = 3;
// Context kept free for tokenizer slack.
const CONTEXT_MARGIN_TOKENS = 512;
// Context kept for the suggestions found earlier in the same run, shown to later passes so they
// aren't proposed again. The newest that fit are shown; the rest are still weeded out afterwards.
const FOUND_SHOWN_TOKENS = 1024;
// The longest replacement a suggestion may make, and the longest rationale or quote kept with it.
export const MAX_REPLACE_CHARACTERS = 4000;
const MAX_NOTE_CHARACTERS = 500;
// Suggestions the reader turned down, shown per character so they aren't proposed again.
const REJECTED_SHOWN = 30;
// Room for the answer, and for a reasoning model's thinking before it.
const MIN_ANSWER_TOKENS = 4000;

// ==================== What the Archivist reads ====================

/** A chat as a transcript, one line per message, using the active swipe of each reply. */
export function chatTranscript(turns) {
  return turns
    .flatMap((turn) =>
      turn.messages.map((message) => `${turn.senderName || 'Someone'}: ${message}`.trim()),
    )
    .join('\n');
}

/**
 * Split text into passes of about `budget` characters, breaking between paragraphs or lines
 * where it can.
 */
export function chunkText(text, budget = ARCHIVE_CHUNK_CHARACTERS) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > budget) {
    const window = rest.slice(0, budget);
    let cut = window.lastIndexOf('\n\n');
    if (cut < budget / 2) cut = window.lastIndexOf('\n');
    if (cut < budget / 2) cut = budget;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

// ==================== The prompt ====================

/**
 * The name each cast member goes by in the prompt, by id. Characters who share a name are told
 * apart by a number, so the model's answer can only mean one card.
 */
export function castLabels(cast) {
  const counts = new Map();
  for (const member of cast) {
    const key = normalized(member.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const seen = new Map();
  const labels = new Map();
  for (const member of cast) {
    const key = normalized(member.name);
    if (counts.get(key) === 1) {
      labels.set(member.id, member.name);
      continue;
    }
    const number = (seen.get(key) ?? 0) + 1;
    seen.set(key, number);
    labels.set(member.id, `${member.name} (${number})`);
  }
  return labels;
}

function describeEdit(suggestion) {
  return suggestion.find
    ? `${suggestion.field}: "${suggestion.find}" -> "${suggestion.replace}"`
    : `${suggestion.field}: add "${suggestion.replace}"`;
}

/**
 * The system and user prompts for one pass.
 * @param {Object} params
 * @param {Array<{id: string, name: string, description: string, personality: string}>} params.cast
 * @param {string} params.text - The stretch of story or chat to read.
 * @param {'story'|'chat'} params.kind
 * @param {{index: number, count: number}} [params.part] - Which pass this is, for long sources.
 * @param {Array<Object>} [params.pending] - Suggestions already waiting for review.
 * @param {Array<Object>} [params.rejected] - Suggestions the reader turned down.
 */
export function buildArchivistPrompt({ cast, text, kind, part, pending = [], rejected = [] }) {
  const source = kind === 'chat' ? 'chat' : 'story';
  const system = [
    `You are the Archivist. You read a ${source} and keep the character cards of its characters up to date with what happened in it.`,
    'A card is a description and a personality written before the ' +
      `${source}. Suggest an edit only for a lasting change the ${source} clearly shows: a new or ended relationship (and with whom), a change in circumstances such as where they live or what they do, a new goal or plan for the future, something important they learned or lost, or a real shift in who they are. Not passing moods, events that are over and don't matter later, or anything the card already says.`,
    'Each edit changes as little as it can and matches the card\'s voice, tense and person. To change something the card says, set "find" to the exact text to replace, copied character for character from the card (a phrase or sentence, not the whole field), and "replace" to the new text. To add something the card doesn\'t cover, leave "find" empty and set "replace" to one or two sentences to add at the end. Keep placeholders such as {{char}} and {{user}} as they are.',
    `Most ${source}s call for no edits, and a few at most. Don't repeat an edit that is waiting for review or that the reader turned down.`,
    'Answer with JSON only, no other text, in this shape:',
    '{"suggestions": [{"character": "the name as its card\'s heading gives it", "field": "description" or "personality", "find": "exact text from the card, or empty", "replace": "new text", "rationale": "what in the ' +
      `${source} shows it, in one sentence", "quote": "a short quote from the ${source} that shows it"}]}`,
    'Answer {"suggestions": []} when nothing lasting changed.',
  ].join('\n\n');

  const labels = castLabels(cast);
  const cards = cast.map((member) => {
    const lines = [`## ${labels.get(member.id)}`];
    for (const field of CARD_SUGGESTION_FIELDS) {
      lines.push(`### ${field}`, member[field]?.trim() || '(empty)');
    }
    const waiting = pending.filter((s) => s.characterId === member.id);
    if (waiting.length > 0) {
      lines.push('### Waiting for review', ...waiting.map((s) => `- ${describeEdit(s)}`));
    }
    const turnedDown = rejected.filter((s) => s.characterId === member.id).slice(-REJECTED_SHOWN);
    if (turnedDown.length > 0) {
      lines.push('### Turned down', ...turnedDown.map((s) => `- ${describeEdit(s)}`));
    }
    return lines.join('\n');
  });

  const heading =
    part && part.count > 1 ? `# The ${source}, part ${part.index + 1} of ${part.count}` : null;
  const user = [
    '# Character cards',
    cards.join('\n\n'),
    heading ?? `# The ${source}`,
    text,
    '# Your answer',
    'Suggest edits to the cards above, as JSON.',
  ].join('\n\n');

  return { system, user };
}

// ==================== Reading the answer ====================

/**
 * The suggestions in a model's answer, or null when it holds no JSON. Reasoning blocks and code
 * fences are skipped, and a bare list is accepted too.
 */
export function parseSuggestions(answer) {
  const text = String(answer ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((index) => index >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.suggestions;
  return Array.isArray(list) ? list : null;
}

function normalized(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function note(text) {
  return typeof text === 'string' ? text.trim().slice(0, MAX_NOTE_CHARACTERS) : '';
}

/** The key two suggestions share when they make the same edit. */
export function suggestionKey(suggestion) {
  return [
    suggestion.characterId,
    suggestion.field,
    normalized(suggestion.find),
    normalized(suggestion.replace),
  ].join('\u0000');
}

/**
 * The suggestions that fit the cast as it stands: a known character and field, a `find` that is
 * in the field word for word, and a change that isn't already waiting or turned down.
 * @param {Array<Object>} raw - Parsed from the answer.
 * @param {Array<Object>} cast
 * @param {Array<Object>} [existing] - Suggestions already kept for this source, in any status.
 */
export function validateSuggestions(raw, cast, existing = []) {
  const labels = castLabels(cast);
  const byName = new Map(cast.map((member) => [normalized(labels.get(member.id)), member]));
  const seen = new Set(existing.map(suggestionKey));
  const valid = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const member = byName.get(normalized(String(item.character ?? '')));
    const field = String(item.field ?? '').toLowerCase();
    if (!member || !CARD_SUGGESTION_FIELDS.includes(field)) continue;
    const find = typeof item.find === 'string' ? item.find.trim() : '';
    const replace = typeof item.replace === 'string' ? item.replace.trim() : '';
    if (!replace || find === replace || replace.length > MAX_REPLACE_CHARACTERS) continue;
    if (find && !(member[field] ?? '').includes(find)) continue;
    const suggestion = {
      characterId: member.id,
      field,
      find,
      replace,
      rationale: note(item.rationale),
      quote: note(item.quote),
    };
    const key = suggestionKey(suggestion);
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(suggestion);
  }
  return valid;
}

// ==================== Applying an edit ====================

/**
 * A field with one suggested edit made, or null when it no longer applies: the text it replaces
 * is gone, or the text it adds is already there. An addition goes on the end, after a blank line
 * when the field has paragraphs.
 */
export function applyEdit(text, find, replace) {
  const current = text ?? '';
  if (!find) {
    if (!current.trim()) return replace;
    if (normalized(current).includes(normalized(replace))) return null;
    const separator = current.includes('\n\n') ? '\n\n' : ' ';
    return `${current.trimEnd()}${separator}${replace}`;
  }
  const index = current.indexOf(find);
  if (index < 0) return null;
  return current.slice(0, index) + replace + current.slice(index + find.length);
}

// ==================== A run ====================

/** The newest suggestions whose lines in the prompt fit the room kept for them, oldest first. */
function newestThatFit(found) {
  let room = FOUND_SHOWN_TOKENS * CHARACTERS_PER_TOKEN;
  const shown = [];
  for (const suggestion of found.toReversed()) {
    // Its line, plus room for a "Waiting for review" heading it may bring.
    room -= describeEdit(suggestion).length + 32;
    if (room < 0) break;
    shown.unshift(suggestion);
  }
  return shown;
}

/**
 * A run that stopped partway. `found` holds what the passes before the failing one suggested, so
 * they needn't be lost with it.
 */
export class ArchivistRunError extends Error {
  constructor(message, { part, found, answer, cause }) {
    super(message, { cause });
    this.name = 'ArchivistRunError';
    this.part = part;
    this.found = found;
    // The start of the model's last answer, for the log, when it wasn't what was asked for.
    this.answer = answer;
  }
}

/**
 * An error's message with the causes under it, since a failed fetch only says "fetch failed" and
 * keeps the reason (a timeout, a closed connection) in its cause.
 */
export function describeError(error) {
  const messages = [];
  for (let current = error; current && messages.length < 4; current = current.cause) {
    const message = current instanceof Error ? current.message : String(current);
    if (message && !messages.includes(message)) messages.push(message);
  }
  if (messages.length === 0) return 'Unknown error';
  const [first, ...causes] = messages;
  return causes.length > 0 ? `${first} (${causes.join(': ')})` : first;
}

/**
 * Read a story or chat and return the new suggestions for its cast.
 * @param {Object} params
 * @param {Object} params.provider - A regular-mode provider.
 * @param {Object} params.preset - Its preset, for generation settings.
 * @param {Array<Object>} params.cast - See buildArchivistPrompt.
 * @param {string} params.text - The whole story or chat transcript.
 * @param {'story'|'chat'} params.kind
 * @param {Array<Object>} [params.existing] - Suggestions already kept for this source.
 * @param {AbortSignal} [params.signal]
 * @param {(part: {index: number, count: number, characters: number}) => void} [params.onPart] -
 *   Called as each pass starts.
 * @throws {ArchivistRunError} When a pass fails, unless the run was cancelled.
 */
export async function runArchivist({
  provider,
  preset,
  cast,
  text,
  kind,
  existing = [],
  signal,
  onPart,
}) {
  const { options, contextTokens, answerTokens } = await archivistOptions(provider, preset, signal);
  const rejected = existing.filter((s) => s.status === 'rejected');
  const found = [];

  // Each pass repeats the cards, so the story text gets what the context has left after them and
  // the answer.
  const overhead = buildArchivistPrompt({
    cast,
    text: '',
    kind,
    part: { index: 0, count: 2 },
    pending: existing.filter((s) => s.status === 'proposed'),
    rejected,
  });
  const overheadTokens = Math.ceil(
    (overhead.system.length + overhead.user.length) / CHARACTERS_PER_TOKEN,
  );
  const budget = Math.min(
    ARCHIVE_CHUNK_CHARACTERS,
    (contextTokens - answerTokens - overheadTokens - CONTEXT_MARGIN_TOKENS - FOUND_SHOWN_TOKENS) *
      CHARACTERS_PER_TOKEN,
  );
  if (budget < MIN_CHUNK_CHARACTERS) {
    throw new Error(
      "This preset's context is too small for the Archivist to read the cards and the story together. Try a preset with a larger context.",
    );
  }
  const chunks = chunkText(text, budget);

  for (const [index, chunk] of chunks.entries()) {
    signal?.throwIfAborted();
    const pending = [...existing.filter((s) => s.status === 'proposed'), ...newestThatFit(found)];
    const { system, user } = buildArchivistPrompt({
      cast,
      text: chunk,
      kind,
      part: { index, count: chunks.length },
      pending,
      rejected,
    });

    const part = { index, count: chunks.length, characters: chunk.length };
    onPart?.(part);
    const parsed = await askArchivist({
      provider,
      system,
      user,
      options,
      signal,
      part,
      found,
      answerTokens,
      parse: parseSuggestions,
    });
    found.push(...validateSuggestions(parsed, cast, [...existing, ...found]));
  }
  return found;
}

/** A pass's failure, naming the pass when there's more than one. */
function inPart(part, message) {
  return part.count > 1 ? `Part ${part.index + 1} of ${part.count}: ${message}` : message;
}

/**
 * The generation options an Archivist pass uses: the preset's own, with room for the answer (at
 * least `minAnswerTokens`, and no more than a quarter of the context) and a cool temperature.
 */
export async function archivistOptions(provider, preset, signal, minAnswerTokens = 0) {
  const settings = preset?.generationSettings ?? {};
  // AI Horde works out its context from its workers, so this may be a promise.
  const contextTokens =
    (await provider.resolveContextTokens?.(preset ?? {})) ?? settings.maxContextTokens ?? 128_000;
  const answerTokens = Math.min(
    Math.max(settings.maxTokens ?? 0, MIN_ANSWER_TOKENS, minAnswerTokens),
    Math.floor(contextTokens / 4),
  );
  const options = {
    ...settings,
    maxTokens: answerTokens,
    temperature: Math.min(settings.temperature ?? 0.5, 0.5),
    // AI Horde reads maxContextLength; KoboldCpp and Ollama read maxContextTokens.
    maxContextTokens: contextTokens,
    maxContextLength: contextTokens,
    signal,
  };
  return { options, contextTokens, answerTokens };
}

/**
 * Ask for one pass's answer and read it with `parse`, asking once more when it isn't JSON.
 * @returns {Promise<*>} What `parse` made of the answer.
 * @throws {ArchivistRunError} When the pass fails, carrying `found` from the passes before it.
 */
export async function askArchivist({
  provider,
  system,
  user,
  options,
  signal,
  part,
  found,
  answerTokens,
  parse,
}) {
  let parsed = null;
  let answer = '';
  try {
    for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
      const result = await provider.generate(system, user, options);
      answer = String(result?.content ?? '');
      parsed = parse(answer);
    }
  } catch (error) {
    if (signal?.aborted) throw error;
    // An answer that wasn't JSON before the retry failed is still worth logging.
    throw new ArchivistRunError(inPart(part, describeError(error)), {
      part,
      found,
      answer: answer ? answer.slice(0, 500) : undefined,
      cause: error,
    });
  }
  if (parsed === null) {
    const problem = answer.trim()
      ? "The Archivist's answer wasn't the JSON it was asked for."
      : "The Archivist's answer was empty. A reasoning model may have used all " +
        `${answerTokens} tokens it had for thinking.`;
    throw new ArchivistRunError(inPart(part, problem), {
      part,
      found,
      answer: answer.slice(0, 500),
    });
  }
  return parsed;
}
