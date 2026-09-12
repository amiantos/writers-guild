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
            pov: 'Mara',
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
      pov: 'Mara',
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
    expect(theoFile).not.toHaveProperty('knows');
    expect(maraFile).toMatchObject({
      name: 'Mara',
      description: 'She keeps the Greywater light.',
      knows: [{ id: cantSwim.id, content: "Theo can't swim." }],
      hasChanged: ['Mara lets Theo steer now.'],
    });
  });

  it('reports lookups for anyone who keeps no memories back to the model', async () => {
    const client = scriptedClient(
      modelTurn([
        toolCall('c1', 'recall', { query: 'boats', character: 'Nobody' }),
        toolCall('c2', 'recall', { query: 'boats', character: 'Theo' }),
        toolCall('c3', 'get_character_file', { name: 'Nobody' }),
      ]),
      modelTurn([], 'Done.'),
    );

    await direct(client);

    expect(toolResults(client.calls[1]).map((result) => result.error)).toEqual([
      'No one named "Nobody" in this story keeps memories',
      "Theo is the reader's character and keeps no memories. To find what the others remember about Theo, search with an empty character.",
      'No one named "Nobody" is in this story',
    ]);
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
    expect(duplicate.error).toMatch(/Mara is already in the cast/);
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
      request: { action: 'direct', direction: 'Make it rain', leadName: 'Mara' },
    });

    expect(system.content).toContain("Theo's words and choices belong to the reader");
    expect(user.content).toContain(
      "=== CAST ===\n- Mara: She keeps the Greywater light.\n- Theo (the reader's character)",
    );
    expect(user.content).toContain('=== STORY SO FAR ===\nTheo knocked.');
    expect(user.content).not.toContain('An old direction');
    expect(user.content).toContain('The author wants this to happen next: Make it rain');
    expect(user.content).toContain('Center the passage on Mara.');
  });

  it('marks an opening with its loose start time', () => {
    const [, user] = buildDirectorMessages({
      story: { title: 'Lamplight' },
      cast,
      turns: [],
      request: { action: 'continue' },
      openingTime: 'a Tuesday, late evening, late October',
    });

    expect(user.content).toContain('(Nothing has been written yet.)');
    expect(user.content).toContain(
      'This is the opening of "Lamplight", which begins on a Tuesday, late evening, late October.',
    );
  });
});
