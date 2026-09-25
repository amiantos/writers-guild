/**
 * Chat Reply
 *
 * Writes a character's next reply in a chat with the chat's preset, through
 * any provider: streaming ones stream, AI Horde reports its queue, and the
 * rest answer at once. The reply is split into messages and saved as a new
 * turn, or as a new swipe of the turn being regenerated.
 */

import { LorebookActivator } from '../lorebook-activator.js';
import { buildChatPrompts, splitReply } from './chat-prompt.js';

// Providers that continue a raw prompt rather than answer a chat: the prompt ends with the
// speaker's label, and anyone else's label stops the reply.
const TEXT_COMPLETION_PROVIDERS = new Set(['koboldcpp', 'aihorde']);
// Recent messages scanned for lorebook keywords.
const LORE_SCAN_TURNS = 10;

function nameOf(card) {
  return card?.data?.name || 'Character';
}

/**
 * Labels that stop a text-completion reply: everyone else's, by full and first name as
 * splitReply reads them, leaving out any the speaker's own name shares.
 */
export function stopLabels(speakerName, otherNames) {
  const variants = (name) => [name, name.split(/\s+/)[0]].filter(Boolean);
  const own = new Set(variants(speakerName));
  const names = new Set(otherNames.flatMap(variants).filter((name) => !own.has(name)));
  return [...names].map((name) => `\n${name}:`);
}

/**
 * Lorebook entries activated by the recent conversation and the scenario, with the preset's
 * lorebook settings.
 */
export function activateChatLore(lorebooks, preset, { chat, turns, pendingText = '' }) {
  if (lorebooks.length === 0) return [];
  const settings = preset.lorebookSettings ?? {};
  const activator = new LorebookActivator({
    lorebookScanDepth: settings.scanDepth,
    lorebookTokenBudget: settings.tokenBudget,
    lorebookRecursionDepth: settings.recursionDepth,
    lorebookEnableRecursion: settings.enableRecursion,
  });
  const scanText = [
    chat.scenario ?? '',
    ...turns.slice(-LORE_SCAN_TURNS).map((turn) => turn.messages.join('\n')),
    pendingText,
  ].join('\n\n');
  return activator.activate(lorebooks, scanText);
}

/**
 * Run a generation and report its progress. Resolves with what was written; when cancelled,
 * resolves with what was written so far and `cancelled: true`.
 */
async function runProvider({
  provider,
  preset,
  system,
  user,
  maxContextTokens,
  stopSequences,
  signal,
  onEvent,
}) {
  const settings = preset.generationSettings ?? {};
  const options = {
    ...settings,
    stop_sequences: [...(settings.stop_sequences ?? []), ...stopSequences],
    // The context the prompt was budgeted for, which AI Horde narrows to what its workers take.
    // AI Horde reads maxContextLength; KoboldCpp and Ollama read maxContextTokens.
    maxContextTokens,
    maxContextLength: maxContextTokens,
    signal,
  };
  const capabilities = provider.getCapabilities();
  let content = '';
  let reasoning = '';

  const isCancellation = (error) =>
    error?.name === 'AbortError' || error?.message === 'Generation cancelled' || signal?.aborted;

  try {
    if (capabilities.streaming) {
      const { stream } = await provider.generateStreaming(system, user, options);
      for await (const chunk of stream) {
        if (chunk.reasoning) {
          reasoning += chunk.reasoning;
          onEvent({ type: 'reasoning', text: chunk.reasoning });
        }
        const text = chunk.content?.replace(/\*/g, '');
        if (text) {
          content += text;
          onEvent({ type: 'content', text });
        }
      }
    } else if (capabilities.requiresPolling) {
      const updates = provider.generateStreamingWithStatus(system, user, {
        ...options,
        timeout: settings.timeout || 300000,
      });
      for await (const update of updates) {
        if (update.type === 'status') {
          onEvent({
            type: 'queue',
            position: update.queuePosition,
            waitTime: update.waitTime,
          });
        } else if (update.type === 'complete') {
          content = update.content?.replace(/\*/g, '') ?? '';
          onEvent({ type: 'content', text: content });
        }
      }
    } else {
      const result = await provider.generate(system, user, options);
      reasoning = result.reasoning ?? '';
      content = result.content?.replace(/\*/g, '') ?? '';
      if (reasoning) onEvent({ type: 'reasoning', text: reasoning });
      onEvent({ type: 'content', text: content });
    }
  } catch (error) {
    if (isCancellation(error)) {
      return { content, reasoning, cancelled: true };
    }
    throw error;
  }
  return { content, reasoning, cancelled: Boolean(signal?.aborted) };
}

/**
 * Write a character's reply and save it.
 *
 * @param {Object} params
 * @param {import('./chat-storage.js').ChatStorage} params.chats
 * @param {Object} params.chat
 * @param {Object} params.speaker - The character card writing, with its id.
 * @param {Array<Object>} params.characters - Every character card in the chat, in order.
 * @param {Object|null} params.persona - The user's character card, if any.
 * @param {Array<Object>} params.lorebooks - The chat's lorebooks, with entries.
 * @param {Object} params.preset
 * @param {import('../providers/base-provider.js').LLMProvider} params.provider
 * @param {Object} [params.regenerate] - The turn to add a swipe to, instead of adding a turn.
 * @param {(event: Object) => void} [params.onEvent] - Receives `prompt`, `queue`, `reasoning`,
 *   and `content` events.
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object|null>} The saved turn. When cancelled, what was written so far is
 *   saved; if nothing was written yet, nothing is and this resolves with null.
 */
export async function generateChatReply({
  chats,
  chat,
  speaker,
  characters,
  persona,
  lorebooks,
  preset,
  provider,
  regenerate = null,
  onEvent = () => {},
  signal,
}) {
  const allTurns = chats.listTurns(chat.id);
  const turns = regenerate
    ? allTurns.filter((turn) => turn.position < regenerate.position)
    : allTurns;
  const speakerName = nameOf(speaker);
  const userName = persona ? nameOf(persona) : 'User';
  const otherNames = [userName, ...characters.map(nameOf)].filter((name) => name !== speakerName);
  // Provider ids match case-insensitively, as getProvider() matches them.
  const textCompletion = TEXT_COMPLETION_PROVIDERS.has(preset.provider?.toLowerCase());

  const maxContextTokens = await provider.resolveContextTokens(preset);
  const { system, user } = buildChatPrompts({
    chat,
    speaker,
    characters,
    persona,
    turns,
    loreEntries: activateChatLore(lorebooks, preset, { chat, turns }),
    preset,
    maxContextTokens,
    primeSpeaker: textCompletion,
  });
  onEvent({ type: 'prompt', system, user });

  const { content, reasoning, cancelled } = await runProvider({
    provider,
    preset,
    system,
    user,
    maxContextTokens,
    stopSequences: textCompletion ? stopLabels(speakerName, otherNames) : [],
    signal,
    onEvent,
  });

  const messages = splitReply(content, speakerName, otherNames);
  if (messages.length === 0) {
    if (cancelled) return null;
    throw new Error(`${speakerName}'s reply came back empty`);
  }
  if (regenerate) {
    // Checked again now, since a message may have been sent while this version was written, and
    // a reply's versions are fixed once the chat moves on. The check and the save run together.
    if (chats.getLastTurn(chat.id)?.id !== regenerate.id) {
      if (cancelled) return null;
      throw new Error('The chat moved on while this version was written, so it wasn’t saved');
    }
    return chats.addSwipe(chat.id, regenerate.id, { messages, reasoning });
  }
  return chats.addTurn(chat.id, {
    source: 'character',
    characterId: speaker.id,
    senderName: speakerName,
    messages,
    reasoning,
  });
}
