/**
 * Writer Turn
 *
 * Generates one Writer turn for a Bureau story: build the prompt, stream the
 * prose, and save it as a new turn or a new variant of an existing one. The
 * exchange is recorded as a run, which the turn's seam displays.
 *
 * Phase 2 runs the Writer alone; the Director and Editor join in phase 4.
 */

import { ImagePreserver } from '../image-preserver.js';
import { LorebookActivator } from '../lorebook-activator.js';
import { BureauTimeError, describeTime } from './bureau-time.js';
import { RunRecorder } from './run-recorder.js';
import { buildWriterMessages } from './writer-prompt.js';

// Story mode's default scan depth, budget, and recursion.
const LOREBOOK_SETTINGS = {
  lorebookScanDepth: 2000,
  lorebookTokenBudget: 1800,
  lorebookRecursionDepth: 3,
  lorebookEnableRecursion: true,
};

// Recorded prompts keep only the end of the story text; the whole story is in its turns.
export const RECORDED_STORY_TAIL = 4000;

/**
 * The request that produced a generated turn, inferred from the turn before
 * it: a direction means 'direct', and the reader's own prose means 'write'.
 *
 * @param {Array<Object>} turns - The story's turns in order.
 * @param {number} index - Index of the generated turn in `turns`.
 * @returns {{ action: string, direction?: string, leadCastId: string|null }}
 */
export function requestForRegeneration(turns, index) {
  const leadCastId = turns[index]?.authorCastId ?? null;
  const previous = turns[index - 1];
  if (previous?.kind === 'direction') {
    return { action: 'direct', direction: previous.content, leadCastId };
  }
  if (previous?.kind === 'prose' && previous.source === 'user') {
    return { action: 'write', leadCastId };
  }
  return { action: 'continue', leadCastId };
}

function recordableMessages(messages, storySection) {
  if (storySection.length <= RECORDED_STORY_TAIL) return messages;

  const omitted = storySection.length - RECORDED_STORY_TAIL;
  const trimmed = `[${omitted} earlier characters not recorded; the full story is in its turns]\n…${storySection.slice(-RECORDED_STORY_TAIL)}`;
  return messages.map((message) =>
    message.role === 'user'
      ? { ...message, content: message.content.replace(storySection, () => trimmed) }
      : message,
  );
}

async function activatedLore(stores, bureauId, scanText) {
  const lorebooks = [];
  for (const lorebookId of stores.bureaus.listLorebookIds(bureauId)) {
    try {
      lorebooks.push(await stores.library.getLorebook(lorebookId));
    } catch {
      // Deleted from the library but still attached; nothing to activate.
    }
  }
  if (lorebooks.length === 0) return [];
  return new LorebookActivator(LOREBOOK_SETTINGS).activate(lorebooks, scanText);
}

function openingTimeFor(story, bureau) {
  try {
    return describeTime(story.startTime, { timeZone: bureau.timezone ?? undefined });
  } catch (error) {
    // A stored time zone this server doesn't know: fall back to the server's.
    if (!(error instanceof BureauTimeError)) throw error;
    return describeTime(story.startTime);
  }
}

/**
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {Object} params.bureau - The Bureau, with settings and timezone.
 * @param {Object} params.story
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {Object} params.request
 * @param {'write'|'direct'|'continue'} params.request.action
 * @param {string} [params.request.direction] - For 'direct'.
 * @param {string|null} [params.request.leadCastId] - Cast member to center the passage on.
 * @param {string|null} [params.regenerateTurnId] - Add a variant to this turn, writing from
 *   the turns before it, instead of appending a new turn.
 * @param {(event: Object) => void} [params.onEvent] - Receives `run`, `reasoning`, and
 *   `content` events as they happen.
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object|null>} The saved turn. When cancelled, the text written so far is
 *   saved, or null is returned if nothing was written yet.
 */
export async function generateWriterTurn({
  stores,
  bureau,
  story,
  client,
  request,
  regenerateTurnId = null,
  onEvent = () => {},
  signal,
}) {
  const { bureaus, stories } = stores;

  const allTurns = stories.listTurns(story.id);
  let turns = allTurns;
  if (regenerateTurnId) {
    const index = allTurns.findIndex((turn) => turn.id === regenerateTurnId);
    if (index === -1) {
      throw new Error(`Turn not found: ${regenerateTurnId}`);
    }
    turns = allTurns.slice(0, index);
  }

  const cast = story.castIds
    .map((castId) => bureaus.getCastMember(bureau.id, castId))
    .filter(Boolean);
  const lead = request.leadCastId ? cast.find((member) => member.id === request.leadCastId) : null;

  const scanText = [...turns.map((turn) => turn.content), request.direction ?? ''].join('\n\n');
  const imagePreserver = new ImagePreserver();
  const { messages, storySection } = buildWriterMessages({
    bureau,
    cast,
    loreEntries: await activatedLore(stores, bureau.id, scanText),
    turns,
    request: { action: request.action, direction: request.direction, leadName: lead?.name },
    openingTime: openingTimeFor(story, bureau),
    imagePreserver,
  });

  const { thinking, reasoningEffort, temperature, maxTokens } = bureau.settings.writer;
  const recordedRequest = {
    model: client.model,
    thinking,
    reasoningEffort,
    temperature,
    maxTokens,
    messages: recordableMessages(messages, storySection),
  };

  const recorder = new RunRecorder(bureaus, {
    bureauId: bureau.id,
    purpose: 'turn',
    targetType: 'story',
    targetId: story.id,
  });
  onEvent({ type: 'run', runId: recorder.runId });

  const restore = (text) =>
    imagePreserver.restoreImages(text, { appendMissing: false }).finalContent.trim();

  const save = (text) =>
    regenerateTurnId
      ? stories.addVariant(story.id, regenerateTurnId, { content: text, runId: recorder.runId })
      : stories.addTurn(story.id, {
          kind: 'prose',
          source: 'generated',
          content: text,
          authorCastId: lead?.id ?? null,
          runId: recorder.runId,
        });

  // Saving can fail too (say, the story was deleted mid-generation), and the run must not
  // be left looking like it's still writing.
  const saveAndFinish = (text, finish) => {
    let turn;
    try {
      turn = save(text);
    } catch (saveError) {
      recorder.fail(saveError);
      throw saveError;
    }
    finish();
    return turn;
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
        // Like story mode, prose never uses asterisks for actions.
        const text = event.text.replace(/\*/g, '');
        content += text;
        if (text) onEvent({ type: 'content', text });
      } else if (event.type === 'done') {
        done = event;
      }
    }
  } catch (error) {
    const cancelled = error.name === 'AbortError' || Boolean(signal?.aborted);
    const partial = restore(content);
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
    if (!partial) {
      recorder.finish('cancelled', 'Cancelled');
      return null;
    }
    return saveAndFinish(partial, () => recorder.finish('cancelled', 'Cancelled'));
  }

  const finalContent = restore(content);
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

  if (!finalContent) {
    const error = new Error('The Writer returned no text');
    recorder.fail(error);
    throw error;
  }

  return saveAndFinish(finalContent, () => recorder.complete());
}
