/**
 * A story's narrative perspective: who tells it, how much the narrator knows, and in what tense.
 * Shared by the server, which renders it into prompts as {{perspective}}, and the client, which
 * offers the choices in the story's edit modal.
 *
 * A story stores a mode, a tense and a character (the narrator in first person, the viewpoint
 * character in third person limited). Null means the default, which is plain third person in the
 * past tense: the text the default system prompt always had, so existing stories are unchanged.
 */

export const PERSPECTIVE_MODES = [
  { value: 'third', label: 'Third person (Original Default)', short: 'third person' },
  { value: 'third_limited', label: 'Third person limited', character: 'Viewpoint character' },
  { value: 'third_omniscient', label: 'Third person omniscient' },
  { value: 'third_objective', label: 'Third person objective' },
  { value: 'first', label: 'First person', character: 'Narrator' },
  { value: 'second', label: 'Second person' },
];

export const PERSPECTIVE_TENSES = [
  { value: 'past', label: 'Past tense' },
  { value: 'present', label: 'Present tense' },
];

export const DEFAULT_PERSPECTIVE_MODE = 'third';
export const DEFAULT_PERSPECTIVE_TENSE = 'past';

const MODE_VALUES = new Set(PERSPECTIVE_MODES.map((mode) => mode.value));
const TENSE_VALUES = new Set(PERSPECTIVE_TENSES.map((tense) => tense.value));

export function isPerspectiveMode(value) {
  return MODE_VALUES.has(value);
}

export function isPerspectiveTense(value) {
  return TENSE_VALUES.has(value);
}

/** Whether a mode is told from one character's point of view, picked per story. */
export function modeTakesCharacter(mode) {
  return Boolean(PERSPECTIVE_MODES.find((entry) => entry.value === mode)?.character);
}

/** A short description, such as "first person, present tense, narrated by Layla". */
export function describePerspective({ mode, tense, characterName } = {}) {
  const resolvedMode = isPerspectiveMode(mode) ? mode : DEFAULT_PERSPECTIVE_MODE;
  const resolvedTense = isPerspectiveTense(tense) ? tense : DEFAULT_PERSPECTIVE_TENSE;
  const entry = PERSPECTIVE_MODES.find((mode) => mode.value === resolvedMode);
  let description = `${entry.short ?? entry.label.toLowerCase()}, ${resolvedTense} tense`;
  if (characterName && resolvedMode === 'first') description += `, narrated by ${characterName}`;
  if (characterName && resolvedMode === 'third_limited') {
    description += `, following ${characterName}`;
  }
  return description;
}

const TENSE_WORDS = {
  past: { other: 'present', examples: 'said, walked, thought, etc.' },
  present: { other: 'past', examples: 'says, walks, thinks, etc.' },
};

/**
 * The perspective instructions for a prompt.
 *
 * @param {Object} perspective
 * @param {string|null} [perspective.mode] - One of PERSPECTIVE_MODES; null for the default
 * @param {string|null} [perspective.tense] - One of PERSPECTIVE_TENSES; null for the default
 * @param {string} [perspective.characterName] - The narrator or viewpoint character, when the
 *   mode takes one and they're still in the story
 * @param {string} [perspective.personaName] - The story's Persona, who is "you" in second person
 * @returns {string} Lines of instructions, without a trailing newline
 */
export function renderPerspective({ mode, tense, characterName, personaName } = {}) {
  const resolvedMode = isPerspectiveMode(mode) ? mode : DEFAULT_PERSPECTIVE_MODE;
  const t = isPerspectiveTense(tense) ? tense : DEFAULT_PERSPECTIVE_TENSE;
  const { other, examples } = TENSE_WORDS[t];

  const lines = [];
  switch (resolvedMode) {
    case 'first': {
      const narrator = characterName || "the story's main character";
      lines.push(`Write only in first-person ${t} tense perspective, narrated by ${narrator}.`);
      lines.push(
        `Use I/me/my for ${narrator} and he/she/they for everyone else, with ${t} tense verbs (${examples}).`,
      );
      lines.push(
        `Show only what ${narrator} sees, hears, thinks and feels. Other characters' thoughts are known only through what they say and do.`,
      );
      lines.push(`Do NOT narrate ${narrator} in the third person, or use ${other} tense.`);
      break;
    }
    case 'second': {
      const you = personaName || "the reader's character";
      lines.push(`Write only in second-person ${t} tense perspective, addressing ${you} as "you".`);
      lines.push(
        `Use you/your for ${you} and he/she/they for everyone else, with ${t} tense verbs (${examples}).`,
      );
      lines.push(`Do NOT narrate ${you} in the first or third person, or use ${other} tense.`);
      break;
    }
    default: {
      if (resolvedMode === 'third_limited') {
        const focus = characterName || "the story's main character";
        lines.push(
          `Write only in third-person limited ${t} tense perspective, staying close to ${focus}.`,
        );
      } else if (resolvedMode === 'third_omniscient') {
        lines.push(`Write only in third-person omniscient ${t} tense perspective.`);
      } else if (resolvedMode === 'third_objective') {
        lines.push(`Write only in third-person objective ${t} tense perspective.`);
      } else {
        lines.push(`Write only in third-person ${t} tense perspective.`);
      }
      lines.push(`Use he/she/they pronouns and ${t} tense verbs (${examples}).`);
      if (resolvedMode === 'third_limited') {
        const focus = characterName || "the story's main character";
        lines.push(
          `Show only what ${focus} sees, hears, thinks and feels. Other characters' thoughts are known only through what they say and do.`,
        );
      } else if (resolvedMode === 'third_omniscient') {
        lines.push(
          `The narrator knows every character's thoughts and feelings, and may move between them and comment on events.`,
        );
      } else if (resolvedMode === 'third_objective') {
        lines.push(
          `Report only what can be seen and heard. Never state any character's thoughts or feelings; show them through what they say and do.`,
        );
      }
      lines.push(`Do NOT use first-person (I, me, my, we) or ${other} tense.`);
    }
  }

  lines.push(`All narrative and dialogue tags should be in ${t} tense.`);
  lines.push(
    'Aspects of character information, such as their profile or dialog style examples, may be in the incorrect tense. Ignore the tense, focus on the context.',
  );
  return lines.join('\n');
}
