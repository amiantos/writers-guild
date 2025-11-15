import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider } from '../openai-provider.js';

describe('OpenAIProvider', () => {
  let provider;
  let mockFetch;

  beforeEach(() => {
    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    provider = new OpenAIProvider({
      apiKey: 'test-api-key',
      model: 'gpt-4-turbo-preview'
    });
  });

  describe('Configuration', () => {
    it('should initialize with correct defaults', () => {
      expect(provider.baseURL).toBe('https://api.openai.com/v1');
      expect(provider.model).toBe('gpt-4-turbo-preview');
    });

    it('should allow custom base URL', () => {
      const customProvider = new OpenAIProvider({
        apiKey: 'test-key',
        baseURL: 'https://custom-api.com/v1'
      });
      expect(customProvider.baseURL).toBe('https://custom-api.com/v1');
    });

    it('should allow custom model', () => {
      const customProvider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4o'
      });
      expect(customProvider.model).toBe('gpt-4o');
    });
  });

  describe('Capabilities', () => {
    it('should return correct capabilities', () => {
      const capabilities = provider.getCapabilities();
      expect(capabilities.streaming).toBe(true);
      expect(capabilities.reasoning).toBe(false);
      expect(capabilities.visionAPI).toBe(true);
      expect(capabilities.maxContextWindow).toBe(128000);
    });
  });

  describe('Validation', () => {
    it('should validate correct configuration', () => {
      const result = provider.validateConfig();
      expect(result.valid).toBe(true);
    });

    it('should reject missing API key', () => {
      const invalidProvider = new OpenAIProvider({ apiKey: '' });
      const result = invalidProvider.validateConfig();
      expect(result.valid).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('should reject whitespace-only API key', () => {
      const invalidProvider = new OpenAIProvider({ apiKey: '   ' });
      const result = invalidProvider.validateConfig();
      expect(result.valid).toBe(false);
    });
  });

  describe('Max Tokens Parameter Detection', () => {
    it('should use max_completion_tokens for gpt-5 models', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-5'
      });
      expect(provider.usesMaxCompletionTokens()).toBe(true);
    });

    it('should use max_completion_tokens for o1 models', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'o1-preview'
      });
      expect(provider.usesMaxCompletionTokens()).toBe(true);
    });

    it('should use max_completion_tokens for o3 models', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'o3-mini'
      });
      expect(provider.usesMaxCompletionTokens()).toBe(true);
    });

    it('should use max_completion_tokens for chatgpt models', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'chatgpt-4o-latest'
      });
      expect(provider.usesMaxCompletionTokens()).toBe(true);
    });

    it('should use max_tokens for gpt-4 models', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-4-turbo'
      });
      expect(provider.usesMaxCompletionTokens()).toBe(false);
    });

    it('should use max_tokens for gpt-3.5 models', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-3.5-turbo'
      });
      expect(provider.usesMaxCompletionTokens()).toBe(false);
    });
  });

  describe('Request Body Building', () => {
    it('should build correct request body with max_tokens for older models', () => {
      const messages = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'User' }
      ];

      const body = provider.buildRequestBody(messages, {
        maxTokens: 2000,
        temperature: 0.7
      });

      expect(body.model).toBe('gpt-4-turbo-preview');
      expect(body.messages).toEqual(messages);
      expect(body.max_tokens).toBe(2000);
      expect(body.max_completion_tokens).toBeUndefined();
      expect(body.temperature).toBe(0.7);
    });

    it('should build correct request body with max_completion_tokens for newer models', () => {
      const newProvider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'gpt-5'
      });

      const messages = [{ role: 'user', content: 'Hello' }];
      const body = newProvider.buildRequestBody(messages, {
        maxTokens: 2000
      });

      expect(body.max_completion_tokens).toBe(2000);
      expect(body.max_tokens).toBeUndefined();
    });

    it('should include optional parameters when provided', () => {
      const messages = [{ role: 'user', content: 'Test' }];
      const body = provider.buildRequestBody(messages, {
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        stop_sequences: ['STOP', 'END']
      });

      expect(body.top_p).toBe(0.9);
      expect(body.frequency_penalty).toBe(0.5);
      expect(body.presence_penalty).toBe(0.3);
      expect(body.stop).toEqual(['STOP', 'END']);
    });

    it('should not include optional parameters when not provided', () => {
      const messages = [{ role: 'user', content: 'Test' }];
      const body = provider.buildRequestBody(messages);

      expect(body.top_p).toBeUndefined();
      expect(body.frequency_penalty).toBeUndefined();
      expect(body.presence_penalty).toBeUndefined();
      expect(body.stop).toBeUndefined();
    });

    it('should use default values', () => {
      const messages = [{ role: 'user', content: 'Test' }];
      const body = provider.buildRequestBody(messages);

      expect(body.temperature).toBe(1.0);
      expect(body.max_tokens).toBe(4000);
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
                role: 'assistant'
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
      expect(callArgs[0]).toBe('https://api.openai.com/v1/chat/completions');

      const headers = callArgs[1].headers;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer test-api-key');

      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.stream).toBe(false);
      expect(requestBody.messages).toEqual([
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'User prompt' }
      ]);
      expect(requestBody.max_tokens).toBe(2000);
      expect(requestBody.temperature).toBe(0.7);
    });

    it('should throw error when API key is missing', async () => {
      const noKeyProvider = new OpenAIProvider({ apiKey: '' });

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

    it('should handle malformed error response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => {
          throw new Error('Invalid JSON');
        }
      });

      await expect(
        provider.generate('System', 'User')
      ).rejects.toThrow('API request failed: Bad Request');
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

    it('should handle empty response content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: null } }]
        })
      });

      const result = await provider.generate('System', 'User');
      expect(result.content).toBe('');
    });
  });

  describe('Edge Cases', () => {
    it('should handle temperature of 0', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      await provider.generate('System', 'User', { temperature: 0 });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.temperature).toBe(0);
    });

    it('should handle temperature of 2.0', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      await provider.generate('System', 'User', { temperature: 2.0 });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.temperature).toBe(2.0);
    });

    it('should handle empty stop sequences array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      await provider.generate('System', 'User', { stop_sequences: [] });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.stop).toBeUndefined();
    });

    it('should handle very long prompts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      const longPrompt = 'a'.repeat(10000);
      await provider.generate('System', longPrompt);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages[1].content).toBe(longPrompt);
    });

    it('should handle special characters in prompts', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }]
        })
      });

      const specialPrompt = 'Test with "quotes" and \\backslashes\\ and \nnewlines';
      await provider.generate('System', specialPrompt);

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.messages[1].content).toBe(specialPrompt);
    });
  });

  describe('Model-specific Behavior', () => {
    it('should handle case-insensitive model detection', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'GPT-5'
      });
      expect(provider.usesMaxCompletionTokens()).toBe(true);
    });

    it('should correctly identify O1-preview model', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'o1-preview-2024'
      });
      expect(provider.usesMaxCompletionTokens()).toBe(true);
    });

    it('should correctly identify ChatGPT models', () => {
      const provider = new OpenAIProvider({
        apiKey: 'test-key',
        model: 'chatgpt-something'
      });
      expect(provider.usesMaxCompletionTokens()).toBe(true);
    });
  });
});
