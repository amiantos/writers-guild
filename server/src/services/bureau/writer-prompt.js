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

// PromptBuilder is story mode's, reused here only for its {{user}}/{{char}} replacement.
const placeholders = new PromptBuilder();

function section(title, body) {
  return `=== ${title} ===\n${body}`;
}

function stripAsterisks(text) {
  return text.replace(/\*/g, '');
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

function instructionFor({ request, userName, openingTime, hasProse, hasGeneratedProse }) {
  const lines = [];

  if (!hasProse) {
    lines.push(
      'Write the opening of this story: set the scene, bring in the characters naturally, and end at a point that invites what comes next.',
    );
  } else if (request.action === 'write') {
    lines.push(
      `Continue the story from where ${userName} left off. Respond to what ${userName} just did, and leave ${userName}'s next words and choices to ${userName}.`,
    );
    lines.push(
      `${userName}'s passages may be written in first or second person; write yours in the house style's perspective and refer to ${userName} by name.`,
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

  lines.push(
    hasProse
      ? 'Write the next 3 to 6 paragraphs, fewer if a natural pause invites a response.'
      : 'Write 3 to 5 paragraphs.',
  );
  return lines.join('\n');
}

/**
 * Build the Writer's messages for the next generated turn.
 *
 * @param {Object} params
 * @param {Object} params.bureau - Uses houseStyle.
 * @param {Array<Object>} params.cast - Cast members, each with seedCard and isPersona.
 * @param {Array<{content: string}>} [params.loreEntries] - Lorebook entries already activated.
 * @param {Array<Object>} params.turns - The story's turns in order, including any turn just
 *   added from the composer. Uses kind, source, and content.
 * @param {Object} params.request
 * @param {'write'|'direct'|'continue'} params.request.action
 * @param {string} [params.request.direction] - The direction text, for 'direct'.
 * @param {string} [params.request.leadName] - Cast member to center the passage on.
 * @param {string|null} [params.openingTime] - Loose start-time description; used until the
 *   story has generated prose.
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
  turns,
  request,
  openingTime = null,
  imagePreserver = null,
  storyCharacterBudget = STORY_CHARACTER_BUDGET,
}) {
  const persona = cast.find((member) => member.isPersona) ?? null;
  const characters = cast.filter((member) => !member.isPersona);
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
  const lore = loreEntries
    .map((entry) =>
      entry.content ? preserve(stripAsterisks(macros.process(entry.content)), 'lore') : '',
    )
    .filter(Boolean);
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
    userName,
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
