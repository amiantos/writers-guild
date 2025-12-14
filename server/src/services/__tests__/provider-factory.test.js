import { describe, it, expect } from 'vitest';
import {
  getProvider,
  getAvailableProviders,
  getProviderCapabilities,
  isValidProvider
} from '../provider-factory.js';

describe('Provider Factory', () => {
  describe('getProvider', () => {
    it('should create a DeepSeek provider', () => {
      const preset = {
        provider: 'deepseek',
        apiConfig: { apiKey: 'sk-test-key-12345' }
      };

      const provider = getProvider(preset);

      expect(provider).toBeDefined();
      expect(provider.constructor.name).toBe('DeepSeekProvider');
    });

    it('should create an OpenAI provider', () => {
      const preset = {
        provider: 'openai',
        apiConfig: { apiKey: 'sk-test-key-12345' }
      };

      const provider = getProvider(preset);

      expect(provider).toBeDefined();
      expect(provider.constructor.name).toBe('OpenAIProvider');
    });

    it('should create an Anthropic provider', () => {
      const preset = {
        provider: 'anthropic',
        apiConfig: { apiKey: 'sk-ant-api-test-key-12345' }
      };

      const provider = getProvider(preset);

      expect(provider).toBeDefined();
      expect(provider.constructor.name).toBe('AnthropicProvider');
    });

    it('should create an OpenRouter provider', () => {
      const preset = {
        provider: 'openrouter',
        apiConfig: { apiKey: 'sk-or-test-key-12345' }
      };

      const provider = getProvider(preset);

      expect(provider).toBeDefined();
      expect(provider.constructor.name).toBe('OpenRouterProvider');
    });

    it('should create an AI Horde provider', () => {
      const preset = {
        provider: 'aihorde',
        apiConfig: { apiKey: '0000000000' } // AI Horde uses this for anonymous access
      };

      const provider = getProvider(preset);

      expect(provider).toBeDefined();
      expect(provider.constructor.name).toBe('AIHordeProvider');
    });

    it('should handle case-insensitive provider names', () => {
      const preset = {
        provider: 'DEEPSEEK',
        apiConfig: { apiKey: 'sk-test-key-12345' }
      };

      const provider = getProvider(preset);
      expect(provider.constructor.name).toBe('DeepSeekProvider');
    });

    it('should throw error for null preset', () => {
      expect(() => getProvider(null))
        .toThrow('Preset configuration is required');
    });

    it('should throw error for undefined preset', () => {
      expect(() => getProvider(undefined))
        .toThrow('Preset configuration is required');
    });

    it('should throw error for missing provider', () => {
      expect(() => getProvider({ apiConfig: { apiKey: 'test' } }))
        .toThrow('Provider type is required in preset');
    });

    it('should throw error for unknown provider', () => {
      expect(() => getProvider({ provider: 'unknown-provider', apiConfig: {} }))
        .toThrow('Unknown provider: unknown-provider');
    });

    it('should include available providers in error message', () => {
      try {
        getProvider({ provider: 'invalid', apiConfig: {} });
      } catch (error) {
        expect(error.message).toContain('deepseek');
        expect(error.message).toContain('openai');
        expect(error.message).toContain('anthropic');
      }
    });

    it('should throw error for invalid configuration', () => {
      const preset = {
        provider: 'openai',
        apiConfig: { apiKey: '' } // Empty API key is invalid
      };

      expect(() => getProvider(preset))
        .toThrow('Provider configuration invalid');
    });

    it('should handle preset with API key in apiConfig', () => {
      const preset = {
        provider: 'deepseek',
        apiConfig: { apiKey: 'test-key-12345' }
      };

      const provider = getProvider(preset);
      expect(provider).toBeDefined();
      expect(provider.constructor.name).toBe('DeepSeekProvider');
    });
  });

  describe('getAvailableProviders', () => {
    it('should return array of provider names', () => {
      const providers = getAvailableProviders();

      expect(providers).toBeInstanceOf(Array);
      expect(providers.length).toBeGreaterThan(0);
    });

    it('should include all expected providers', () => {
      const providers = getAvailableProviders();

      expect(providers).toContain('deepseek');
      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');
      expect(providers).toContain('openrouter');
      expect(providers).toContain('aihorde');
    });
  });

  describe('getProviderCapabilities', () => {
    it('should return capabilities for DeepSeek', () => {
      const capabilities = getProviderCapabilities('deepseek');

      expect(capabilities).toHaveProperty('streaming');
      expect(capabilities).toHaveProperty('reasoning');
      expect(capabilities).toHaveProperty('maxContextWindow');
    });

    it('should return capabilities for OpenAI', () => {
      const capabilities = getProviderCapabilities('openai');

      expect(capabilities.streaming).toBe(true);
      expect(capabilities.visionAPI).toBe(true);
    });

    it('should return capabilities for Anthropic', () => {
      const capabilities = getProviderCapabilities('anthropic');

      expect(capabilities.streaming).toBe(true);
    });

    it('should return capabilities for AI Horde', () => {
      const capabilities = getProviderCapabilities('aihorde');

      expect(capabilities.requiresPolling).toBe(true);
    });

    it('should handle case-insensitive provider names', () => {
      const capabilities = getProviderCapabilities('OPENAI');
      expect(capabilities).toBeDefined();
    });

    it('should throw error for unknown provider', () => {
      expect(() => getProviderCapabilities('unknown'))
        .toThrow('Unknown provider: unknown');
    });
  });

  describe('isValidProvider', () => {
    it('should return true for valid providers', () => {
      expect(isValidProvider('deepseek')).toBe(true);
      expect(isValidProvider('openai')).toBe(true);
      expect(isValidProvider('anthropic')).toBe(true);
      expect(isValidProvider('openrouter')).toBe(true);
      expect(isValidProvider('aihorde')).toBe(true);
    });

    it('should handle case-insensitive names', () => {
      expect(isValidProvider('DEEPSEEK')).toBe(true);
      expect(isValidProvider('OpenAI')).toBe(true);
      expect(isValidProvider('Anthropic')).toBe(true);
    });

    it('should return false for invalid providers', () => {
      expect(isValidProvider('invalid')).toBe(false);
      expect(isValidProvider('unknown')).toBe(false);
      expect(isValidProvider('gpt4')).toBe(false);
    });

    it('should return falsy for empty string', () => {
      expect(isValidProvider('')).toBeFalsy();
    });

    it('should return falsy for null/undefined', () => {
      expect(isValidProvider(null)).toBeFalsy();
      expect(isValidProvider(undefined)).toBeFalsy();
    });
  });
});
