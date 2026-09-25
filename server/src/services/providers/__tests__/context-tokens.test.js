import { describe, it, expect } from 'vitest';
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
});
