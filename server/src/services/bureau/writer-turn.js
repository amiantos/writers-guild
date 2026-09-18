/**
 * Writer Turn
 *
 * Generates one turn for a Bureau story and saves it as a new turn or a new
 * variant of an existing one. The Writer streams the passage with story mode's
 * prompts (see "Generation pipeline" in docs/bureau-design.md). The run records
 * it, and the turn's seam displays the run.
 */

import { ImagePreserver } from '../image-preserver.js';
import { LorebookActivator } from '../lorebook-activator.js';
import { chapterTime, settingYear } from './bureau-time.js';
import { imageStream } from './images.js';
import { factsAsOf, memoriesAsOf, notesAsOf, selectForPrompt } from './memory.js';
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
 * The request that produced a generated turn. A rewritten greeting is known by the greeting its run
 * recorded, and a turn written for one character by the character its Writer step recorded.
 * Otherwise the request is inferred from the turn before it: a direction means 'direct', and the
 * reader's own prose means 'write'.
 *
 * @param {Array<Object>} turns - The story's turns in order.
 * @param {number} index - Index of the generated turn in `turns`.
 * @param {Object|null} [run] - The run that wrote the version shown, with its steps.
 * @returns {{ action: string, direction?: string, character?: { castId: string, name: string },
 *   greeting?: { name: string, content: string } }}
 */
export function requestForRegeneration(turns, index, run = null) {
  const greeting = run?.steps?.find((step) => step.role === 'greeting')?.response;
  if (greeting?.content) {
    return {
      action: 'greeting',
      greeting: { name: greeting.name ?? '', content: greeting.content },
    };
  }
  const character = run?.steps?.find((step) => step.role === 'writer')?.request?.character;
  if (character?.name) {
    return { action: 'character', character: { castId: character.castId, name: character.name } };
  }

  const previous = turns[index - 1];
  if (previous?.kind === 'direction') {
    return { action: 'direct', direction: previous.content };
  }
  if (previous?.kind === 'prose' && previous.source === 'user') {
    return { action: 'write' };
  }
  return { action: 'continue' };
}

function recordableMessages(messages, storySection) {
  if (storySection.length <= RECORDED_STORY_TAIL) return messages;

  const omitted = storySection.length - RECORDED_STORY_TAIL;
  const trimmed = `[${omitted} earlier characters not recorded; the full chapter is in its turns]\n…${storySection.slice(-RECORDED_STORY_TAIL)}`;
  return messages.map((message) =>
    message.role === 'user'
      ? { ...message, content: message.content.replace(storySection, () => trimmed) }
      : message,
  );
}

/** Entries from the Bureau's attached lorebooks that the text activates. */
export async function activatedLore(stores, bureauId, scanText) {
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

/**
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {Object} params.bureau - The Bureau, with settings and timezone.
 * @param {Object} params.story
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {Object} params.request
 * @param {'write'|'direct'|'continue'|'character'|'greeting'} params.request.action
 * @param {string} [params.request.direction] - For 'direct'.
 * @param {{ castId: string, name: string }} [params.request.character] - For 'character': who the
 *   next part is written for.
 * @param {{ name: string, content: string }} [params.request.greeting] - For 'greeting': the
 *   greeting from a character card to rewrite as the chapter's opening.
 * @param {string|null} [params.regenerateTurnId] - Add a variant to this turn, writing from
 *   the turns before it, instead of appending a new turn.
 * @param {(event: Object) => void} [params.onEvent] - Receives events as they happen: `run`,
 *   `stage` (writing), `reasoning`, and `content` (with images in place of their markers).
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

  // What each character, the reader's included, remembers from before this chapter.
  const memoriesByCast = new Map(
    cast.map((member) => [
      member.id,
      selectForPrompt(
        memoriesAsOf(stores.memories.listMemories(bureau.id, member.id, { status: 'all' }), story),
        bureau.settings.memory,
      ),
    ]),
  );

  // How each character has changed before this story, from accepted arc notes.
  const arcNotesByCast = new Map(
    cast.map((member) => [
      member.id,
      notesAsOf(stores.arcNotes.listNotes(bureau.id, member.id, { status: 'accepted' }), story),
    ]),
  );

  const promptRequest = {
    action: request.action,
    direction: request.direction,
    character: request.character,
    greeting: request.greeting,
  };

  const recorder = new RunRecorder(bureaus, {
    bureauId: bureau.id,
    purpose: 'turn',
    targetType: 'story',
    targetId: story.id,
  });
  onEvent({ type: 'run', runId: recorder.runId });

  // A rewrite keeps its greeting in the run, for the seam and for writing another version.
  if (request.action === 'greeting') {
    recorder.recordStep({
      role: 'greeting',
      kind: 'tool',
      request: { name: 'greeting' },
      response: { name: request.greeting.name, content: request.greeting.content },
    });
  }

  onEvent({ type: 'stage', stage: 'writing' });
  // The chapter's scenario and a greeting being rewritten activate lore too; they're often all the
  // chapter has so far.
  const scanText = [
    story.scenario ?? '',
    ...turns.map((turn) => turn.content),
    request.direction ?? '',
    request.greeting?.content ?? '',
  ].join('\n\n');
  const imagePreserver = new ImagePreserver();
  const { thinking, reasoningEffort, temperature, maxTokens } = bureau.settings.writer;
  let messages;
  let storySection;
  try {
    ({ messages, storySection } = buildWriterMessages({
      bureau,
      cast,
      loreEntries: await activatedLore(stores, bureau.id, scanText),
      memoriesByCast,
      arcNotesByCast,
      facts: factsAsOf(stores.facts.listFacts(bureau.id), story),
      turns,
      request: promptRequest,
      scenario: story.scenario,
      // Turns stop before a turn being regenerated, so the time is the chapter's as of that turn.
      startTime: story.startTime,
      settingYear: settingYear(bureau, chapterTime(story, turns).time),
      imagePreserver,
      maxTokens,
    }));
  } catch (error) {
    recorder.fail(error);
    throw error;
  }

  const recordedRequest = {
    model: client.model,
    thinking,
    reasoningEffort,
    temperature,
    maxTokens,
    // Who a Continue for Character wrote for, so writing another version does the same.
    ...(request.action === 'character' ? { character: request.character } : {}),
    messages: recordableMessages(messages, storySection),
  };

  const restore = (text) =>
    imagePreserver.restoreImages(text, { appendMissing: false }).finalContent.trim();

  const save = (text) =>
    regenerateTurnId
      ? stories.addVariant(story.id, regenerateTurnId, { content: text, runId: recorder.runId })
      : stories.addTurn(story.id, {
          kind: 'prose',
          source: 'generated',
          content: text,
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
  // What the reader sees streaming in, with each image in place as soon as its marker is written.
  const shown = imageStream(imagePreserver);

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
        const next = shown.push(text);
        if (next) onEvent({ type: 'content', text: next });
      } else if (event.type === 'done') {
        done = event;
      }
    }
    const rest = shown.finish();
    if (rest) onEvent({ type: 'content', text: rest });
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

  // A rewritten greeting keeps its images: any the Writer left out go at the end, as story mode's
  // rewrite does.
  const leftOut = imagePreserver.saved
    .filter((image) => image.source === 'greeting' && !content.includes(image.placeholder))
    .map((image) => image.original);
  const restored = restore(content);
  const finalContent =
    restored && leftOut.length > 0 ? [restored, ...leftOut].join('\n\n') : restored;
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
