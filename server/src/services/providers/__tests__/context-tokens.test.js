import { describe, it, expect, vi } from 'vitest';
import { KoboldCppProvider } from '../koboldcpp-provider.js';
import { OllamaProvider } from '../ollama-provider.js';
import { OpenAIProvider } from '../openai-provider.js';

describe('resolveContextTokens', () => {
  const unset = { generationSettings: {} };
  const set = { generationSettings: { maxContextTokens: 16384 } };

  it('is the preset’s context size when it has one', () => {
    for (const provider of [
      new KoboldCppProvider({ baseURL: 'http://localhost:5001/api' }),
      new OllamaProvider({ baseURL: 'http://localhost:11434' }),
      new OpenAIProvider({ apiKey: 'k' }),
    ]) {
      expect(provider.resolveContextTokens(set)).toBe(16384);
    }
  });

  it('is what the local backends are sent when the preset has none', () => {
    expect(new KoboldCppProvider({ baseURL: 'x' }).resolveContextTokens(unset)).toBe(4096);
    expect(new OllamaProvider({ baseURL: 'x' }).resolveContextTokens(unset)).toBe(4096);
    expect(new OpenAIProvider({ apiKey: 'k' }).resolveContextTokens(unset)).toBe(128000);
  });

  it('is taken from the caller when buildPrompts is given one', () => {
    const provider = new OpenAIProvider({ apiKey: 'k' });
    const resolve = vi.spyOn(provider, 'resolveContextTokens');
    const build = vi
      .spyOn(provider.promptBuilder, 'buildPrompts')
      .mockReturnValue({ system: '', user: '' });

    provider.buildPrompts({}, 'continue', { maxContextTokens: 2048 }, { generationSettings: {} });

    expect(resolve).not.toHaveBeenCalled();
    expect(build.mock.calls[0][1].maxContextTokens).toBe(2048);
  });
});
