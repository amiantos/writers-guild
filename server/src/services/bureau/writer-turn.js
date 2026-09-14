/**
 * Writer Turn
 *
 * Generates one turn for a Bureau story and saves it as a new turn or a new
 * variant of an existing one. The Director plans the passage, the Writer
 * streams it, style lint checks it, and the Editor fixes what lint flags (see
 * "Generation pipeline" in docs/bureau-design.md). Every step is recorded in
 * one run, which the turn's seam displays.
 *
 * The Director and Editor only improve a turn: if either fails, the Writer
 * writes without a brief, or the unedited text is kept.
 */

import { ImagePreserver } from '../image-preserver.js';
import { LorebookActivator } from '../lorebook-activator.js';
import { chapterTime, settingYear } from './bureau-time.js';
import { DeepSeekError } from './deepseek-client.js';
import { runDirector } from './director.js';
import { runEditor } from './editor.js';
import { imageStream } from './images.js';
import { memoriesAsOf, notesAsOf, selectForPrompt } from './memory.js';
import { RunRecorder } from './run-recorder.js';
import { inferPronoun, lintProse, usesThirdPerson } from './style-lint.js';
import { DEFAULT_HOUSE_STYLE, buildWriterMessages } from './writer-prompt.js';

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
 * @returns {{ action: string, direction?: string }}
 */
export function requestForRegeneration(turns, index) {
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

function nameOf(member) {
  return member.seedCard?.data?.name || member.name;
}

function pronounOf(member) {
  const data = member.seedCard?.data ?? {};
  return inferPronoun(`${data.description ?? ''}\n${data.personality ?? ''}`);
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
 * @param {string|null} [params.regenerateTurnId] - Add a variant to this turn, writing from
 *   the turns before it, instead of appending a new turn.
 * @param {(event: Object) => void} [params.onEvent] - Receives events as they happen: `run`,
 *   `stage` (directing, writing, or editing), `brief`, `reasoning`, `content` (with images in
 *   place of their markers), and `edits`.
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
  };
  const isCancellation = (error) => error?.name === 'AbortError' || Boolean(signal?.aborted);

  const recorder = new RunRecorder(bureaus, {
    bureauId: bureau.id,
    purpose: 'turn',
    targetType: 'story',
    targetId: story.id,
  });
  onEvent({ type: 'run', runId: recorder.runId });

  // The Director plans the passage, unless it's off or this is a plain Continue.
  let brief = null;
  const director = bureau.settings.director;
  if (director.enabled && !(director.skipOnContinue && request.action === 'continue')) {
    onEvent({ type: 'stage', stage: 'directing' });
    try {
      brief = await runDirector({
        stores,
        bureau,
        story,
        cast,
        turns,
        request: promptRequest,
        client,
        recorder,
        signal,
      });
    } catch (error) {
      if (isCancellation(error)) {
        recorder.finish('cancelled', 'Cancelled');
        return null;
      }
      // Failed model calls are already recorded; note anything else. Either way the Writer
      // goes on without a brief.
      if (!(error instanceof DeepSeekError)) {
        recorder.recordStep({ role: 'director', kind: 'model', error: error.message });
      }
    }
    if (brief) onEvent({ type: 'brief', brief });
  }

  onEvent({ type: 'stage', stage: 'writing' });
  const scanText = [...turns.map((turn) => turn.content), request.direction ?? ''].join('\n\n');
  const imagePreserver = new ImagePreserver();
  let messages;
  let storySection;
  try {
    ({ messages, storySection } = buildWriterMessages({
      bureau,
      cast,
      loreEntries: await activatedLore(stores, bureau.id, scanText),
      memoriesByCast,
      arcNotesByCast,
      turns,
      request: { ...promptRequest, brief },
      // Turns stop before a turn being regenerated, so the time is the chapter's as of that turn.
      startTime: story.startTime,
      settingYear: settingYear(bureau, chapterTime(story, turns).time),
      imagePreserver,
    }));
  } catch (error) {
    recorder.fail(error);
    throw error;
  }

  const { thinking, reasoningEffort, temperature, maxTokens } = bureau.settings.writer;
  const recordedRequest = {
    model: client.model,
    thinking,
    reasoningEffort,
    temperature,
    maxTokens,
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

  // Lint runs and is recorded even with the Editor off, so runs can be compared.
  const houseStyle = bureau.houseStyle?.trim() || DEFAULT_HOUSE_STYLE;
  const findings = lintProse(finalContent, {
    names: cast.map((member) => ({ name: nameOf(member), pronoun: pronounOf(member) })),
    thirdPerson: usesThirdPerson(houseStyle),
    recentText: turns
      .filter((turn) => turn.kind === 'prose' && turn.source === 'generated')
      .slice(-3)
      .map((turn) => turn.content)
      .join('\n\n'),
    bannedPhrases: bureau.settings.style.bannedPhrases,
  });
  recorder.recordStep({
    role: 'lint',
    kind: 'tool',
    request: { name: 'style_lint' },
    response: { findings },
  });

  let savedContent = finalContent;
  if (findings.length > 0 && bureau.settings.editor.enabled) {
    onEvent({ type: 'stage', stage: 'editing' });
    try {
      const edited = await runEditor({
        client,
        recorder,
        houseStyle,
        text: finalContent,
        findings,
        signal,
      });
      savedContent = edited.text;
      if (edited.edits.length > 0) onEvent({ type: 'edits', edits: edited.edits });
    } catch (error) {
      if (isCancellation(error)) {
        return saveAndFinish(finalContent, () => recorder.finish('cancelled', 'Cancelled'));
      }
      // The unedited text stands. Failed model calls are already recorded; note anything else.
      if (!(error instanceof DeepSeekError)) {
        recorder.recordStep({ role: 'editor', kind: 'model', error: error.message });
      }
    }
  }

  return saveAndFinish(savedContent, () => recorder.complete());
}
