/**
 * Card Archivist
 *
 * Reads a finished story or chat and suggests small edits to the library cards
 * of the characters in it, so a card keeps up with what happened: a new
 * relationship, a change in circumstances, a new goal, or a lasting shift in
 * who someone is. It's Bureau's Archivist (bureau/archivist.js) for regular
 * cards, which keep their format: a suggestion replaces one span of a card's
 * description or personality, or adds a sentence to the end, and waits for the
 * reader to accept, edit, or reject it.
 *
 * Regular-mode providers can't be forced to call a tool, so the model is asked
 * for JSON in plain text and its answer is read leniently. Anything that doesn't
 * fit a card as it stands is dropped rather than guessed at.
 */

// The card fields the Archivist may suggest changes to.
export const CARD_SUGGESTION_FIELDS = ['description', 'personality'];
// Story or chat text per pass; longer stories are read in several passes.
export const ARCHIVE_CHUNK_CHARACTERS = 60_000;
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
    '{"suggestions": [{"character": "name", "field": "description" or "personality", "find": "exact text from the card, or empty", "replace": "new text", "rationale": "what in the ' +
      `${source} shows it, in one sentence", "quote": "a short quote from the ${source} that shows it"}]}`,
    'Answer {"suggestions": []} when nothing lasting changed.',
  ].join('\n\n');

  const cards = cast.map((member) => {
    const lines = [`## ${member.name}`];
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
  const byName = new Map(cast.map((member) => [normalized(member.name), member]));
  const seen = new Set(existing.map(suggestionKey));
  const valid = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const member = byName.get(normalized(String(item.character ?? '')));
    const field = String(item.field ?? '').toLowerCase();
    if (!member || !CARD_SUGGESTION_FIELDS.includes(field)) continue;
    const find = typeof item.find === 'string' ? item.find.trim() : '';
    const replace = typeof item.replace === 'string' ? item.replace.trim() : '';
    if (!replace || find === replace) continue;
    if (find && !(member[field] ?? '').includes(find)) continue;
    const suggestion = {
      characterId: member.id,
      field,
      find,
      replace,
      rationale: typeof item.rationale === 'string' ? item.rationale.trim() : '',
      quote: typeof item.quote === 'string' ? item.quote.trim() : '',
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
 * A field with one suggested edit made, or null when the text it replaces is no longer there.
 * An addition goes on the end, after a blank line when the field has paragraphs.
 */
export function applyEdit(text, find, replace) {
  const current = text ?? '';
  if (!find) {
    if (!current.trim()) return replace;
    const separator = current.includes('\n\n') ? '\n\n' : ' ';
    return `${current.trimEnd()}${separator}${replace}`;
  }
  const index = current.indexOf(find);
  if (index < 0) return null;
  return current.slice(0, index) + replace + current.slice(index + find.length);
}

// ==================== A run ====================

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
 */
export async function runArchivist({ provider, preset, cast, text, kind, existing = [], signal }) {
  const chunks = chunkText(text);
  const settings = preset?.generationSettings ?? {};
  const options = {
    ...settings,
    maxTokens: Math.max(settings.maxTokens ?? 0, MIN_ANSWER_TOKENS),
    temperature: Math.min(settings.temperature ?? 0.5, 0.5),
    signal,
  };
  const rejected = existing.filter((s) => s.status === 'rejected');
  const found = [];

  for (const [index, chunk] of chunks.entries()) {
    const pending = [...existing.filter((s) => s.status === 'proposed'), ...found];
    const { system, user } = buildArchivistPrompt({
      cast,
      text: chunk,
      kind,
      part: { index, count: chunks.length },
      pending,
      rejected,
    });

    let parsed = null;
    for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
      const result = await provider.generate(system, user, options);
      parsed = parseSuggestions(result?.content);
    }
    if (parsed === null) {
      throw new Error("The Archivist's answer wasn't the JSON it was asked for. Try again.");
    }
    found.push(...validateSuggestions(parsed, cast, [...existing, ...found]));
  }
  return found;
}
