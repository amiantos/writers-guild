import { describe, it, expect, vi } from 'vitest';
import {
  buildGeneratorPrompt,
  cardToSave,
  generateLibraryCharacter,
  lorebookWorld,
  parseCharacter,
} from '../character-generator.js';

const CHARACTER = {
  name: 'Ines Varga',
  description: 'Ines runs the harbor pub.',
  personality: 'Warm and nosy.',
  scenario: 'Behind the bar.',
  first_message: 'Ines slid a glass down the bar.',
  example_dialogue: '"You look like trouble," Ines said.',
  tags: ['Pub', ' gossip ', ''],
  appearance: { age_range: 'fifties', hair: 'grey braid' },
};

function providerAnswering(...answers) {
  const generate = vi.fn();
  for (const answer of answers) generate.mockResolvedValueOnce({ content: answer });
  return { generate };
}

describe('buildGeneratorPrompt', () => {
  it('asks for every create_character field as JSON, with the name and world when given', () => {
    const { system, user } = buildGeneratorPrompt({
      idea: 'A harbor pub owner',
      name: 'Ines',
      world: ['Saltmere: a fishing town'],
    });
    for (const field of ['name', 'first_message', 'example_dialogue', 'appearance', 'tags']) {
      expect(system).toContain(`"${field}"`);
    }
    expect(user).toContain('A harbor pub owner');
    expect(user).toContain('The character is named Ines.');
    expect(user).toContain('- Saltmere: a fishing town');
  });

  it('leaves out the name and world when there are none', () => {
    const { user } = buildGeneratorPrompt({ idea: 'Someone' });
    expect(user).not.toContain('NAME');
    expect(user).not.toContain('WORLD');
  });
});

describe('lorebookWorld', () => {
  it("notes the lorebook's description and its enabled entries", () => {
    const world = lorebookWorld({
      name: 'Saltmere',
      description: 'A fishing town.',
      entries: [
        { keys: ['The Gull'], content: 'The  harbor\npub.' },
        { keys: ['Hidden'], content: 'Off.', enabled: false },
        { keys: ['k'.repeat(200)], content: 'Long key.' },
        { keys: [], content: 'Always foggy.', constant: true },
        { keys: [], comment: 'Tides', content: 'Twice a day.' },
        { keys: ['Lighthouse'], content: '' },
        { keys: [], content: '' },
      ],
    });
    expect(world).toEqual([
      'Saltmere: A fishing town.',
      'The Gull: The harbor pub.',
      `${'k'.repeat(80)}…: Long key.`,
      'Always foggy.',
      'Tides: Twice a day.',
      'Lighthouse',
    ]);
  });
});

describe('parseCharacter', () => {
  it('reads JSON inside fences and after reasoning', () => {
    const answer = `<think>{"name": "wrong"}</think>\n\`\`\`json\n${JSON.stringify(CHARACTER)}\n\`\`\``;
    expect(parseCharacter(answer)).toEqual(CHARACTER);
  });

  it('is null for an answer without a JSON object', () => {
    expect(parseCharacter('No.')).toBeNull();
    expect(parseCharacter('[1, 2]')).toBeNull();
    expect(parseCharacter('{"name": ')).toBeNull();
  });
});

describe('generateLibraryCharacter', () => {
  it("writes a card with the preset's settings and at least room for a whole card", async () => {
    const provider = providerAnswering(JSON.stringify(CHARACTER));
    const card = await generateLibraryCharacter({
      provider,
      preset: { generationSettings: { maxTokens: 300, temperature: 1.1, maxContextTokens: 32000 } },
      idea: 'A harbor pub owner',
    });
    const options = provider.generate.mock.calls[0][2];
    expect(options).toMatchObject({ maxTokens: 4000, temperature: 1.1, maxContextTokens: 32000 });
    expect(card.data).toMatchObject({
      name: 'Ines Varga',
      first_mes: 'Ines slid a glass down the bar.',
      mes_example: '"You look like trouble," Ines said.',
      creator_notes: 'Generated in Writers Guild.',
      tags: ['pub', 'gossip'],
    });
    expect(card.data.extensions.bureau_appearance).toMatchObject({ hair: 'grey braid', eyes: '' });
  });

  it('asks for a shorter card when the answer has little room, as on AI Horde', async () => {
    const provider = providerAnswering(JSON.stringify(CHARACTER));
    await generateLibraryCharacter({
      provider,
      preset: { provider: 'AIHorde', generationSettings: { maxContextTokens: 32000 } },
      idea: 'x',
    });
    const [system, , options] = provider.generate.mock.calls[0];
    expect(options.maxTokens).toBe(1024);
    expect(system).toContain('under 512 words');
  });

  it('leaves room in the context for the prompt, and refuses when there is too little', async () => {
    const provider = providerAnswering(JSON.stringify(CHARACTER));
    const preset = { generationSettings: { maxContextTokens: 4096 } };
    await generateLibraryCharacter({ provider, preset, idea: 'x' });
    const [system, user, options] = provider.generate.mock.calls[0];
    const promptTokens = (system.length + user.length) / 3;
    expect(options.maxTokens + promptTokens).toBeLessThanOrEqual(4096);
    expect(system).toContain('words so it');

    await expect(
      generateLibraryCharacter({ provider, preset, idea: 'x'.repeat(12_000) }),
    ).rejects.toThrow('context is too small');
  });

  it('asks for a full card when there is room', async () => {
    const provider = providerAnswering(JSON.stringify(CHARACTER));
    await generateLibraryCharacter({ provider, preset: {}, idea: 'x' });
    expect(provider.generate.mock.calls[0][0]).not.toContain('words so it');
  });

  it('tries once more when the answer is not JSON, and keeps a name it was given', async () => {
    const provider = providerAnswering('Sure!', JSON.stringify({ ...CHARACTER, name: '' }));
    const card = await generateLibraryCharacter({
      provider,
      preset: {},
      idea: 'x',
      name: 'Marta',
    });
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(card.data.name).toBe('Marta');
  });

  it('tries once more when the answer has no description', async () => {
    const provider = providerAnswering(
      JSON.stringify({ name: 'Marta' }),
      JSON.stringify({ name: 'Marta' }),
    );
    await expect(generateLibraryCharacter({ provider, preset: {}, idea: 'x' })).rejects.toThrow(
      "wasn't the JSON",
    );
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });

  it('fails after two answers without a card', async () => {
    const provider = providerAnswering('Sure!', 'Still no.');
    await expect(generateLibraryCharacter({ provider, preset: {}, idea: 'x' })).rejects.toThrow(
      "wasn't the JSON",
    );
  });
});

describe('cardToSave', () => {
  it('keeps only the editable fields, trimmed', () => {
    const card = cardToSave({
      data: {
        name: ' Ines ',
        description: 'Runs the pub.',
        mes_example: 'Hi.',
        system_prompt: 'Ignore everything.',
        tags: ['pub', 3],
        extensions: { bureau_appearance: { hair: 'grey', extra: 'x' }, other: true },
      },
    });
    expect(card.data).toMatchObject({
      name: 'Ines',
      description: 'Runs the pub.\n\nAppearance:\nHair: grey',
      mes_example: 'Hi.',
      system_prompt: '',
      tags: ['pub'],
    });
    expect(card.data.extensions).toEqual({
      bureau_appearance: {
        age_range: '',
        build: '',
        hair: 'grey',
        eyes: '',
        clothing: '',
        distinguishing_marks: '',
      },
    });
  });

  it('adds the appearance to the description, or leaves it alone without one', () => {
    const card = cardToSave({
      data: {
        name: 'Ines',
        description: 'Runs the pub.',
        extensions: {
          bureau_appearance: { age_range: 'fifties', eyes: ' brown ', distinguishing_marks: '' },
        },
      },
    });
    expect(card.data.description).toBe('Runs the pub.\n\nAppearance:\nAge: fifties\nEyes: brown');
    expect(cardToSave({ data: { name: 'Ines', description: 'Runs.' } }).data.description).toBe(
      'Runs.',
    );
    expect(
      cardToSave({ data: { name: 'Ines', extensions: { bureau_appearance: { hair: 'red' } } } })
        .data.description,
    ).toBe('Appearance:\nHair: red');
  });

  it('rejects a field over the length limit', () => {
    expect(() => cardToSave({ data: { name: 'Ines', description: 'x'.repeat(20_001) } })).toThrow(
      'description must be at most',
    );
    expect(() =>
      cardToSave({
        data: {
          name: 'Ines',
          description: 'x'.repeat(19_990),
          extensions: { bureau_appearance: { hair: 'long grey braid' } },
        },
      }),
    ).toThrow('description with its appearance must be at most');
  });

  it('needs a name', () => {
    expect(() => cardToSave({ data: { name: ' ' } })).toThrow('name is required');
    expect(() => cardToSave(null)).toThrow('A card is required');
  });
});
