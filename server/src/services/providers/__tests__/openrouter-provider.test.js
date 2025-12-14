import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenRouterProvider } from '../openrouter-provider.js';

describe('OpenRouterProvider', () => {
  let provider;
  let mockFetch;

  beforeEach(() => {
    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    provider = new OpenRouterProvider({
      apiKey: 'test-api-key',
      model: 'anthropic/claude-3.5-sonnet'
    });
  });

  describe('Configuration', () => {
    it('should initialize with correct defaults', () => {
      const defaultProvider = new OpenRouterProvider({
        apiKey: 'test-key'
      });

      expect(defaultProvider.baseURL).toBe('https://openrouter.ai/api/v1');
      expect(defaultProvider.model).toBe('anthropic/claude-3.5-sonnet');
      expect(defaultProvider.allowFallbacks).toBe(true);
    });

    it('should allow custom base URL', () => {
      const customProvider = new OpenRouterProvider({
        apiKey: 'test-key',
        baseURL: 'https://custom-api.com/v1'
      });

      expect(customProvider.baseURL).toBe('https://custom-api.com/v1');
    });

    it('should allow custom model', () => {
      const customProvider = new OpenRouterProvider({
        apiKey: 'test-key',
        model: 'openai/gpt-4'
      });

      expect(customProvider.model).toBe('openai/gpt-4');
    });

    it('should accept provider preferences', () => {
      const customProvider = new OpenRouterProvider({
        apiKey: 'test-key',
        providers: ['anthropic', 'openai']
      });

      expect(customProvider.providers).toEqual(['anthropic', 'openai']);
    });

    it('should allow disabling fallbacks', () => {
      const customProvider = new OpenRouterProvider({
        apiKey: 'test-key',
        allowFallbacks: false
      });

      expect(customProvider.allowFallbacks).toBe(false);
    });
  });

  describe('Capabilities', () => {
    it('should return correct capabilities', () => {
      const capabilities = provider.getCapabilities();

      expect(capabilities.streaming).toBe(true);
      expect(capabilities.reasoning).toBe(true);
      expect(capabilities.visionAPI).toBe(true);
      expect(capabilities.maxContextWindow).toBe(200000);
    });
  });

  describe('Validation', () => {
    it('should validate correct configuration', () => {
      const result = provider.validateConfig();
      expect(result.valid).toBe(true);
    });

    it('should reject missing API key', () => {
      const invalidProvider = new OpenRouterProvider({ apiKey: '' });
      const result = invalidProvider.validateConfig();

      expect(result.valid).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('should use default model when none specified', () => {
      const defaultProvider = new OpenRouterProvider({
        apiKey: 'test-key'
      });
      // OpenRouter defaults to a model, so it should be valid
      const result = defaultProvider.validateConfig();
      expect(result.valid).toBe(true);
    });
  });

  describe('buildHeaders', () => {
    it('should include authorization and content-type', () => {
      const headers = provider.buildHeaders();

      expect(headers['Authorization']).toBe('Bearer test-api-key');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('should include HTTP-Referer and X-Title', () => {
      const headers = provider.buildHeaders();

      expect(headers['HTTP-Referer']).toBeDefined();
      expect(headers['X-Title']).toBe('Writers Guild');
    });

    it('should include provider preferences when set', () => {
      const customProvider = new OpenRouterProvider({
        apiKey: 'test-key',
        providers: ['anthropic', 'openai']
      });

      const headers = customProvider.buildHeaders();
      expect(headers['X-OpenRouter-Provider']).toBe('anthropic,openai');
    });

    it('should not include provider header when no preferences set', () => {
      const headers = provider.buildHeaders();
      expect(headers['X-OpenRouter-Provider']).toBeUndefined();
    });
  });

  describe('Generate (Non-streaming)', () => {
    it('should generate content successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['X-OpenRouter-Provider', 'anthropic']]),
        json: async () => ({
          choices: [
            {
              message: {
                content: 'Generated response',
                reasoning: 'Thinking process'
              }
            }
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50
          },
          model: 'anthropic/claude-3.5-sonnet'
        })
      });

      const result = await provider.generate(
        'You are a helpful assistant',
        'Hello, how are you?'
      );

      expect(result.content).toBe('Generated response');
      expect(result.reasoning).toBe('Thinking process');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should build correct API request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map(),
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
          model: 'test-model'
        })
      });

      await provider.generate('System prompt', 'User prompt', {
        maxTokens: 2000,
        temperature: 0.7
      });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://openrouter.ai/api/v1/chat/completions');

      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.stream).toBe(false);
      expect(requestBody.model).toBe('anthropic/claude-3.5-sonnet');
      expect(requestBody.max_tokens).toBe(2000);
      expect(requestBody.temperature).toBe(0.7);
      expect(requestBody.reasoning).toEqual({ enabled: true });
    });

    it('should throw error when API key is missing', async () => {
      const noKeyProvider = new OpenRouterProvider({ apiKey: '' });

      await expect(
        noKeyProvider.generate('System', 'User')
      ).rejects.toThrow('API key not set');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({
          error: { message: 'Invalid request' }
        })
      });

      await expect(
        provider.generate('System', 'User')
      ).rejects.toThrow('Invalid request');
    });

    it('should include optional parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map(),
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
          model: 'test-model'
        })
      });

      await provider.generate('System', 'User', {
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        stop_sequences: ['STOP']
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.top_p).toBe(0.9);
      expect(requestBody.frequency_penalty).toBe(0.5);
      expect(requestBody.presence_penalty).toBe(0.3);
      expect(requestBody.stop).toEqual(['STOP']);
    });

    it('should add route parameter when fallbacks disabled', async () => {
      const noFallbackProvider = new OpenRouterProvider({
        apiKey: 'test-key',
        allowFallbacks: false
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map(),
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
          model: 'test-model'
        })
      });

      await noFallbackProvider.generate('System', 'User');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.route).toBe('fallback');
    });
  });

  describe('Generate Streaming', () => {
    it('should throw error when API key is missing', async () => {
      const noKeyProvider = new OpenRouterProvider({ apiKey: '' });

      await expect(
        noKeyProvider.generateStreaming('System', 'User')
      ).rejects.toThrow('API key not set');
    });

    it('should return stream object with abort function', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['X-OpenRouter-Provider', 'anthropic']]),
        body: {
          getReader: () => ({
            read: async () => ({ done: true })
          })
        }
      });

      const result = await provider.generateStreaming('System', 'User');

      expect(result).toHaveProperty('stream');
      expect(result).toHaveProperty('abort');
      expect(result).toHaveProperty('metadata');
      expect(typeof result.abort).toBe('function');
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Server Error',
        json: async () => ({
          error: { message: 'Server error' }
        })
      });

      await expect(
        provider.generateStreaming('System', 'User')
      ).rejects.toThrow('Server error');
    });
  });

  describe('Error Parsing', () => {
    it('should parse authentication errors', () => {
      const error = new Error('401 Unauthorized');
      const parsed = provider.parseError(error);

      expect(parsed.code).toBe('AUTH_ERROR');
      expect(parsed.message).toBe('Invalid API key');
    });

    it('should parse rate limit errors', () => {
      const error = new Error('429 rate limit exceeded');
      const parsed = provider.parseError(error);

      expect(parsed.code).toBe('RATE_LIMIT');
      expect(parsed.message).toContain('Rate limit');
    });

    it('should parse insufficient credits errors', () => {
      const error = new Error('402 insufficient credits');
      const parsed = provider.parseError(error);

      expect(parsed.code).toBe('INSUFFICIENT_CREDITS');
      expect(parsed.message).toContain('credits');
    });

    it('should parse model not found errors', () => {
      const error = new Error('model xyz/abc not found');
      const parsed = provider.parseError(error);

      expect(parsed.code).toBe('MODEL_NOT_FOUND');
      expect(parsed.message).toContain('not found');
    });

    it('should return generic error for unknown errors', () => {
      const error = new Error('Unknown error');
      const parsed = provider.parseError(error);

      expect(parsed.code).toBe('API_ERROR');
    });
  });

  describe('getAvailableModels', () => {
    it('should fetch and transform models', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'anthropic/claude-3.5-sonnet',
              name: 'Claude 3.5 Sonnet',
              description: 'Fast and capable',
              context_length: 200000,
              pricing: { prompt: 0.003, completion: 0.015 },
              top_provider: { name: 'Anthropic' }
            },
            {
              id: 'openai/gpt-4',
              name: 'GPT-4',
              context_length: 8192,
              pricing: { prompt: 0.03, completion: 0.06 }
            }
          ]
        })
      });

      const models = await provider.getAvailableModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('anthropic/claude-3.5-sonnet');
      expect(models[0].vendor).toBe('anthropic');
      expect(models[0].contextLength).toBe(200000);
      expect(models[0].pricing.prompt).toBe(0.003);
    });

    it('should return empty array on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Server Error'
      });

      const models = await provider.getAvailableModels();
      expect(models).toEqual([]);
    });
  });

  describe('getModelProviders', () => {
    it('should return provider info for model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'anthropic/claude-3.5-sonnet',
              top_provider: {
                name: 'Anthropic',
                max_completion_tokens: 8192,
                is_moderated: false
              }
            }
          ]
        })
      });

      const providers = await provider.getModelProviders('anthropic/claude-3.5-sonnet');

      expect(providers).toHaveLength(1);
      expect(providers[0].name).toBe('Anthropic');
    });

    it('should return empty array for model without provider', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'other/model'
            }
          ]
        })
      });

      const providers = await provider.getModelProviders('anthropic/claude-3.5-sonnet');
      expect(providers).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Error'
      });

      const providers = await provider.getModelProviders('any-model');
      expect(providers).toEqual([]);
    });
  });
});
