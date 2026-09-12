/**
 * Director
 *
 * Plans the next passage before the Writer writes it (see "Director" in
 * docs/bureau-design.md). It looks things up with tools, then hands over a
 * scene brief through submit_brief. The tool-calling conversation stays here
 * and in the run record, so the Writer's prompt stays prose.
 */

import { generateCharacter } from './character-generator.js';
import { memoriesAsOf, notesAsOf, selectForPrompt } from './memory.js';
import { runToolLoop } from './tool-loop.js';

export const DIRECTOR_MAX_ITERATIONS = 6;
export const DIRECTOR_MAX_TOKENS = 8000;
export const BRIEF_LENGTHS = ['short', 'medium', 'long'];

// The end of the story the Director reads; the Writer still gets all of it.
const RECENT_STORY_CHARACTERS = 6000;
const PROFILE_CHARACTERS = 300;
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
      'Search what the characters remember: earlier stories, backstory, and what this story has recorded so far. Use it when the passage turns on earlier events, people, or promises.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Words to search for.' },
        character: {
          type: 'string',
          description: "A character's name, or an empty string to search everyone in the story.",
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
    description: "A character's full card, with what they know and their recent stories.",
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
        role: { type: 'string', description: 'Their part in this story, in a sentence.' },
        notes: {
          type: 'string',
          description: 'Who they are: anything the story or the request establishes.',
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
            'What happens in the next passage, in order: one to four short beats, each a plain sentence.',
        },
        pov: {
          type: 'string',
          description:
            "The character the passage stays closest to, by name. The house style sets the narration's person and tense, so don't choose them.",
        },
        tone: { type: 'string', description: 'How the passage should feel, in a few words.' },
        length: {
          type: 'string',
          enum: BRIEF_LENGTHS,
          description: 'short: 1 to 3 paragraphs. medium: 3 to 5. long: 5 to 8.',
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
            "Continuity the Writer could get wrong, such as where everyone is or what just happened, in a sentence or two. Don't restate the character cards. Empty if nothing.",
        },
      },
      required: ['beats', 'pov', 'tone', 'length', 'memories', 'notes'],
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

// A narrative person named in a point of view: "first person", "close third", "third-person limited".
const NARRATIVE_PERSON =
  /\b(?:(?:close|deep|tight|limited)\s+(?:first|second|third)(?:[\s-]+person)?|(?:first|second|third|1st|2nd|3rd)[\s-]+person(?:\s+(?:limited|omniscient))?)\b/gi;

/**
 * A brief's point of view without any narrative person it names: the Director picks whose view,
 * and the house style, whatever it is, sets the narration's person and tense.
 */
function whoseView(pov) {
  return pov
    .replace(NARRATIVE_PERSON, '')
    .replace(/\(\s*\)/g, '')
    .replace(/([,;:—–-])(?:\s*[,;:—–-])+/g, '$1')
    .replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, '')
    .replace(/\s+([,;:])/g, '$1')
    .replace(/\s{2,}/g, ' ');
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
 * @param {Object} params.story - Uses title.
 * @param {Array<Object>} params.cast - The story's cast members, with seed cards.
 * @param {Array<Object>} params.turns - Turns before the one being written.
 * @param {Object} params.request - { action, direction, leadName }.
 * @param {string|null} [params.openingTime] - Loose start time, for an opening.
 * @param {boolean} [params.canCreateCharacters] - Whether create_character is offered.
 */
export function buildDirectorMessages({
  story,
  cast,
  turns,
  request,
  openingTime = null,
  canCreateCharacters = false,
}) {
  const persona = cast.find((member) => member.isPersona) ?? null;
  const personaName = persona ? nameOf(persona) : null;

  const system = [
    'You are the Director for an ongoing story. Before the Writer writes the next passage, decide what should happen in it and gather anything the Writer needs.',
    [
      '- Use recall when the passage turns on earlier events, people, or promises; lookup_lore for places, customs, or history; get_character_file for more about someone. Look up only what this passage needs: one or two lookups are usually enough, and none is fine.',
      '- Follow the request below. Keep the beats to what fits in one passage, ending where the reader can respond.',
      '- Plan what happens and leave how it reads to the Writer. Each beat is a plain sentence about what someone does or what changes, without lines of dialogue, jokes, imagery, or explanations of what anyone feels underneath.',
      '- Keep the characters in the moment. Plan a callback to earlier events or a running joke only when the scene is about it: people seldom talk about what they both already know.',
      "- The Writer has the character cards, so don't restate anyone's traits or habits in the notes.",
      "- For the point of view, name only the character the passage stays closest to. The narration's person and tense come from the house style, so don't specify them.",
      canCreateCharacters
        ? '- When the passage brings in a new named character who will matter beyond this scene, call create_character first so they have a card. Never for walk-ons, and never for anyone already in this story.'
        : null,
      personaName
        ? `- ${personaName}'s words and choices belong to the reader. Don't plan what ${personaName} says or decides.`
        : null,
      '- Finish by calling submit_brief once.',
    ]
      .filter(Boolean)
      .join('\n'),
  ];

  const castLines = cast.map((member) => {
    const label = member.isPersona ? `${nameOf(member)} (the reader's character)` : nameOf(member);
    const description = text(member.seedCard?.data?.description);
    return description ? `- ${label}: ${truncate(description, PROFILE_CHARACTERS)}` : `- ${label}`;
  });

  const storyText = turns
    .filter((turn) => turn.kind === 'prose' || turn.kind === 'scene_break')
    .map((turn) => (turn.kind === 'scene_break' ? '---' : turn.content))
    .join('\n\n');
  const recent =
    storyText.length > RECENT_STORY_CHARACTERS
      ? `[Earlier parts omitted.]\n…${storyText.slice(-RECENT_STORY_CHARACTERS)}`
      : storyText;

  const next = [];
  if (!turns.some((turn) => turn.kind === 'prose')) {
    next.push(
      openingTime
        ? `This is the opening of "${story.title}", which begins on ${openingTime}.`
        : `This is the opening of "${story.title}".`,
    );
  }
  if (request.action === 'write') {
    next.push(
      `${personaName ?? 'The reader'} wrote the latest passage above. Plan the response to it.`,
    );
  } else if (request.action === 'direct' && request.direction) {
    next.push(`The author wants this to happen next: ${request.direction}`);
  } else {
    next.push('Continue the story naturally from where it left off.');
  }
  if (request.leadName) {
    next.push(`Center the passage on ${request.leadName}.`);
  }

  return [
    { role: 'system', content: system.join('\n\n') },
    {
      role: 'user',
      content: [
        section('CAST', castLines.join('\n') || '(No one in the cast.)'),
        section('STORY SO FAR', recent || '(Nothing has been written yet.)'),
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
  const characters = cast.filter((member) => !member.isPersona);
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

  const handlers = {
    recall({ query, character }) {
      lookUp();
      let members = characters;
      if (text(character)) {
        const member = findMember(characters, character);
        if (!member) {
          const persona = findMember(
            cast.filter((castMember) => castMember.isPersona),
            character,
          );
          throw new Error(
            persona
              ? `${nameOf(persona)} is the reader's character and keeps no memories. To find what the others remember about ${nameOf(persona)}, search with an empty character.`
              : `No one named "${character}" in this story keeps memories`,
          );
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
            from: sourceLabelOf(memory),
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
          const keys = (entry.keys ?? []).join(' ').toLowerCase();
          const content = entry.content.toLowerCase();
          const score = words.reduce(
            (total, word) =>
              total + (keys.includes(word) ? 2 : 0) + (content.includes(word) ? 1 : 0),
            0,
          );
          if (score > 0) scored.push({ score, entry });
        }
      }
      return {
        entries: scored
          .toSorted((a, b) => b.score - a.score)
          .slice(0, LORE_LIMIT)
          .map(({ entry }) => ({
            keys: entry.keys ?? [],
            content: truncate(entry.content, LORE_ENTRY_CHARACTERS),
          })),
      };
    },

    get_character_file({ name }) {
      lookUp();
      const member = findMember(cast, name);
      if (!member) {
        throw new Error(`No one named "${name}" is in this story`);
      }
      const data = member.seedCard?.data ?? {};
      const file = {
        name: nameOf(member),
        readersCharacter: member.isPersona,
        description: text(data.description),
        personality: text(data.personality),
        scenario: text(data.scenario),
      };
      if (!member.isPersona) {
        const { knowledge, episodes } = selectForPrompt(visibleMemories(member), {
          knowledgeCharacters: bureau.settings.memory.knowledgeCharacters,
          recentEpisodes: bureau.settings.memory.recentEpisodes,
        });
        file.knows = knowledge.map((memory) => ({
          id: remember(member, memory),
          content: memory.content,
        }));
        file.recentStories = episodes.map((memory) => ({
          id: remember(member, memory),
          story: sourceLabelOf(memory),
          content: memory.content,
        }));
        file.hasChanged = notesAsOf(
          stores.arcNotes.listNotes(bureau.id, member.id, { status: 'accepted' }),
          story,
        ).map((note) => note.content);
      }
      return file;
    },

    submit_brief(args) {
      const beats = (Array.isArray(args.beats) ? args.beats : []).map(text).filter(Boolean);
      if (beats.length === 0) {
        throw new Error('A brief needs at least one beat');
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
        pov: whoseView(text(args.pov)),
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
          `${inStory ? nameOf(inStory) : wanted} is already in this story; use get_character_file to learn about them`,
        );
      }

      const addToStory = (member) => {
        const current = stores.stories.getStory(bureau.id, story.id);
        stores.stories.updateStory(bureau.id, story.id, {
          castIds: [...(current?.castIds ?? story.castIds), member.id],
        });
        cast.push(member);
        return {
          name: nameOf(member),
          description: truncate(text(member.seedCard?.data?.description), PROFILE_CHARACTERS),
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
 * @param {Object} params.request - { action, direction, leadName }.
 * @param {string|null} [params.openingTime]
 * @param {import('./deepseek-client.js').DeepSeekClient} params.client
 * @param {import('./run-recorder.js').RunRecorder} params.recorder
 * @param {AbortSignal} [params.signal]
 * @returns {Promise<Object|null>} The brief ({ beats, pov, tone, length, memories, notes }), or
 *   null when the Director answered without one.
 */
export async function runDirector({
  stores,
  bureau,
  story,
  cast,
  turns,
  request,
  openingTime = null,
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
      openingTime,
      canCreateCharacters: createCharacters,
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
    options: { thinking, reasoningEffort, strict: true, maxTokens: DIRECTOR_MAX_TOKENS },
    recorder,
    maxIterations: DIRECTOR_MAX_ITERATIONS,
    finalTool: 'submit_brief',
    signal,
  });
  return result.finalCall?.result ?? null;
}
