/**
 * Bureau Correspondence Routes
 *
 * Mounted at /api/bureaus/:bureauId/threads. Each cast member has one thread
 * with the Bureau's reader's character (see "Correspondence" in
 * docs/bureau-design.md). Messages and replies happen at the current Bureau
 * time and never move it: the reader lets time pass themselves. Replies stream
 * as server-sent events when the client asks for text/event-stream, and answer
 * with JSON otherwise.
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { sseChannel } from '../utils/sse.js';
import { DeepSeekError } from '../services/bureau/deepseek-client.js';
import { archiveSettledSessions, archiveThread } from '../services/bureau/archivist.js';
import { generateReply } from '../services/bureau/correspondence.js';
import {
  createBureauClient,
  optionalString,
  requireApiKey,
  requireBureau,
} from './bureau-route-helpers.js';

const router = express.Router({ mergeParams: true });

export const MAX_MESSAGE_CHARACTERS = 8000;

/** The reader's character, with their seed card. */
function requirePersona(bureaus, bureauId) {
  const persona = bureaus.listCast(bureauId).find((member) => member.isPersona);
  if (!persona) {
    throw new AppError("Choose a reader's character in the cast before writing to anyone", 400);
  }
  return bureaus.getCastMember(bureauId, persona.id);
}

/** The cast member a thread is with, with their seed card. */
function requireCorrespondent(bureaus, bureauId, castId) {
  const member = bureaus.getCastMember(bureauId, castId);
  if (!member) {
    throw new AppError('Cast member not found', 404);
  }
  if (member.isPersona) {
    throw new AppError("The reader's character has no thread with themselves", 400);
  }
  return member;
}

function requireThread(threads, bureauId, castId) {
  const thread = threads.getThreadForCast(bureauId, castId);
  if (!thread) {
    throw new AppError('Thread not found', 404);
  }
  return thread;
}

function messageText(body, field) {
  const text = optionalString(body, field);
  if (!text) {
    throw new AppError(`${field} is required`, 400);
  }
  if (text.length > MAX_MESSAGE_CHARACTERS) {
    throw new AppError(`${field} must be at most ${MAX_MESSAGE_CHARACTERS} characters`, 400);
  }
  return text;
}

/** A cast member as the cast list shows them, without their seed card. */
function castListing(bureaus, bureauId, castId) {
  return bureaus.listCast(bureauId).find((member) => member.id === castId) ?? null;
}

/**
 * Write the cast member's reply and answer the request: as a stream of events
 * when the client asked for one, otherwise as JSON once the reply is saved.
 */
async function respondWithReply(req, res, { bureau, thread, member, persona, message }) {
  const { stores } = res.locals;
  const client = createBureauClient(req, stores.bureaus.getBureauCredentials(bureau.id));
  const channel = sseChannel(req, res);
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  channel.open();
  if (message) {
    channel.send({ type: 'message', message });
  }

  try {
    const replies = await generateReply({
      stores,
      bureau,
      thread,
      member,
      persona,
      client,
      signal: controller.signal,
      onEvent: (event) => channel.send(event),
    });
    if (controller.signal.aborted) {
      // The client left; anything written so far was saved.
      if (!res.writableEnded) res.end();
      return;
    }
    channel.finish({
      statusCode: 201,
      body: { message, replies, bureau: stores.bureaus.getBureau(bureau.id) },
    });

    // Finished sessions go into memory. Tests turn this off with app.locals.bureauAutoArchive.
    if (bureau.settings.memory.autoArchive && (req.app.locals.bureauAutoArchive ?? true)) {
      archiveSettledSessions({ stores, bureauId: bureau.id, threadId: thread.id, client });
    }
  } catch (error) {
    if (controller.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (!(error instanceof DeepSeekError)) {
      console.error('[Bureau] Reply failed:', error);
    }
    channel.fail(error.message, error instanceof DeepSeekError ? 502 : 500);
  }
}

// Everyone the reader can write to, each with their thread (null before the first message)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { bureaus, threads } = res.locals.stores;
    const { bureauId } = req.params;
    requireBureau(bureaus, bureauId);

    const cast = bureaus.listCast(bureauId);
    const threadByCast = new Map(
      threads.listThreads(bureauId).map((thread) => [thread.castMemberId, thread]),
    );
    res.json({
      personaId: cast.find((member) => member.isPersona)?.id ?? null,
      correspondents: cast
        .filter((member) => !member.isPersona)
        .map((member) => ({ castMember: member, thread: threadByCast.get(member.id) ?? null })),
    });
  }),
);

// A cast member's thread and its messages
router.get(
  '/:castId',
  asyncHandler(async (req, res) => {
    const { bureaus, threads } = res.locals.stores;
    const { bureauId, castId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    requireCorrespondent(bureaus, bureauId, castId);

    const thread = threads.getThreadForCast(bureauId, castId);
    res.json({
      bureau,
      castMember: castListing(bureaus, bureauId, castId),
      thread,
      messages: thread ? threads.listMessages(thread.id) : [],
    });
  }),
);

// Send a message as the reader's character, at the current Bureau time. The
// cast member replies unless reply is false.
router.post(
  '/:castId/messages',
  asyncHandler(async (req, res) => {
    const { bureaus, threads } = res.locals.stores;
    const { bureauId, castId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    const member = requireCorrespondent(bureaus, bureauId, castId);
    const persona = requirePersona(bureaus, bureauId);
    const body = req.body ?? {};
    const text = messageText(body, 'text');
    const wantsReply = body.reply !== false;
    if (wantsReply) {
      requireApiKey(bureau);
    }

    let thread;
    let message;
    bureaus.db.transaction(() => {
      thread = threads.getOrCreateThread(bureauId, castId);
      message = threads.addMessage(thread.id, {
        source: 'user',
        senderCastId: persona.id,
        content: text,
        bureauTime: bureau.bureauTime,
      });
    })();

    if (!wantsReply) {
      res.status(201).json({ message, bureau: bureaus.getBureau(bureauId) });
      return;
    }
    await respondWithReply(req, res, {
      bureau: bureaus.getBureau(bureauId),
      thread,
      member,
      persona,
      message,
    });
  }),
);

// Have the cast member write without a new message from the reader
router.post(
  '/:castId/reply',
  asyncHandler(async (req, res) => {
    const { bureaus, threads } = res.locals.stores;
    const { bureauId, castId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    const member = requireCorrespondent(bureaus, bureauId, castId);
    const persona = requirePersona(bureaus, bureauId);
    requireApiKey(bureau);

    await respondWithReply(req, res, {
      bureau,
      thread: threads.getOrCreateThread(bureauId, castId),
      member,
      persona,
      message: null,
    });
  }),
);

// Commit the thread to memory now: the Archivist reads every message it hasn't read yet
router.post(
  '/:castId/archive',
  asyncHandler(async (req, res) => {
    const { stores } = res.locals;
    const { bureauId, castId } = req.params;
    const bureau = requireBureau(stores.bureaus, bureauId);
    requireApiKey(bureau);
    const thread = requireThread(stores.threads, bureauId, castId);

    const client = createBureauClient(req, stores.bureaus.getBureauCredentials(bureauId));
    let archive;
    try {
      archive = await archiveThread({ stores, bureauId, threadId: thread.id, client });
    } catch (error) {
      if (error instanceof DeepSeekError) {
        throw new AppError(error.message, 502);
      }
      throw error;
    }
    res.json({ thread: stores.threads.getThread(bureauId, thread.id), archive });
  }),
);

/** Mark memories, arc notes, and facts that cite a changed or deleted message for review. */
function flagChangedMessage({ memories, arcNotes, facts }, bureauId, threadId, messageId) {
  memories.flagTurnsChanged(bureauId, threadId, [messageId], 'correspondence');
  arcNotes.flagTurnsChanged(bureauId, threadId, [messageId], 'correspondence');
  facts.flagTurnsChanged(bureauId, threadId, [messageId], 'correspondence');
}

// Edit a message; memories, arc notes, and facts citing it are marked for review
router.put(
  '/:castId/messages/:messageId',
  asyncHandler(async (req, res) => {
    const { bureaus, threads } = res.locals.stores;
    const { bureauId, castId, messageId } = req.params;
    requireBureau(bureaus, bureauId);
    const thread = requireThread(threads, bureauId, castId);
    const content = messageText(req.body ?? {}, 'content');

    const message = threads.editMessage(thread.id, messageId, content);
    if (!message) {
      throw new AppError('Message not found', 404);
    }
    flagChangedMessage(res.locals.stores, bureauId, thread.id, messageId);
    res.json({ message });
  }),
);

// Delete a message; memories, arc notes, and facts citing it are marked for review
router.delete(
  '/:castId/messages/:messageId',
  asyncHandler(async (req, res) => {
    const { bureaus, threads } = res.locals.stores;
    const { bureauId, castId, messageId } = req.params;
    requireBureau(bureaus, bureauId);
    const thread = requireThread(threads, bureauId, castId);

    if (!threads.deleteMessage(thread.id, messageId)) {
      throw new AppError('Message not found', 404);
    }
    flagChangedMessage(res.locals.stores, bureauId, thread.id, messageId);
    res.json({ success: true });
  }),
);

export default router;
