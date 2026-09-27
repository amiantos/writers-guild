import { describe, it, expect, vi } from 'vitest';
import {
  applyEdit,
  buildArchivistPrompt,
  chatTranscript,
  chunkText,
  parseSuggestions,
  runArchivist,
  validateSuggestions,
} from '../card-archivist.js';

const LAYLA = {
  id: 'layla',
  name: 'Layla',
  description: 'Layla is a baker in Portland. She is single and lives alone.',
  personality: 'Warm, stubborn.',
};

describe('chatTranscript', () => {
  it('writes each message of the active swipe on its own line, named', () => {
    const turns = [
      { senderName: 'Bradley', messages: ['you up?'] },
      { senderName: 'Layla', messages: ['always', 'why?'] },
    ];
    expect(chatTranscript(turns)).toBe('Bradley: you up?\nLayla: always\nLayla: why?');
  });
});

describe('chunkText', () => {
  it('keeps short text whole', () => {
    expect(chunkText('One.\n\nTwo.', 100)).toEqual(['One.\n\nTwo.']);
  });

  it('splits long text between paragraphs', () => {
    const text = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`;
    expect(chunkText(text, 100)).toEqual(['a'.repeat(60), 'b'.repeat(60)]);
  });
});

describe('buildArchivistPrompt', () => {
  it('shows each card, what waits for review, and what was turned down', () => {
    const { system, user } = buildArchivistPrompt({
      cast: [LAYLA],
      text: 'Layla kissed Sam.',
      kind: 'story',
      pending: [
        { characterId: 'layla', field: 'description', find: '', replace: 'She has a cat.' },
      ],
      rejected: [
        {
          characterId: 'layla',
          field: 'personality',
          find: 'stubborn',
          replace: 'yielding',
        },
      ],
    });
    expect(system).toContain('JSON');
    expect(user).toContain('## Layla');
    expect(user).toContain('She is single and lives alone.');
    expect(user).toContain('description: add "She has a cat."');
    expect(user).toContain('personality: "stubborn" -> "yielding"');
    expect(user).toContain('Layla kissed Sam.');
  });
});

describe('parseSuggestions', () => {
  it('reads JSON inside fences and after reasoning', () => {
    const answer = '<think>hmm {not json}</think>\n```json\n{"suggestions": [{"a": 1}]}\n```';
    expect(parseSuggestions(answer)).toEqual([{ a: 1 }]);
  });

  it('accepts a bare list', () => {
    expect(parseSuggestions('[]')).toEqual([]);
  });

  it('is null when there is no JSON', () => {
    expect(parseSuggestions('No changes needed.')).toBeNull();
    expect(parseSuggestions('{"suggestions": [')).toBeNull();
  });
});

describe('validateSuggestions', () => {
  const single = {
    character: 'layla',
    field: 'Description',
    find: 'She is single',
    replace: 'She is dating Sam',
    rationale: 'They got together.',
    quote: 'Layla kissed Sam.',
  };

  it('keeps an edit whose text is in the card, matching the name loosely', () => {
    expect(validateSuggestions([single], [LAYLA])).toEqual([
      {
        characterId: 'layla',
        field: 'description',
        find: 'She is single',
        replace: 'She is dating Sam',
        rationale: 'They got together.',
        quote: 'Layla kissed Sam.',
      },
    ]);
  });

  it("drops edits it can't make", () => {
    const raw = [
      { ...single, character: 'Sam' },
      { ...single, field: 'first_mes' },
      { ...single, find: 'She is married' },
      { ...single, replace: '' },
      { ...single, replace: 'She is single' },
      'nonsense',
    ];
    expect(validateSuggestions(raw, [LAYLA])).toEqual([]);
  });

  it('drops repeats, including ones already kept', () => {
    const kept = {
      characterId: 'layla',
      field: 'description',
      find: '',
      replace: 'She has a cat.',
    };
    const raw = [single, single, { ...single, find: '', replace: 'she has a  cat.' }];
    expect(validateSuggestions(raw, [LAYLA], [kept])).toHaveLength(1);
  });
});

describe('applyEdit', () => {
  it('replaces the first match', () => {
    expect(applyEdit('a b a', 'a', 'c')).toBe('c b a');
  });

  it('adds to the end, as a new paragraph when the field has them', () => {
    expect(applyEdit('One.', '', 'Two.')).toBe('One. Two.');
    expect(applyEdit('One.\n\nTwo.\n', '', 'Three.')).toBe('One.\n\nTwo.\n\nThree.');
    expect(applyEdit('', '', 'One.')).toBe('One.');
  });

  it('is null when the text is gone', () => {
    expect(applyEdit('a b', 'c', 'd')).toBeNull();
  });
});

describe('runArchivist', () => {
  const answer = JSON.stringify({
    suggestions: [
      {
        character: 'Layla',
        field: 'description',
        find: 'She is single',
        replace: 'She is dating Sam',
      },
    ],
  });

  it('asks the provider and returns the edits that fit', async () => {
    const provider = { generate: vi.fn(async () => ({ content: answer })) };
    const found = await runArchivist({
      provider,
      preset: { generationSettings: { maxTokens: 300, temperature: 1.2 } },
      cast: [LAYLA],
      text: 'Layla kissed Sam.',
      kind: 'story',
    });
    expect(found.map((s) => s.replace)).toEqual(['She is dating Sam']);
    const options = provider.generate.mock.calls[0][2];
    expect(options.maxTokens).toBe(4000);
    expect(options.temperature).toBe(0.5);
  });

  it('asks once more when the answer is not JSON, then gives up', async () => {
    const provider = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({ content: 'Sure! Here you go.' })
        .mockResolvedValueOnce({ content: answer }),
    };
    const found = await runArchivist({ provider, cast: [LAYLA], text: 'x', kind: 'chat' });
    expect(found).toHaveLength(1);

    provider.generate = vi.fn(async () => ({ content: 'nope' }));
    await expect(
      runArchivist({ provider, cast: [LAYLA], text: 'x', kind: 'chat' }),
    ).rejects.toThrow(/JSON/);
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });
});
