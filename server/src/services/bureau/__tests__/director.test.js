import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DIRECTOR_TOOLS, buildDirectorMessages, runDirector } from '../director.js';
import { getBureauStores } from '../stores.js';
import { closeBureauDb } from '../bureau-db.js';
import { assertStrictSchema } from '../deepseek-client.js';

const START = '2026-10-27T07:30:00.000Z';

function card(name, description = '') {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name, description } };
}

function toolCall(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function modelTurn(toolCalls = [], content = '') {
  return {
    content,
    reasoning: '',
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    usage: { prompt_tokens: 200, completion_tokens: 30 },
    model: 'deepseek-flash',
  };
}

/** A client that answers with each turn in order; a function turn gets the request. */
function scriptedClient(...turns) {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    async chat(options) {
      client.calls.push(options);
      const turn = turns[client.calls.length - 1];
      return typeof turn === 'function' ? turn(options) : turn;
    },
  };
  return client;
}

function toolResults(options) {
  return options.messages
    .filter((message) => message.role === 'tool')
    .map((message) => JSON.parse(message.content));
}

describe('runDirector', () => {
  let tempDir;
  let stores;
  let bureau;
  let mara;
  let theo;
  let story;
  let cantSwim;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'director-'));
    stores = getBureauStores(tempDir);
    bureau = stores.bureaus.createBureau({ name: 'Harbor', apiKey: 'sk-test' });
    mara = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Mara', 'She keeps the Greywater light.'),
      libraryCharacterId: 'c1',
    });
    theo = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Theo', 'A cartographer.'),
      libraryCharacterId: 'c2',
      isPersona: true,
    });
    const earlier = stores.stories.createStory(bureau.id, {
      startTime: '2026-10-01T20:00:00.000Z',
      castIds: [mara.id, theo.id],
      title: 'The Lamp Room',
    });
    story = stores.stories.createStory(bureau.id, {
      startTime: START,
      castIds: [mara.id, theo.id],
      title: 'Weather Coming In',
    });
    const later = stores.stories.createStory(bureau.id, {
      startTime: '2026-11-20T20:00:00.000Z',
      castIds: [mara.id, theo.id],
    });
    const fromStory = (source, content) =>
      stores.memories.addMemory(bureau.id, mara.id, {
        layer: 'knowledge',
        content,
        sourceType: 'story',
        sourceId: source.id,
        worldTime: source.startTime,
      });
    cantSwim = fromStory(earlier, "Theo can't swim.");
    fromStory(later, 'Theo swims to the buoy every morning.');
  });

  afterEach(() => {
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function direct(client, request = { action: 'continue' }, turns = []) {
    return runDirector({
      stores,
      bureau: stores.bureaus.getBureau(bureau.id),
      story: stores.stories.getStory(bureau.id, story.id),
      cast: [
        stores.bureaus.getCastMember(bureau.id, mara.id),
        stores.bureaus.getCastMember(bureau.id, theo.id),
      ],
      turns,
      request,
      client,
      recorder: { runId: 'run-1', recordStep() {} },
    });
  }

  it('uses schemas that strict mode accepts', () => {
    for (const tool of DIRECTOR_TOOLS) {
      expect(() => assertStrictSchema(tool.parameters)).not.toThrow();
    }
  });

  it('recalls what the story can see and cites only found memories in the brief', async () => {
    const client = scriptedClient(
      modelTurn([toolCall('c1', 'recall', { query: 'swimming', character: 'mara' })]),
      (options) => {
        const [{ memories }] = toolResults(options);
        return modelTurn([
          toolCall('c2', 'submit_brief', {
            beats: ['Mara offers a lesson', ' '],
            tone: 'wry',
            length: 'enormous',
            memories: [
              { id: memories[0].id, reason: 'He cannot swim' },
              { id: 9999, reason: 'Made up' },
            ],
            notes: '',
          }),
        ]);
      },
    );

    const brief = await direct(client);

    expect(toolResults(client.calls[1])[0].memories.map((memory) => memory.content)).toEqual([
      "Theo can't swim.",
    ]);
    expect(brief).toEqual({
      beats: ['Mara offers a lesson'],
      tone: 'wry',
      length: 'medium',
      memories: [
        {
          id: cantSwim.id,
          character: 'Mara',
          content: "Theo can't swim.",
          reason: 'He cannot swim',
        },
      ],
      notes: '',
    });
    expect(client.calls[0]).toMatchObject({ strict: true, thinking: true, reasoningEffort: 'low' });
  });

  it('looks up lore and character files', async () => {
    stores.library = {
      close() {},
      async getLorebook(lorebookId) {
        if (lorebookId !== 'lb-1') throw new Error(`Lorebook not found: ${lorebookId}`);
        return {
          entries: [
            {
              keys: ['lighthouse'],
              content: 'The Greywater light went dark in 1971.',
              enabled: true,
            },
            { keys: ['market'], content: 'The night market opens on Fridays.', enabled: true },
            { keys: ['lighthouse'], content: 'A disabled entry.', enabled: false },
          ],
        };
      },
    };
    stores.arcNotes.addNote(bureau.id, mara.id, {
      content: 'Mara lets Theo steer now.',
      status: 'accepted',
    });
    stores.bureaus.attachLorebook(bureau.id, 'lb-gone');
    stores.bureaus.attachLorebook(bureau.id, 'lb-1');
    const client = scriptedClient(
      modelTurn([
        toolCall('c1', 'lookup_lore', { query: 'the lighthouse' }),
        toolCall('c2', 'get_character_file', { name: 'Theo' }),
        toolCall('c3', 'get_character_file', { name: 'mara' }),
      ]),
      modelTurn([], 'I have what I need.'),
    );

    const brief = await direct(client);

    expect(brief).toBeNull();
    const [lore, theoFile, maraFile] = toolResults(client.calls[1]);
    expect(lore).toEqual({
      entries: [{ keys: ['lighthouse'], content: 'The Greywater light went dark in 1971.' }],
    });
    expect(theoFile).toMatchObject({ name: 'Theo', readersCharacter: true });
    // The reader's character's file has their memories too.
    expect(theoFile).toMatchObject({ knows: [], recentEpisodes: [], hasChanged: [] });
    expect(maraFile).toMatchObject({
      name: 'Mara',
      description: 'She keeps the Greywater light.',
      knows: [{ id: cantSwim.id, content: "Theo can't swim." }],
      hasChanged: ['Mara lets Theo steer now.'],
    });
  });

  it('looks up lore with images as labels, so their URLs take up no room', async () => {
    const url = `/api/assets/lorebooks/lb-1/${'a'.repeat(64)}.webp`;
    stores.library = {
      close() {},
      async getLorebook() {
        return {
          entries: [
            {
              keys: ['pier'],
              content: `Photos of the pier:\n![Mara at the pier](${url})\n![](${url})`,
              enabled: true,
            },
          ],
        };
      },
    };
    stores.bureaus.attachLorebook(bureau.id, 'lb-1');
    const client = scriptedClient(
      modelTurn([toolCall('c1', 'lookup_lore', { query: 'pier photos' })]),
      modelTurn([], 'Done.'),
    );

    await direct(client);

    expect(toolResults(client.calls[1])[0]).toEqual({
      entries: [
        { keys: ['pier'], content: 'Photos of the pier:\n[image: Mara at the pier]\n[image]' },
      ],
    });
  });

  it("reports lookups for anyone who isn't in the chapter, and recalls the reader's character too", async () => {
    const client = scriptedClient(
      modelTurn([
        toolCall('c1', 'recall', { query: 'boats', character: 'Nobody' }),
        toolCall('c2', 'recall', { query: 'boats', character: 'Theo' }),
        toolCall('c3', 'get_character_file', { name: 'Nobody' }),
      ]),
      modelTurn([], 'Done.'),
    );

    await direct(client);

    const [nobody, theoRecall, nobodyFile] = toolResults(client.calls[1]);
    expect(nobody.error).toBe('No one named "Nobody" is in this chapter');
    // The reader's character remembers too, so their memories can be searched.
    expect(theoRecall).toEqual({ memories: [] });
    expect(nobodyFile.error).toBe('No one named "Nobody" is in this chapter');
  });

  it('creates a draft cast member for a new named character and adds them to the story', async () => {
    const generated = {
      name: 'Someone Else',
      description: 'Runs the harbor pub and hears everything.',
      personality: 'Nosy.',
      scenario: '',
      first_message: '',
      example_dialogue: '',
      tags: [],
      appearance: {
        age_range: '',
        build: '',
        hair: '',
        eyes: '',
        clothing: '',
        distinguishing_marks: '',
      },
    };
    const client = scriptedClient(
      modelTurn([
        toolCall('c1', 'create_character', {
          name: 'Ines',
          role: 'She warns Theo about the storm.',
          notes: 'Owns the harbor pub.',
        }),
      ]),
      modelTurn([toolCall('g1', 'create_character', generated)]),
      modelTurn([toolCall('c2', 'create_character', { name: 'mara', role: '', notes: '' })]),
      modelTurn([], 'Done.'),
    );
    const cast = [
      stores.bureaus.getCastMember(bureau.id, mara.id),
      stores.bureaus.getCastMember(bureau.id, theo.id),
    ];

    await runDirector({
      stores,
      bureau: stores.bureaus.getBureau(bureau.id),
      story: stores.stories.getStory(bureau.id, story.id),
      cast,
      turns: [],
      request: { action: 'direct', direction: 'Ines arrives with news' },
      client,
      recorder: { runId: 'run-1', recordStep() {} },
    });

    expect(client.calls[0].messages[0].content).toContain('call create_character first');
    expect(client.calls[1].messages[1].content).toContain('The character is named Ines.');
    const ines = stores.bureaus.listCast(bureau.id).find((member) => member.name === 'Ines');
    expect(ines).toMatchObject({ isDraft: true, libraryCharacterId: null });
    expect(stores.stories.getStory(bureau.id, story.id).castIds).toContain(ines.id);
    expect(cast.map((member) => member.name)).toEqual(['Mara', 'Theo', 'Ines']);
    const [created, duplicate] = toolResults(client.calls[3]);
    expect(created).toEqual({
      name: 'Ines',
      description: 'Runs the harbor pub and hears everything.',
      addedToStory: true,
    });
    expect(duplicate.error).toMatch(/Mara is already in this chapter/);
  });

  it('brings someone already in the Bureau into the story instead of creating them', async () => {
    const ines = stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Ines', 'Runs the harbor pub.'),
      libraryCharacterId: 'c3',
    });
    const client = scriptedClient(
      modelTurn([toolCall('c1', 'create_character', { name: 'Ines', role: '', notes: '' })]),
      modelTurn([], 'Done.'),
    );
    const cast = [
      stores.bureaus.getCastMember(bureau.id, mara.id),
      stores.bureaus.getCastMember(bureau.id, theo.id),
    ];

    await runDirector({
      stores,
      bureau: stores.bureaus.getBureau(bureau.id),
      story: stores.stories.getStory(bureau.id, story.id),
      cast,
      turns: [],
      request: { action: 'direct', direction: 'Ines arrives' },
      client,
      recorder: { runId: 'run-1', recordStep() {} },
    });

    expect(client.calls).toHaveLength(2);
    expect(toolResults(client.calls[1])[0]).toEqual({
      name: 'Ines',
      description: 'Runs the harbor pub.',
      addedToStory: true,
      existing: true,
    });
    expect(stores.stories.getStory(bureau.id, story.id).castIds).toContain(ines.id);
    expect(cast.map((member) => member.name)).toEqual(['Mara', 'Theo', 'Ines']);
    expect(stores.bureaus.listCast(bureau.id).filter((member) => member.isDraft)).toEqual([]);
  });

  it('lets the Director try again when generating a character fails', async () => {
    const create = (id) => toolCall(id, 'create_character', { name: 'Ines', role: '', notes: '' });
    const client = scriptedClient(
      modelTurn([create('c1')]),
      modelTurn([], 'I would rather not.'),
      modelTurn([create('c2')]),
      modelTurn([
        toolCall('g1', 'create_character', {
          name: 'Ines',
          description: 'Runs the harbor pub.',
          personality: '',
          scenario: '',
          first_message: '',
          example_dialogue: '',
          tags: [],
          appearance: {
            age_range: '',
            build: '',
            hair: '',
            eyes: '',
            clothing: '',
            distinguishing_marks: '',
          },
        }),
      ]),
      modelTurn([], 'Done.'),
    );

    await direct(client);

    const [failed, created] = toolResults(client.calls[4]);
    expect(failed.error).toBeTruthy();
    expect(created).toMatchObject({ name: 'Ines', addedToStory: true });
    expect(stores.bureaus.listCast(bureau.id).map((member) => member.name)).toContain('Ines');
  });

  it("doesn't offer create_character when the Bureau turns it off", async () => {
    stores.bureaus.updateSettings(bureau.id, { director: { createCharacters: false } });
    const client = scriptedClient(modelTurn([], 'Done.'));

    await direct(client);

    expect(client.calls[0].tools.map((tool) => tool.name)).not.toContain('create_character');
    expect(client.calls[0].messages[0].content).not.toContain('create_character');
  });

  it('stops looking things up after four lookups', async () => {
    const lookup = (id) => toolCall(id, 'lookup_lore', { query: 'lighthouse' });
    const client = scriptedClient(
      modelTurn([lookup('c1'), lookup('c2'), lookup('c3'), lookup('c4'), lookup('c5')]),
      modelTurn([], 'Done.'),
    );

    await direct(client);

    expect(toolResults(client.calls[1]).at(-1).error).toBe(
      "That's enough looking up for one passage. Call submit_brief now.",
    );
  });

  it('creates characters after its lookups run out, up to two per passage', async () => {
    const lookup = (id) => toolCall(id, 'lookup_lore', { query: 'lighthouse' });
    const create = (id, name) => toolCall(id, 'create_character', { name, role: '', notes: '' });
    const generated = (name) =>
      modelTurn([
        toolCall('g', 'create_character', {
          name,
          description: `${name} works the harbor.`,
          personality: '',
          scenario: '',
          first_message: '',
          example_dialogue: '',
          tags: [],
          appearance: {
            age_range: '',
            build: '',
            hair: '',
            eyes: '',
            clothing: '',
            distinguishing_marks: '',
          },
        }),
      ]);
    const client = scriptedClient(
      modelTurn([lookup('c1'), lookup('c2'), lookup('c3'), lookup('c4')]),
      modelTurn([create('c5', 'Ines')]),
      generated('Ines'),
      modelTurn([create('c6', 'Pell')]),
      generated('Pell'),
      modelTurn([create('c7', 'Quill')]),
      modelTurn([], 'Done.'),
    );

    await direct(client);

    const results = toolResults(client.calls[6]).slice(4);
    expect(results.map((result) => result.name ?? result.error)).toEqual([
      'Ines',
      'Pell',
      "That's enough new characters for one passage. Call submit_brief now.",
    ]);
    const names = stores.bureaus.listCast(bureau.id).map((member) => member.name);
    expect(names).toEqual(expect.arrayContaining(['Ines', 'Pell']));
    expect(names).not.toContain('Quill');
  });

  it("recalls this story's memories only from passages before the one being written", async () => {
    const earlier = stores.stories.addTurn(story.id, {
      kind: 'prose',
      source: 'generated',
      content: 'Theo waded in.',
    });
    const later = stores.stories.addTurn(story.id, {
      kind: 'prose',
      source: 'generated',
      content: 'Theo swam to the buoy.',
    });
    const fromTurn = (turn, content) =>
      stores.memories.addMemory(bureau.id, mara.id, {
        layer: 'knowledge',
        content,
        sourceType: 'story',
        sourceId: story.id,
        worldTime: START,
        sourceTurnIds: [turn.id],
      });
    fromTurn(earlier, 'Theo waded into the water.');
    fromTurn(later, 'Theo swam out to the buoy.');
    const client = scriptedClient(
      modelTurn([toolCall('c1', 'recall', { query: 'Theo', character: '' })]),
      modelTurn([], 'Done.'),
    );

    await direct(client, { action: 'continue' }, [earlier]);

    const contents = toolResults(client.calls[1])[0].memories.map((memory) => memory.content);
    expect(contents).toContain('Theo waded into the water.');
    expect(contents).not.toContain('Theo swam out to the buoy.');
    // This chapter's own memories are marked, so they don't read as an earlier chapter.
    const labels = Object.fromEntries(
      toolResults(client.calls[1])[0].memories.map((memory) => [memory.content, memory.from]),
    );
    expect(labels['Theo waded into the water.']).toBe('this chapter');
    expect(labels["Theo can't swim."]).not.toBe('this chapter');
  });
});

describe('buildDirectorMessages', () => {
  const cast = [
    { name: 'Mara', isPersona: false, seedCard: card('Mara', 'She keeps the Greywater light.') },
    { name: 'Theo', isPersona: true, seedCard: card('Theo') },
  ];

  it('gives the cast, the recent story, and the request', () => {
    const [system, user] = buildDirectorMessages({
      story: { title: 'Lamplight' },
      cast,
      turns: [
        { kind: 'prose', source: 'user', content: 'Theo knocked.' },
        { kind: 'direction', source: 'user', content: 'An old direction' },
      ],
      request: { action: 'direct', direction: 'Make it rain' },
    });

    expect(system.content).toContain(
      '- Follow the request below. Keep the beats to what fits in one passage, ending where the reader can respond.',
    );
    expect(system.content).not.toMatch(/belong to the reader|waits on Theo|Don't plan what Theo/);
    expect(system.content).toContain(
      "- A passage can follow any of the characters in the chapter, often several at once as they interact; don't build it around one character's point of view.",
    );
    expect(system.content).not.toContain('name only the character the passage stays closest to');
    expect(user.content).toContain(
      "=== CAST ===\n- Mara: She keeps the Greywater light.\n- Theo (the reader's character)",
    );
    expect(user.content).toContain('=== CHAPTER SO FAR ===\nTheo knocked.');
    expect(user.content).not.toContain('An old direction');
    expect(user.content).toContain(
      "The author's direction for the next passage (not part of the story yet): Make it rain\nPlan a passage that carries it out.",
    );
    expect(user.content).not.toContain('Center the passage');
  });

  it("continues the story when there's no direction, without holding back the reader's character", () => {
    const [system, user] = buildDirectorMessages({
      story: { title: 'Lamplight' },
      cast,
      turns: [{ kind: 'prose', source: 'user', content: 'Theo knocked.' }],
      request: { action: 'write' },
    });

    expect(system.content).not.toMatch(/Don't plan what Theo|waits on Theo/);
    // Who wrote the latest passage doesn't matter: the story just continues.
    expect(user.content).toContain(
      '=== NEXT ===\nContinue the story naturally from where it left off.',
    );
    expect(user.content).not.toContain('wrote the latest passage');
    expect(system.content).toContain(
      "- Keep the scene moving. Don't plan an action, gesture, or bit of business the recent passages already have",
    );
  });

  it('marks an opening with its exact start time, in the Bureau time zone', () => {
    const [, user] = buildDirectorMessages({
      story: { title: 'Lamplight', startTime: START },
      cast,
      turns: [],
      request: { action: 'continue' },
      timeZone: 'America/Los_Angeles',
    });

    expect(user.content).toContain('(Nothing has been written yet.)');
    expect(user.content).toContain(
      'This is the opening of "Lamplight", which begins at exactly 12:30 AM on Tuesday, October 27, 2026.',
    );
  });

  it("gives later passages the chapter's time, and marks time passing", () => {
    const prose = { kind: 'prose', source: 'generated', content: 'The lamp was lit.' };
    const passes = {
      kind: 'time_passes',
      source: 'user',
      content: '',
      bureauTime: '2026-10-28T15:00:00.000Z',
    };
    const next = (turns) =>
      buildDirectorMessages({
        story: { title: 'Lamplight', startTime: START },
        cast,
        turns,
        request: { action: 'continue' },
        timeZone: 'America/Los_Angeles',
      })[1].content;

    expect(next([prose])).toContain(
      '=== NEXT ===\nWhen the chapter began, the time was exactly 12:30 AM on Tuesday, October 27, 2026.\nContinue the story naturally from where it left off.',
    );
    expect(next([prose, passes])).toContain(
      "The lamp was lit.\n\n---\n\n[Time passes. It's now exactly 8:00 AM on Wednesday, October 28, 2026.]",
    );
    expect(next([prose, passes])).toContain(
      "Time has just passed: it's now exactly 8:00 AM on Wednesday, October 28, 2026. Plan the passage from this time.",
    );
    expect(next([prose, passes, prose])).toContain(
      'When time last passed in the chapter, it was exactly 8:00 AM on Wednesday, October 28, 2026.',
    );
  });

  it('gives images in the cast and the chapter as labels', () => {
    const [, user] = buildDirectorMessages({
      story: { title: 'Lamplight' },
      cast: [
        {
          name: 'June',
          isPersona: false,
          seedCard: card('June', 'A regular. ![June](/api/assets/characters/c3/june.webp)'),
        },
      ],
      turns: [
        {
          kind: 'prose',
          source: 'user',
          content: 'June waved.\n\n![June waving](/api/assets/characters/c3/wave.webp)',
        },
      ],
      request: { action: 'continue' },
    });

    expect(user.content).toContain('- June: A regular. [image: June]');
    expect(user.content).toContain('June waved.\n\n[image: June waving]');
    expect(user.content).not.toContain('/api/assets/');
  });
});
