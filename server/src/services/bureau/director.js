/**
 * Director
 *
 * Plans the next passage before the Writer writes it (see "Director" in
 * docs/bureau-design.md). It looks things up with tools, then hands over a
 * scene brief through submit_brief. The tool-calling conversation stays here
 * and in the run record, so the Writer's prompt stays prose.
 */

import { chapterTime, describeBureauTime, describeTimePassing } from './bureau-time.js';
import { generateCharacter } from './character-generator.js';
import { labelImages } from './images.js';
import { factsAsOf, memoriesAsOf, notesAsOf, selectForPrompt } from './memory.js';
import { bureauText, cardText, profileLines } from './profile-text.js';
import { runToolLoop } from './tool-loop.js';

export const DIRECTOR_MAX_ITERATIONS = 6;
export const DIRECTOR_MAX_TOKENS = 8000;
export const BRIEF_LENGTHS = ['short', 'medium', 'long'];
// Beats per brief. More than this cluttered passages with busywork, and strict schemas can't cap
// an array, so submit_brief enforces it.
export const MAX_BEATS = 2;

// The end of the story the Director reads; the Writer still gets all of it.
const RECENT_STORY_CHARACTERS = 6000;
const RECALL_LIMIT = 8;
const LORE_LIMIT = 5;
const LORE_ENTRY_CHARACTERS = 800;
// Lookups per passage; after that, the Director is told to hand over its brief.
const LOOKUP_LIMIT = 4;
// New characters per passage. Creating one isn't a lookup, so it has its own limit.
const CREATE_LIMIT = 2;
const STOPWORDS = new Set(
  'the and for with that this from what who where when how are was were has have had not but his her its our their you she him they them into onto about'.split(
    ' ',
  ),
);

export const DIRECTOR_TOOLS = [
  {
    name: 'recall',
    description:
      'Search what the characters remember: earlier chapters, backstory, and what this chapter has recorded so far. Use it when the passage turns on earlier events, people, or promises.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to search for.' },
        character: {
          type: 'string',
          description: "A character's name, or an empty string to search everyone in the chapter.",
        },
      },
      required: ['query', 'character'],
      additionalProperties: false,
    },
  },
  {
    name: 'lookup_lore',
    description: "Search the world's lorebooks for places, customs, history, and other details.",
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Words to search for.' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_character_file',
    description:
      "A character's full card, with what they know and their latest episodes: what they remember of recent chapters and messages.",
    parameters: {
      type: 'object',
      properties: { name: { type: 'string', description: "The character's name." } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_character',
    description:
      'Give a new named character a card and add them to the cast as a draft, when they will matter beyond this scene.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name they go by in the story.' },
        role: { type: 'string', description: 'Their part in this chapter, in a sentence.' },
        notes: {
          type: 'string',
          description: 'Who they are: anything the chapter or the request establishes.',
        },
      },
      required: ['name', 'role', 'notes'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_brief',
    description: 'Give the Writer the brief for the next passage. Call this once, last.',
    parameters: {
      type: 'object',
      properties: {
        beats: {
          type: 'array',
          items: { type: 'string' },
          description:
            'What the next passage covers: usually one thing, two at most, each a plain sentence.',
        },
        tone: { type: 'string', description: 'How the passage should feel, in a few words.' },
        length: {
          type: 'string',
          enum: BRIEF_LENGTHS,
          description:
            'short: 1 or 2 paragraphs, for a quick exchange or a single beat. medium: 3 or 4. long: 5 to 7.',
        },
        memories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'integer', description: 'The id of a memory you found.' },
              reason: {
                type: 'string',
                description: 'What in this passage depends on it, in one line.',
              },
            },
            required: ['id', 'reason'],
            additionalProperties: false,
          },
          description:
            'Memories you found that this passage depends on, so the Writer stays consistent with them. Usually empty: memories are background, not something for the characters to bring up.',
        },
        notes: {
          type: 'string',
          description:
            "Continuity the Writer could get wrong, such as where everyone is or what just happened, in a sentence or two. Leave out props and details this passage doesn't need, and don't restate the character cards. Empty if nothing.",
        },
      },
      required: ['beats', 'tone', 'length', 'memories', 'notes'],
      additionalProperties: false,
    },
  },
];

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

/** Where a memory came from, for the Director. */
function sourceLabelOf(memory) {
  if (memory.sourceTitle) return memory.sourceTitle;
  if (memory.sourceType === 'correspondence') return 'messages';
  if (memory.sourceType === 'offscreen') return 'time away';
  return 'backstory';
}

function findMember(members, name) {
  const wanted = text(name).toLowerCase();
  return members.find(
    (member) => nameOf(member).toLowerCase() === wanted || member.name.toLowerCase() === wanted,
  );
}

/**
 * @param {Object} params
 * @param {Object} params.story - Uses title and startTime.
 * @param {Array<Object>} params.cast - The story's cast members, with seed cards.
 * @param {Array<Object>} params.turns - Turns before the one being written.
 * @param {Object} params.request - { action, direction }.
 * @param {string|null} [params.timeZone] - The Bureau's, for the chapter's time.
 * @param {boolean} [params.canCreateCharacters] - Whether create_character is offered.
 * @param {Array<{content: string}>} [params.facts] - Established facts the story can see.
 */
export function buildDirectorMessages({
  story,
  cast,
  turns,
  request,
  timeZone = null,
  canCreateCharacters = false,
  facts = [],
}) {
  const persona = cast.find((member) => member.isPersona);
  const readerName = persona ? nameOf(persona) : null;
  const directed = request.action === 'direct' && Boolean(request.direction);

  const system = [
    'You are the Director for an ongoing story. Before the Writer writes the next passage, decide what should happen in it and gather anything the Writer needs.',
    [
      '- Use recall when the passage turns on earlier events, people, or promises; lookup_lore for places, customs, or history; get_character_file for what someone knows and remembers. Look up only what this passage needs: one or two lookups are usually enough, and none is fine.',
      '- Follow the request below. Pick one thing for the passage to cover, or two at most: more than that clutters it. End at a natural pause rather than on a reveal.',
      "- Keep to the chapter's present and its course: no jump to a later hour or day unless the request asks for one, and no new secret, twist, or trouble the story isn't already heading toward.",
      "- Pick the length the moment needs. Pick short for a quick exchange, a reaction, or a single beat: a passage doesn't have to fill space.",
      "- Don't plan anyone repeating a point, a figure, or a line that's already been said in the chapter.",
      '- Plan what happens and leave how it reads to the Writer. Each beat is a plain sentence about what someone does or what changes, without lines of dialogue, jokes, imagery, or explanations of what anyone feels underneath.',
      "- A passage can follow any of the characters in the chapter, often several at once as they interact; don't build it around one character's point of view.",
      readerName
        ? [
            `- ${readerName} is the reader's character, so don't plan what ${readerName} says, does, decides, or thinks, including choices made without a word${directed ? ", beyond what the author's direction asks for" : ''}.`,
            `When the moment turns to ${readerName}, such as a question put to ${readerName} or a choice only ${readerName} can make, end the beats there${directed ? ' once the direction is carried out' : ''}.`,
            directed
              ? null
              : `If the chapter so far ends waiting on ${readerName}, plan around it without answering for ${readerName}.`,
          ]
            .filter(Boolean)
            .join(' ')
        : null,
      '- Keep the characters in the moment. Plan a callback to earlier events or a running joke only when the scene is about it: people seldom talk about what they both already know.',
      "- Keep the scene moving. Don't plan an action, gesture, or bit of business the recent passages already have, such as refilling a drink or glancing out a window, unless something new comes of it or the request below asks for it.",
      "- The Writer has the character cards, so don't restate anyone's traits or habits in the notes.",
      "- The cast's profiles and any established facts below are true. Plan nothing that contradicts them, and when a memory disagrees with a profile or fact, go by the profile or fact.",
      canCreateCharacters
        ? '- When the passage brings in a new named character who will matter beyond this scene, call create_character first so they have a card. Never for walk-ons, and never for anyone already in this chapter.'
        : null,
      '- Finish by calling submit_brief once.',
    ]
      .filter(Boolean)
      .join('\n'),
  ];

  const castProfiles = cast.map((member) =>
    [
      member.isPersona ? `${nameOf(member)} (the reader's character)` : nameOf(member),
      ...profileLines(member, readerName),
    ].join('\n'),
  );

  const storyText = turns
    .filter((turn) => ['prose', 'scene_break', 'time_passes'].includes(turn.kind))
    .map((turn) => {
      if (turn.kind === 'scene_break') return '---';
      if (turn.kind === 'time_passes') {
        return `---\n\n${describeTimePassing(turn.bureauTime, timeZone)}`;
      }
      return labelImages(turn.content);
    })
    .join('\n\n');
  const recent =
    storyText.length > RECENT_STORY_CHARACTERS
      ? `[Earlier parts omitted.]\n…${storyText.slice(-RECENT_STORY_CHARACTERS)}`
      : storyText;

  const next = [];
  const clock = story.startTime ? chapterTime(story, turns) : null;
  const exactly = clock ? describeBureauTime(clock.time, timeZone) : null;
  if (!turns.some((turn) => turn.kind === 'prose')) {
    next.push(
      clock
        ? `This is the opening of "${story.title}", which begins at exactly ${exactly}.`
        : `This is the opening of "${story.title}".`,
    );
  } else if (clock?.justPassed) {
    next.push(
      `Time has just passed: it's now exactly ${exactly}. Plan the passage from this time.`,
    );
  } else if (clock) {
    next.push(
      clock.passed
        ? `When time last passed in the chapter, it was exactly ${exactly}.`
        : `When the chapter began, the time was exactly ${exactly}.`,
    );
  }
  if (request.action === 'direct' && request.direction) {
    next.push(
      `The author's direction for the next passage (not part of the story yet): ${request.direction}`,
      'Plan a passage that carries it out.',
    );
  } else {
    next.push('Continue the story naturally from where it left off.');
  }

  return [
    { role: 'system', content: system.join('\n\n') },
    {
      role: 'user',
      content: [
        section('CAST', castProfiles.join('\n\n') || '(No one in the cast.)'),
        ...(facts.length > 0
          ? [
              section(
                'ESTABLISHED FACTS',
                facts.map((fact) => `- ${bureauText(fact.content, readerName)}`).join('\n'),
              ),
            ]
          : []),
        section('CHAPTER SO FAR', recent || '(Nothing has been written yet.)'),
        section('NEXT', next.join('\n')),
      ].join('\n\n'),
    },
  ];
}

/** The tools' handlers. They share what the Director has found, so a brief can cite only that. */
function toolHandlers({
  stores,
  bureau,
  story,
  cast,
  turns,
  client,
  recorder,
  signal,
  createCharacters,
}) {
  // Everyone in the chapter remembers, the reader's character included.
  const characters = cast;
  const persona = cast.find((member) => member.isPersona);
  const readerName = persona ? nameOf(persona) : null;
  const found = new Map();
  const earlierTurnIds = new Set(turns.map((turn) => turn.id));
  let lookups = 0;
  // Lowercased names of characters created for this passage, reserved before they're generated.
  const createdNames = new Set();

  const lookUp = () => {
    lookups += 1;
    if (lookups > LOOKUP_LIMIT) {
      throw new Error("That's enough looking up for one passage. Call submit_brief now.");
    }
  };

  // Memories from this story count only if every passage they cite comes before the one being
  // written, so regenerating an earlier turn doesn't plan around what happens after it.
  const visibleMemories = (member) =>
    memoriesAsOf(
      stores.memories
        .listMemories(bureau.id, member.id, { status: 'all' })
        .filter(
          (memory) =>
            memory.sourceType !== 'story' ||
            memory.sourceId !== story.id ||
            (memory.sourceTurnIds.length > 0 &&
              memory.sourceTurnIds.every((turnId) => earlierTurnIds.has(turnId))),
        ),
      story,
      { includeOwnStory: true },
    );

  const remember = (member, memory) => {
    found.set(memory.id, { ...memory, character: nameOf(member) });
    return memory.id;
  };

  // Where a memory came from, marking this chapter's own so it doesn't read as an earlier one.
  const labelOf = (memory) =>
    memory.sourceType === 'story' && memory.sourceId === story.id
      ? 'this chapter'
      : sourceLabelOf(memory);

  const handlers = {
    recall({ query, character }) {
      lookUp();
      let members = characters;
      if (text(character)) {
        const member = findMember(characters, character);
        if (!member) {
          throw new Error(`No one named "${character}" is in this chapter`);
        }
        members = [member];
      }
      const results = [];
      for (const member of members) {
        const visible = new Set(visibleMemories(member).map((memory) => memory.id));
        for (const memory of stores.memories.searchMemories(bureau.id, member.id, query)) {
          if (!visible.has(memory.id)) continue;
          results.push({
            id: remember(member, memory),
            character: nameOf(member),
            kind: memory.layer,
            from: labelOf(memory),
            content: memory.content,
          });
        }
      }
      return { memories: results.slice(0, RECALL_LIMIT) };
    },

    async lookup_lore({ query }) {
      lookUp();
      const words = [
        ...new Set(
          text(query)
            .toLowerCase()
            .match(/[\p{L}\p{N}]{3,}/gu) ?? [],
        ),
      ].filter((word) => !STOPWORDS.has(word));
      if (words.length === 0) return { entries: [] };

      const scored = [];
      for (const lorebookId of stores.bureaus.listLorebookIds(bureau.id)) {
        let lorebook;
        try {
          lorebook = await stores.library.getLorebook(lorebookId);
        } catch {
          continue; // Deleted from the library but still attached.
        }
        for (const entry of lorebook.entries ?? []) {
          if (entry.enabled === false || !entry.content) continue;
          // With images as labels, an asset URL neither matches a word nor fills an entry's room.
          const content = labelImages(entry.content);
          const keys = (entry.keys ?? []).join(' ').toLowerCase();
          const lowered = content.toLowerCase();
          const score = words.reduce(
            (total, word) =>
              total + (keys.includes(word) ? 2 : 0) + (lowered.includes(word) ? 1 : 0),
            0,
          );
          if (score > 0) scored.push({ score, keys: entry.keys ?? [], content });
        }
      }
      return {
        entries: scored
          .toSorted((a, b) => b.score - a.score)
          .slice(0, LORE_LIMIT)
          .map(({ keys, content }) => ({
            keys,
            content: truncate(content, LORE_ENTRY_CHARACTERS),
          })),
      };
    },

    get_character_file({ name }) {
      lookUp();
      const member = findMember(cast, name);
      if (!member) {
        throw new Error(`No one named "${name}" is in this chapter`);
      }
      const data = member.seedCard?.data ?? {};
      const file = {
        name: nameOf(member),
        readersCharacter: member.isPersona,
        description: cardText(data.description, member, readerName),
        personality: cardText(data.personality, member, readerName),
        scenario: cardText(data.scenario, member, readerName),
      };
      const { knowledge, episodes } = selectForPrompt(visibleMemories(member), {
        knowledgeCharacters: bureau.settings.memory.knowledgeCharacters,
        recentEpisodes: bureau.settings.memory.recentEpisodes,
      });
      file.knows = knowledge.map((memory) => ({
        id: remember(member, memory),
        content: memory.content,
      }));
      file.recentEpisodes = episodes.map((memory) => ({
        id: remember(member, memory),
        from: labelOf(memory),
        content: memory.content,
      }));
      file.hasChanged = notesAsOf(
        stores.arcNotes.listNotes(bureau.id, member.id, { status: 'accepted' }),
        story,
      ).map((note) => note.content);
      return file;
    },

    submit_brief(args) {
      const beats = (Array.isArray(args.beats) ? args.beats : []).map(text).filter(Boolean);
      if (beats.length === 0) {
        throw new Error('A brief needs at least one beat');
      }
      if (beats.length > MAX_BEATS) {
        throw new Error(
          `A brief covers one thing, two at most, and this one has ${beats.length}. Keep what matters most and call submit_brief again.`,
        );
      }
      const memories = (Array.isArray(args.memories) ? args.memories : [])
        .filter((item) => found.has(item?.id))
        .map((item) => {
          const memory = found.get(item.id);
          return {
            id: memory.id,
            character: memory.character,
            content: memory.content,
            reason: text(item.reason),
          };
        });
      return {
        beats,
        tone: text(args.tone),
        length: BRIEF_LENGTHS.includes(args.length) ? args.length : 'medium',
        memories,
        notes: text(args.notes),
      };
    },
  };

  if (createCharacters) {
    // A new character joins the Bureau as a draft and this story's cast, and `cast` itself, so
    // the Writer gets their card too. Someone already in the Bureau just joins the story.
    handlers.create_character = async ({ name, role, notes }) => {
      if (createdNames.size >= CREATE_LIMIT) {
        throw new Error("That's enough new characters for one passage. Call submit_brief now.");
      }
      const wanted = text(name);
      if (!wanted) {
        throw new Error('A new character needs a name');
      }
      const key = wanted.toLowerCase();
      const inStory = findMember(cast, wanted);
      if (inStory || createdNames.has(key)) {
        throw new Error(
          `${inStory ? nameOf(inStory) : wanted} is already in this chapter; use get_character_file to learn about them`,
        );
      }

      const addToStory = (member) => {
        const current = stores.stories.getStory(bureau.id, story.id);
        stores.stories.updateStory(bureau.id, story.id, {
          castIds: [...(current?.castIds ?? story.castIds), member.id],
        });
        cast.push(member);
        const data = member.seedCard?.data ?? {};
        return {
          name: nameOf(member),
          description: cardText(data.description, member, readerName),
          personality: cardText(data.personality, member, readerName),
          addedToStory: true,
        };
      };

      // Someone already in the Bureau joins the story instead of being created again.
      const inBureau = findMember(stores.bureaus.listCast(bureau.id), wanted);
      if (inBureau) {
        return {
          ...addToStory(stores.bureaus.getCastMember(bureau.id, inBureau.id)),
          existing: true,
        };
      }

      // Reserve the name before generating, and give it back if generating fails so the
      // Director can try again.
      createdNames.add(key);
      let card;
      try {
        ({ card } = await generateCharacter({
          stores,
          bureau,
          client,
          idea: text(notes) || `${wanted}, a new character in the story`,
          name: wanted,
          role: text(role),
          recorder,
          signal,
        }));
      } catch (error) {
        createdNames.delete(key);
        throw error;
      }
      return addToStory(stores.bureaus.addCastMember(bureau.id, { seedCard: card, isDraft: true }));
    };
  }
  return handlers;
}

/**
 * Plan the next passage.
 *
 * @param {Object} params
 * @param {ReturnType<import('./stores.js').getBureauStores>} params.stores
 * @param {Object} params.bureau - With settings.director and settings.memory.
 * @param {Object} params.story
 * @param {Array<Object>} params.cast - The story's cast members, with seed cards. A character the
 *   Director creates is added to it.
 * @param {Array<Object>} params.turns - Turns before the one being written.
 * @param {Object} params.request - { action, direction }.
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {import('./run-recorder.js').RunRecorder} params.recorder
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object|null>} The brief ({ beats, tone, length, memories, notes }), or
 *   null when the Director answered without one.
 */
export async function runDirector({
  stores,
  bureau,
  story,
  cast,
  turns,
  request,
  client,
  recorder,
  signal,
}) {
  const { thinking, reasoningEffort, createCharacters } = bureau.settings.director;
  const tools = createCharacters
    ? DIRECTOR_TOOLS
    : DIRECTOR_TOOLS.filter((tool) => tool.name !== 'create_character');

  const result = await runToolLoop({
    client,
    role: 'director',
    messages: buildDirectorMessages({
      story,
      cast,
      turns,
      request,
      timeZone: bureau.timezone,
      canCreateCharacters: createCharacters,
      facts: factsAsOf(stores.facts.listFacts(bureau.id), story),
    }),
    tools,
    handlers: toolHandlers({
      stores,
      bureau,
      story,
      cast,
      turns,
      client,
      recorder,
      signal,
      createCharacters,
    }),
    // Streamed, so a stalled request times out once it goes quiet, while a long plan that's
    // still reasoning keeps going.
    options: {
      thinking,
      reasoningEffort,
      strict: true,
      stream: true,
      maxTokens: DIRECTOR_MAX_TOKENS,
    },
    recorder,
    maxIterations: DIRECTOR_MAX_ITERATIONS,
    finalTool: 'submit_brief',
    signal,
  });
  return result.finalCall?.result ?? null;
}
