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
import { chapterTime, describeBureauTime, describeTimePassing } from './bureau-time.js';

export const DEFAULT_HOUSE_STYLE = [
  'Write in a narrative, novel-style format with proper paragraphs and dialogue.',
  'Write in third-person past tense, including dialogue tags.',
  "Give each character's dialogue its own paragraph: when a different character speaks, start a new paragraph.",
  'Show rather than tell, with specific, concrete detail and natural dialogue.',
  'Let dialogue sound like real speech: mostly short lines, broken up by action, without characters explaining their feelings or recapping what they both know.',
  'Keep the narration concrete rather than clever: use similes sparingly, and avoid punchy sentence fragments for emphasis.',
  `Keep most sentences short or medium, and vary their length. Don't string clauses together with "and" into long, breathless sentences.`,
  "Don't explain what a look, gesture, or silence means, or call something a character's way of saying a thing: let what people do and say carry it.",
  "Use a character's habits and mannerisms from their profile now and then, not in every passage.",
  'Do not use asterisks for actions. Write everything as prose.',
  'Character profiles and memories may be written in another tense or perspective; take facts from them, not style.',
  'Write in the same language as the existing story.',
].join('\n');

// Roughly 100k tokens of story text. The oldest turns are dropped first.
export const STORY_CHARACTER_BUDGET = 300_000;

const SCENE_BREAK = '---';

// Turns that are part of the chapter's text. Directions are instructions, so they go in NEXT.
const CHAPTER_TEXT_KINDS = ['prose', 'scene_break', 'time_passes'];

const KEEP_TO_THE_TIME =
  'Let the time shape the scene without dwelling on the clock, and if anyone mentions the time, keep it consistent with this';

const BRIEF_LENGTHS = {
  short: 'Write 1 or 2 paragraphs.',
  medium: 'Write 3 or 4 paragraphs.',
  long: 'Write 5 to 7 paragraphs.',
};

const MEMORIES_PREFACE =
  "What the characters remember from before this chapter, as background for how they act. People seldom talk about the past, so bring it up only when the moment calls for it, and never recite it. When a memory disagrees with a character's profile or an established fact, the profile or fact is right.";

// PromptBuilder is story mode's, reused here only for its {{user}}/{{char}} replacement.
const placeholders = new PromptBuilder();

function section(title, body) {
  return `=== ${title} ===\n${body}`;
}

function stripAsterisks(text) {
  return text.replace(/\*/g, '');
}

/** Where an episode happened: a story's title, or messages. */
function episodeLabel(memory) {
  if (memory.sourceTitle) return `${memory.sourceTitle}: `;
  return memory.sourceType === 'correspondence' ? 'In messages: ' : '';
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
      `${name} remembers:`,
      ...memories.episodes.map(
        (memory) => `- ${episodeLabel(memory)}${stripAsterisks(memory.content)}`,
      ),
    );
  }
  if (memories.offscreen) {
    if (lines.length > 0) lines.push('');
    lines.push(`${name} lately: ${stripAsterisks(memories.offscreen.content)}`);
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

/**
 * Where the chapter stands in time: exactly when it began, or when time last passed in it (see
 * chapterTime). Nothing when the start time isn't known.
 */
function timeInstructions({ startTime, turns, timeZone, hasProse }) {
  if (!startTime) return [];
  const { time, passed, justPassed } = chapterTime({ startTime }, turns);
  const exactly = describeBureauTime(time, timeZone);
  if (!hasProse) {
    return [`This chapter begins at exactly ${exactly}.`, `${KEEP_TO_THE_TIME}.`];
  }
  if (justPassed) {
    return [
      `Time has just passed: it's now exactly ${exactly}. Pick the story up at this time.`,
      `${KEEP_TO_THE_TIME}.`,
    ];
  }
  return [
    passed
      ? `When time last passed in the chapter, it was exactly ${exactly}.`
      : `When the chapter began, the time was exactly ${exactly}.`,
    `${KEEP_TO_THE_TIME} and with how much has happened since.`,
  ];
}

/**
 * Rewriting a greeting from a character's card as the chapter's opening, as story mode rewrites a
 * greeting, but with everything else a passage gets.
 */
function greetingInstruction({ greeting, greetingText, readerName, timeLines }) {
  const lines = [
    `Write the opening of this chapter by rewriting ${greeting.name ? `${greeting.name}'s greeting` : 'a greeting'} below in the house style. It comes from a character card and isn't part of the story yet.`,
    `Greeting:\n${greetingText}`,
    'Keep its events, dialogue, and details.',
  ];
  if (/\[WG_IMAGE_\d+\]/.test(greetingText)) {
    lines.push(
      'Keep each image marker, such as [WG_IMAGE_0], exactly as written and where it belongs.',
    );
  }
  lines.push(
    readerName
      ? `Where the greeting says "you", it means ${readerName}: refer to ${readerName} by name, in the house style's perspective.`
      : `Where the greeting says "you", write in the house style's perspective without inventing a name.`,
    ...timeLines,
    "Where the greeting disagrees with the chapter's time or with what the characters know, follow the chapter.",
    'Write about as much as the greeting.',
  );
  return lines.join('\n');
}

function instructionFor({
  request,
  readerName,
  timeLines,
  hasProse,
  hasReaderProse,
  greetingText,
}) {
  if (request.action === 'greeting' && request.greeting) {
    return greetingInstruction({ greeting: request.greeting, greetingText, readerName, timeLines });
  }

  const lines = [];

  // Who wrote the latest passage doesn't matter: every passage continues the story, as in story mode.
  if (!hasProse) {
    lines.push(
      'Write the opening of this chapter: set the scene, bring in the characters naturally, and end at a point that invites what comes next.',
    );
  } else {
    lines.push('Continue the story naturally from where it left off.');
  }
  if (hasReaderProse) {
    lines.push(
      readerName
        ? `Some passages may be written in first or second person; write in the house style's perspective and refer to ${readerName} by name.`
        : "Some passages may be written in first or second person; write in the house style's perspective.",
    );
  }
  if (request.action === 'direct' && request.direction) {
    lines.push(
      `The author's direction for this passage (not part of the story yet): ${request.direction}`,
      'Carry it out in the passage itself: write what it describes as happening.',
    );
  }
  lines.push(...timeLines);

  const { brief } = request;
  if (brief) {
    lines.push(
      `Scene brief from the Director:\n${brief.beats.map((beat) => `- ${beat}`).join('\n')}`,
    );
    if (brief.tone) lines.push(`Tone: ${brief.tone}.`);
    if (brief.memories?.length > 0) {
      const memories = brief.memories.map(
        (memory) => `- ${memory.content}${memory.reason ? ` (${memory.reason})` : ''}`,
      );
      lines.push(`Stay consistent with:\n${memories.join('\n')}`);
    }
    if (brief.notes) lines.push(`Notes: ${brief.notes}`);
  }

  if (brief && BRIEF_LENGTHS[brief.length]) {
    lines.push(BRIEF_LENGTHS[brief.length]);
  } else {
    lines.push(
      hasProse
        ? 'Write as much as the moment needs, usually 2 to 4 paragraphs. A quick exchange or a reaction can be a single paragraph: stop rather than pad.'
        : 'Write 3 to 5 paragraphs.',
    );
  }
  if (hasProse) {
    lines.push(
      "Pick up right where the last passage stopped and stay in that moment: don't skip ahead to later in the day or to another day, or bring in a new secret, twist, or trouble, unless the instructions above ask for it.",
      "Keep the scene moving: don't reuse an action, gesture, image, or turn of phrase from earlier in the chapter unless something new comes of it or the instructions above ask for it.",
      "Don't let characters repeat themselves: no one restates a point, a figure, or a line already said in the chapter, or talks through plans and facts everyone in the scene already knows.",
      'End where the moment naturally pauses, on what someone does or says, not on a line that sums the moment up or hints at what comes next.',
      'The chapter so far is the story, not a model for the prose: write this passage fresh in the house style, even where earlier passages drifted from it.',
    );
  }
  return lines.join('\n');
}

/**
 * Build the Writer's messages for the next generated turn.
 *
 * @param {Object} params
 * @param {Object} params.bureau - Uses houseStyle and timezone.
 * @param {Array<Object>} params.cast - Cast members, each with seedCard and isPersona.
 * @param {Array<{content: string}>} [params.loreEntries] - Lorebook entries already activated.
 * @param {Map<string, {knowledge: Array<Object>, episodes: Array<Object>}>} [params.memoriesByCast] -
 *   What each character remembers from before this story, by cast member id (see memory.js).
 * @param {Map<string, Array<{content: string}>>} [params.arcNotesByCast] - Accepted arc notes
 *   from before this story, by cast member id: how each character has changed.
 * @param {Array<{content: string}>} [params.facts] - Established facts the story can see (see
 *   factsAsOf in memory.js).
 * @param {Array<Object>} params.turns - The story's turns in order, including any turn just
 *   added from the composer. Uses kind, source, content, and bureauTime.
 * @param {Object} params.request
 * @param {'write'|'direct'|'continue'|'greeting'} params.request.action
 * @param {string} [params.request.direction] - The direction text, for 'direct'.
 * @param {{ name: string, content: string }} [params.request.greeting] - For 'greeting': the
 *   greeting from a character card to rewrite as the chapter's opening.
 * @param {Object|null} [params.request.brief] - The Director's scene brief (see director.js).
 * @param {string|null} [params.startTime] - When the chapter began (ISO), so the Writer knows
 *   the exact time.
 * @param {string|null} [params.settingYear] - The year to name as setting, for a story set in
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
  facts = [],
  turns,
  request,
  startTime = null,
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
  const establishedFacts = facts
    .map((fact) => stripAsterisks(macros.process(fact.content)).trim())
    .filter(Boolean);
  if (establishedFacts.length > 0) {
    system.push(
      section(
        'ESTABLISHED FACTS',
        [
          'True in this story unless the chapter itself shows one changing.',
          ...establishedFacts.map((fact) => `- ${fact}`),
        ].join('\n'),
      ),
    );
  }
  // The reader's character remembers too; only what they say and do is left to the reader.
  const remembered = [...characters, ...(persona ? [persona] : [])]
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

  const storyTurns = turns.filter((turn) => CHAPTER_TEXT_KINDS.includes(turn.kind));
  const parts = storyTurns.map((turn) => {
    if (turn.kind === 'scene_break') return SCENE_BREAK;
    if (turn.kind === 'time_passes') {
      return `${SCENE_BREAK}\n\n${describeTimePassing(turn.bureauTime, bureau.timezone)}`;
    }
    return turn.content;
  });
  const { kept, truncated } = fitToBudget(parts, storyCharacterBudget);
  let storyText = kept.join('\n\n');
  if (truncated) {
    storyText = `[Earlier parts of the chapter are omitted.]\n\n${storyText}`;
  }

  const hasProse = storyTurns.some((turn) => turn.kind === 'prose');
  const instruction = instructionFor({
    request,
    readerName: personaInfo?.name ?? null,
    timeLines: timeInstructions({ startTime, turns, timeZone: bureau.timezone, hasProse }),
    hasProse,
    hasReaderProse: storyTurns.some((turn) => turn.kind === 'prose' && turn.source === 'user'),
    // Its images become markers to keep; writer-turn.js puts back any the Writer leaves out.
    greetingText: request.greeting
      ? preserve(stripAsterisks(request.greeting.content), 'greeting')
      : '',
  });

  const storySection = storyText ? preserve(storyText, 'story') : '(Nothing has been written yet.)';

  return {
    storySection,
    messages: [
      { role: 'system', content: system.join('\n\n') },
      {
        role: 'user',
        content: [section('CHAPTER SO FAR', storySection), section('NEXT', instruction)].join(
          '\n\n',
        ),
      },
    ],
    storyTruncated: truncated,
  };
}
