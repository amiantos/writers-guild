/**
 * Writer Prompt
 *
 * Builds the messages for the Writer, the role that produces a story's prose
 * (see "Generation pipeline" in docs/bureau-design.md).
 *
 * The story reaches the model as continuous prose, never as a chat transcript:
 * turns are storage and UI structure only. Direction turns are instructions
 * for the next beat, so they appear in the instructions, not the story text.
 */

import { MacroProcessor } from '../macro-processor.js';
import { PromptBuilder } from '../prompt-builder.js';

export const DEFAULT_HOUSE_STYLE = [
  'Write in a narrative, novel-style format with proper paragraphs and dialogue.',
  'Write in third-person past tense, including dialogue tags.',
  "Give each character's dialogue its own paragraph: when a different character speaks, start a new paragraph.",
  'Show rather than tell, with specific, vivid description and natural dialogue.',
  'Do not use asterisks for actions. Write everything as prose.',
  'Character profiles may be written in another tense or perspective; take facts from them, not style.',
  'Write in the same language as the existing story.',
].join('\n');

// Roughly 100k tokens of story text. The oldest turns are dropped first.
export const STORY_CHARACTER_BUDGET = 300_000;

const SCENE_BREAK = '---';

const BRIEF_LENGTHS = {
  short: 'Write 1 to 3 paragraphs.',
  medium: 'Write 3 to 5 paragraphs.',
  long: 'Write 5 to 8 paragraphs.',
};

const MEMORIES_PREFACE =
  'What the characters remember from before this story. Let it shape what they do and bring up, without reciting it.';

// PromptBuilder is story mode's, reused here only for its {{user}}/{{char}} replacement.
const placeholders = new PromptBuilder();

function section(title, body) {
  return `=== ${title} ===\n${body}`;
}

function stripAsterisks(text) {
  return text.replace(/\*/g, '');
}

/** One character's memories, or '' when they have none. */
function memoryBlock(name, memories) {
  if (!memories) return '';
  const lines = [];
  if (memories.knowledge.length > 0) {
    lines.push(
      `${name} knows:`,
      ...memories.knowledge.map((memory) => `- ${stripAsterisks(memory.content)}`),
    );
  }
  if (memories.episodes.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(
      `${name} remembers from earlier stories:`,
      ...memories.episodes.map(
        (memory) =>
          `- ${memory.sourceTitle ? `${memory.sourceTitle}: ` : ''}${stripAsterisks(memory.content)}`,
      ),
    );
  }
  return lines.join('\n');
}

/** Keep the most recent parts that fit the budget, always keeping at least the last one. */
function fitToBudget(parts, budget) {
  let size = 0;
  let start = parts.length;
  while (start > 0) {
    const partSize = parts[start - 1].length + 2;
    if (size + partSize > budget && start < parts.length) break;
    size += partSize;
    start -= 1;
  }
  return { kept: parts.slice(start), truncated: start > 0 };
}

function instructionFor({ request, readerName, openingTime, hasProse, hasGeneratedProse }) {
  const lines = [];

  if (!hasProse) {
    lines.push(
      'Write the opening of this story: set the scene, bring in the characters naturally, and end at a point that invites what comes next.',
    );
  } else if (request.action === 'write' && readerName) {
    lines.push(
      `Continue the story from where ${readerName} left off. Respond to what ${readerName} just did, and leave ${readerName}'s next words and choices to ${readerName}.`,
    );
    lines.push(
      `${readerName}'s passages may be written in first or second person; write yours in the house style's perspective and refer to ${readerName} by name.`,
    );
  } else if (request.action === 'write') {
    lines.push(
      "Continue the story from the reader's latest passage, responding to what happens in it.",
    );
    lines.push(
      "The reader's passages may be written in first or second person; write yours in the house style's perspective.",
    );
  } else {
    lines.push('Continue the story naturally from where it left off.');
  }

  if (request.action === 'direct' && request.direction) {
    lines.push(`The author wants this to happen next: ${request.direction}`);
  }
  if (request.leadName) {
    lines.push(
      `Center this passage on ${request.leadName}: their thoughts, actions, and dialogue.`,
    );
  }
  if (openingTime && !hasGeneratedProse) {
    lines.push(
      `The story begins on ${openingTime}. Let the time shape the scene without stating an exact hour.`,
    );
  }

  const { brief } = request;
  if (brief) {
    lines.push(
      `Scene brief from the Director:\n${brief.beats.map((beat) => `- ${beat}`).join('\n')}`,
    );
    const details = [
      brief.pov ? `Point of view: ${brief.pov}.` : '',
      brief.tone ? `Tone: ${brief.tone}.` : '',
    ].filter(Boolean);
    if (details.length > 0) lines.push(details.join(' '));
    if (brief.memories?.length > 0) {
      const memories = brief.memories.map(
        (memory) => `- ${memory.content}${memory.reason ? ` (${memory.reason})` : ''}`,
      );
      lines.push(`Keep in mind:\n${memories.join('\n')}`);
    }
    if (brief.notes) lines.push(`Notes: ${brief.notes}`);
  }

  if (brief && BRIEF_LENGTHS[brief.length]) {
    lines.push(BRIEF_LENGTHS[brief.length]);
  } else {
    lines.push(
      hasProse
        ? 'Write the next 3 to 6 paragraphs, fewer if a natural pause invites a response.'
        : 'Write 3 to 5 paragraphs.',
    );
  }
  return lines.join('\n');
}

/**
 * Build the Writer's messages for the next generated turn.
 *
 * @param {Object} params
 * @param {Object} params.bureau - Uses houseStyle.
 * @param {Array<Object>} params.cast - Cast members, each with seedCard and isPersona.
 * @param {Array<{content: string}>} [params.loreEntries] - Lorebook entries already activated.
 * @param {Map<string, {knowledge: Array<Object>, episodes: Array<Object>}>} [params.memoriesByCast] -
 *   What each character remembers from before this story, by cast member id (see memory.js).
 * @param {Map<string, Array<{content: string}>>} [params.arcNotesByCast] - Accepted arc notes
 *   from before this story, by cast member id: how each character has changed.
 * @param {Array<Object>} params.turns - The story's turns in order, including any turn just
 *   added from the composer. Uses kind, source, and content.
 * @param {Object} params.request
 * @param {'write'|'direct'|'continue'} params.request.action
 * @param {string} [params.request.direction] - The direction text, for 'direct'.
 * @param {string} [params.request.leadName] - Cast member to center the passage on.
 * @param {Object|null} [params.request.brief] - The Director's scene brief (see director.js).
 * @param {string|null} [params.openingTime] - Loose start-time description; used until the
 *   story has generated prose.
 * @param {number|null} [params.settingYear] - The year to name as setting, for a story set in
 *   another year (see settingYear in bureau-time.js).
 * @param {import('../image-preserver.js').ImagePreserver|null} [params.imagePreserver] - Swaps
 *   image markup for placeholders the model can reproduce.
 * @param {number} [params.storyCharacterBudget]
 * @returns {{ messages: Array<{role: string, content: string}>, storyTruncated: boolean,
 *   storySection: string }} storySection is the story text exactly as placed in the prompt.
 */
export function buildWriterMessages({
  bureau,
  cast,
  loreEntries = [],
  memoriesByCast = new Map(),
  arcNotesByCast = new Map(),
  turns,
  request,
  openingTime = null,
  settingYear = null,
  imagePreserver = null,
  storyCharacterBudget = STORY_CHARACTER_BUDGET,
}) {
  const persona = cast.find((member) => member.isPersona) ?? null;
  // A Bureau has one reader's character. Anyone else still marked as one is described as a
  // character rather than dropped.
  const characters = cast.filter((member) => member !== persona);
  const personaInfo = persona ? { name: persona.seedCard?.data?.name || persona.name } : null;
  const userName = personaInfo?.name || 'User';
  const macros = new MacroProcessor({
    userName,
    charName: characters[0]?.name || 'Character',
  });

  const preserve = (text, source) =>
    imagePreserver ? imagePreserver.preserve(text, source) : text;

  const prepareCardText = (text, card) => {
    if (!text) return '';
    const replaced = placeholders.replacePlaceholders(text, card, personaInfo);
    return preserve(stripAsterisks(macros.process(replaced)), 'cast');
  };

  const profile = (member) => {
    const card = member.seedCard;
    const data = card?.data ?? {};
    const lines = [`Name: ${data.name || member.name}`];
    const description = prepareCardText(data.description, card);
    if (description) lines.push(`Description: ${description}`);
    const personality = prepareCardText(data.personality, card);
    if (personality) lines.push(`Personality: ${personality}`);
    const notes = arcNotesByCast.get(member.id) ?? [];
    if (notes.length > 0) {
      const changes = notes.map((note) => `- ${stripAsterisks(note.content)}`);
      lines.push(`How ${data.name || member.name} has changed:\n${changes.join('\n')}`);
    }
    return lines.join('\n');
  };

  const system = [
    'You are the Writer for an ongoing story. Write only the next passage of the story itself, with no titles, notes, or commentary.',
    section('HOUSE STYLE', bureau.houseStyle?.trim() || DEFAULT_HOUSE_STYLE),
  ];
  if (characters.length > 0) {
    system.push(section('CHARACTERS', characters.map(profile).join('\n\n---\n\n')));
  }
  if (persona) {
    system.push(section(`${userName.toUpperCase()} (THE READER'S CHARACTER)`, profile(persona)));
  }
  const remembered = characters
    .map((member) =>
      memoryBlock(member.seedCard?.data?.name || member.name, memoriesByCast.get(member.id)),
    )
    .filter(Boolean);
  if (remembered.length > 0) {
    system.push(section('MEMORIES', [MEMORIES_PREFACE, ...remembered].join('\n\n')));
  }
  const lore = loreEntries
    .map((entry) =>
      entry.content ? preserve(stripAsterisks(macros.process(entry.content)), 'lore') : '',
    )
    .filter(Boolean);
  if (settingYear) {
    lore.unshift(`The year is ${settingYear}.`);
  }
  if (lore.length > 0) {
    system.push(section('WORLD', lore.join('\n\n')));
  }

  const storyTurns = turns.filter((turn) => turn.kind === 'prose' || turn.kind === 'scene_break');
  const parts = storyTurns.map((turn) =>
    turn.kind === 'scene_break' ? SCENE_BREAK : turn.content,
  );
  const { kept, truncated } = fitToBudget(parts, storyCharacterBudget);
  let storyText = kept.join('\n\n');
  if (truncated) {
    storyText = `[Earlier parts of the story are omitted.]\n\n${storyText}`;
  }

  const hasProse = storyTurns.some((turn) => turn.kind === 'prose');
  const instruction = instructionFor({
    request,
    readerName: personaInfo?.name ?? null,
    openingTime,
    hasProse,
    hasGeneratedProse: storyTurns.some(
      (turn) => turn.kind === 'prose' && turn.source === 'generated',
    ),
  });

  const storySection = storyText ? preserve(storyText, 'story') : '(Nothing has been written yet.)';

  return {
    storySection,
    messages: [
      { role: 'system', content: system.join('\n\n') },
      {
        role: 'user',
        content: [section('STORY SO FAR', storySection), section('NEXT', instruction)].join('\n\n'),
      },
    ],
    storyTruncated: truncated,
  };
}
