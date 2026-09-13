/**
 * Character Generator
 *
 * Writes a new character card from an idea (see "Character generator" in
 * docs/bureau-design.md) with one forced call to a strict create_character
 * tool. It backs both the standalone flow in a Bureau and the Director's
 * create_character tool. The card fits the Bureau's world and cast, and its
 * appearance block gives portraits a stable description to work from later.
 */

import { RunRecorder } from './run-recorder.js';

export const GENERATOR_MAX_TOKENS = 4000;
export const APPEARANCE_FIELDS = [
  'age_range',
  'build',
  'hair',
  'eyes',
  'clothing',
  'distinguishing_marks',
];

const CAST_DESCRIPTION_CHARACTERS = 240;
const WORLD_ENTRIES = 12;

export const CREATE_CHARACTER_TOOL = {
  name: 'create_character',
  description: 'Write the card for the new character.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "The character's full name." },
      description: {
        type: 'string',
        description:
          'Who they are: background, situation, relationships, and what they want, in the third person. Two to four paragraphs.',
      },
      personality: {
        type: 'string',
        description: 'Temperament, habits, contradictions, and how they talk, in a few sentences.',
      },
      scenario: {
        type: 'string',
        description: 'Where a story finds them, in one or two sentences. Empty if nothing fits.',
      },
      first_message: {
        type: 'string',
        description: 'A short opening passage introducing them, in the third person past tense.',
      },
      example_dialogue: {
        type: 'string',
        description: 'Three or four lines of their dialogue that show their voice.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Three to six short lowercase tags.',
      },
      appearance: {
        type: 'object',
        description: 'Stable details for picturing them. Empty strings where nothing fits.',
        properties: Object.fromEntries(
          APPEARANCE_FIELDS.map((field) => [field, { type: 'string' }]),
        ),
        required: APPEARANCE_FIELDS,
        additionalProperties: false,
      },
    },
    required: [
      'name',
      'description',
      'personality',
      'scenario',
      'first_message',
      'example_dialogue',
      'tags',
      'appearance',
    ],
    additionalProperties: false,
  },
};

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function section(title, body) {
  return `=== ${title} ===\n${body}`;
}

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;
}

/**
 * @param {Object} params
 * @param {string} params.idea - What the reader (or the Director) wants.
 * @param {string} [params.name] - A name the character must have.
 * @param {string} [params.role] - Their part in the current story, for the Director.
 * @param {Array<Object>} params.cast - The Bureau's cast members, with seed cards.
 * @param {string[]} [params.world] - Short notes about the world, such as lorebook topics.
 */
export function buildGeneratorMessages({ idea, name = '', role = '', cast, world = [] }) {
  const system = [
    'You create characters for an ongoing story told in chapters. Call create_character once with a complete card for the character described.',
    'Make them specific and alive: give them wants, habits, and contradictions of their own. Keep them consistent with the world and the existing cast, and never copy or duplicate anyone already in it. Write in the same language as the idea.',
    "The card is about the new character alone. The existing cast is listed only so you don't duplicate anyone: never name or describe anyone from it in any field of the card, and don't give the new character opinions of them or history with them. Later chapters will decide how they meet.",
  ];

  const user = [section('IDEA', idea)];
  if (name) user.push(section('NAME', `The character is named ${name}.`));
  if (role) user.push(section('ROLE IN THE CURRENT CHAPTER', role));
  const castLines = cast.map((member) => {
    const data = member.seedCard?.data ?? {};
    const description = text(data.description);
    const label = data.name || member.name;
    return description
      ? `- ${label}: ${truncate(description, CAST_DESCRIPTION_CHARACTERS)}`
      : `- ${label}`;
  });
  user.push(section('EXISTING CAST', castLines.join('\n') || '(No one yet.)'));
  if (world.length > 0) {
    user.push(section('WORLD', world.map((note) => `- ${note}`).join('\n')));
  }

  return [
    { role: 'system', content: system.join('\n\n') },
    { role: 'user', content: user.join('\n\n') },
  ];
}

/**
 * The V2 card for a generated character.
 * @param {Object} character - create_character's arguments.
 * @param {Object} options
 * @param {string} options.bureauName
 * @param {string} [options.name] - Overrides the generated name.
 */
export function cardFromCharacter(character, { bureauName, name = '' }) {
  const finalName = text(name) || text(character.name);
  if (!finalName) {
    throw new Error('The generated character has no name');
  }
  const appearance = Object.fromEntries(
    APPEARANCE_FIELDS.map((field) => [field, text(character.appearance?.[field])]),
  );
  const tags = (Array.isArray(character.tags) ? character.tags : [])
    .map((tag) => text(tag).toLowerCase())
    .filter(Boolean);

  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: finalName,
      description: text(character.description),
      personality: text(character.personality),
      scenario: text(character.scenario),
      first_mes: text(character.first_message),
      mes_example: text(character.example_dialogue),
      creator_notes: `Generated in the Bureau "${bureauName}".`,
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      character_book: null,
      tags: [...new Set([...tags, 'bureau'])],
      creator: '',
      character_version: '1.0',
      extensions: { bureau_appearance: appearance },
    },
  };
}

/** Short notes about the Bureau's world: each attached lorebook and the topics of its entries. */
async function worldNotes(stores, bureauId) {
  const notes = [];
  for (const lorebookId of stores.bureaus.listLorebookIds(bureauId)) {
    let lorebook;
    try {
      lorebook = await stores.library.getLorebook(lorebookId);
    } catch {
      continue; // Deleted from the library but still attached.
    }
    const topics = (lorebook.entries ?? [])
      .filter((entry) => entry.enabled !== false && entry.keys?.length > 0)
      .slice(0, WORLD_ENTRIES)
      .map((entry) => entry.keys[0]);
    notes.push(topics.length > 0 ? `${lorebook.name}: ${topics.join(', ')}` : lorebook.name);
  }
  return notes;
}

/**
 * Generate a character card for a Bureau.
 *
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {Object} params.bureau
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {string} params.idea
 * @param {string} [params.name] - A name the character must have.
 * @param {string} [params.role] - Their part in the current story.
 * @param {import('./run-recorder.js').RunRecorder} [params.recorder] - Record into this run (the
 *   Director's) instead of a run of its own.
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<{ card: Object, runId: string }>}
 */
export async function generateCharacter({
  stores,
  bureau,
  client,
  idea,
  name = '',
  role = '',
  recorder = null,
  signal,
}) {
  const ownRun = !recorder;
  const run =
    recorder ??
    new RunRecorder(stores.bureaus, { bureauId: bureau.id, purpose: 'generate_character' });

  try {
    const cast = stores.bureaus
      .listCast(bureau.id)
      .map((member) => stores.bureaus.getCastMember(bureau.id, member.id))
      .filter(Boolean);
    const messages = buildGeneratorMessages({
      idea,
      name,
      role,
      cast,
      world: await worldNotes(stores, bureau.id),
    });
    const recordedRequest = {
      model: client.model,
      thinking: false,
      maxTokens: GENERATOR_MAX_TOKENS,
      messages,
    };

    const started = Date.now();
    let response;
    try {
      response = await client.chat({
        messages,
        tools: [CREATE_CHARACTER_TOOL],
        strict: true,
        toolChoice: { name: CREATE_CHARACTER_TOOL.name },
        thinking: false,
        maxTokens: GENERATOR_MAX_TOKENS,
        signal,
      });
    } catch (error) {
      run.recordStep({
        role: 'generator',
        kind: 'model',
        request: recordedRequest,
        error: error.message,
        durationMs: Date.now() - started,
      });
      throw error;
    }
    run.recordStep({
      role: 'generator',
      kind: 'model',
      request: recordedRequest,
      response: { finishReason: response.finishReason, model: response.model },
      toolCalls: response.toolCalls,
      usage: response.usage,
      durationMs: Date.now() - started,
    });

    const call = response.toolCalls.find(
      (toolCall) => toolCall.function?.name === CREATE_CHARACTER_TOOL.name,
    );
    if (!call) {
      throw new Error("The generator didn't return a character");
    }
    let character;
    try {
      character = JSON.parse(call.function.arguments);
    } catch {
      const cutOff = response.finishReason === 'length' ? ' (it ran out of tokens)' : '';
      throw new Error(`The generated character wasn't valid JSON${cutOff}`);
    }

    const card = cardFromCharacter(character, { bureauName: bureau.name, name });
    run.recordStep({
      role: 'generator',
      kind: 'tool',
      request: { id: call.id, name: CREATE_CHARACTER_TOOL.name, arguments: character },
      response: { card },
    });
    if (ownRun) run.complete();
    return { card, runId: run.runId };
  } catch (error) {
    if (ownRun) run.fail(error);
    throw error;
  }
}
