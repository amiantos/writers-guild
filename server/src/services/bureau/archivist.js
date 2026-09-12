/**
 * Archivist
 *
 * Reads a story's turns and records what its characters will remember (see
 * "Archivist" in docs/bureau-design.md). Each pass is one forced call to a
 * strict record_memories tool, which returns knowledge, an episode per
 * character, arc notes, and the story's running summary.
 *
 * Memories apply without review, because every memory is visible, sourced, and
 * editable in the memory browser. Arc notes, which change how a character is
 * written, are only proposed: the reader accepts or rejects each one. The
 * reader's character gets neither: the reader remembers for them.
 */

import { describeBureauTime } from './bureau-time.js';
import { isBeforeStory, memoriesAsOf, selectForPrompt } from './memory.js';
import { RunRecorder } from './run-recorder.js';

// The latest turns may still be regenerated or edited, so automatic passes leave them.
export const SETTLE_TURNS = 6;
// Settled prose turns that must be waiting before an automatic pass runs.
export const MIN_SETTLED_PROSE = 6;
// Story text per pass; longer stretches are read in several passes.
export const ARCHIVE_CHUNK_CHARACTERS = 60_000;
// Existing knowledge shown per character, so the Archivist updates rather than repeats.
export const KNOWN_CHARACTERS_PER_CHARACTER = 12_000;

export const RECORD_MEMORIES_TOOL = {
  name: 'record_memories',
  description: 'Record what the characters will remember from the new passages.',
  parameters: {
    type: 'object',
    properties: {
      knowledge: {
        type: 'array',
        description: 'Lasting facts the characters learned. Empty when nothing lasting happened.',
        items: {
          type: 'object',
          properties: {
            character: {
              type: 'string',
              description: 'Name of the character who remembers this.',
            },
            content: {
              type: 'string',
              description: 'One fact, in the third person, using names.',
            },
            importance: {
              type: 'integer',
              description: '1 trivia, 2 minor, 3 useful, 4 significant, 5 defining.',
            },
            supersedes: {
              type: 'integer',
              description: "Number of the character's memory this updates or corrects, or 0.",
            },
            passages: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Numbers of the passages this comes from.',
            },
          },
          required: ['character', 'content', 'importance', 'supersedes', 'passages'],
          additionalProperties: false,
        },
      },
      episodes: {
        type: 'array',
        description: 'One per character, telling the whole story so far from their point of view.',
        items: {
          type: 'object',
          properties: {
            character: { type: 'string', description: 'Name of the character.' },
            content: { type: 'string', description: 'At most 120 words, past tense.' },
          },
          required: ['character', 'content'],
          additionalProperties: false,
        },
      },
      arc_notes: {
        type: 'array',
        description:
          'Ways a character changed in these passages, for the reader to review. Usually empty.',
        items: {
          type: 'object',
          properties: {
            character: { type: 'string', description: 'Name of the character who changed.' },
            content: {
              type: 'string',
              description: 'How they have changed, in one or two sentences, in the third person.',
            },
            rationale: { type: 'string', description: 'What in the passages shows it.' },
            passages: {
              type: 'array',
              items: { type: 'integer' },
              description: 'Numbers of the passages that show it.',
            },
          },
          required: ['character', 'content', 'rationale', 'passages'],
          additionalProperties: false,
        },
      },
      story_summary: {
        type: 'string',
        description: 'What has happened in the whole story so far, at most 150 words.',
      },
    },
    required: ['knowledge', 'episodes', 'arc_notes', 'story_summary'],
    additionalProperties: false,
  },
};

class StoryDeletedError extends Error {
  constructor() {
    super('The story was deleted while it was being archived');
    this.name = 'StoryDeletedError';
  }
}

// ==================== Deciding what to read ====================

/**
 * The position an automatic pass should read through, or null when too little
 * has settled since the last pass.
 * @param {Array<Object>} turns - The story's turns in order.
 * @param {Object} story - Uses archivedThrough.
 */
export function autoArchiveThrough(turns, story) {
  const settled = turns.slice(0, Math.max(0, turns.length - SETTLE_TURNS));
  const waiting = settled.filter(
    (turn) => turn.kind === 'prose' && turn.position > story.archivedThrough,
  );
  return waiting.length >= MIN_SETTLED_PROSE ? settled.at(-1).position : null;
}

/** Split turns into passes of about `budget` characters of text, at least one turn each. */
export function chunkTurns(turns, budget = ARCHIVE_CHUNK_CHARACTERS) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const turn of turns) {
    const turnSize = turn.content.length + 16;
    if (current.length > 0 && size + turnSize > budget) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(turn);
    size += turnSize;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// ==================== Prompt ====================

function nameOf(member) {
  return member.seedCard?.data?.name || member.name;
}

function listNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function section(title, body) {
  return `=== ${title} ===\n${body}`;
}

/**
 * @param {Object} params
 * @param {Object} params.story - Uses title and summary.
 * @param {string|null} params.openingTime - Loose description of the start time.
 * @param {Array<Object>} params.characters - Cast members who remember.
 * @param {Object|null} params.persona - The reader's character, if present.
 * @param {Map<string, Array<Object>>} params.knownByCast - Knowledge each character has now.
 * @param {Map<string, Object>} params.episodeByCast - Each character's episode for this story.
 * @param {Map<string, {accepted: Array<Object>, proposed: Array<Object>}>} [params.notesByCast] -
 *   Each character's accepted arc notes and the proposals waiting for review.
 * @param {Array<Object>} params.turns - The turns to read, in order.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildArchivistMessages({
  story,
  openingTime,
  characters,
  persona,
  knownByCast,
  episodeByCast,
  notesByCast = new Map(),
  turns,
}) {
  const names = characters.map(nameOf);
  const personaName = persona ? nameOf(persona) : null;
  const about = personaName ? `the people around them (including ${personaName})` : 'each other';

  const system = [
    'You are the Archivist for a series of connected stories. Read the new passages, then call record_memories once with what the characters will remember.',
    `Characters who remember: ${names.length > 0 ? listNames(names) : 'none'}.`,
  ];
  if (personaName) {
    system.push(
      `${personaName} is the reader's character. Record what the other characters learn about ${personaName}, but never ${personaName}'s own memories.`,
    );
  }
  system.push(
    [
      'Knowledge:',
      `- Lasting facts a character learned, or that changed: about ${about}, their relationships, promises, plans, preferences, places, and running jokes.`,
      '- One fact per memory, in the third person with names, never "I" or "you". Record only what that character saw, heard, or was told.',
      '- Each memory must make sense on its own, read months later: say who and what, never "this" or "that" for something in another memory.',
      '- Skip passing actions, scenery, short-lived plans, and anything the character already knows.',
      "- When a fact updates or contradicts one of the character's numbered memories, set supersedes to that number and write the complete updated fact. Otherwise set supersedes to 0.",
      '- Importance: 1 trivia, 2 minor detail, 3 useful, 4 significant, 5 defining (a milestone in a relationship, a secret revealed).',
      '- passages lists the numbers of the passages the fact comes from.',
      '- Recording no knowledge is fine when nothing lasting happened.',
    ].join('\n'),
    'Episodes: one for each character who remembers, telling what happened in this story so far from their point of view, in the past tense, in at most 120 words. When they already have an episode for this story, rewrite it to include the new passages.',
    "Arc notes: only when the passages change who a character is, such as a new habit, a stance that softened or hardened, or a lasting decision about themselves or someone else. Not a fact they learned (that's knowledge), and not a passing mood. Write how they have changed in one or two sentences, with a rationale naming what in the passages shows it. Don't repeat a change they already have or one waiting for review. Most passages call for none; the reader reviews every one.",
    'story_summary: what has happened in the whole story so far, in at most 150 words, updating the previous summary.',
  );

  const present = personaName ? [...names, `${personaName} (the reader's character)`] : names;
  const storyLines = [`Title: ${story.title}`];
  if (openingTime) storyLines.push(`Begins: ${openingTime}`);
  storyLines.push(`Present: ${present.length > 0 ? listNames(present) : 'no one in the cast'}`);

  const known = characters.map((member) => {
    const lines = [`${nameOf(member)}:`];
    const knowledge = knownByCast.get(member.id) ?? [];
    lines.push(
      ...(knowledge.length > 0
        ? knowledge.map((memory) => `[${memory.id}] ${memory.content}`)
        : ['(nothing yet)']),
    );
    const episode = episodeByCast.get(member.id);
    if (episode) {
      lines.push(`Episode for this story so far: ${episode.content}`);
    }
    const notes = notesByCast.get(member.id);
    if (notes?.accepted.length > 0) {
      lines.push(
        `How ${nameOf(member)} has changed so far:`,
        ...notes.accepted.map((note) => `- ${note.content}`),
      );
    }
    if (notes?.proposed.length > 0) {
      lines.push(
        'Changes already waiting for review:',
        ...notes.proposed.map((note) => `- ${note.content}`),
      );
    }
    return lines.join('\n');
  });

  const passages = turns
    .filter((turn) => turn.kind === 'prose' || turn.kind === 'scene_break')
    .map((turn) =>
      turn.kind === 'scene_break' ? '---' : `[Passage ${turn.position}]\n${turn.content}`,
    );

  const user = [section('STORY', storyLines.join('\n'))];
  user.push(
    section(
      'SUMMARY SO FAR',
      story.summary || 'Nothing has been summarized yet; these are the first passages.',
    ),
  );
  if (known.length > 0) {
    user.push(section('WHAT THEY ALREADY KNOW', known.join('\n\n')));
  }
  user.push(section('NEW PASSAGES', passages.join('\n\n')));

  return [
    { role: 'system', content: system.join('\n\n') },
    { role: 'user', content: user.join('\n\n') },
  ];
}

// ==================== Applying a record ====================

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Save one pass's record, skipping anything that doesn't check out.
 * @returns {{ added: number, superseded: number, episodes: number, arcNotes: number,
 *   warnings: string[] }}
 */
function applyRecord({
  stores,
  bureauId,
  story,
  record,
  characters,
  knownByCast,
  episodeByCast,
  notesByCast,
  turns,
  runId,
  archivedThrough,
}) {
  const { memories, stories } = stores;
  const byName = new Map(characters.map((member) => [nameOf(member).toLowerCase(), member]));
  const turnIdByPosition = new Map(
    turns.filter((turn) => turn.kind === 'prose').map((turn) => [turn.position, turn.id]),
  );
  const turnIdsFor = (passages) => [
    ...new Set(
      (Array.isArray(passages) ? passages : [])
        .map((position) => turnIdByPosition.get(position))
        .filter(Boolean),
    ),
  ];
  const result = { added: 0, superseded: 0, episodes: 0, arcNotes: 0, warnings: [] };

  const memberFor = (name, what) => {
    const member = byName.get(text(name).toLowerCase());
    if (!member) {
      result.warnings.push(
        `Skipped ${what} for "${text(name)}", who isn't a character that remembers`,
      );
    }
    return member;
  };

  const base = { sourceType: 'story', sourceId: story.id, worldTime: story.startTime, runId };

  // The model read memories as they were before its call, which can take a while. Replace one
  // only if it's still that memory: not pinned, edited, retired, or replaced since, including
  // by an earlier item in this record. Call inside the transaction.
  const replaced = new Set();
  const canReplace = (castId, seen) => {
    const current = memories.getMemory(bureauId, seen.id);
    return (
      Boolean(current) &&
      current.castMemberId === castId &&
      !current.pinned &&
      !current.retired &&
      current.supersededBy === null &&
      current.content === seen.content &&
      current.modified === seen.modified &&
      !replaced.has(seen.id)
    );
  };

  stores.bureaus.db.transaction(() => {
    if (!stories.getStory(bureauId, story.id)) {
      throw new StoryDeletedError();
    }

    // Turns edited, regenerated, or deleted while the model was reading them.
    const changedTurnIds = turns
      .filter((turn) => stories.getTurn(story.id, turn.id)?.content !== turn.content)
      .map((turn) => turn.id);

    for (const item of Array.isArray(record.knowledge) ? record.knowledge : []) {
      const member = memberFor(item?.character, 'a memory');
      const content = text(item?.content);
      if (!member || !content) continue;

      let supersedes = null;
      if (item.supersedes) {
        const seen = (knownByCast.get(member.id) ?? []).find(
          (memory) => memory.id === item.supersedes,
        );
        if (seen && canReplace(member.id, seen)) {
          supersedes = seen.id;
          replaced.add(seen.id);
          result.superseded += 1;
        } else {
          result.warnings.push(
            `Kept memory ${item.supersedes} for ${nameOf(member)}: it can't be replaced`,
          );
        }
      }

      memories.addMemory(bureauId, member.id, {
        ...base,
        layer: 'knowledge',
        content,
        importance: item.importance,
        sourceTurnIds: turnIdsFor(item.passages),
        supersedes,
      });
      result.added += 1;
    }

    // One episode per character per story; a later one in the same record wins.
    const episodes = new Map();
    for (const item of Array.isArray(record.episodes) ? record.episodes : []) {
      const member = memberFor(item?.character, 'an episode');
      const content = text(item?.content);
      if (member && content) episodes.set(member.id, content);
    }
    const proseTurnIds = turns.filter((turn) => turn.kind === 'prose').map((turn) => turn.id);
    for (const [castId, content] of episodes) {
      const previous = episodeByCast.get(castId) ?? null;
      if (previous && !canReplace(castId, previous)) {
        const name = nameOf(characters.find((member) => member.id === castId));
        result.warnings.push(
          `Kept ${name}'s episode for this story: it was pinned or changed during the pass`,
        );
        continue;
      }
      memories.addMemory(bureauId, castId, {
        ...base,
        layer: 'episode',
        content,
        // An episode covers every passage so far, so a change to any of them flags it.
        sourceTurnIds: [...new Set([...(previous?.sourceTurnIds ?? []), ...proseTurnIds])],
        supersedes: previous?.id ?? null,
      });
      result.episodes += 1;
    }

    // Arc notes are proposals for the reader, skipping changes the character already has or
    // that are already waiting.
    const seenNotes = new Set(
      [...notesByCast.entries()].flatMap(([castId, notes]) =>
        [...notes.accepted, ...notes.proposed].map(
          (note) => `${castId}:${note.content.toLowerCase()}`,
        ),
      ),
    );
    for (const item of Array.isArray(record.arc_notes) ? record.arc_notes : []) {
      const member = memberFor(item?.character, 'an arc note');
      const content = text(item?.content);
      if (!member || !content) continue;
      const key = `${member.id}:${content.toLowerCase()}`;
      if (seenNotes.has(key)) continue;
      seenNotes.add(key);

      stores.arcNotes.addNote(bureauId, member.id, {
        ...base,
        content,
        rationale: text(item.rationale),
        status: 'proposed',
        sourceTurnIds: turnIdsFor(item.passages),
      });
      result.arcNotes += 1;
    }

    if (changedTurnIds.length > 0) {
      memories.flagTurnsChanged(bureauId, story.id, changedTurnIds);
      stores.arcNotes.flagTurnsChanged(bureauId, story.id, changedTurnIds);
      result.warnings.push(
        `Marked for review: ${changedTurnIds.length} passage(s) changed while the Archivist read them`,
      );
    }

    stories.setArchiveProgress(story.id, {
      archivedThrough,
      summary: text(record.story_summary) || story.summary,
    });
  })();

  return result;
}

// ==================== Running passes ====================

const storyLocks = new Map();

/** Run `work` after any archive already running for the story. */
function withStoryLock(storyId, work) {
  const previous = storyLocks.get(storyId) ?? Promise.resolve();
  const run = previous.then(work);
  const tail = run.catch(() => {});
  storyLocks.set(storyId, tail);
  tail.finally(() => {
    if (storyLocks.get(storyId) === tail) storyLocks.delete(storyId);
  });
  return run;
}

/** Whether an archive is running or queued for a story. */
export function isArchiving(storyId) {
  return storyLocks.has(storyId);
}

/**
 * What each character remembering in this story knows now, their episode for it, and their
 * arc notes: accepted ones the story can see, and every proposal still waiting.
 */
function currentMemories(stores, bureauId, story, characters) {
  const knownByCast = new Map();
  const episodeByCast = new Map();
  const notesByCast = new Map();
  for (const member of characters) {
    const notes = stores.arcNotes.listNotes(bureauId, member.id);
    notesByCast.set(member.id, {
      accepted: notes.filter(
        (note) =>
          note.status === 'accepted' &&
          (isBeforeStory(note, story) ||
            (note.sourceType === 'story' && note.sourceId === story.id)),
      ),
      proposed: notes.filter((note) => note.status === 'proposed'),
    });

    const asOf = memoriesAsOf(
      stores.memories.listMemories(bureauId, member.id, { status: 'all' }),
      story,
      { includeOwnStory: true },
    );
    knownByCast.set(
      member.id,
      selectForPrompt(asOf, {
        knowledgeCharacters: KNOWN_CHARACTERS_PER_CHARACTER,
        recentEpisodes: 0,
      }).knowledge,
    );
    const episode = asOf.find(
      (memory) =>
        memory.layer === 'episode' && memory.sourceType === 'story' && memory.sourceId === story.id,
    );
    if (episode) episodeByCast.set(member.id, episode);
  }
  return { knownByCast, episodeByCast, notesByCast };
}

async function readChunk({ stores, bureau, storyId, client, recorder, chunk, signal }) {
  // Re-read the story each pass: the previous pass updated its summary.
  const story = stores.stories.getStory(bureau.id, storyId);
  if (!story) {
    throw new StoryDeletedError();
  }
  const cast = story.castIds
    .map((castId) => stores.bureaus.getCastMember(bureau.id, castId))
    .filter(Boolean);
  const persona = cast.find((member) => member.isPersona) ?? null;
  const characters = cast.filter((member) => member !== persona);
  const { knownByCast, episodeByCast, notesByCast } = currentMemories(
    stores,
    bureau.id,
    story,
    characters,
  );

  const messages = buildArchivistMessages({
    story,
    openingTime: describeBureauTime(story.startTime, bureau.timezone),
    characters,
    persona,
    knownByCast,
    episodeByCast,
    notesByCast,
    turns: chunk,
  });
  const options = {
    messages,
    tools: [RECORD_MEMORIES_TOOL],
    strict: true,
    toolChoice: { name: RECORD_MEMORIES_TOOL.name },
    thinking: false,
    maxTokens: 8000,
    signal,
  };
  const recordedRequest = { model: client.model, thinking: false, maxTokens: 8000, messages };

  const started = Date.now();
  let response;
  try {
    response = await client.chat(options);
  } catch (error) {
    recorder.recordStep({
      role: 'archivist',
      kind: 'model',
      request: recordedRequest,
      error: error.message,
      durationMs: Date.now() - started,
    });
    throw error;
  }
  recorder.recordStep({
    role: 'archivist',
    kind: 'model',
    request: recordedRequest,
    response: { finishReason: response.finishReason, model: response.model },
    toolCalls: response.toolCalls,
    usage: response.usage,
    durationMs: Date.now() - started,
  });

  const call = response.toolCalls.find(
    (toolCall) => toolCall.function?.name === RECORD_MEMORIES_TOOL.name,
  );
  if (!call) {
    throw new Error("The Archivist didn't record anything");
  }
  let record;
  try {
    record = JSON.parse(call.function.arguments);
  } catch {
    const cutOff = response.finishReason === 'length' ? ' (it ran out of tokens)' : '';
    throw new Error(`The Archivist's record wasn't valid JSON${cutOff}`);
  }

  const result = applyRecord({
    stores,
    bureauId: bureau.id,
    story,
    record,
    characters,
    knownByCast,
    episodeByCast,
    notesByCast,
    turns: chunk,
    runId: recorder.runId,
    archivedThrough: chunk.at(-1).position,
  });
  recorder.recordStep({
    role: 'archivist',
    kind: 'tool',
    request: { id: call.id, name: RECORD_MEMORIES_TOOL.name, arguments: record },
    response: result,
  });
  return result;
}

/**
 * Read a story's unread turns through a position and record what the characters remember.
 *
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {string} params.bureauId
 * @param {string} params.storyId
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {number} [params.through] - Last position to read; defaults to the end of the story.
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object|null>} Totals for the passes ({ passes, added, superseded, episodes,
 *   arcNotes, warnings, archivedThrough, runId }), or null when there was nothing to read.
 */
export function archiveStory({ stores, bureauId, storyId, client, through = Infinity, signal }) {
  return withStoryLock(storyId, async () => {
    const bureau = stores.bureaus.getBureau(bureauId);
    const story = bureau ? stores.stories.getStory(bureauId, storyId) : null;
    if (!story) return null;

    const unread = stores.stories
      .listTurns(storyId)
      .filter((turn) => turn.position > story.archivedThrough && turn.position <= through);
    if (unread.length === 0) return null;

    const totals = {
      passes: 0,
      added: 0,
      superseded: 0,
      episodes: 0,
      arcNotes: 0,
      warnings: [],
      archivedThrough: story.archivedThrough,
      runId: null,
    };
    let recorder = null;

    try {
      for (const chunk of chunkTurns(unread)) {
        const last = chunk.at(-1).position;
        if (!chunk.some((turn) => turn.kind === 'prose')) {
          // Only directions and scene breaks: nothing to remember.
          const current = stores.stories.getStory(bureauId, storyId);
          if (!current) throw new StoryDeletedError();
          stores.stories.setArchiveProgress(storyId, {
            archivedThrough: last,
            summary: current.summary,
          });
        } else {
          recorder ??= new RunRecorder(stores.bureaus, {
            bureauId,
            purpose: 'archive',
            targetType: 'story',
            targetId: storyId,
          });
          totals.runId = recorder.runId;
          const result = await readChunk({
            stores,
            bureau,
            storyId,
            client,
            recorder,
            chunk,
            signal,
          });
          totals.passes += 1;
          totals.added += result.added;
          totals.superseded += result.superseded;
          totals.episodes += result.episodes;
          totals.arcNotes += result.arcNotes;
          totals.warnings.push(...result.warnings);
        }
        totals.archivedThrough = last;
      }
    } catch (error) {
      recorder?.fail(error);
      throw error;
    }

    recorder?.complete();
    return totals;
  });
}

const backgroundArchives = new Set();

/**
 * Start an automatic pass over a story's settled turns, if enough have settled
 * and no archive is already running. It runs in the background: failures are
 * logged and recorded in the run, never thrown.
 *
 * @returns {Promise<Object|null>|null} The pass, or null when none started.
 */
export function archiveSettledTurns({ stores, bureauId, storyId, client }) {
  if (isArchiving(storyId)) return null;
  const story = stores.stories.getStory(bureauId, storyId);
  if (!story) return null;
  const through = autoArchiveThrough(stores.stories.listTurns(storyId), story);
  if (through === null) return null;

  const task = archiveStory({ stores, bureauId, storyId, client, through })
    .catch((error) => {
      console.error(`[Bureau] Automatic archive of story ${storyId} failed:`, error.message);
      return null;
    })
    .finally(() => backgroundArchives.delete(task));
  backgroundArchives.add(task);
  return task;
}

/** Wait for automatic passes to finish. */
export async function settleBackgroundArchives() {
  await Promise.all(backgroundArchives);
}
