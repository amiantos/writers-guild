/**
 * Greetings
 *
 * The first message and alternate greetings on a character's card, offered to open a chapter as
 * story mode offers them for a new story (see "Composer" in docs/bureau-design.md). A greeting
 * gets the same {{user}}/{{char}} and macro replacement as card text in the Writer's prompt, with
 * the reader's character as {{user}}.
 */

import { MacroProcessor } from '../macro-processor.js';
import { PromptBuilder } from '../prompt-builder.js';

// PromptBuilder is story mode's, reused here only for its {{user}}/{{char}} replacement.
const placeholders = new PromptBuilder();

function nameOf(member) {
  return member.seedCard?.data?.name || member.name;
}

/**
 * The greetings on a cast member's card, ready to use as chapter text. Index 0 is the first
 * message, and alternate greetings count up from 1. Empty ones are skipped without renumbering.
 *
 * @param {Object} member - A cast member, with their seed card.
 * @param {string|null} readerName - The reader's character's name, for {{user}}.
 * @returns {Array<{ castId: string, name: string, index: number, label: string, content: string }>}
 */
export function greetingsFor(member, readerName) {
  const card = member.seedCard;
  const data = card?.data ?? {};
  const name = nameOf(member);
  const macros = new MacroProcessor({ userName: readerName || 'User', charName: name });
  const reader = readerName ? { name: readerName } : null;
  const alternates = Array.isArray(data.alternate_greetings) ? data.alternate_greetings : [];

  return [data.first_mes, ...alternates]
    .map((text, index) => {
      if (typeof text !== 'string') return null;
      const replaced = placeholders.replacePlaceholders(text.replace(/\r\n?/g, '\n'), card, reader);
      return {
        castId: member.id,
        name,
        index,
        label: index === 0 ? 'First message' : `Alternate greeting ${index}`,
        // Like generated prose, a chapter never uses asterisks for actions.
        content: macros.process(replaced).replace(/\*/g, '').trim(),
      };
    })
    .filter((greeting) => greeting?.content);
}

/**
 * The greetings a chapter can open with: those on the cards of everyone in it but the reader's
 * character, in cast order. A greeting speaks to the reader's character, who fills in {{user}}.
 *
 * @param {Array<Object>} cast - The chapter's cast members, with seed cards.
 * @returns {Array<Object>} See greetingsFor.
 */
export function listGreetings(cast) {
  const reader = cast.find((member) => member.isPersona) ?? null;
  const readerName = reader ? nameOf(reader) : null;
  return cast
    .filter((member) => member !== reader)
    .flatMap((member) => greetingsFor(member, readerName));
}
