/**
 * Bureau Profile Routes
 *
 * Mounted at /api/bureaus/:bureauId. A cast member's profile is the Bureau's copy of their card,
 * and their routine (see "Profiles and interviews" in docs/bureau-design.md). It changes only by
 * hand or from an interview the reader accepts, keeps every version, and never reaches the
 * library character. Interview questions stream as server-sent events when the client asks for
 * text/event-stream, and answer with JSON otherwise.
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { sseChannel } from '../utils/sse.js';
import { PROFILE_FIELDS, profileOf } from '../services/bureau/bureau-storage.js';
import { DeepSeekError } from '../services/bureau/deepseek-client.js';
import {
  DEFAULT_FOCUS,
  INTERVIEW_FOCUSES,
  InterviewChangedError,
  ProfileChangedError,
  WRITE_UP_FIELDS,
  acceptProposal,
  askQuestion,
  writeUp,
} from '../services/bureau/interview.js';
import { InterviewConflictError } from '../services/bureau/interview-storage.js';
import {
  createBureauClient,
  optionalString,
  requireApiKey,
  requireBureau,
} from './bureau-route-helpers.js';

const router = express.Router({ mergeParams: true });

export const MAX_ROUTINE_CHARACTERS = 2000;
// Imported cards can be long; this only guards against runaway requests.
export const MAX_PROFILE_FIELD_CHARACTERS = 200_000;
export const MAX_ANSWER_CHARACTERS = 8000;
export const MAX_NOTE_CHARACTERS = 2000;

// Cast members with an interview question being written, so overlapping requests can't ask two.
const askingCastIds = new Set();

/** A cast member as the cast list shows them, without their seed card. */
function listing(member) {
  const { seedCard, ...castMember } = member;
  return castMember;
}

function requireCastMember(bureaus, bureauId, castId) {
  const member = bureaus.getCastMember(bureauId, castId);
  if (!member) {
    throw new AppError('Cast member not found', 404);
  }
  return member;
}

function requireOpenInterview(interviews, bureauId, castId) {
  const interview = interviews.getOpenInterview(bureauId, castId);
  if (!interview) {
    throw new AppError('There is no interview going', 404);
  }
  return interview;
}

/** A profile field from the body, trimmed, or undefined when it's absent. */
function profileField(body, field) {
  const value = optionalString(body, field);
  const limit = field === 'routine' ? MAX_ROUTINE_CHARACTERS : MAX_PROFILE_FIELD_CHARACTERS;
  if (value !== undefined && value.length > limit) {
    throw new AppError(`${field} must be at most ${limit} characters`, 400);
  }
  return value;
}

function profileResponse(bureaus, bureauId, member) {
  return {
    castMember: listing(member),
    profile: profileOf(member),
    versions: bureaus.listProfileVersions(bureauId, member.id),
  };
}

/** Take the right to write a cast member's next question; release it with releaseQuestion. */
function claimQuestion(member) {
  if (askingCastIds.has(member.id)) {
    throw new AppError(`A question for ${member.name} is already being written`, 409);
  }
  askingCastIds.add(member.id);
}

function releaseQuestion(member) {
  askingCastIds.delete(member.id);
}

/**
 * Write the interview's next question, or one in place of the latest, and answer the request: as
 * a stream of events when the client asked for one, otherwise as JSON once the question is saved.
 */
async function respondWithQuestion(req, res, { bureau, interview, member, replace = false }) {
  const { stores } = res.locals;
  const client = createBureauClient(req, stores.bureaus.getBureauCredentials(bureau.id));
  const channel = sseChannel(req, res);
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  channel.open();
  channel.send({ type: 'interview', interview });

  try {
    const saved = await askQuestion({
      stores,
      bureau,
      interview,
      member,
      client,
      replace,
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
      body: { interview: saved ?? stores.interviews.getOpenInterview(bureau.id, member.id) },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (!(error instanceof DeepSeekError)) {
      console.error('[Bureau] Interview question failed:', error);
    }
    channel.fail(error.message, error instanceof DeepSeekError ? 502 : 500);
  }
}

// ==================== Profiles ====================

// A cast member's profile, with every version kept
router.get(
  '/cast/:castId/profile',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    const { bureauId, castId } = req.params;
    requireBureau(bureaus, bureauId);
    const member = requireCastMember(bureaus, bureauId, castId);
    res.json(profileResponse(bureaus, bureauId, member));
  }),
);

// Change a cast member's profile by hand; each change is kept as a version
router.put(
  '/cast/:castId/profile',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    const { bureauId, castId } = req.params;
    requireBureau(bureaus, bureauId);
    requireCastMember(bureaus, bureauId, castId);

    const body = req.body ?? {};
    const updates = Object.fromEntries(
      PROFILE_FIELDS.map((field) => [field, profileField(body, field)]),
    );
    if (Object.values(updates).every((value) => value === undefined)) {
      throw new AppError('No updates provided', 400);
    }

    const member = bureaus.updateProfile(bureauId, castId, updates, { source: 'manual' });
    if (!member) {
      throw new AppError('Cast member not found', 404);
    }
    res.json(profileResponse(bureaus, bureauId, member));
  }),
);

// Put a cast member's profile back as it was at an earlier version, saved as a new version
router.post(
  '/cast/:castId/profile/versions/:versionId/restore',
  asyncHandler(async (req, res) => {
    const { bureaus } = res.locals.stores;
    const { bureauId, castId } = req.params;
    requireBureau(bureaus, bureauId);
    requireCastMember(bureaus, bureauId, castId);

    const versionId = Number(req.params.versionId);
    const member = Number.isInteger(versionId)
      ? bureaus.restoreProfileVersion(bureauId, castId, versionId)
      : null;
    if (!member) {
      throw new AppError('Version not found', 404);
    }
    res.json(profileResponse(bureaus, bureauId, member));
  }),
);

// ==================== Interviews ====================

// A cast member's open interview (null when there isn't one), with what an interview can focus on
router.get(
  '/cast/:castId/interview',
  asyncHandler(async (req, res) => {
    const { bureaus, interviews } = res.locals.stores;
    const { bureauId, castId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    const member = requireCastMember(bureaus, bureauId, castId);

    res.json({
      bureau,
      castMember: listing(member),
      interview: interviews.getOpenInterview(bureauId, castId),
      focuses: Object.entries(INTERVIEW_FOCUSES).map(([key, focus]) => ({
        key,
        label: focus.label,
        description: focus.description,
      })),
    });
  }),
);

// Start an interview and write its first question
router.post(
  '/cast/:castId/interview',
  asyncHandler(async (req, res) => {
    const { bureaus, interviews } = res.locals.stores;
    const { bureauId, castId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    const member = requireCastMember(bureaus, bureauId, castId);
    requireApiKey(bureau);

    const body = req.body ?? {};
    const focus = body.focus ?? DEFAULT_FOCUS;
    if (!Object.hasOwn(INTERVIEW_FOCUSES, focus)) {
      throw new AppError(`focus must be one of: ${Object.keys(INTERVIEW_FOCUSES).join(', ')}`, 400);
    }
    const note = optionalString(body, 'note') ?? '';
    if (note.length > MAX_NOTE_CHARACTERS) {
      throw new AppError(`note must be at most ${MAX_NOTE_CHARACTERS} characters`, 400);
    }

    claimQuestion(member);
    try {
      let interview;
      try {
        interview = interviews.startInterview(bureauId, castId, { focus, note });
      } catch (error) {
        if (error instanceof InterviewConflictError) {
          throw new AppError(`${member.name} already has an interview going`, 409);
        }
        throw error;
      }
      await respondWithQuestion(req, res, { bureau, interview, member });
    } finally {
      releaseQuestion(member);
    }
  }),
);

// Answer the latest question, then write the next one
router.post(
  '/cast/:castId/interview/answers',
  asyncHandler(async (req, res) => {
    const { bureaus, interviews } = res.locals.stores;
    const { bureauId, castId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    const member = requireCastMember(bureaus, bureauId, castId);
    requireApiKey(bureau);
    const interview = requireOpenInterview(interviews, bureauId, castId);

    const answer = optionalString(req.body ?? {}, 'text');
    if (!answer) {
      throw new AppError('text is required', 400);
    }
    if (answer.length > MAX_ANSWER_CHARACTERS) {
      throw new AppError(`text must be at most ${MAX_ANSWER_CHARACTERS} characters`, 400);
    }

    claimQuestion(member);
    try {
      const answered = interviews.addMessage(bureauId, interview.id, {
        source: 'user',
        content: answer,
      });
      await respondWithQuestion(req, res, { bureau, interview: answered, member });
    } finally {
      releaseQuestion(member);
    }
  }),
);

// Write a different question in place of the latest, or a question when there isn't one to answer
router.post(
  '/cast/:castId/interview/ask-again',
  asyncHandler(async (req, res) => {
    const { bureaus, interviews } = res.locals.stores;
    const { bureauId, castId } = req.params;
    const bureau = requireBureau(bureaus, bureauId);
    const member = requireCastMember(bureaus, bureauId, castId);
    requireApiKey(bureau);
    const interview = requireOpenInterview(interviews, bureauId, castId);

    claimQuestion(member);
    try {
      await respondWithQuestion(req, res, { bureau, interview, member, replace: true });
    } finally {
      releaseQuestion(member);
    }
  }),
);

// Write up the answers as a new description, personality, and routine for the reader to review
router.post(
  '/cast/:castId/interview/write-up',
  asyncHandler(async (req, res) => {
    const { stores } = res.locals;
    const { bureauId, castId } = req.params;
    const bureau = requireBureau(stores.bureaus, bureauId);
    const member = requireCastMember(stores.bureaus, bureauId, castId);
    requireApiKey(bureau);
    const interview = requireOpenInterview(stores.interviews, bureauId, castId);
    if (!interview.messages.some((message) => message.source === 'user')) {
      throw new AppError('Answer at least one question before writing it up', 400);
    }

    const client = createBureauClient(req, stores.bureaus.getBureauCredentials(bureauId));
    try {
      res.json({ interview: await writeUp({ stores, bureau, interview, member, client }) });
    } catch (error) {
      if (error instanceof DeepSeekError) {
        throw new AppError(error.message, 502);
      }
      if (error instanceof InterviewChangedError) {
        throw new AppError(error.message, 409);
      }
      throw error;
    }
  }),
);

// Accept the write-up, as the reader edited it, into the profiles it changes
router.post(
  '/cast/:castId/interview/accept',
  asyncHandler(async (req, res) => {
    const { stores } = res.locals;
    const { bureauId, castId } = req.params;
    const bureau = requireBureau(stores.bureaus, bureauId);
    const member = requireCastMember(stores.bureaus, bureauId, castId);
    const interview = requireOpenInterview(stores.interviews, bureauId, castId);
    if (!interview.proposal) {
      throw new AppError('Write up the interview before accepting it', 400);
    }

    const body = req.body ?? {};
    const edits = Object.fromEntries(
      WRITE_UP_FIELDS.map((field) => [field, profileField(body, field)]),
    );
    if (body.relationships !== undefined) {
      const valid =
        Array.isArray(body.relationships) &&
        body.relationships.every(
          (line) =>
            typeof line?.castId === 'string' &&
            typeof line?.addition === 'string' &&
            line.addition.length <= MAX_PROFILE_FIELD_CHARACTERS,
        );
      if (!valid) {
        throw new AppError('relationships must be a list of { castId, addition }', 400);
      }
      edits.relationships = body.relationships;
    }

    let accepted;
    try {
      accepted = acceptProposal({ stores, bureau, interview, member, edits });
    } catch (error) {
      if (error instanceof ProfileChangedError) {
        throw new AppError(error.message, 409);
      }
      throw error;
    }
    res.json({
      castMember: listing(accepted.castMember),
      interview: accepted.interview,
      updated: accepted.updated.map(listing),
    });
  }),
);

// Discard the open interview; its profile stays as it is
router.delete(
  '/cast/:castId/interview',
  asyncHandler(async (req, res) => {
    const { bureaus, interviews } = res.locals.stores;
    const { bureauId, castId } = req.params;
    requireBureau(bureaus, bureauId);
    requireCastMember(bureaus, bureauId, castId);
    const interview = requireOpenInterview(interviews, bureauId, castId);

    interviews.deleteInterview(bureauId, interview.id);
    res.json({ success: true });
  }),
);

export default router;
