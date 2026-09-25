/**
 * Chat Prompt
 *
 * Builds chat mode's prompts from a preset's chatSystemPrompt and chatReply
 * templates (or the defaults), in the system + user shape every provider
 * takes. The conversation reaches the model as a labeled transcript in the
 * user prompt, as Bureau correspondence does, so text-completion backends work
 * the same as chat APIs.
 *
 * A reply is one or more text messages from one character, separated in the
 * model's output by a line holding only `---`.
 */

import {
  DEFAULT_CHAT_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_PROMPT_TEMPLATES,
} from '../default-presets.js';
import { MacroProcessor } from '../macro-processor.js';
import { PromptBuilder } from '../prompt-builder.js';
import { TemplateEngine } from '../template-engine.js';
import { labelImages } from '../bureau/images.js';

export const MESSAGE_SEPARATOR = '---';
export const MAX_REPLY_MESSAGES = 6;
// Formatting and safety margin, as story mode reserves.
const PROMPT_OVERHEAD_TOKENS = 100;
const CHARS_PER_TOKEN = 3;
// The shortest conversation budget, so a tight context still sends the latest messages.
const MIN_CONVERSATION_CHARS = 1000;

const SEPARATOR_LINE = /^[ \t]*---[ \t]*$/m;
const CONVERSATION_MARKER = '\u0000CONVERSATION\u0000';

// PromptBuilder is story mode's, reused for its {{user}}/{{char}} replacement and token estimate.
const placeholders = new PromptBuilder();
const templates = new TemplateEngine();

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripAsterisks(text) {
  return text.replace(/\*/g, '');
}

/** "Layla", "Layla and Sam", "Layla, Sam, and Ada" */
export function joinNames(names) {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

function nameOf(card) {
  return card?.data?.name || card?.name || 'Character';
}

/**
 * Who writes next when nobody was named: a character the user's message mentions by name
 * (the earliest mention wins), otherwise whoever spoke last, otherwise the first character.
 *
 * @param {Array<{id: string, data: Object}>} characters - The chat's characters, in order.
 * @param {Array<Object>} turns - The chat's turns, oldest first.
 * @returns {Object|null} The character card, or null when the chat has none.
 */
export function pickSpeaker(characters, turns) {
  if (characters.length <= 1) return characters[0] ?? null;

  const last = turns.at(-1);
  if (last?.source === 'user') {
    const text = last.messages.join('\n');
    let earliest = null;
    for (const character of characters) {
      const names = [...new Set([nameOf(character), nameOf(character).split(/\s+/)[0]])];
      const pattern = new RegExp(`\\b(?:${names.map(escapeRegExp).join('|')})\\b`, 'i');
      const match = pattern.exec(text);
      if (match && (!earliest || match.index < earliest.index)) {
        earliest = { index: match.index, character };
      }
    }
    if (earliest) return earliest.character;
  }

  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const speaker = characters.find((character) => character.id === turns[i].characterId);
    if (turns[i].source === 'character' && speaker) return speaker;
  }
  return characters[0];
}

/**
 * Split a reply into messages at separator lines. A leading "Name:" label the model adds is
 * dropped, and the reply is cut where the model starts writing someone else's messages.
 * Extra messages past the limit join the last one.
 *
 * @param {string} text
 * @param {string} name - The sender's name.
 * @param {string[]} [otherNames] - Everyone else in the chat.
 * @returns {string[]}
 */
export function splitReply(text, name, otherNames = []) {
  const variantsOf = (names) => names.flatMap((n) => [n, n.split(/\s+/)[0]]).filter(Boolean);
  const labelSource = (variants) =>
    variants.length > 0
      ? `[ \\t]*(?:${variants.map(escapeRegExp).join('|')})[ \\t]*:[ \\t]*`
      : null;
  // A name the sender shares, like another Layla's first name, is the sender's own label.
  const ownVariants = [...new Set(variantsOf([name]))];
  const ownKeys = new Set(ownVariants.map((variant) => variant.toLowerCase()));
  const otherVariants = [...new Set(variantsOf(otherNames))].filter(
    (variant) => !ownKeys.has(variant.toLowerCase()),
  );
  const own = labelSource(ownVariants);
  const others = labelSource(otherVariants);

  let body = stripAsterisks(text);
  if (others) {
    const otherLabel = new RegExp(`^${others}`, 'i');
    const lines = body.split('\n');
    const cut = lines.findIndex((line) => otherLabel.test(line));
    if (cut !== -1) body = lines.slice(0, cut).join('\n');
  }

  // A line starting with the sender's own label starts another message, as a separator would.
  const ownLabel = own ? new RegExp(`^${own}`, 'i') : null;
  const ownLabelLine = own ? new RegExp(`\\n(?=${own})`, 'i') : null;
  const parts = body
    .split(SEPARATOR_LINE)
    .flatMap((part) => (ownLabelLine ? part.split(ownLabelLine) : [part]))
    .map((part) => (ownLabel ? part.trim().replace(ownLabel, '') : part).trim())
    .filter(Boolean);
  if (parts.length <= MAX_REPLY_MESSAGES) return parts;
  return [
    ...parts.slice(0, MAX_REPLY_MESSAGES - 1),
    parts.slice(MAX_REPLY_MESSAGES - 1).join('\n\n'),
  ];
}

/** Transcript lines for turns, oldest first: "Name: message" per message. */
function transcriptLines(turns, nameForTurn) {
  return turns.map((turn) =>
    turn.messages.map((message) => `${nameForTurn(turn)}: ${labelImages(message)}`).join('\n'),
  );
}

/**
 * The latest turns that fit the budget. The last one is always kept; when it alone is over the
 * budget, it keeps its sender's label and its end, as the conversation's most recent words.
 */
function latestThatFit(lines, budget) {
  let size = 0;
  let start = lines.length;
  while (start > 0) {
    const lineSize = lines[start - 1].length + 1;
    if (size + lineSize > budget && start < lines.length) break;
    size += lineSize;
    start -= 1;
  }
  const kept = lines.slice(start);
  const last = kept.at(-1);
  if (kept.length === 1 && last.length > budget) {
    const labelEnd = last.indexOf(': ') + 2;
    const label = last.slice(0, labelEnd);
    kept[0] = `${label}...${last.slice(-(budget - label.length - 3))}`;
    return { kept, truncated: true };
  }
  return { kept, truncated: start > 0 };
}

/**
 * Build the prompts for a character's next reply.
 *
 * @param {Object} params
 * @param {Object} params.chat - Uses scenario.
 * @param {Object} params.speaker - The character card writing, with its id.
 * @param {Array<Object>} params.characters - Every character card in the chat, in order.
 * @param {Object|null} params.persona - The user's character card, if the chat has one.
 * @param {Array<Object>} params.turns - The turns before this reply, oldest first.
 * @param {Array<{content: string, comment?: string}>} [params.loreEntries] - Activated entries.
 * @param {Object} params.preset - Uses promptTemplates and generationSettings.
 * @param {number} params.maxContextTokens
 * @param {boolean} [params.primeSpeaker] - End the user prompt with the speaker's label, for
 *   text-completion backends that continue the prompt rather than answer it.
 * @returns {{ system: string, user: string }}
 */
export function buildChatPrompts({
  chat,
  speaker,
  characters,
  persona,
  turns,
  loreEntries = [],
  preset,
  maxContextTokens,
  primeSpeaker = false,
}) {
  const settings = preset.generationSettings ?? {};
  const promptTemplates = preset.promptTemplates ?? {};
  const speakerName = nameOf(speaker);
  const userName = persona ? nameOf(persona) : 'User';
  const personaForPlaceholders = { name: userName };
  const isGroup = characters.length > 1;

  const text = (value, card) => {
    if (!value) return '';
    const macros = new MacroProcessor({ userName, charName: nameOf(card) });
    return labelImages(
      stripAsterisks(
        macros.process(placeholders.replacePlaceholders(value, card, personaForPlaceholders)),
      ),
    ).trim();
  };

  const scenario = text(chat.scenario, speaker);
  const systemData = {
    user: userName,
    char: speakerName,
    is_group: isGroup,
    character_names: joinNames(characters.map(nameOf)),
    participant_names: joinNames([userName, ...characters.map(nameOf)]),
    has_chat_scenario: Boolean(scenario),
    chat_scenario: scenario,
    characters: characters.map((card) => ({
      name: nameOf(card),
      description: text(card.data?.description, card),
      personality: text(card.data?.personality, card),
      scenario: text(card.data?.scenario, card),
      mes_example: settings.includeDialogueExamples ? text(card.data?.mes_example, card) : '',
    })),
    has_persona: Boolean(persona),
    persona: persona
      ? {
          name: userName,
          description: text(persona.data?.description, speaker),
          personality: text(persona.data?.personality, speaker),
        }
      : null,
    has_lorebook: loreEntries.length > 0,
    lorebook_entries: loreEntries.map((entry) => ({
      content: text(entry.content, speaker),
      comment: entry.comment || '',
    })),
  };
  const system = templates
    .render(promptTemplates.chatSystemPrompt ?? DEFAULT_CHAT_SYSTEM_PROMPT_TEMPLATE, systemData)
    .trim();

  const last = turns.at(-1);
  const replyData = {
    char: speakerName,
    user: userName,
    is_group: isGroup,
    is_first_message: !last,
    is_reply: Boolean(last) && !(last.source === 'character' && last.characterId === speaker.id),
    is_follow_up: last?.source === 'character' && last.characterId === speaker.id,
    conversation: CONVERSATION_MARKER,
  };
  const replyTemplate = promptTemplates.chatReply ?? DEFAULT_PROMPT_TEMPLATES.chatReply;
  const instruction = templates.render(replyTemplate, replyData).trim();

  // The conversation gets what's left of the context after the prompts and the reply.
  const maxTokens = settings.maxTokens || 4000;
  const available =
    maxContextTokens -
    placeholders.estimateTokens(system) -
    placeholders.estimateTokens(instruction) -
    maxTokens -
    PROMPT_OVERHEAD_TOKENS;
  const budget = Math.max(MIN_CONVERSATION_CHARS, available * CHARS_PER_TOKEN);

  const nameById = new Map(characters.map((card) => [card.id, nameOf(card)]));
  const nameForTurn = (turn) =>
    turn.source === 'user'
      ? turn.senderName || userName
      : nameById.get(turn.characterId) || turn.senderName || 'Character';
  const { kept, truncated } = latestThatFit(transcriptLines(turns, nameForTurn), budget);
  const conversation =
    [...(truncated ? ['(Earlier messages are omitted.)'] : []), ...kept].join('\n') ||
    '(No messages yet.)';

  let user = instruction.includes(CONVERSATION_MARKER)
    ? instruction.replace(CONVERSATION_MARKER, () => conversation)
    : `=== CONVERSATION ===\n${conversation}\n\n=== NOW ===\n${instruction}`;
  if (primeSpeaker) {
    user += `\n\n${speakerName}:`;
  }

  return { system, user };
}
