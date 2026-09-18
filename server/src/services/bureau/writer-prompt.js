/**
 * Writer Prompt
 *
 * Builds the messages for the Writer, the role that produces a chapter's prose (see "Generation
 * pipeline" in docs/bureau-design.md).
 *
 * The prompts are story mode's own: its PromptBuilder renders the default system prompt and the
 * default template for the matching story mode button, so a chapter reads like a story written in
 * story mode. What Bureau adds is continuity: established facts, how the characters have changed,
 * what they remember, and the chapter's time, in sections placed before story mode's instructions.
 *
 * The story reaches the model as continuous prose, never as a chat transcript: turns are storage
 * and UI structure only. Directions reach the Writer as story mode's "Continue with Instruction"
 * does, so they're never part of the story text.
 */

import { DEFAULT_PROMPT_TEMPLATES } from '../default-presets.js';
import { MacroProcessor } from '../macro-processor.js';
import { PromptBuilder } from '../prompt-builder.js';
import { chapterTime, describeBureauTime, describeTimePassing } from './bureau-time.js';

// DeepSeek V4.1 Flash's 1M-token context, budgeted the way story mode's buildPrompts does.
export const MAX_CONTEXT_TOKENS = 1_000_000;
const PROMPT_OVERHEAD_TOKENS = 100;
const DEFAULT_MAX_TOKENS = 8000;

const SCENE_BREAK = '---';

// Story mode's instruction template is its continue template plus the sentence that carries the
// direction. A direction that opens a chapter has that sentence follow Start Story's template.
const DIRECTION_SENTENCE = DEFAULT_PROMPT_TEMPLATES.instruction
  .replace(DEFAULT_PROMPT_TEMPLATES.continue, '')
  .trim();

// Turns that are part of the chapter's text. Directions are instructions, so they go in the request.
const CHAPTER_TEXT_KINDS = ['prose', 'scene_break', 'time_passes'];

const KEEP_TO_THE_TIME =
  'Let the time shape the scene without dwelling on the clock, and if anyone mentions the time, keep it consistent with this';

const MEMORIES_PREFACE =
  "What the characters remember from before this chapter, as background for how they act. People seldom talk about the past, so bring it up only when the moment calls for it, and never recite it. When a memory disagrees with a character's profile or an established fact, the profile or fact is right.";

function section(title, body) {
  return `=== ${title} ===\n${body}`;
}

function stripAsterisks(text) {
  return text.replace(/\*/g, '');
}

function nameOf(member) {
  return member.seedCard?.data?.name || member.name;
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
function timeLines({ startTime, turns, timeZone, hasProse }) {
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
 * The story mode template for a request, by the story mode button that does the same thing. Writing
 * a passage and then generating is typing into a story and pressing Continue. A chapter with nothing
 * written yet starts as Start Story does, with any direction added (see DIRECTION_SENTENCE).
 */
export function generationTypeFor(action, hasProse) {
  switch (action) {
    case 'greeting':
      return 'rewriteThirdPerson';
    case 'direct':
      return hasProse ? 'instruction' : 'storyStarter';
    case 'character':
      return 'character';
    default:
      return hasProse ? 'continue' : 'storyStarter';
  }
}

/** Bureau's sections go before story mode's instructions, or at the end if those aren't found. */
function withContinuity(systemPrompt, sections, instructionsHeader) {
  if (sections.length === 0) return systemPrompt;
  const continuity = sections.join('\n\n');
  const at = systemPrompt.indexOf(instructionsHeader);
  if (at === -1) return `${systemPrompt}\n\n${continuity}`;
  return `${systemPrompt.slice(0, at)}${continuity}\n\n${systemPrompt.slice(at)}`;
}

/**
 * Build the Writer's messages for the next generated turn.
 *
 * @param {Object} params
 * @param {Object} params.bureau - Uses timezone.
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
 * @param {'write'|'direct'|'continue'|'character'|'greeting'} params.request.action
 * @param {string} [params.request.direction] - The direction text, for 'direct'.
 * @param {{ castId: string, name: string }} [params.request.character] - For 'character': who
 *   the next part is written for, as story mode's Continue for Character.
 * @param {{ name: string, content: string }} [params.request.greeting] - For 'greeting': the
 *   greeting from a character card to rewrite as the chapter's opening.
 * @param {string|null} [params.startTime] - When the chapter began (ISO), so the Writer knows
 *   the exact time.
 * @param {string|null} [params.settingYear] - The year to name as setting, for a story set in
 *   another year (see settingYear in bureau-time.js).
 * @param {import('../image-preserver.js').ImagePreserver|null} [params.imagePreserver] - Swaps
 *   image markup for placeholders the model can reproduce.
 * @param {number} [params.maxTokens] - What the Writer may write, reserved from the context.
 * @param {number} [params.storyCharacterBudget] - Characters of story text to keep. By default,
 *   what the context has room for once the system prompt and maxTokens are reserved.
 * @returns {{ messages: Array<{role: string, content: string}>, storyTruncated: boolean,
 *   storySection: string, generationType: string }} storySection is the story text exactly as
 *   placed in the prompt, or '' when there is none.
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
  maxTokens = DEFAULT_MAX_TOKENS,
  storyCharacterBudget = null,
}) {
  const persona = cast.find((member) => member.isPersona) ?? null;
  // A Bureau has one reader's character. Anyone else still marked as one is described as a
  // character rather than dropped.
  const characters = cast.filter((member) => member !== persona);
  const personaData = persona?.seedCard?.data ?? {};
  // Shaped as story mode loads a story's persona, whose personality is its writing style.
  const personaInfo = persona
    ? {
        name: nameOf(persona),
        description: personaData.description || '',
        writingStyle: personaData.personality || '',
      }
    : null;
  // Story mode adds a lone character's scenario, but a card's scenario is where its story starts,
  // such as a first meeting. A chapter goes on from what the characters remember instead.
  const characterCards = characters.map((member) => ({
    ...member.seedCard,
    data: { ...member.seedCard?.data, name: nameOf(member), scenario: '' },
  }));
  const macros = new MacroProcessor({
    userName: personaInfo?.name || 'User',
    charName: characterCards[0]?.data.name || 'Character',
  });

  const builder = new PromptBuilder();
  // processContent reads it, as buildPrompts sets it in story mode.
  builder.imagePreserver = imagePreserver;
  const preserve = (text, source) =>
    imagePreserver ? imagePreserver.preserve(text, source) : text;

  const storyTurns = turns.filter((turn) => CHAPTER_TEXT_KINDS.includes(turn.kind));
  const hasProse = storyTurns.some((turn) => turn.kind === 'prose');
  const generationType = generationTypeFor(request.action, hasProse);

  const systemPrompt = builder.buildSystemPrompt({
    persona: personaInfo,
    characterCards,
    // The setting year goes with the world, as setting rather than a timestamp.
    activatedLorebooks: [
      ...(settingYear ? [{ content: `The year is ${settingYear}.` }] : []),
      ...loreEntries,
    ],
    story: null,
    settings: { includeDialogueExamples: false },
  });

  const continuity = [];
  const establishedFacts = facts
    .map((fact) => stripAsterisks(macros.process(fact.content)).trim())
    .filter(Boolean);
  if (establishedFacts.length > 0) {
    continuity.push(
      section(
        'ESTABLISHED FACTS',
        [
          'True in this story unless the chapter itself shows one changing.',
          ...establishedFacts.map((fact) => `- ${fact}`),
        ].join('\n'),
      ),
    );
  }
  const everyone = [...characters, ...(persona ? [persona] : [])];
  const changes = everyone
    .map((member) => {
      const notes = arcNotesByCast.get(member.id) ?? [];
      if (notes.length === 0) return '';
      const lines = notes.map((note) => `- ${stripAsterisks(note.content)}`);
      return `How ${nameOf(member)} has changed:\n${lines.join('\n')}`;
    })
    .filter(Boolean);
  if (changes.length > 0) {
    continuity.push(section('CHARACTER DEVELOPMENT', changes.join('\n\n')));
  }
  // The reader's character remembers too.
  const remembered = everyone
    .map((member) => memoryBlock(nameOf(member), memoriesByCast.get(member.id)))
    .filter(Boolean);
  if (remembered.length > 0) {
    continuity.push(section('MEMORIES', [MEMORIES_PREFACE, ...remembered].join('\n\n')));
  }
  const time = timeLines({ startTime, turns, timeZone: bureau.timezone, hasProse });
  if (time.length > 0) {
    continuity.push(section('TIME', time.join('\n')));
  }
  const system = withContinuity(
    systemPrompt,
    continuity,
    builder.config.sectionHeaders.instructions,
  );

  // A greeting is rewritten on its own, as story mode rewrites a story that holds only the greeting.
  let storySection = '';
  let truncated = false;
  if (generationType === 'rewriteThirdPerson') {
    storySection = preserve(stripAsterisks(request.greeting?.content ?? ''), 'greeting');
  } else {
    const parts = storyTurns.map((turn) => {
      if (turn.kind === 'scene_break') return SCENE_BREAK;
      if (turn.kind === 'time_passes') {
        return `${SCENE_BREAK}\n\n${describeTimePassing(turn.bureauTime, bureau.timezone)}`;
      }
      return turn.content;
    });
    const budget =
      storyCharacterBudget ??
      Math.max(
        1000,
        (MAX_CONTEXT_TOKENS - builder.estimateTokens(system) - maxTokens - PROMPT_OVERHEAD_TOKENS) *
          3,
      );
    const fitted = fitToBudget(parts, budget);
    truncated = fitted.truncated;
    const storyText = fitted.kept.join('\n\n');
    // Story mode marks a story cut to fit the same way.
    storySection = preserve(truncated ? `...${storyText}` : storyText, 'story');
  }

  // The text is already fitted and preserved, so story mode neither cuts it nor preserves it again.
  // Its preserver still goes in, so a rewrite is told to keep the greeting's image markers.
  const directedOpening = generationType === 'storyStarter' && Boolean(request.direction);
  const user = builder.buildGenerationPrompt(generationType, {
    storyContent: storySection,
    characterName: request.character?.name,
    customInstruction: request.direction,
    templateText: directedOpening
      ? `${DEFAULT_PROMPT_TEMPLATES.storyStarter} ${DIRECTION_SENTENCE}`
      : null,
    maxChars: Math.max(storySection.length, 1),
    userName: personaInfo?.name,
    imagePreserver,
  });

  return {
    storySection,
    generationType,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    storyTruncated: truncated,
  };
}
