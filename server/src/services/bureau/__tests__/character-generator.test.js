import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  CREATE_CHARACTER_TOOL,
  buildGeneratorMessages,
  cardFromCharacter,
  generateCharacter,
} from '../character-generator.js';
import { getBureauStores } from '../stores.js';
import { closeBureauDb } from '../bureau-db.js';
import { DeepSeekError, assertStrictSchema } from '../deepseek-client.js';

const CHARACTER = {
  name: 'Ines Varga',
  description: 'Ines runs the harbor pub and knows everyone’s business.',
  personality: 'Warm, nosy, and impossible to lie to.',
  scenario: 'Behind the bar on a stormy night.',
  first_message: 'Ines slid a glass down the bar before anyone asked.',
  example_dialogue: '"You look like a man with a secret," Ines said.',
  tags: ['Pub', ' gossip ', 'pub', ''],
  appearance: {
    age_range: 'fifties',
    build: 'broad',
    hair: 'grey braid',
    eyes: 'brown',
    clothing: 'apron over a fisherman’s sweater',
    distinguishing_marks: '',
  },
};

function card(name, description = '') {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name, description } };
}

/** A client whose chat returns a create_character call with `args` (raw text if a string). */
function generatorClient(args, { failWith = null } = {}) {
  const client = {
    model: 'deepseek-flash',
    calls: [],
    async chat(options) {
      client.calls.push(options);
      if (failWith) throw failWith;
      return {
        content: '',
        reasoning: '',
        finishReason: 'tool_calls',
        model: 'deepseek-flash',
        usage: { prompt_tokens: 500, completion_tokens: 400 },
        toolCalls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'create_character',
              arguments: typeof args === 'string' ? args : JSON.stringify(args),
            },
          },
        ],
      };
    },
  };
  return client;
}

describe('cardFromCharacter', () => {
  it('builds a V2 card with the appearance block and tidy tags', () => {
    const result = cardFromCharacter(CHARACTER, { bureauName: 'Harbor' });

    expect(result).toMatchObject({
      spec: 'chara_card_v2',
      data: {
        name: 'Ines Varga',
        first_mes: 'Ines slid a glass down the bar before anyone asked.',
        mes_example: '"You look like a man with a secret," Ines said.',
        creator_notes: 'Generated in the Bureau "Harbor".',
        tags: ['pub', 'gossip', 'bureau'],
        extensions: { bureau_appearance: { hair: 'grey braid', distinguishing_marks: '' } },
      },
    });
  });

  it('uses a required name, and refuses a character with none', () => {
    expect(cardFromCharacter(CHARACTER, { bureauName: 'Harbor', name: 'Ines' }).data.name).toBe(
      'Ines',
    );
    expect(() => cardFromCharacter({ ...CHARACTER, name: ' ' }, { bureauName: 'Harbor' })).toThrow(
      /no name/,
    );
  });
});

describe('buildGeneratorMessages', () => {
  it('gives the idea, name, role, cast, and world', () => {
    const [system, user] = buildGeneratorMessages({
      idea: 'A harbor pub owner who hears everything',
      name: 'Ines',
      role: 'She warns Theo about the storm',
      cast: [{ name: 'Mara', seedCard: card('Mara', 'Keeper of the light.') }],
      world: ['Greywater: lighthouse, harbor'],
    });

    expect(system.content).toContain('never copy or duplicate anyone already in it');
    expect(system.content).toContain('never name or describe anyone from it');
    expect(user.content).toContain('=== IDEA ===\nA harbor pub owner who hears everything');
    expect(user.content).toContain('The character is named Ines.');
    expect(user.content).toContain('=== ROLE IN THE CURRENT CHAPTER ===\nShe warns Theo');
    expect(user.content).toContain('=== EXISTING CAST ===\n- Mara: Keeper of the light.');
    expect(user.content).toContain('=== WORLD ===\n- Greywater: lighthouse, harbor');
  });

  it("gives images in the cast's descriptions as labels", () => {
    const [, user] = buildGeneratorMessages({
      idea: 'A new regular at the pub',
      cast: [
        {
          name: 'June',
          seedCard: card('June', '![June](/api/assets/characters/c3/june.webp) A regular.'),
        },
      ],
    });

    expect(user.content).toContain('=== EXISTING CAST ===\n- June: [image: June] A regular.');
  });
});

describe('generateCharacter', () => {
  let tempDir;
  let stores;
  let bureau;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'character-generator-'));
    stores = getBureauStores(tempDir);
    bureau = stores.bureaus.createBureau({ name: 'Harbor', apiKey: 'sk-test' });
    stores.bureaus.addCastMember(bureau.id, {
      seedCard: card('Mara', 'Keeper of the light.'),
      libraryCharacterId: 'c1',
    });
  });

  afterEach(() => {
    stores.library.close();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('uses a schema that strict mode accepts', () => {
    expect(() => assertStrictSchema(CREATE_CHARACTER_TOOL.parameters)).not.toThrow();
  });

  it('forces the tool with the cast and world, and records its own run', async () => {
    stores.library = {
      close() {},
      async getLorebook() {
        return {
          name: 'Greywater',
          entries: [
            { keys: ['lighthouse'], enabled: true },
            { keys: ['secret'], enabled: false },
          ],
        };
      },
    };
    stores.bureaus.attachLorebook(bureau.id, 'lb-1');
    const client = generatorClient(CHARACTER);

    const { card: generated, runId } = await generateCharacter({
      stores,
      bureau,
      client,
      idea: 'A harbor pub owner',
    });

    expect(generated.data.name).toBe('Ines Varga');
    expect(client.calls[0]).toMatchObject({
      strict: true,
      thinking: false,
      toolChoice: { name: 'create_character' },
    });
    expect(client.calls[0].messages[1].content).toContain('- Mara: Keeper of the light.');
    expect(client.calls[0].messages[1].content).toContain('- Greywater: lighthouse');
    const run = stores.bureaus.getRun(bureau.id, runId);
    expect(run).toMatchObject({ purpose: 'generate_character', status: 'completed' });
    expect(run.steps.map((step) => [step.role, step.kind])).toEqual([
      ['generator', 'model'],
      ['generator', 'tool'],
    ]);
  });

  it("records into a caller's run without finishing it", async () => {
    const steps = [];
    const recorder = {
      runId: 'director-run',
      recordStep: (step) => steps.push(step),
      complete: () => steps.push('completed'),
      fail: () => steps.push('failed'),
    };

    const { runId } = await generateCharacter({
      stores,
      bureau,
      client: generatorClient(CHARACTER),
      idea: 'A harbor pub owner',
      recorder,
    });

    expect(runId).toBe('director-run');
    expect(steps.map((step) => step.kind ?? step)).toEqual(['model', 'tool']);
  });

  it('fails the run on a model failure or a broken answer', async () => {
    const failure = new DeepSeekError('DeepSeek API error 402 (insufficient balance)');

    await expect(
      generateCharacter({
        stores,
        bureau,
        client: generatorClient(CHARACTER, { failWith: failure }),
        idea: 'x',
      }),
    ).rejects.toBe(failure);
    await expect(
      generateCharacter({ stores, bureau, client: generatorClient('{"name":'), idea: 'x' }),
    ).rejects.toThrow('valid JSON');

    expect(stores.bureaus.listRuns(bureau.id).map((run) => run.status)).toEqual([
      'failed',
      'failed',
    ]);
  });
});
