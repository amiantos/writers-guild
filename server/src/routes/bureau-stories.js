/**
 * Bureau Story Routes
 *
 * Mounted at /api/bureaus/:bureauId/stories. A story is an ordered list of
 * turns. The generate and regenerate endpoints stream the Writer's output as
 * server-sent events when the client asks for text/event-stream, and answer
 * with JSON otherwise.
 *
 * The Archivist reads a story into memory when asked, when the story ends, and
 * in the background as turns settle. Changing a turn it has read marks the
 * memories that cite it for review.
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { sseChannel } from '../utils/sse.js';
import { DeepSeekError } from '../services/bureau/deepseek-client.js';
import {
  BureauTimeError,
  chapterTime,
  isValidTimeZone,
  passTime,
  resolveStoryEndTime,
  resolveStoryStartTime,
} from '../services/bureau/bureau-time.js';
import { archiveSettledTurns, archiveStory, archiveThread } from '../services/bureau/archivist.js';
import { listGreetings } from '../services/bureau/greetings.js';
import { findOffscreenGaps, generateOffscreenLife } from '../services/bureau/offscreen.js';
import { generateWriterTurn, requestForRegeneration } from '../services/bureau/writer-turn.js';
import {
  createBureauClient,
  optionalString,
  requireApiKey,
  requireBureau,
  requireStory,
} from './bureau-route-helpers.js';

const router = express.Router({ mergeParams: true });

const GENERATE_ACTIONS = ['write', 'direct', 'continue', 'greeting'];
const READER_TURN_KINDS = ['prose', 'direction', 'scene_break', 'time_passes'];

function resolveTime(resolve) {
  try {
    return resolve();
  } catch (error) {
    if (error instanceof BureauTimeError) {
      throw new AppError(error.message, 400);
    }
    throw error;
  }
}

function validateCastIds(bureaus, bureauId, castIds) {
  if (!Array.isArray(castIds) || castIds.some((id) => typeof id !== 'string')) {
    throw new AppError('castIds must be an array of cast member ids', 400);
  }
  const known = new Set(bureaus.listCast(bureauId).map((member) => member.id));
  const unknown = castIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new AppError(`Not in this Bureau's cast: ${unknown.join(', ')}`, 400);
  }
  return [...new Set(castIds)];
}

function requireActive(story) {
  if (story.status !== 'active') {
    throw new AppError('This chapter has ended', 409);
  }
}

function requireTurn(stories, storyId, turnId) {
  const turn = stories.getTurn(storyId, turnId);
  if (!turn) {
    throw new AppError('Turn not found', 404);
  }
  return turn;
}

/** Read the story's unread turns into memory, reporting model failures as 502s. */
async function archiveNow(req, res, bureauId, storyId) {
  const { stores } = res.locals;
  const client = createBureauClient(req, stores.bureaus.getBureauCredentials(bureauId));
  try {
    return await archiveStory({ stores, bureauId, storyId, client });
  } catch (error) {
    if (error instanceof DeepSeekError) {
      throw new AppError(error.message, 502);
    }
    throw error;
  }
}

/** Mark memories, arc notes, and facts that cite changed or deleted turns for review. */
function flagChangedTurns(stores, bureauId, storyId, turnIds) {
  stores.memories.flagTurnsChanged(bureauId, storyId, turnIds);
  stores.arcNotes.flagTurnsChanged(bureauId, storyId, turnIds);
  stores.facts.flagTurnsChanged(bureauId, storyId, turnIds);
}

/** Where `part` appears in `text` as whole paragraphs, or -1. */
function paragraphIndexOf(text, part) {
  let index = text.indexOf(part);
  while (index !== -1) {
    const end = index + part.length;
    const startsParagraph = index === 0 || text[index - 1] === '\n';
    const endsParagraph = end === text.length || text[end] === '\n';
    if (startsParagraph && endsParagraph) return index;
    index = text.indexOf(part, index + 1);
  }
  return -1;
}

function personaIn(bureaus, bureauId, story) {
  const persona = story.castIds
    .map((castId) => bureaus.getCastMember(bureauId, castId))
    .find((member) => member?.isPersona);
  return persona?.id ?? null;
}

/**
 * Run the Writer and answer the request: as a stream of events when the
 * client asked for one, otherwise as JSON once the turn is saved.
 */
async function respondWithWriterTurn(
  req,
  res,
  { bureau, story, request, regenerateTurnId, userTurn },
) {
  const { stores } = res.locals;
  const client = createBureauClient(req, stores.bureaus.getBureauCredentials(bureau.id));
  const channel = sseChannel(req, res);
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  channel.open();
  if (userTurn) {
    channel.send({ type: 'turn', turn: userTurn });
  }

  try {
    const turn = await generateWriterTurn({
      stores,
      bureau,
      story,
      client,
      request,
      regenerateTurnId,
      signal: controller.signal,
      onEvent: (event) => channel.send(event),
    });
    if (regenerateTurnId && turn) {
      flagChangedTurns(stores, bureau.id, story.id, [regenerateTurnId]);
    }
    if (controller.signal.aborted) {
      // The client left; any text written so far was saved with the turn.
      if (!res.writableEnded) res.end();
      return;
    }
    channel.finish({ statusCode: regenerateTurnId ? 200 : 201, body: { userTurn, turn } });

    // Tests turn background archiving off with app.locals.bureauAutoArchive.
    if (
      !regenerateTurnId &&
      bureau.settings.memory.autoArchive &&
      (req.app.locals.bureauAutoArchive ?? true)
    ) {
      archiveSettledTurns({ stores, bureauId: bureau.id, storyId: story.id, client });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (!(error instanceof DeepSeekError)) {
      console.error('[Bureau] Writer turn failed:', error);
    }
    channel.fail(error.message, error instanceof DeepSeekError ? 502 : 500);
  }
}

// ==================== Stories ====================

// List a Bureau's stories in order
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    requireBureau(bureaus, req.params.bureauId);
    res.json({ stories: stories.listStories(req.params.bureauId) });
  }),
);

/**
 * Before a story begins: commit what its characters said in messages to memory,
 * then give each of them an account of their time away since they were last
 * seen. Neither stops the story; failures come back as messages.
 */
async function catchUpBeforeStory(req, stores, bureau, story) {
  const result = { archiveError: null, offscreenError: null };
  if (!bureau.hasApiKey) return result;

  const client = createBureauClient(req, stores.bureaus.getBureauCredentials(bureau.id));
  const cast = story.castIds
    .map((castId) => stores.bureaus.getCastMember(bureau.id, castId))
    .filter(Boolean);
  const members = cast.filter((member) => !member.isPersona);
  // Every thread is with the reader's character, so when they're in the story, all of them count.
  const correspondents = cast.some((member) => member.isPersona)
    ? stores.bureaus.listCast(bureau.id).filter((member) => !member.isPersona)
    : members;

  if (bureau.settings.memory.autoArchive) {
    // One thread failing doesn't keep the others out of memory.
    const failures = [];
    for (const member of correspondents) {
      const thread = stores.threads.getThreadForCast(bureau.id, member.id);
      if (!thread) continue;
      try {
        await archiveThread({ stores, bureauId: bureau.id, threadId: thread.id, client });
      } catch (error) {
        console.error(`[Bureau] Committing messages with ${member.name} failed:`, error.message);
        failures.push(`${member.name}: ${error.message}`);
      }
    }
    if (failures.length > 0) {
      result.archiveError = failures.join('; ');
    }
  }

  if (bureau.settings.memory.offscreenLife) {
    try {
      await generateOffscreenLife({
        stores,
        bureau,
        gaps: findOffscreenGaps(stores, bureau, members, story.startTime, {
          ignoreStoryId: story.id,
        }),
        to: story.startTime,
        client,
      });
    } catch (error) {
      console.error('[Bureau] Offscreen life before the story failed:', error.message);
      result.offscreenError = error.message;
    }
  }
  return result;
}

// Start a story. start.choice is 'bureau' (the Bureau's current time, the
// default) or 'custom' with start.customTime. The Bureau's clock moves to the
// start time. The browser's timeZone is saved if the Bureau has none yet. Messages
// its characters exchanged are committed to memory first, and a jump forward in
// time gives them offscreen life; archiveError and offscreenError say if either failed.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { stores } = res.locals;
    const { bureaus, stories } = stores;
    const { bureauId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    const body = req.body ?? {};

    const title = optionalString(body, 'title') ?? '';
    const castIds =
      body.castIds === undefined
        ? bureaus.listCast(bureauId).map((member) => member.id)
        : validateCastIds(bureaus, bureauId, body.castIds);
    const startTime = resolveTime(() =>
      resolveStoryStartTime({
        choice: body.start?.choice ?? 'bureau',
        bureauTime: bureau.bureauTime,
        customTime: body.start?.customTime,
      }),
    );

    let story;
    bureaus.db.transaction(() => {
      story = stories.createStory(bureauId, { title, castIds, startTime });
      bureaus.setBureauTime(bureauId, startTime);
      if (!bureau.timezone && isValidTimeZone(body.timeZone)) {
        bureaus.updateBureau(bureauId, { timezone: body.timeZone });
      }
    })();

    const { archiveError, offscreenError } = await catchUpBeforeStory(req, stores, bureau, story);
    res
      .status(201)
      .json({ story, bureau: bureaus.getBureau(bureauId), archiveError, offscreenError });
  }),
);

// Get a story with its turns
router.get(
  '/:storyId',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId } = req.params;
    requireBureau(bureaus, bureauId);
    const story = requireStory(stories, bureauId, storyId);
    res.json({ story, turns: stories.listTurns(storyId) });
  }),
);

// Update a story's title or who is present
router.put(
  '/:storyId',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId } = req.params;
    requireBureau(bureaus, bureauId);
    requireStory(stories, bureauId, storyId);

    const body = req.body ?? {};
    const title = optionalString(body, 'title');
    if (title === '') {
      throw new AppError('Title cannot be empty', 400);
    }
    const castIds =
      body.castIds === undefined ? undefined : validateCastIds(bureaus, bureauId, body.castIds);
    if (title === undefined && castIds === undefined) {
      throw new AppError('No updates provided', 400);
    }

    res.json({ story: stories.updateStory(bureauId, storyId, { title, castIds }) });
  }),
);

// End a story. end.choice is 'unchanged' (the default) or 'custom' with
// end.customTime; the Bureau's clock moves to the chosen time. Unless the Bureau
// archives only on request, the rest of the story is then read into memory;
// if that fails, the story still ends and archiveError says why.
router.post(
  '/:storyId/end',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    requireActive(requireStory(stories, bureauId, storyId));

    const end = req.body?.end;
    const endTime = resolveTime(() =>
      resolveStoryEndTime({
        choice: end?.choice ?? 'unchanged',
        bureauTime: bureau.bureauTime,
        customTime: end?.customTime,
      }),
    );

    bureaus.db.transaction(() => {
      stories.endStory(bureauId, storyId, { endTime });
      bureaus.setBureauTime(bureauId, endTime);
    })();

    let archive = null;
    let archiveError = null;
    if (bureau.hasApiKey && bureau.settings.memory.autoArchive) {
      try {
        archive = await archiveNow(req, res, bureauId, storyId);
      } catch (error) {
        console.error('[Bureau] Archiving the ended story failed:', error.message);
        archiveError = error.message;
      }
    }

    res.json({
      story: stories.getStory(bureauId, storyId),
      bureau: bureaus.getBureau(bureauId),
      archive,
      archiveError,
    });
  }),
);

// Commit the story to memory now: the Archivist reads every turn it hasn't read yet
router.post(
  '/:storyId/archive',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    requireStory(stories, bureauId, storyId);
    requireApiKey(bureau);

    const archive = await archiveNow(req, res, bureauId, storyId);
    res.json({ story: stories.getStory(bureauId, storyId), archive });
  }),
);

// Delete a story with its turns, and the memories, arc notes, and facts recorded from it
router.delete(
  '/:storyId',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId } = req.params;
    requireBureau(bureaus, bureauId);

    const { memories, arcNotes, facts } = res.locals.stores;
    let deleted = false;
    bureaus.db.transaction(() => {
      memories.deleteStoryMemories(bureauId, storyId);
      arcNotes.deleteStoryNotes(bureauId, storyId);
      facts.deleteStoryFacts(bureauId, storyId);
      deleted = stories.deleteStory(bureauId, storyId);
    })();
    if (!deleted) {
      throw new AppError('Chapter not found', 404);
    }
    res.json({ success: true });
  }),
);

// ==================== Turns ====================

// Add a turn from the reader without generating a reply, such as a scene break. Time passing in
// the chapter (kind time_passes) takes { step } or a later { to }, as letting Bureau time pass
// does: it moves on from the chapter's time (its last time passing, or its start), and the
// Bureau's clock moves up to it unless it's already later. Answers with the Bureau too.
router.post(
  '/:storyId/turns',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    const story = requireStory(stories, bureauId, storyId);
    requireActive(story);

    const body = req.body ?? {};
    const { kind } = body;
    if (!READER_TURN_KINDS.includes(kind)) {
      throw new AppError(`kind must be one of: ${READER_TURN_KINDS.join(', ')}`, 400);
    }

    if (kind === 'time_passes') {
      const from = chapterTime(story, stories.listTurns(storyId)).time;
      const bureauTime = resolveTime(() =>
        passTime(from, { step: body.step, to: body.to }, bureau.timezone),
      );
      if (Date.parse(bureauTime) <= Date.parse(from)) {
        throw new AppError(
          "Time only moves forward in a chapter: to must be later than the chapter's time.",
          400,
        );
      }
      // No offscreen life: the chapter covers this time. Bureau time never goes back from here,
      // since messages may already be dated later (after letting time pass between them).
      let turn;
      bureaus.db.transaction(() => {
        turn = stories.addTurn(storyId, { kind, source: 'user', bureauTime });
        if (Date.parse(bureauTime) > Date.parse(bureau.bureauTime)) {
          bureaus.setBureauTime(bureauId, bureauTime);
        }
      })();
      res.status(201).json({ turn, bureau: bureaus.getBureau(bureauId) });
      return;
    }

    const content = optionalString(body, 'content') ?? '';
    if (kind !== 'scene_break' && !content) {
      throw new AppError('content is required', 400);
    }

    const turn = stories.addTurn(storyId, {
      kind,
      source: 'user',
      content: kind === 'scene_break' ? '' : content,
      authorCastId: kind === 'prose' ? personaIn(bureaus, bureauId, story) : null,
    });
    res.status(201).json({ turn });
  }),
);

// Edit a turn's text
router.put(
  '/:storyId/turns/:turnId',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId, turnId } = req.params;
    requireBureau(bureaus, bureauId);
    requireStory(stories, bureauId, storyId);
    const turn = requireTurn(stories, storyId, turnId);
    if (turn.kind === 'time_passes') {
      throw new AppError("Time passing can't be edited. Delete it and let time pass again.", 400);
    }

    const content = optionalString(req.body ?? {}, 'content');
    if (content === undefined || (!content && turn.kind !== 'scene_break')) {
      throw new AppError('content is required', 400);
    }
    const edited = stories.editTurn(storyId, turnId, content);
    flagChangedTurns(res.locals.stores, bureauId, storyId, [turnId]);
    res.json({ turn: edited });
  }),
);

// Delete a turn
router.delete(
  '/:storyId/turns/:turnId',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId, turnId } = req.params;
    requireBureau(bureaus, bureauId);
    requireStory(stories, bureauId, storyId);

    if (!stories.deleteTurn(storyId, turnId)) {
      throw new AppError('Turn not found', 404);
    }
    flagChangedTurns(res.locals.stores, bureauId, storyId, [turnId]);
    res.json({ success: true });
  }),
);

// Show a different version of a turn
router.put(
  '/:storyId/turns/:turnId/variant',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId, turnId } = req.params;
    requireBureau(bureaus, bureauId);
    requireStory(stories, bureauId, storyId);
    const current = requireTurn(stories, storyId, turnId);

    const { variantId } = req.body ?? {};
    if (!variantId || typeof variantId !== 'string') {
      throw new AppError('variantId is required', 400);
    }
    const turn = stories.selectVariant(storyId, turnId, variantId);
    if (!turn) {
      throw new AppError('Variant not found', 404);
    }
    if (variantId !== current.activeVariantId) {
      flagChangedTurns(res.locals.stores, bureauId, storyId, [turnId]);
    }
    res.json({ turn });
  }),
);

// Undo one of the Editor's fixes to a turn, putting back the paragraph it replaced.
// index is the fix's place in the run's list of fixes.
router.post(
  '/:storyId/turns/:turnId/revert-edit',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId, turnId } = req.params;
    requireBureau(bureaus, bureauId);
    requireStory(stories, bureauId, storyId);
    const turn = requireTurn(stories, storyId, turnId);

    const { runId, index } = req.body ?? {};
    if (typeof runId !== 'string' || !Number.isInteger(index) || index < 0) {
      throw new AppError('runId and index are required', 400);
    }
    if (runId !== turn.runId) {
      throw new AppError("That run didn't write the version of this turn being shown", 409);
    }
    const fix = bureaus
      .getRun(bureauId, runId)
      ?.steps.find((step) => step.role === 'editor' && step.kind === 'tool')?.response?.edits?.[
      index
    ];
    if (!fix) {
      throw new AppError('Fix not found', 404);
    }
    // Check for the original first: a replacement can be part of it (when the Editor cut the
    // reader's lines), so finding the replacement doesn't mean the fix is still in place.
    if (turn.content.includes(fix.original)) {
      throw new AppError('This fix was already reverted', 409);
    }
    const at = paragraphIndexOf(turn.content, fix.replacement);
    if (at === -1) {
      throw new AppError('This fix was edited over', 409);
    }

    const updated = stories.editTurn(
      storyId,
      turnId,
      turn.content.slice(0, at) + fix.original + turn.content.slice(at + fix.replacement.length),
    );
    flagChangedTurns(res.locals.stores, bureauId, storyId, [turnId]);
    res.json({ turn: updated });
  }),
);

// ==================== Greetings ====================

// The greetings on the cards of everyone in the chapter but the reader's character, to open it
// with. A macro such as {{random}} picks again each time they're listed.
router.get(
  '/:storyId/greetings',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId } = req.params;
    requireBureau(bureaus, bureauId);
    const story = requireStory(stories, bureauId, storyId);

    const cast = story.castIds
      .map((castId) => bureaus.getCastMember(bureauId, castId))
      .filter(Boolean);
    res.json({ greetings: listGreetings(cast) });
  }),
);

// Open the chapter with a greeting kept as written: { content }, the text as it was listed, since a
// macro such as {{random}} picks again each time. It's added as prose from the reader. To have the
// Writer rewrite a greeting instead, generate with action 'greeting'.
router.post(
  '/:storyId/greetings',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId } = req.params;
    requireBureau(bureaus, bureauId);
    const story = requireStory(stories, bureauId, storyId);
    requireActive(story);

    const content = optionalString(req.body ?? {}, 'content');
    if (!content) {
      throw new AppError('content is required', 400);
    }
    const turn = stories.addTurn(storyId, { kind: 'prose', source: 'user', content });
    res.status(201).json({ turn });
  }),
);

// ==================== Generation ====================

// Generate the next turn. action 'write' adds the reader's text as prose first,
// 'direct' adds it as a direction, and 'continue' ignores text. 'greeting' has the Writer rewrite
// text, a greeting from the card of castId, as the chapter's opening.
router.post(
  '/:storyId/generate',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    const story = requireStory(stories, bureauId, storyId);
    requireActive(story);
    requireApiKey(bureau);

    const body = req.body ?? {};
    const { action } = body;
    if (!GENERATE_ACTIONS.includes(action)) {
      throw new AppError(`action must be one of: ${GENERATE_ACTIONS.join(', ')}`, 400);
    }
    const text = optionalString(body, 'text') ?? '';
    if (action !== 'continue' && !text) {
      throw new AppError(`text is required to ${action}`, 400);
    }

    let userTurn = null;
    let greeting;
    if (action === 'write') {
      userTurn = stories.addTurn(storyId, {
        kind: 'prose',
        source: 'user',
        content: text,
        authorCastId: personaIn(bureaus, bureauId, story),
      });
    } else if (action === 'direct') {
      userTurn = stories.addTurn(storyId, { kind: 'direction', source: 'user', content: text });
    } else if (action === 'greeting') {
      const member = story.castIds.includes(body.castId)
        ? bureaus.getCastMember(bureauId, body.castId)
        : null;
      if (!member) {
        throw new AppError('castId must be someone in this chapter', 400);
      }
      greeting = { name: member.seedCard?.data?.name || member.name, content: text };
    }

    await respondWithWriterTurn(req, res, {
      bureau,
      story,
      request: { action, direction: action === 'direct' ? text : undefined, greeting },
      regenerateTurnId: null,
      userTurn,
    });
  }),
);

// Regenerate a generated turn as a new variant, from the turns before it. A rewritten greeting is
// rewritten again.
router.post(
  '/:storyId/turns/:turnId/regenerate',
  asyncHandler(async (req, res) => {
    const { bureaus, stories } = res.locals.stores;
    const { bureauId, storyId, turnId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    const story = requireStory(stories, bureauId, storyId);
    requireActive(story);
    requireApiKey(bureau);

    const turns = stories.listTurns(storyId);
    const index = turns.findIndex((turn) => turn.id === turnId);
    if (index === -1) {
      throw new AppError('Turn not found', 404);
    }
    if (turns[index].source !== 'generated') {
      throw new AppError('Only generated turns can be regenerated', 400);
    }

    await respondWithWriterTurn(req, res, {
      bureau,
      story,
      request: requestForRegeneration(turns, index, bureaus.getRun(bureauId, turns[index].runId)),
      regenerateTurnId: turnId,
      userTurn: null,
    });
  }),
);

export default router;
