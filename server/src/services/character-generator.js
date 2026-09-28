/**
 * Character Generator
 *
 * Bureau's character generator (bureau/character-generator.js) for the
 * character library: it writes a new card from an idea with a regular-mode
 * preset, optionally set in the world of a library lorebook.
 *
 * Regular-mode providers can't be forced to call a tool, so the model is asked
 * for create_character's arguments as JSON in plain text and its answer is read
 * leniently, the way the card Archivist reads its suggestions.
 */

import {
  APPEARANCE_FIELDS,
  CREATE_CHARACTER_TOOL,
  generatedCard,
} from './bureau/character-generator.js';

// Room for the answer, and for a reasoning model's thinking before it.
const MIN_ANSWER_TOKENS = 4000;
// AI Horde's workers write at most this many tokens, whatever is asked for.
const AI_HORDE_MAX_ANSWER_TOKENS = 1024;
// Words that fit in a token of answer, cautiously, with room left for the JSON around them.
const WORDS_PER_ANSWER_TOKEN = 0.5;
// A cautious estimate, so the prompt and answer fit the context even for text that tokenizes poorly.
const CHARACTERS_PER_TOKEN = 3;
// Context kept free for tokenizer slack.
const CONTEXT_MARGIN_TOKENS = 256;
// The least room worth asking for a card in.
const MIN_USABLE_ANSWER_TOKENS = 512;
// The longest lorebook key, comment, or name shown in the prompt.
const WORLD_LABEL_CHARACTERS = 80;
// Lorebook entries named in the prompt at most.
const WORLD_ENTRIES = 12;
// Characters of each lorebook entry's content shown in the prompt at most.
const WORLD_ENTRY_CHARACTERS = 300;
// The longest idea or name accepted.
export const MAX_IDEA_CHARACTERS = 4000;
// The longest card field a generated card may be saved with, and the most tags.
export const MAX_CARD_FIELD_CHARACTERS = 20_000;
const MAX_TAGS = 30;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;
}

function section(title, body) {
  return `=== ${title} ===\n${body}`;
}

/**
 * Short notes about a lorebook's world: its description, and a line per enabled entry, headed by
 * its first key or comment. Entries without keys, such as constant ones, count too.
 */
export function lorebookWorld(lorebook) {
  if (!lorebook) return [];
  const entries = (lorebook.entries ?? [])
    .filter((entry) => entry.enabled !== false)
    .map((entry) => {
      const label = truncate(text(entry.keys?.[0]) || text(entry.comment), WORLD_LABEL_CHARACTERS);
      const content = truncate(text(entry.content).replace(/\s+/g, ' '), WORLD_ENTRY_CHARACTERS);
      if (label && content) return `${label}: ${content}`;
      return label || content;
    })
    .filter(Boolean)
    .slice(0, WORLD_ENTRIES);
  const description = text(lorebook.description);
  return [
    description
      ? `${truncate(text(lorebook.name), WORLD_LABEL_CHARACTERS)}: ${truncate(description, WORLD_ENTRY_CHARACTERS)}`
      : null,
    ...entries,
  ].filter(Boolean);
}

/** The JSON the model is asked for, one line per create_character field. */
function answerShape() {
  const { properties } = CREATE_CHARACTER_TOOL.parameters;
  const lines = Object.entries(properties).map(([field, schema]) => {
    if (field === 'appearance') {
      const inner = APPEARANCE_FIELDS.map((key) => `"${key}": "..."`).join(', ');
      return `  "appearance": {${inner}}`;
    }
    const value = schema.type === 'array' ? '["..."]' : '"..."';
    return `  "${field}": ${value}`;
  });
  const notes = Object.entries(properties).map(
    ([field, schema]) => `- ${field}: ${schema.description}`,
  );
  return { json: `{\n${lines.join(',\n')}\n}`, notes: notes.join('\n') };
}

/**
 * The system and user prompts for a new library character.
 * @param {Object} params
 * @param {string} params.idea - What the reader wants.
 * @param {string} [params.name] - A name the character must have.
 * @param {string[]} [params.world] - Notes about the world, from a lorebook.
 * @param {number} [params.wordLimit] - The most words the whole card may use, when the answer
 *   has little room.
 */
export function buildGeneratorPrompt({ idea, name = '', world = [], wordLimit = 0 }) {
  const shape = answerShape();
  const system = [
    'You create characters for stories. Write one complete character card for the character described.',
    'Make them specific and alive: give them wants, habits, and contradictions of their own. Keep them consistent with the world when one is given. Write in the same language as the idea.',
    'Answer with JSON only, no other text, in this shape:',
    shape.json,
    `What each field holds:\n${shape.notes}`,
    wordLimit
      ? `Keep the whole card under ${wordLimit} words so it isn't cut off: shorten the description, first message, and example dialogue to fit.`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const user = [section('IDEA', idea)];
  if (name) user.push(section('NAME', `The character is named ${name}.`));
  if (world.length > 0) {
    user.push(section('WORLD', world.map((note) => `- ${note}`).join('\n')));
  }
  user.push('Write the card as JSON.');

  return { system, user: user.join('\n\n') };
}

/**
 * The character in a model's answer, or null when it holds no JSON object. Reasoning blocks and
 * code fences are skipped.
 */
export function parseCharacter(answer) {
  const content = String(answer ?? '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

/**
 * Generate a library character card. Nothing is saved.
 * @param {Object} params
 * @param {Object} params.provider - A regular-mode provider.
 * @param {Object} params.preset - Its preset, for generation settings.
 * @param {string} params.idea
 * @param {string} [params.name] - A name the character must have.
 * @param {string[]} [params.world] - See buildGeneratorPrompt.
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object>} A V2 card.
 */
export async function generateLibraryCharacter({
  provider,
  preset,
  idea,
  name = '',
  world = [],
  signal,
}) {
  const settings = preset?.generationSettings ?? {};
  // AI Horde works out its context from its workers, so this may be a promise.
  const contextTokens =
    (await provider.resolveContextTokens?.(preset ?? {})) ?? settings.maxContextTokens ?? 128_000;
  // The answer gets what the context has left after the prompt, measured with room for the
  // word limit it may carry.
  const overhead = buildGeneratorPrompt({ idea, name, world, wordLimit: MIN_ANSWER_TOKENS });
  const promptTokens = Math.ceil(
    (overhead.system.length + overhead.user.length) / CHARACTERS_PER_TOKEN,
  );
  let answerTokens = Math.min(
    Math.max(settings.maxTokens ?? 0, MIN_ANSWER_TOKENS),
    contextTokens - promptTokens - CONTEXT_MARGIN_TOKENS,
  );
  if (String(preset?.provider ?? '').toLowerCase() === 'aihorde') {
    answerTokens = Math.min(answerTokens, AI_HORDE_MAX_ANSWER_TOKENS);
  }
  if (answerTokens < MIN_USABLE_ANSWER_TOKENS) {
    throw new Error(
      "This preset's context is too small for the idea and world together. Shorten the idea, pick no lorebook, or use a preset with a larger context.",
    );
  }
  const options = {
    ...settings,
    maxTokens: answerTokens,
    // AI Horde reads maxContextLength; KoboldCpp and Ollama read maxContextTokens.
    maxContextTokens: contextTokens,
    maxContextLength: contextTokens,
    signal,
  };
  // A small context or AI Horde leaves less room than a full card takes, so the card is asked to
  // be shorter rather than cut off.
  const wordLimit =
    answerTokens < MIN_ANSWER_TOKENS ? Math.floor(answerTokens * WORDS_PER_ANSWER_TOKEN) : 0;
  const { system, user } = buildGeneratorPrompt({ idea, name, world, wordLimit });

  // One more try when the answer isn't JSON or leaves out the name or description.
  let character = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await provider.generate(system, user, options);
    const parsed = parseCharacter(result?.content);
    character = parsed && (name || text(parsed.name)) && text(parsed.description) ? parsed : null;
    if (character) break;
  }
  if (!character) {
    throw new Error(
      wordLimit
        ? "The generator's answer wasn't the JSON it was asked for, or was cut off. Try again, or use a preset with a larger context."
        : "The generator's answer wasn't the JSON it was asked for. Try again.",
    );
  }
  return generatedCard(character, { creatorNotes: 'Generated in Writers Guild.', name });
}

/** The card fields the reader can edit before a generated card is saved. */
export const EDITABLE_FIELDS = [
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
];

const APPEARANCE_LABELS = {
  age_range: 'Age',
  build: 'Build',
  hair: 'Hair',
  eyes: 'Eyes',
  clothing: 'Clothing',
  distinguishing_marks: 'Distinguishing marks',
};

/** A card's appearance details as a paragraph for its description, or empty when it has none. */
export function appearanceText(appearance) {
  const lines = APPEARANCE_FIELDS.filter((field) => text(appearance?.[field])).map(
    (field) => `${APPEARANCE_LABELS[field]}: ${text(appearance[field])}`,
  );
  return lines.length > 0 ? ['Appearance:', ...lines].join('\n') : '';
}

/**
 * A generated card as the reader left it, rebuilt from its known fields so nothing else a
 * request carries is saved. Its appearance details are added to the end of the description too, so
 * stories and chats, which read the description, know what the character looks like.
 */
export function cardToSave(card) {
  const data = card?.data;
  if (!data || typeof data !== 'object') {
    throw new Error('A card is required');
  }
  const fields = Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, text(data[field])]));
  if (!fields.name) {
    throw new Error('Character name is required');
  }
  for (const [field, value] of Object.entries(fields)) {
    if (value.length > MAX_CARD_FIELD_CHARACTERS) {
      throw new Error(`${field} must be at most ${MAX_CARD_FIELD_CHARACTERS} characters`);
    }
  }
  const source = data.extensions?.bureau_appearance ?? {};
  const appearance = Object.fromEntries(
    APPEARANCE_FIELDS.map((field) => [field, text(source[field]).slice(0, 500)]),
  );
  const description = [fields.description, appearanceText(appearance)].filter(Boolean).join('\n\n');
  if (description.length > MAX_CARD_FIELD_CHARACTERS) {
    throw new Error(
      `description with its appearance must be at most ${MAX_CARD_FIELD_CHARACTERS} characters`,
    );
  }
  return generatedCard(
    {
      ...fields,
      description,
      first_message: fields.first_mes,
      example_dialogue: fields.mes_example,
      tags: Array.isArray(data.tags)
        ? data.tags
            .filter((tag) => typeof tag === 'string')
            .map((tag) => tag.slice(0, 100))
            .slice(0, MAX_TAGS)
        : [],
      appearance,
    },
    { creatorNotes: 'Generated in Writers Guild.' },
  );
}
