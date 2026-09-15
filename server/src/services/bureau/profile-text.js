/**
 * Profile Text
 *
 * A cast member's card as the Director, the Archivist, and offscreen life read it: whole, with
 * {{user}} and {{char}} as names and images as short labels. The Writer and replies build their own,
 * since the Writer keeps images as markers it can write back.
 */

import { MacroProcessor } from '../macro-processor.js';
import { PromptBuilder } from '../prompt-builder.js';
import { labelImages } from './images.js';

// PromptBuilder is story mode's, reused here only for its {{user}}/{{char}} replacement.
const placeholders = new PromptBuilder();

function nameOf(member) {
  return member.seedCard?.data?.name || member.name;
}

/**
 * Text from a cast member's card, ready for a prompt.
 * @param {string} text
 * @param {Object} member - Whose card it is, with their seed card.
 * @param {string|null} readerName - The reader's character's name, for {{user}}.
 * @returns {string} '' when there's no text.
 */
export function cardText(text, member, readerName) {
  if (typeof text !== 'string' || !text.trim()) return '';
  const macros = new MacroProcessor({ userName: readerName, charName: nameOf(member) });
  const replaced = placeholders.replacePlaceholders(text, member.seedCard, { name: readerName });
  return labelImages(macros.process(replaced).replace(/\*/g, '')).trim();
}

/**
 * A cast member's whole description and personality, as "Description: ..." and
 * "Personality: ..." lines, leaving out either when it's empty.
 * @param {Object} member - With their seed card.
 * @param {string|null} readerName - The reader's character's name, for {{user}}.
 * @returns {string[]}
 */
export function profileLines(member, readerName) {
  const data = member.seedCard?.data ?? {};
  const lines = [];
  const description = cardText(data.description, member, readerName);
  if (description) lines.push(`Description: ${description}`);
  const personality = cardText(data.personality, member, readerName);
  if (personality) lines.push(`Personality: ${personality}`);
  return lines;
}

/**
 * Text written for the whole Bureau, such as an established fact, with {{user}} as the reader's
 * character.
 * @param {string} text
 * @param {string|null} readerName
 */
export function bureauText(text, readerName) {
  if (typeof text !== 'string') return '';
  return new MacroProcessor({ userName: readerName }).process(text).replace(/\*/g, '').trim();
}
