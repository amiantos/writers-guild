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
// Lorebook entries named in the prompt at most.
const WORLD_ENTRIES = 12;
// Characters of each lorebook entry's content shown in the prompt at most.
const WORLD_ENTRY_CHARACTERS = 300;
// The longest idea, name, or edited card field accepted.
export const MAX_IDEA_CHARACTERS = 4000;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;
}

function section(title, body) {
  return `=== ${title} ===\n${body}`;
}

/** Short notes about a lorebook's world: its name, and a line per enabled entry with keys. */
export function lorebookWorld(lorebook) {
  if (!lorebook) return [];
  const entries = (lorebook.entries ?? [])
    .filter((entry) => entry.enabled !== false && entry.keys?.length > 0)
    .slice(0, WORLD_ENTRIES)
    .map((entry) => {
      const content = text(entry.content);
      return content
        ? `${entry.keys[0]}: ${truncate(content.replace(/\s+/g, ' '), WORLD_ENTRY_CHARACTERS)}`
        : entry.keys[0];
    });
  const description = text(lorebook.description);
  return [
    description ? `${lorebook.name}: ${truncate(description, WORLD_ENTRY_CHARACTERS)}` : null,
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
  let answerTokens = Math.min(
    Math.max(settings.maxTokens ?? 0, MIN_ANSWER_TOKENS),
    Math.floor(contextTokens / 2),
  );
  if (preset?.provider === 'aihorde') {
    answerTokens = Math.min(answerTokens, AI_HORDE_MAX_ANSWER_TOKENS);
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

  // One more try when the answer isn't JSON or leaves out the name.
  let character = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await provider.generate(system, user, options);
    character = parseCharacter(result?.content);
    if (character && (name || text(character.name))) break;
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

/**
 * A generated card as the reader left it, rebuilt from its known fields so nothing else a
 * request carries is saved.
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
  const appearance = data.extensions?.bureau_appearance ?? {};
  return generatedCard(
    {
      ...fields,
      first_message: fields.first_mes,
      example_dialogue: fields.mes_example,
      tags: Array.isArray(data.tags) ? data.tags.filter((tag) => typeof tag === 'string') : [],
      appearance: Object.fromEntries(
        APPEARANCE_FIELDS.map((field) => [field, text(appearance[field])]),
      ),
    },
    { creatorNotes: 'Generated in Writers Guild.' },
  );
}
