import { describe, it, expect, vi } from 'vitest';
import { ArchivistRunError } from '../card-archivist.js';
import {
  buildContinuityPrompt,
  parseContinuity,
  runContinuityArchivist,
} from '../continuity-archivist.js';

const CONTINUITY =
  'A few months ago Bradley helped Amanda find her lost dog. A couple days ago, Amanda brought him a cake, and he asked her out on a date.';
const UPDATED = `${CONTINUITY} They went on the date and hit it off, and Amanda said she'd call him about a second one.`;

function answer(continuity, rationale = 'Added the date.') {
  return { content: JSON.stringify({ continuity, rationale }) };
}

describe('buildContinuityPrompt', () => {
  it('gives the Continuity, then the story, and asks for the whole text back', () => {
    const { system, user } = buildContinuityPrompt({
      name: 'Bradley and Amanda',
      continuity: CONTINUITY,
      text: 'They went to dinner.',
      kind: 'story',
    });
    expect(system).toContain('"continuity": "the whole Continuity, updated"');
    expect(user.indexOf(CONTINUITY)).toBeLessThan(user.indexOf('They went to dinner.'));
    expect(user).toContain('# The Continuity: Bradley and Amanda');
  });

  it('says a later part builds on the earlier ones', () => {
    const { user } = buildContinuityPrompt({
      name: 'X',
      continuity: '',
      text: 'More.',
      kind: 'chat',
      part: { index: 1, count: 3 },
    });
    expect(user).toContain('(empty so far)');
    expect(user).toContain('# The chat, part 2 of 3');
    expect(user).toContain('already includes what the earlier parts of the chat added');
  });
});

describe('parseContinuity', () => {
  it('reads the answer, fenced or after reasoning', () => {
    expect(
      parseContinuity(
        '<think>hmm</think>```json\n{"continuity": " New. ", "rationale": "Why."}\n```',
      ),
    ).toEqual({
      continuity: 'New.',
      rationale: 'Why.',
    });
  });

  it('reads "nothing to carry forward"', () => {
    expect(parseContinuity('{"continuity": null}')).toEqual({ continuity: null, rationale: '' });
  });

  it('refuses anything else', () => {
    expect(parseContinuity('Sure! Here it is.')).toBeNull();
    expect(parseContinuity('{"suggestions": []}')).toBeNull();
    expect(parseContinuity('{"continuity": 3}')).toBeNull();
  });
});

describe('runContinuityArchivist', () => {
  const base = {
    preset: { generationSettings: { maxContextTokens: 128_000 } },
    name: 'Bradley and Amanda',
    continuity: CONTINUITY,
    kind: 'story',
  };

  it('returns the updated Continuity', async () => {
    const provider = { generate: vi.fn(async () => answer(UPDATED)) };
    const found = await runContinuityArchivist({ ...base, provider, text: 'They had dinner.' });
    expect(found).toEqual({ replace: UPDATED, rationale: 'Added the date.' });
  });

  it('returns null when nothing changed', async () => {
    const provider = { generate: vi.fn(async () => answer(null)) };
    expect(await runContinuityArchivist({ ...base, provider, text: 'Nothing.' })).toBeNull();
    provider.generate.mockResolvedValue(answer(` ${CONTINUITY} `));
    expect(await runContinuityArchivist({ ...base, provider, text: 'Nothing.' })).toBeNull();
  });

  it('hands each pass the text the pass before it wrote', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `${i} ${'They talked. '.repeat(200)}`).join(
      '\n\n',
    );
    let step = 0;
    const provider = {
      generate: vi.fn(async () => {
        step += 1;
        return answer(`${CONTINUITY} Step ${step}.`, `Step ${step}.`);
      }),
    };
    const found = await runContinuityArchivist({ ...base, provider, text: long });
    const calls = provider.generate.mock.calls;
    expect(calls.length).toBeGreaterThan(1);
    expect(calls[1][1]).toContain(`${CONTINUITY} Step 1.`);
    expect(found.replace).toBe(`${CONTINUITY} Step ${calls.length}.`);
    expect(found.rationale).toContain('Step 1.');
  });

  it('keeps what earlier passes wrote when a later one fails', async () => {
    const long = Array.from({ length: 40 }, (_, i) => `${i} ${'They talked. '.repeat(200)}`).join(
      '\n\n',
    );
    const provider = {
      generate: vi
        .fn()
        .mockResolvedValueOnce(answer(UPDATED))
        .mockRejectedValue(new Error('Context length exceeded')),
    };
    const error = await runContinuityArchivist({ ...base, provider, text: long }).catch((e) => e);
    expect(error).toBeInstanceOf(ArchivistRunError);
    expect(error.message).toMatch(/^Part 2 of \d+: Context length exceeded/);
    expect(error.found).toEqual([{ replace: UPDATED, rationale: 'Added the date.' }]);
  });

  it('refuses a preset whose context is too small to repeat the Continuity', async () => {
    const provider = { resolveContextTokens: () => 4096, generate: vi.fn() };
    await expect(
      runContinuityArchivist({ ...base, continuity: 'x'.repeat(20000), provider, text: 'Hi.' }),
    ).rejects.toThrow(/context is too small/);
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
