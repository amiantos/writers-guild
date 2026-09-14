/**
 * Interviews
 *
 * An interview helps the reader flesh out one cast member's profile (see "Profiles and
 * interviews" in docs/bureau-design.md). The interviewer asks about the character one question at
 * a time, grounded in their profile and the rest of the cast. When the reader is ready, the
 * write-up turns the answers into a new description, personality, and routine in plain English,
 * with a line for the description of anyone the character turned out to have a relationship
 * with. Nothing changes until the reader accepts, and every profile keeps its earlier versions.
 *
 * Unlike a story, an interview reaches the model as a conversation, since it is one.
 */

import { ImagePreserver } from '../image-preserver.js';
import { profileOf } from './bureau-storage.js';
import { worldNotes } from './character-generator.js';
import { labelImages } from './images.js';
import { memoriesAtTime, notesAtTime, selectForPrompt } from './memory.js';
import { RunRecorder } from './run-recorder.js';

/** What an interview can focus on. The questions differ; every write-up covers the same fields. */
export const INTERVIEW_FOCUSES = Object.freeze({
  flesh_out: Object.freeze({
    label: 'Flesh them out',
    description:
      'Who they are beyond their card: their history, wants, habits, days, and where they stand with the cast.',
    instruction:
      'Flesh out who they are beyond their profile: their history, what they want, their habits and contradictions, how they spend their days, and where they stand with the rest of the cast. Start with whatever the profile leaves thinnest that matters most for writing them.',
  }),
  relationships: Object.freeze({
    label: 'Relationships',
    description:
      "How they know each person in the cast, what they think of them, and what's unresolved.",
    instruction:
      "Focus on their relationships with the rest of the cast, the reader's character included: how they know each person, what they think of them, and what's unresolved between them. Start with the people their profile doesn't account for.",
  }),
  routine: Object.freeze({
    label: 'Daily routine',
    description: 'How they spend their days and weeks, which their replies and time away follow.',
    instruction:
      'Focus on their routine: how they usually spend their days and weeks, when they work, sleep, and eat, where they tend to be at different hours, and what breaks the pattern. Their replies to messages and their offscreen life follow it.',
  }),
});

export const DEFAULT_FOCUS = 'flesh_out';

/** The profile fields a write-up rewrites. */
export const WRITE_UP_FIELDS = ['description', 'personality', 'routine'];

export const QUESTION_MAX_TOKENS = 500;
// The whole description comes back, and some cards are long.
export const WRITE_UP_MAX_TOKENS = 16000;

// How much of each other cast member's description the prompts show. The write-up sees more, to
// tell whether their description already covers a relationship.
const CAST_DESCRIPTION_CHARACTERS = 600;
const WRITE_UP_CAST_DESCRIPTION_CHARACTERS = 4000;
const EXAMPLE_DIALOGUE_CHARACTERS = 1500;

export const WRITE_PROFILE_TOOL = {
  name: 'write_profile',
  description: "Write the character's new profile from the interview.",
  parameters: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description:
          'Their whole new description: who they are, their history, situation, and relationships, in plain English prose in the third person.',
      },
      personality: {
        type: 'string',
        description:
          'Their whole new personality: temperament, habits, contradictions, and how they talk, in plain English.',
      },
      routine: {
        type: 'string',
        description:
          'How they usually spend their days and weeks, in plain English, in a short paragraph of no more than about 150 words. Empty if neither the profile nor the interview says.',
      },
      changes: {
        type: 'string',
        description: "One or two sentences telling the author what's new in the profile.",
      },
      relationships: {
        type: 'array',
        description:
          "Lines to add to other cast members' descriptions, for relationships the interview revealed that their own descriptions don't already cover. Empty if there are none.",
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Their name, as the cast lists it.' },
            addition: {
              type: 'string',
              description:
                'One or two sentences about them and the character, in plain English, for their description.',
            },
          },
          required: ['name', 'addition'],
          additionalProperties: false,
        },
      },
    },
    required: ['description', 'personality', 'routine', 'changes', 'relationships'],
    additionalProperties: false,
  },
};

export class ProfileChangedError extends Error {
  constructor(name) {
    super(
      `${name}'s profile changed after this was written up. Write it up again to build on the change.`,
    );
    this.name = 'ProfileChangedError';
  }
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function nameOf(member) {
  return member.seedCard?.data?.name || member.name;
}

function section(title, body) {
  return `=== ${title} ===\n${body}`;
}

function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length).trimEnd()}…` : value;
}

function findMember(members, name) {
  const wanted = text(name).toLowerCase();
  if (!wanted) return null;
  return (
    members.find(
      (member) => nameOf(member).toLowerCase() === wanted || member.name.toLowerCase() === wanted,
    ) ?? null
  );
}

/**
 * Card text with {{char}} as the character's name, and {{user}} as the reader's character's name
 * when the Bureau has one.
 */
function withNames(value, name, personaName) {
  const named = value.replace(/\{\{char(?:acter)?\}\}/gi, name);
  return personaName ? named.replace(/\{\{user\}\}/gi, personaName) : named;
}

/** Everyone else in the cast, each with the start of their description. */
function castLines(cast, { personaName, limit }) {
  const lines = cast.map((other) => {
    const otherName = nameOf(other);
    const label = other.isPersona ? `${otherName} (the reader's character)` : otherName;
    const description = truncate(
      labelImages(withNames(text(other.seedCard?.data?.description), otherName, personaName)),
      limit,
    );
    return description ? `- ${label}: ${description}` : `- ${label}`;
  });
  return lines.join('\n') || '(No one else yet.)';
}

/** What the character knows and remembers, or '' when they have no memories. */
function memoryLines(name, memories) {
  const lines = [];
  if (memories.knowledge.length > 0) {
    lines.push(`${name} knows:`, ...memories.knowledge.map((memory) => `- ${memory.content}`));
  }
  if (memories.episodes.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push(`${name} remembers:`, ...memories.episodes.map((memory) => `- ${memory.content}`));
  }
  return labelImages(lines.join('\n'));
}

/**
 * What an interview works from besides the character's profile: everyone else in the cast, the
 * reader's character, how the character has changed and what they remember as of Bureau time,
 * and the world.
 */
async function interviewContext(stores, bureau, member) {
  const cast = stores.bureaus
    .listCast(bureau.id)
    .filter((listed) => listed.id !== member.id)
    .map((listed) => stores.bureaus.getCastMember(bureau.id, listed.id))
    .filter(Boolean);
  const time = new Date(bureau.bureauTime);
  const allMemories = stores.memories.listMemories(bureau.id, member.id, { status: 'all' });
  return {
    cast,
    persona: member.isPersona ? member : (cast.find((other) => other.isPersona) ?? null),
    memories: selectForPrompt(memoriesAtTime(allMemories, time), bureau.settings.memory),
    arcNotes: notesAtTime(
      stores.arcNotes.listNotes(bureau.id, member.id, { status: 'accepted' }),
      time,
    ),
    world: await worldNotes(stores, bureau.id),
  };
}

/**
 * Build the interviewer's messages for the next question.
 *
 * @param {Object} params
 * @param {Object} params.member - The character being interviewed, with their seed card.
 * @param {Object} params.interview - Uses focus, note, and messages.
 * @param {Array<Object>} [params.cast] - Everyone else in the cast, with seed cards.
 * @param {Object|null} [params.persona] - The reader's character, who may be the member.
 * @param {{ knowledge: Array<Object>, episodes: Array<Object> }} [params.memories] - From
 *   selectForPrompt.
 * @param {Array<{content: string}>} [params.arcNotes] - Accepted arc notes.
 * @param {string[]} [params.world] - Short notes about the world, such as lorebook topics.
 * @param {string|null} [params.setAside] - A question the reader asked to replace. It's left out
 *   of the messages, which ask for something else.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildQuestionMessages({
  member,
  interview,
  cast = [],
  persona = null,
  memories = { knowledge: [], episodes: [] },
  arcNotes = [],
  world = [],
  setAside = null,
}) {
  const name = nameOf(member);
  const personaName = persona ? nameOf(persona) : null;
  const profile = profileOf(member);
  const read = (value) => labelImages(withNames(value, name, personaName)).trim();

  const focus = INTERVIEW_FOCUSES[interview.focus] ?? INTERVIEW_FOCUSES[DEFAULT_FOCUS];
  const focusLines = [focus.instruction];
  if (text(interview.note)) focusLines.push(`The author's note: ${text(interview.note)}`);

  const profileLines = [`Name: ${name}`];
  if (member.isPersona) {
    profileLines.push(`${name} is the reader's character, the one the author writes as.`);
  }
  profileLines.push(
    `Description: ${read(profile.description) || '(not written yet)'}`,
    `Personality: ${read(profile.personality) || '(not written yet)'}`,
  );
  if (read(profile.scenario)) profileLines.push(`Scenario: ${read(profile.scenario)}`);
  if (read(profile.mes_example)) {
    profileLines.push(
      `Example dialogue: ${truncate(read(profile.mes_example), EXAMPLE_DIALOGUE_CHARACTERS)}`,
    );
  }
  profileLines.push(`Usual routine: ${read(profile.routine) || '(not described yet)'}`);
  if (arcNotes.length > 0) {
    const changes = arcNotes.map((note) => `- ${note.content}`);
    profileLines.push(`How ${name} has changed:\n${changes.join('\n')}`);
  }

  const system = [
    `You're interviewing an author about ${name}, a character in their ongoing story, to flesh out ${name}'s profile. The author knows ${name} and answers; you ask the questions. Afterward, the answers will be written up as ${name}'s new description, personality, and routine.`,
    section(
      'HOW TO INTERVIEW',
      [
        "- Ask one question at a time, about one thing, in a sentence or two: no double questions, no lists of options to pick from, no preamble or praise, and don't repeat the answer back.",
        `- Ask what matters for writing ${name}: what the profile leaves thin, unsaid, or in tension, and how ${name} stands with the people in the cast. Avoid stock questionnaire questions unless the profile makes them matter.`,
        '- Follow up when an answer opens up something worth knowing; otherwise move on to something new. Never ask about what the profile or an earlier answer already settles.',
        "- If the author skips a question, move on and don't come back to it. If they ask you to decide, choose something specific that fits, say what you chose in a sentence, and ask your next question.",
        `- Only ask questions. Don't draft ${name}'s profile, suggest wording for it, or sum up the interview.`,
        '- Write plain text without markdown, in the same language as the profile.',
      ].join('\n'),
    ),
    section('FOCUS', focusLines.join('\n')),
    section(name.toUpperCase(), profileLines.join('\n')),
  ];
  const remembered = memoryLines(name, memories);
  if (remembered) system.push(section('WHAT THEY REMEMBER', remembered));
  system.push(
    section(
      'THE REST OF THE CAST',
      castLines(cast, { personaName, limit: CAST_DESCRIPTION_CHARACTERS }),
    ),
  );
  if (world.length > 0) {
    system.push(section('WORLD', world.map((note) => `- ${note}`).join('\n')));
  }

  // The conversation so far, opened with a request for the first question. Consecutive messages
  // from one side are joined, so the turns alternate.
  const conversation = [{ role: 'user', content: 'Ask your first question.' }];
  for (const message of interview.messages) {
    const role = message.source === 'generated' ? 'assistant' : 'user';
    const last = conversation.at(-1);
    if (last.role === role) {
      last.content = `${last.content}\n\n${message.content}`;
    } else {
      conversation.push({ role, content: message.content });
    }
  }
  if (setAside) {
    const request = `(Ask something other than: "${setAside}")`;
    const last = conversation.at(-1);
    if (last.role === 'user') {
      last.content = `${last.content}\n\n${request}`;
    } else {
      conversation.push({ role: 'user', content: request });
    }
  }

  return [{ role: 'system', content: system.join('\n\n') }, ...conversation];
}

/**
 * Ask the interview's next question, or a different one in place of the latest, and save it.
 * The question is recorded as a run.
 *
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {Object} params.bureau
 * @param {Object} params.interview - Open.
 * @param {Object} params.member - The character being interviewed, with their seed card.
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {boolean} [params.replace] - Replace the latest question, if the interview ends with one.
 * @param {(event: Object) => void} [params.onEvent] - Receives `run` and `content`.
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object|null>} The interview with the question saved. When cancelled, what was
 *   written so far is saved; if nothing was, or the interview closed meanwhile, null.
 */
export async function askQuestion({
  stores,
  bureau,
  interview,
  member,
  client,
  replace = false,
  onEvent = () => {},
  signal,
}) {
  const recorder = new RunRecorder(stores.bureaus, {
    bureauId: bureau.id,
    purpose: 'interview',
    targetType: 'interview',
    targetId: interview.id,
  });
  onEvent({ type: 'run', runId: recorder.runId });

  const latest = interview.messages.at(-1);
  const setAside = replace && latest?.source === 'generated' ? latest.content : null;
  let messages;
  try {
    const { cast, persona, memories, arcNotes, world } = await interviewContext(
      stores,
      bureau,
      member,
    );
    messages = buildQuestionMessages({
      member,
      interview: setAside ? { ...interview, messages: interview.messages.slice(0, -1) } : interview,
      cast,
      persona,
      memories,
      arcNotes,
      world,
      setAside,
    });
  } catch (error) {
    recorder.fail(error);
    throw error;
  }

  const recordedRequest = {
    model: client.model,
    thinking: false,
    maxTokens: QUESTION_MAX_TOKENS,
    messages,
  };
  const save = (content) =>
    stores.interviews.addMessage(bureau.id, interview.id, {
      source: 'generated',
      content,
      runId: recorder.runId,
      replaceQuestion: Boolean(setAside),
    });

  let content = '';
  let done = null;
  const started = Date.now();
  try {
    const stream = client.chatStream({
      messages,
      thinking: false,
      maxTokens: QUESTION_MAX_TOKENS,
      signal,
    });
    for await (const event of stream) {
      if (event.type === 'content') {
        const piece = event.text.replace(/\*/g, '');
        content += piece;
        if (piece) onEvent({ type: 'content', text: piece });
      } else if (event.type === 'done') {
        done = event;
      }
    }
  } catch (error) {
    const cancelled = error.name === 'AbortError' || Boolean(signal?.aborted);
    const partial = content.trim();
    recorder.recordStep({
      role: 'interviewer',
      kind: 'model',
      request: recordedRequest,
      response: partial ? { content: partial, finishReason: null, model: client.model } : null,
      error: cancelled ? 'Cancelled' : error.message,
      durationMs: Date.now() - started,
    });
    if (!cancelled) {
      recorder.fail(error);
      throw error;
    }
    recorder.finish('cancelled', 'Cancelled');
    return partial ? save(partial) : null;
  }

  const question = content.trim();
  recorder.recordStep({
    role: 'interviewer',
    kind: 'model',
    request: recordedRequest,
    response: {
      content: question,
      finishReason: done?.finishReason ?? null,
      model: done?.model ?? client.model,
    },
    usage: done?.usage ?? null,
    durationMs: Date.now() - started,
  });
  if (!question) {
    const error = new Error('The interviewer came back without a question');
    recorder.fail(error);
    throw error;
  }

  let saved;
  try {
    saved = save(question);
  } catch (error) {
    recorder.fail(error);
    throw error;
  }
  recorder.complete();
  return saved;
}

/**
 * Build the messages for writing up an interview.
 *
 * @param {Object} params
 * @param {Object} params.member - The character interviewed, with their seed card.
 * @param {Object} params.interview - Uses focus, note, and messages.
 * @param {Array<Object>} [params.cast] - Everyone else in the cast, with seed cards.
 * @param {Object|null} [params.persona] - The reader's character, who may be the member.
 * @param {Array<{content: string}>} [params.arcNotes] - Accepted arc notes, for context.
 * @param {ImagePreserver|null} [params.imagePreserver] - Swaps the images in the fields being
 *   rewritten for markers the model can keep, each saved under its field's name.
 * @returns {Array<{role: string, content: string}>}
 */
export function buildWriteUpMessages({
  member,
  interview,
  cast = [],
  persona = null,
  arcNotes = [],
  imagePreserver = null,
}) {
  const name = nameOf(member);
  const personaName = persona ? nameOf(persona) : null;
  const profile = profileOf(member);
  const current = Object.fromEntries(
    WRITE_UP_FIELDS.map((field) => {
      const named = withNames(profile[field], name, personaName).trim();
      return [field, imagePreserver ? imagePreserver.preserve(named, field) : named];
    }),
  );

  const rules = [
    '- Write in plain English: clear, specific prose in the third person. Where the current profile uses lists, tags, or a bracketed format, turn it into plain prose that says the same things.',
    "- Change only what the interview changed. Keep the rest of the profile as it is, in its own wording, and work each new detail in where it belongs. A field the interview didn't touch comes back as it was.",
    "- Add only what the author said, or what the interviewer chose at the author's request. Don't add traits, feelings, interpretation, or atmosphere of your own, and don't fill in questions the author skipped. Where an answer contradicts the profile, follow the answer.",
    `- Keep each field to its job: the description says who ${name} is, with their history and relationships; the personality says how they think, act, and talk; the routine says how they usually spend their days and weeks. What happened in the story's chapters stays in their memories, and how they've changed stays in their notes. Don't mention the interview itself.`,
    `- Add a line to another cast member's description only when the interview revealed something about them and ${name} that their own description doesn't already say. They may appear in scenes without ${name}.`,
  ];
  if (imagePreserver?.saved.length > 0) {
    rules.push(
      '- Keep each image marker, such as [WG_IMAGE_0], exactly as written, in the field it came from.',
    );
  }
  if (!personaName) {
    rules.push(
      "- Where the profile says {{user}}, it means the reader's character; keep {{user}} as written.",
    );
  }
  rules.push('- Write in the same language as the profile.');

  const profileLines = [
    `Name: ${name}`,
    `Description: ${current.description || '(empty)'}`,
    `Personality: ${current.personality || '(empty)'}`,
    `Usual routine: ${current.routine || '(empty)'}`,
  ];
  const scenario = labelImages(withNames(profile.scenario, name, personaName)).trim();
  if (scenario) profileLines.push(`Scenario, for context: ${scenario}`);
  if (arcNotes.length > 0) {
    const changes = arcNotes.map((note) => `- ${note.content}`);
    profileLines.push(`How ${name} has changed, for context:\n${changes.join('\n')}`);
  }

  const focus = INTERVIEW_FOCUSES[interview.focus] ?? INTERVIEW_FOCUSES[DEFAULT_FOCUS];
  const interviewLines = [`Focus: ${focus.label}`];
  if (text(interview.note)) interviewLines.push(`The author's note: ${text(interview.note)}`);
  interviewLines.push(
    '',
    ...interview.messages.map(
      (message) =>
        `${message.source === 'generated' ? 'Interviewer' : 'Author'}: ${labelImages(message.content)}`,
    ),
  );

  return [
    {
      role: 'system',
      content: [
        `You write character profiles for an ongoing story. The author has just been interviewed about ${name}. Call write_profile once with ${name}'s new profile, built from their current profile and the interview.`,
        section('HOW TO WRITE IT', rules.join('\n')),
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: [
        section(`${name.toUpperCase()}'S CURRENT PROFILE`, profileLines.join('\n')),
        section(
          'THE REST OF THE CAST',
          castLines(cast, { personaName, limit: WRITE_UP_CAST_DESCRIPTION_CHARACTERS }),
        ),
        section('INTERVIEW', interviewLines.join('\n')),
      ].join('\n\n'),
    },
  ];
}

/**
 * A proposal from write_profile's arguments. The profile's images go back where the model kept
 * their markers, and at the end of their field where it didn't. Relationship lines are matched to
 * the cast, and lines for the same person are joined.
 *
 * @param {Object} args - write_profile's arguments.
 * @param {Object} options
 * @param {Object} options.member - The character interviewed, with their seed card.
 * @param {Array<Object>} options.cast - Everyone else in the cast.
 * @param {ImagePreserver|null} [options.imagePreserver] - The one the messages were built with.
 * @param {string|null} [options.runId]
 * @param {Date} [options.now]
 * @returns {Object} { description, personality, routine, changes, relationships: [{ castId, name,
 *   addition }], base, runId, created }. base is the profile the write-up built on.
 */
export function proposalFrom(
  args,
  { member, cast, imagePreserver = null, runId = null, now = new Date() },
) {
  const written = Object.fromEntries(WRITE_UP_FIELDS.map((field) => [field, text(args[field])]));
  const fields = { ...written };
  if (imagePreserver?.saved.length > 0) {
    const everything = Object.values(written).join('\n');
    for (const field of WRITE_UP_FIELDS) {
      const leftOut = imagePreserver.saved
        .filter((image) => image.source === field && !everything.includes(image.placeholder))
        .map((image) => image.original);
      const restored = imagePreserver.restore(written[field]).text.trim();
      fields[field] = [restored, ...leftOut].filter(Boolean).join('\n\n');
    }
  }

  const base = profileOf(member);
  if (!fields.description && base.description.trim()) {
    throw new Error('The write-up came back without a description');
  }

  const relationships = [];
  for (const item of Array.isArray(args.relationships) ? args.relationships : []) {
    const other = findMember(cast, item?.name);
    const addition = text(item?.addition);
    if (!other || other.id === member.id || !addition) continue;
    const existing = relationships.find((relationship) => relationship.castId === other.id);
    if (existing) {
      existing.addition = `${existing.addition} ${addition}`;
    } else {
      relationships.push({ castId: other.id, name: nameOf(other), addition });
    }
  }

  return {
    ...fields,
    changes: text(args.changes),
    relationships,
    base: Object.fromEntries(WRITE_UP_FIELDS.map((field) => [field, base[field]])),
    runId,
    created: now.toISOString(),
  };
}

/**
 * Write up an interview's answers as a proposal for the reader to review, replacing any earlier
 * write-up. One forced call to write_profile with thinking off, recorded as a run.
 *
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {Object} params.bureau
 * @param {Object} params.interview - Open.
 * @param {Object} params.member - The character interviewed, with their seed card.
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object>} The interview with its proposal.
 */
export async function writeUp({ stores, bureau, interview, member, client, signal }) {
  const run = new RunRecorder(stores.bureaus, {
    bureauId: bureau.id,
    purpose: 'interview_write_up',
    targetType: 'interview',
    targetId: interview.id,
  });

  try {
    const { cast, persona, arcNotes } = await interviewContext(stores, bureau, member);
    const imagePreserver = new ImagePreserver();
    const messages = buildWriteUpMessages({
      member,
      interview,
      cast,
      persona,
      arcNotes,
      imagePreserver,
    });
    const recordedRequest = {
      model: client.model,
      thinking: false,
      maxTokens: WRITE_UP_MAX_TOKENS,
      messages,
    };

    const started = Date.now();
    let response;
    try {
      response = await client.chat({
        messages,
        tools: [WRITE_PROFILE_TOOL],
        strict: true,
        toolChoice: { name: WRITE_PROFILE_TOOL.name },
        thinking: false,
        maxTokens: WRITE_UP_MAX_TOKENS,
        signal,
      });
    } catch (error) {
      run.recordStep({
        role: 'write_up',
        kind: 'model',
        request: recordedRequest,
        error: error.message,
        durationMs: Date.now() - started,
      });
      throw error;
    }
    run.recordStep({
      role: 'write_up',
      kind: 'model',
      request: recordedRequest,
      response: { finishReason: response.finishReason, model: response.model },
      toolCalls: response.toolCalls,
      usage: response.usage,
      durationMs: Date.now() - started,
    });

    const call = response.toolCalls.find(
      (toolCall) => toolCall.function?.name === WRITE_PROFILE_TOOL.name,
    );
    if (!call) {
      throw new Error("The write-up didn't return a profile");
    }
    let args;
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      const cutOff = response.finishReason === 'length' ? ' (it ran out of tokens)' : '';
      throw new Error(`The write-up wasn't valid JSON${cutOff}`);
    }

    const proposal = proposalFrom(args, { member, cast, imagePreserver, runId: run.runId });
    run.recordStep({
      role: 'write_up',
      kind: 'tool',
      request: { id: call.id, name: WRITE_PROFILE_TOOL.name, arguments: args },
      response: { proposal },
    });

    const saved = stores.interviews.setProposal(bureau.id, interview.id, proposal);
    if (!saved) {
      throw new Error('The interview ended while it was being written up');
    }
    run.complete();
    return saved;
  } catch (error) {
    run.fail(error);
    throw error;
  }
}

/**
 * Apply a write-up as the reader reviewed it. The character gets the new description,
 * personality, and routine, and each relationship line kept goes at the end of that person's
 * description. Every profile that changes keeps a version from the interview, and the interview
 * closes.
 *
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {Object} params.bureau
 * @param {Object} params.interview - Open, with a proposal.
 * @param {Object} params.member - The character interviewed, with their seed card.
 * @param {Object} params.edits - description, personality, and routine as the reader left them
 *   (the proposal's where absent), and relationships: [{ castId, addition }] for the lines to keep.
 *   Lines for anyone the proposal didn't name, and empty lines, are left out.
 * @returns {{ castMember: Object, interview: Object, updated: Array<Object> }} updated holds the
 *   other cast members whose descriptions changed.
 * @throws {ProfileChangedError} When the character's profile changed after the write-up.
 */
export function acceptProposal({ stores, bureau, interview, member, edits }) {
  const { proposal } = interview;
  const current = profileOf(member);
  if (WRITE_UP_FIELDS.some((field) => current[field] !== proposal.base[field])) {
    throw new ProfileChangedError(nameOf(member));
  }

  const fields = Object.fromEntries(
    WRITE_UP_FIELDS.map((field) => [
      field,
      typeof edits[field] === 'string' ? edits[field].trim() : proposal[field],
    ]),
  );
  const proposed = new Map(
    proposal.relationships.map((relationship) => [relationship.castId, relationship]),
  );
  const kept = [];
  for (const relationship of Array.isArray(edits.relationships) ? edits.relationships : []) {
    const match = proposed.get(relationship?.castId);
    const addition = text(relationship?.addition);
    if (match && addition && !kept.some((line) => line.castId === match.castId)) {
      kept.push({ castId: match.castId, name: match.name, addition });
    }
  }

  let castMember;
  const updated = [];
  stores.bureaus.db.transaction(() => {
    const source = { source: 'interview', sourceId: interview.id };
    castMember = stores.bureaus.updateProfile(bureau.id, member.id, fields, source);
    for (const line of kept) {
      const other = stores.bureaus.getCastMember(bureau.id, line.castId);
      if (!other) continue;
      const description = [profileOf(other).description.trim(), line.addition]
        .filter(Boolean)
        .join('\n\n');
      updated.push(stores.bureaus.updateProfile(bureau.id, other.id, { description }, source));
    }
    stores.interviews.acceptInterview(bureau.id, interview.id, {
      ...proposal,
      ...fields,
      relationships: kept,
    });
  })();

  return {
    castMember,
    interview: stores.interviews.getInterview(bureau.id, interview.id),
    updated,
  };
}
