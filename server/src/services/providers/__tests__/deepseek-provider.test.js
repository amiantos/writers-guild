import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeepSeekProvider } from '../deepseek-provider.js';

describe('DeepSeekProvider', () => {
  let provider;
  let mockFetch;

  beforeEach(() => {
    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    provider = new DeepSeekProvider({
      apiKey: 'test-api-key',
      model: 'deepseek-chat'
    });
  });

  describe('Configuration', () => {
    it('should initialize with correct defaults', () => {
      const defaultProvider = new DeepSeekProvider({
        apiKey: 'test-key'
      });

      expect(defaultProvider.baseURL).toBe('https://api.deepseek.com/v1');
      expect(defaultProvider.model).toBe('deepseek-reasoner');
    });

    it('should allow custom base URL', () => {
      const customProvider = new DeepSeekProvider({
        apiKey: 'test-key',
        baseURL: 'https://custom-api.com/v1'
      });

      expect(customProvider.baseURL).toBe('https://custom-api.com/v1');
    });

    it('should allow custom model', () => {
      const customProvider = new DeepSeekProvider({
        apiKey: 'test-key',
        model: 'deepseek-chat'
      });

      expect(customProvider.model).toBe('deepseek-chat');
    });
  });

  describe('Capabilities', () => {
    it('should return correct capabilities', () => {
      const capabilities = provider.getCapabilities();

      expect(capabilities.streaming).toBe(true);
      expect(capabilities.reasoning).toBe(true);
      expect(capabilities.visionAPI).toBe(false);
      expect(capabilities.maxContextWindow).toBe(128000);
    });
  });

  describe('Validation', () => {
    it('should validate correct configuration', () => {
      const result = provider.validateConfig();
      expect(result.valid).toBe(true);
    });

    it('should reject missing API key', () => {
      const invalidProvider = new DeepSeekProvider({ apiKey: '' });
      const result = invalidProvider.validateConfig();

      expect(result.valid).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('should reject whitespace-only API key', () => {
      const invalidProvider = new DeepSeekProvider({ apiKey: '   ' });
      const result = invalidProvider.validateConfig();

      expect(result.valid).toBe(false);
    });
  });

  describe('isReasonerModel', () => {
    it('should return true for deepseek-reasoner', () => {
      const reasonerProvider = new DeepSeekProvider({
        apiKey: 'test-key',
        model: 'deepseek-reasoner'
      });

      expect(reasonerProvider.isReasonerModel()).toBe(true);
    });

    it('should return false for deepseek-chat', () => {
      const chatProvider = new DeepSeekProvider({
        apiKey: 'test-key',
        model: 'deepseek-chat'
      });

      expect(chatProvider.isReasonerModel()).toBe(false);
    });
  });

  describe('Generate (Non-streaming)', () => {
    it('should generate content successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: 'Generated response',
                reasoning_content: 'Thinking process'
              }
            }
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50
          }
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
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      await provider.generate('System prompt', 'User prompt', {
        maxTokens: 2000,
        temperature: 0.7
      });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://api.deepseek.com/v1/chat/completions');

      const headers = callArgs[1].headers;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer test-api-key');

      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.stream).toBe(false);
      expect(requestBody.model).toBe('deepseek-chat');
      expect(requestBody.max_tokens).toBe(2000);
      expect(requestBody.temperature).toBe(0.7);
    });

    it('should throw error when API key is missing', async () => {
      const noKeyProvider = new DeepSeekProvider({ apiKey: '' });

      await expect(
        noKeyProvider.generate('System', 'User')
      ).rejects.toThrow('API key not set');
    });

    it('should handle API errors with error message', async () => {
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

    it('should handle API errors without error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => ({})
      });

      await expect(
        provider.generate('System', 'User')
      ).rejects.toThrow('API request failed: Internal Server Error');
    });

    it('should include optional parameters for non-reasoner model', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
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

    it('should pass abort signal to fetch', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      const controller = new AbortController();
      await provider.generate('System', 'User', { signal: controller.signal });

      expect(mockFetch.mock.calls[0][1].signal).toBe(controller.signal);
    });
  });

  describe('Generate Streaming', () => {
    it('should throw error when API key is missing', async () => {
      const noKeyProvider = new DeepSeekProvider({ apiKey: '' });

      await expect(
        noKeyProvider.generateStreaming('System', 'User')
      ).rejects.toThrow('API key not set');
    });

    it('should return stream object with abort function', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
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
            { id: 'deepseek-chat', created: 1234567890, owned_by: 'deepseek' },
            { id: 'deepseek-reasoner', created: 1234567891, owned_by: 'deepseek' }
          ]
        })
      });

      const models = await provider.getAvailableModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('deepseek-chat');
      expect(models[0].contextLength).toBe(64000);
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

  describe('getModelDescription', () => {
    it('should return description for deepseek-chat', () => {
      const description = provider.getModelDescription('deepseek-chat');
      expect(description).toContain('conversation');
    });

    it('should return description for deepseek-reasoner', () => {
      const description = provider.getModelDescription('deepseek-reasoner');
      expect(description).toContain('reasoning');
    });

    it('should return empty string for unknown model', () => {
      const description = provider.getModelDescription('unknown-model');
      expect(description).toBe('');
    });
  });
});
