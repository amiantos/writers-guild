import { describe, it, expect, vi } from 'vitest';
import {
  ArchivistRunError,
  describeError,
  applyEdit,
  buildArchivistPrompt,
  castLabels,
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

  it('drops an overlong replacement and shortens long notes', () => {
    expect(validateSuggestions([{ ...single, replace: 'x'.repeat(4001) }], [LAYLA])).toEqual([]);
    const [kept] = validateSuggestions([{ ...single, quote: 'q'.repeat(2000) }], [LAYLA]);
    expect(kept.quote).toHaveLength(500);
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

  it('is null when the text it adds is already there', () => {
    expect(applyEdit('One. She has a  cat.', '', 'she has a cat.')).toBeNull();
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

  it('keeps an answer that was not JSON when the retry then fails', async () => {
    const provider = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({ content: 'Sure! Here you go.' })
        .mockRejectedValueOnce(new Error('fetch failed')),
    };
    const failure = await runArchivist({ provider, cast: [LAYLA], text: 'x', kind: 'chat' }).catch(
      (error) => error,
    );
    expect(failure.message).toBe('fetch failed');
    expect(failure.answer).toBe('Sure! Here you go.');
  });

  it('says when the answer was empty, rather than not JSON', async () => {
    const provider = { generate: vi.fn(async () => ({ content: '' })) };
    await expect(
      runArchivist({ provider, cast: [LAYLA], text: 'x', kind: 'chat' }),
    ).rejects.toThrow(/answer was empty/);
  });
});

describe('describeError', () => {
  it('adds the causes a failed fetch keeps under its message', () => {
    const error = new TypeError('fetch failed', {
      cause: new Error('Headers Timeout Error', { cause: 'UND_ERR_HEADERS_TIMEOUT' }),
    });
    expect(describeError(error)).toBe(
      'fetch failed (Headers Timeout Error: UND_ERR_HEADERS_TIMEOUT)',
    );
    expect(describeError(new Error('Plain'))).toBe('Plain');
  });
});

describe('characters who share a name', () => {
  const twins = [
    { ...LAYLA, id: 'a' },
    { ...LAYLA, id: 'b' },
    { id: 'sam', name: 'Sam', description: 'Sam is single.', personality: '' },
  ];

  it('are told apart by a number in the prompt', () => {
    expect([...castLabels(twins).values()]).toEqual(['Layla (1)', 'Layla (2)', 'Sam']);
    const { user } = buildArchivistPrompt({ cast: twins, text: 'x', kind: 'story' });
    expect(user).toContain('## Layla (1)');
    expect(user).toContain('## Layla (2)');
  });

  it('get only the edits that name one of them exactly', () => {
    const edit = { field: 'description', find: 'She is single', replace: 'She is with Sam' };
    const found = validateSuggestions(
      [
        { ...edit, character: 'Layla' },
        { ...edit, character: 'Layla (2)' },
      ],
      twins,
    );
    expect(found.map((s) => s.characterId)).toEqual(['b']);
  });
});

describe('the context a run fits in', () => {
  const empty = JSON.stringify({ suggestions: [] });

  it('reads a long story in passes small enough for the preset', async () => {
    const provider = {
      resolveContextTokens: () => 4096,
      generate: vi.fn(async () => ({ content: empty })),
    };
    const text = Array.from({ length: 20 }, (_, i) => `${i} ${'word '.repeat(200)}`).join('\n\n');
    await runArchivist({ provider, cast: [LAYLA], text, kind: 'story' });

    expect(provider.generate.mock.calls.length).toBeGreaterThan(1);
    for (const [system, user, options] of provider.generate.mock.calls) {
      expect(options.maxTokens).toBe(1024);
      expect(options.maxContextTokens).toBe(4096);
      expect((system.length + user.length) / 3 + options.maxTokens).toBeLessThan(4096);
    }
  });

  it("waits for a provider that works out its context, like AI Horde's", async () => {
    const provider = {
      resolveContextTokens: async () => 4096,
      generate: vi.fn(async () => ({ content: empty })),
    };
    const text = Array.from({ length: 20 }, (_, i) => `${i} ${'word '.repeat(200)}`).join('\n\n');
    await runArchivist({ provider, cast: [LAYLA], text, kind: 'story' });

    expect(provider.generate.mock.calls.length).toBeGreaterThan(1);
    expect(provider.generate.mock.calls[0][2].maxContextTokens).toBe(4096);
  });

  it('keeps later passes within the context however many edits earlier ones found', async () => {
    let pass = 0;
    const provider = {
      resolveContextTokens: () => 4096,
      generate: vi.fn(async () => {
        pass += 1;
        const suggestions = Array.from({ length: 20 }, (_, i) => ({
          character: 'Layla',
          field: 'personality',
          find: '',
          replace: `Pass ${pass}, change ${i}: ${'detail '.repeat(20)}`,
        }));
        return { content: JSON.stringify({ suggestions }) };
      }),
    };
    const text = Array.from({ length: 20 }, (_, i) => `${i} ${'word '.repeat(200)}`).join('\n\n');
    const found = await runArchivist({ provider, cast: [LAYLA], text, kind: 'story' });

    expect(provider.generate.mock.calls.length).toBeGreaterThan(2);
    expect(found.length).toBe(20 * provider.generate.mock.calls.length);
    for (const [system, user, options] of provider.generate.mock.calls) {
      expect((system.length + user.length) / 3 + options.maxTokens).toBeLessThan(4096);
    }
    // The newest are the ones shown.
    const last = provider.generate.mock.calls.at(-1)[1];
    expect(last).toContain(`Pass ${pass - 1}, change 19`);
  });

  it('names the part that failed, and hands back what earlier parts found', async () => {
    const provider = {
      resolveContextTokens: () => 4096,
      generate: vi
        .fn()
        .mockResolvedValueOnce({
          content: JSON.stringify({
            suggestions: [
              {
                character: 'Layla',
                field: 'description',
                find: 'She is single',
                replace: 'She is dating Sam',
              },
            ],
          }),
        })
        .mockRejectedValue(new Error('Context length exceeded')),
    };
    const parts = [];
    const text = Array.from({ length: 20 }, (_, i) => `${i} ${'word '.repeat(200)}`).join('\n\n');
    const failure = await runArchivist({
      provider,
      cast: [LAYLA],
      text,
      kind: 'story',
      onPart: (part) => parts.push(part),
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(ArchivistRunError);
    expect(failure.message).toMatch(/^Part 2 of \d+: Context length exceeded$/);
    expect(failure.found.map((s) => s.replace)).toEqual(['She is dating Sam']);
    expect(parts.map((part) => part.index)).toEqual([0, 1]);
    expect(parts[0].count).toBeGreaterThan(2);
  });

  it("refuses when the cards alone don't leave room for the story", async () => {
    const provider = {
      resolveContextTokens: () => 1024,
      generate: vi.fn(),
    };
    await expect(
      runArchivist({ provider, cast: [LAYLA], text: 'x', kind: 'story' }),
    ).rejects.toThrow(/too small/);
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
