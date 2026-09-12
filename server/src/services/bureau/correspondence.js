/**
 * Correspondence
 *
 * Writes a cast member's messages to the reader's character between stories
 * (see "Correspondence" in docs/bureau-design.md). A reply is one streamed call
 * with the character's profile, their memories as they stand at the Bureau's
 * present, and the conversation so far. The reply is split into messages and
 * saved at the present, which moves Bureau time.
 *
 * Unlike a story, the conversation reaches the model as a labeled transcript:
 * correspondence is a chat.
 */

import { MacroProcessor } from '../macro-processor.js';
import { PromptBuilder } from '../prompt-builder.js';
import { SESSION_GAP_MS, threadSessions } from './archivist.js';
import { bureauPresent, describeBureauTime, describeGap, settingYear } from './bureau-time.js';
import { DeepSeekError } from './deepseek-client.js';
import { memoriesAtTime, notesAtTime, selectForPrompt } from './memory.js';
import { findOffscreenGaps, generateOffscreenLife } from './offscreen.js';
import { RunRecorder } from './run-recorder.js';
import { activatedLore } from './writer-turn.js';

export const DEFAULT_CORRESPONDENCE_STYLE = [
  'Write text messages, the way the character would type them on their phone.',
  'Keep messages short, usually a sentence or two, and send a few short messages rather than one long one.',
  'Write only what they type: no narration, no descriptions of actions, no asterisks, and no quotation marks around messages.',
  "Match the character's voice and mood, and what they're likely doing at this time of day.",
  'Write in the same language as the conversation.',
].join('\n');

// A line with only this on it separates one message from the next in a reply.
export const MESSAGE_SEPARATOR = '---';
export const MAX_REPLY_MESSAGES = 6;
// Messages read from the thread for a reply; the prompt keeps the latest that fit the budget.
export const RECENT_MESSAGES = 200;
export const CONVERSATION_CHARACTER_BUDGET = 60_000;
// Reasoning counts against max_tokens, so thinking mode gets this much room beyond the reply.
export const THINKING_TOKENS = 8000;
// Recent messages scanned for lorebook keywords.
const LORE_SCAN_MESSAGES = 10;

const SEPARATOR_LINE = /^[ \t]*---[ \t]*$/m;

// PromptBuilder is story mode's, reused here only for its {{user}}/{{char}} replacement.
const placeholders = new PromptBuilder();

function nameOf(member) {
  return member.seedCard?.data?.name || member.name;
}

function section(title, body) {
  return `=== ${title} ===\n${body}`;
}

function stripAsterisks(text) {
  return text.replace(/\*/g, '');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Split a reply into messages at separator lines, dropping a leading name label
 * ("Mara:") the model may add. Extra messages past the limit join the last one.
 * @param {string} text
 * @param {string} [name] - The sender's name.
 * @returns {string[]}
 */
export function splitMessages(text, name = '') {
  const names = [...new Set([name, name.split(/\s+/)[0]].filter(Boolean))];
  const label =
    names.length > 0 ? new RegExp(`^(?:${names.map(escapeRegExp).join('|')})\\s*:\\s*`, 'i') : null;
  const parts = text
    .split(SEPARATOR_LINE)
    .map((part) => (label ? part.trim().replace(label, '') : part).trim())
    .filter(Boolean);
  if (parts.length <= MAX_REPLY_MESSAGES) return parts;
  return [
    ...parts.slice(0, MAX_REPLY_MESSAGES - 1),
    parts.slice(MAX_REPLY_MESSAGES - 1).join('\n\n'),
  ];
}

/** One character's memories, or '' when they have none. */
function memoryBlock(name, { knowledge, episodes, offscreen = null }) {
  const lines = [];
  if (knowledge.length > 0) {
    lines.push(
      `${name} knows:`,
      ...knowledge.map((memory) => `- ${stripAsterisks(memory.content)}`),
    );
  }
  if (episodes.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(
      `${name} remembers:`,
      ...episodes.map(
        (memory) =>
          `- ${memory.sourceTitle ? `${memory.sourceTitle}: ` : ''}${stripAsterisks(memory.content)}`,
      ),
    );
  }
  if (offscreen) {
    if (lines.length > 0) lines.push('');
    lines.push(`${name} lately: ${stripAsterisks(offscreen.content)}`);
  }
  return lines.join('\n');
}

/**
 * When the current session of messages began: its first message, or the present
 * when the last message belongs to an earlier session (or there are none).
 */
function sessionStartOf(history, present) {
  const session = threadSessions(history).at(-1);
  if (!session || present.getTime() - Date.parse(session.at(-1).bureauTime) > SESSION_GAP_MS) {
    return present;
  }
  return new Date(Math.min(Date.parse(session[0].bureauTime), present.getTime()));
}

/** The latest messages that fit the budget, always keeping at least the last one. */
function latestThatFit(history, budget) {
  let size = 0;
  let start = history.length;
  while (start > 0) {
    const messageSize = history[start - 1].content.length + 40;
    if (size + messageSize > budget && start < history.length) break;
    size += messageSize;
    start -= 1;
  }
  return { kept: history.slice(start), truncated: start > 0 };
}

/**
 * Build the messages for a cast member's next reply.
 *
 * @param {Object} params
 * @param {Object} params.bureau - Uses timezone, presentOffsetDays, and settings.correspondence.
 * @param {Object} params.member - The cast member writing, with their seed card.
 * @param {Object} params.persona - The reader's character, with their seed card.
 * @param {Array<Object>} params.history - The thread's messages, oldest first.
 * @param {Date} params.present - The Bureau's present.
 * @param {{ knowledge: Array<Object>, episodes: Array<Object> }} [params.memories] - From
 *   selectForPrompt.
 * @param {Array<{content: string}>} [params.arcNotes] - Accepted arc notes as of the present.
 * @param {Array<{content: string}>} [params.loreEntries] - Lorebook entries already activated.
 * @param {Date} [params.now] - Real time, to tell whether the present is in another year.
 * @param {number} [params.characterBudget]
 * @returns {Array<{role: string, content: string}>}
 */
export function buildCorrespondenceMessages({
  bureau,
  member,
  persona,
  history,
  present,
  memories = { knowledge: [], episodes: [] },
  arcNotes = [],
  loreEntries = [],
  now = new Date(),
  characterBudget = CONVERSATION_CHARACTER_BUDGET,
}) {
  const name = nameOf(member);
  const personaName = nameOf(persona);
  const macros = new MacroProcessor({ userName: personaName, charName: name });
  const cardText = (text, card) =>
    text
      ? stripAsterisks(
          macros.process(placeholders.replacePlaceholders(text, card, { name: personaName })),
        )
      : '';

  const profile = (castMember, notes = []) => {
    const card = castMember.seedCard;
    const data = card?.data ?? {};
    const lines = [`Name: ${nameOf(castMember)}`];
    const description = cardText(data.description, card);
    if (description) lines.push(`Description: ${description}`);
    const personality = cardText(data.personality, card);
    if (personality) lines.push(`Personality: ${personality}`);
    const routine = castMember.routine?.text?.trim();
    if (routine) lines.push(`Usual routine: ${routine}`);
    if (notes.length > 0) {
      const changes = notes.map((note) => `- ${stripAsterisks(note.content)}`);
      lines.push(`How ${nameOf(castMember)} has changed:\n${changes.join('\n')}`);
    }
    return lines.join('\n');
  };

  const system = [
    `You write ${name}'s side of a private correspondence with ${personaName}, the reader's character, between the chapters of an ongoing story. Write only ${name}'s messages.`,
    section(
      'CORRESPONDENCE STYLE',
      bureau.settings.correspondence.style.trim() || DEFAULT_CORRESPONDENCE_STYLE,
    ),
    section(name.toUpperCase(), profile(member, arcNotes)),
    section(`${personaName.toUpperCase()} (THE READER'S CHARACTER)`, profile(persona)),
  ];
  const remembered = memoryBlock(name, memories);
  if (remembered) {
    system.push(
      section(
        'MEMORIES',
        `What ${name} remembers, as background for how they act. Mention the past when ${name} would naturally write about it, such as something that just happened between them, but not as filler, and never recite it.\n\n${remembered}`,
      ),
    );
  }
  const world = loreEntries
    .map((entry) => (entry.content ? stripAsterisks(macros.process(entry.content)) : ''))
    .filter(Boolean);
  const year = settingYear(bureau, present, now);
  if (year) world.unshift(`The year is ${year}.`);
  if (world.length > 0) {
    system.push(section('WORLD', world.join('\n\n')));
  }

  // The conversation, with a loose time at the start and after each long gap.
  const { kept, truncated } = latestThatFit(history, characterBudget);
  const lines = truncated ? ['(Earlier messages are omitted.)'] : [];
  let previous = null;
  for (const message of kept) {
    const gap = previous ? describeGap(previous.bureauTime, message.bureauTime) : null;
    if (!previous || gap) {
      const when = describeBureauTime(message.bureauTime, bureau.timezone);
      lines.push(previous ? `(${gap} later: ${when})` : `(${when})`);
    }
    lines.push(`${message.source === 'user' ? personaName : name}: ${message.content}`);
    previous = message;
  }

  const last = history.at(-1);
  const silence = last ? describeGap(last.bureauTime, present) : null;
  const instructions = [`It's ${describeBureauTime(present, bureau.timezone)}.`];
  if (silence) instructions.push(`It has been ${silence} since the last message.`);
  if (!last) {
    instructions.push(`Write the first message ${name} sends ${personaName}.`);
  } else if (last.source === 'user') {
    instructions.push(`Write ${name}'s reply to ${personaName}.`);
  } else {
    instructions.push(`${personaName} hasn't answered yet. Write a short follow-up from ${name}.`);
  }
  instructions.push(
    `Stay in character. Let the time of day and what ${name} is likely doing shape the messages, and mention what ${name} remembers when they'd naturally write about it, not as filler.`,
    `Write only what ${name} sends, never ${personaName}'s side, and don't label messages with names.`,
    `Write one to four messages, with a line containing only ${MESSAGE_SEPARATOR} between messages.`,
  );

  return [
    { role: 'system', content: system.join('\n\n') },
    {
      role: 'user',
      content: [
        section('CONVERSATION', lines.join('\n') || '(No messages yet.)'),
        section('NOW', instructions.join('\n')),
      ].join('\n\n'),
    },
  ];
}

/**
 * Write and save a cast member's next messages in a thread. Every step is
 * recorded in one run.
 *
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {Object} params.bureau
 * @param {Object} params.thread
 * @param {Object} params.member - The cast member writing, with their seed card.
 * @param {Object} params.persona - The reader's character, with their seed card.
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {(event: Object) => void} [params.onEvent] - Receives `run`, `reasoning`, and `content`.
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Array<Object>>} The saved messages. When cancelled, what was written so far
 *   is saved; if nothing was written yet, nothing is.
 */
export async function generateReply({
  stores,
  bureau,
  thread,
  member,
  persona,
  client,
  onEvent = () => {},
  signal,
}) {
  const name = nameOf(member);
  const present = bureauPresent(bureau);
  const history = stores.threads.listMessages(thread.id, { limit: RECENT_MESSAGES });
  const allMemories = () => stores.memories.listMemories(bureau.id, member.id, { status: 'all' });
  const isCancellation = (error) => error?.name === 'AbortError' || Boolean(signal?.aborted);

  const recorder = new RunRecorder(stores.bureaus, {
    bureauId: bureau.id,
    purpose: 'reply',
    targetType: 'thread',
    targetId: thread.id,
  });
  onEvent({ type: 'run', runId: recorder.runId });

  let messages;
  try {
    // After a quiet stretch, the character first gets an account of what they did meanwhile,
    // dated just before this session of messages began, so the session's episode takes over.
    const sessionStart = sessionStartOf(history, present).toISOString();
    const gaps = bureau.settings.memory.offscreenLife
      ? findOffscreenGaps(stores, bureau, [member], sessionStart)
      : [];
    if (gaps.length > 0) {
      onEvent({ type: 'stage', stage: 'catching-up' });
      try {
        await generateOffscreenLife({
          stores,
          bureau,
          gaps,
          to: sessionStart,
          client,
          recorder,
          signal,
        });
      } catch (error) {
        if (isCancellation(error)) throw error;
        // The reply goes on without it. Failed model calls are already recorded; note anything else.
        if (!(error instanceof DeepSeekError)) {
          recorder.recordStep({ role: 'offscreen', kind: 'model', error: error.message });
        }
      }
      onEvent({ type: 'stage', stage: 'writing' });
    }

    const memories = selectForPrompt(
      memoriesAtTime(allMemories(), present),
      bureau.settings.memory,
    );
    const arcNotes = notesAtTime(
      stores.arcNotes.listNotes(bureau.id, member.id, { status: 'accepted' }),
      present,
    );
    const scanText = history
      .slice(-LORE_SCAN_MESSAGES)
      .map((message) => message.content)
      .join('\n\n');
    messages = buildCorrespondenceMessages({
      bureau,
      member,
      persona,
      history,
      present,
      memories,
      arcNotes,
      loreEntries: await activatedLore(stores, bureau.id, scanText),
    });
  } catch (error) {
    if (isCancellation(error)) {
      recorder.finish('cancelled', 'Cancelled');
      return [];
    }
    recorder.fail(error);
    throw error;
  }

  const { thinking, reasoningEffort, maxTokens: replyTokens } = bureau.settings.correspondence;
  const { temperature } = bureau.settings.writer;
  const maxTokens = thinking ? replyTokens + THINKING_TOKENS : replyTokens;
  const recordedRequest = {
    model: client.model,
    thinking,
    reasoningEffort,
    temperature,
    maxTokens,
    messages,
  };

  // Saving can fail too (say, the thread was deleted mid-reply), and the run must not be left
  // looking like it's still writing.
  const saveAndFinish = (text, finish) => {
    let saved;
    try {
      const sentAt = bureauPresent(bureau).toISOString();
      stores.bureaus.db.transaction(() => {
        saved = splitMessages(text, name).map((content) =>
          stores.threads.addMessage(thread.id, {
            source: 'generated',
            senderCastId: member.id,
            content,
            bureauTime: sentAt,
            runId: recorder.runId,
          }),
        );
        stores.bureaus.setBureauTime(bureau.id, sentAt);
      })();
    } catch (saveError) {
      recorder.fail(saveError);
      throw saveError;
    }
    finish();
    return saved;
  };

  let content = '';
  let reasoning = '';
  let done = null;
  const started = Date.now();

  try {
    const stream = client.chatStream({
      messages,
      thinking,
      reasoningEffort,
      temperature,
      maxTokens,
      signal,
    });
    for await (const event of stream) {
      if (event.type === 'reasoning') {
        reasoning += event.text;
        onEvent({ type: 'reasoning', text: event.text });
      } else if (event.type === 'content') {
        const text = event.text.replace(/\*/g, '');
        content += text;
        if (text) onEvent({ type: 'content', text });
      } else if (event.type === 'done') {
        done = event;
      }
    }
  } catch (error) {
    const cancelled = error.name === 'AbortError' || Boolean(signal?.aborted);
    const partial = content.trim();
    recorder.recordStep({
      role: 'writer',
      kind: 'model',
      request: recordedRequest,
      response: partial ? { content: partial, finishReason: null, model: client.model } : null,
      reasoning,
      error: cancelled ? 'Cancelled' : error.message,
      durationMs: Date.now() - started,
    });

    if (!cancelled) {
      recorder.fail(error);
      throw error;
    }
    if (splitMessages(partial, name).length === 0) {
      recorder.finish('cancelled', 'Cancelled');
      return [];
    }
    return saveAndFinish(partial, () => recorder.finish('cancelled', 'Cancelled'));
  }

  const finalContent = content.trim();
  recorder.recordStep({
    role: 'writer',
    kind: 'model',
    request: recordedRequest,
    response: {
      content: finalContent,
      finishReason: done?.finishReason ?? null,
      model: done?.model ?? client.model,
    },
    reasoning,
    usage: done?.usage ?? null,
    durationMs: Date.now() - started,
  });

  if (splitMessages(finalContent, name).length === 0) {
    const cutOff = done?.finishReason === 'length' ? ' (it ran out of tokens)' : '';
    const error = new Error(`${name}'s reply came back empty${cutOff}`);
    recorder.fail(error);
    throw error;
  }
  return saveAndFinish(finalContent, () => recorder.complete());
}
