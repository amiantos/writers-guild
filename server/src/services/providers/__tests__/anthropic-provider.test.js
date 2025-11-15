import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider.js';

describe('AnthropicProvider', () => {
  let provider;
  let mockFetch;

  beforeEach(() => {
    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    provider = new AnthropicProvider({
      apiKey: 'test-api-key',
      model: 'claude-3-5-sonnet-20241022'
    });
  });

  describe('Configuration', () => {
    it('should initialize with correct defaults', () => {
      expect(provider.baseURL).toBe('https://api.anthropic.com/v1');
      expect(provider.model).toBe('claude-3-5-sonnet-20241022');
      expect(provider.anthropicVersion).toBe('2023-06-01');
    });

    it('should allow custom base URL', () => {
      const customProvider = new AnthropicProvider({
        apiKey: 'test-key',
        baseURL: 'https://custom-api.com/v1'
      });
      expect(customProvider.baseURL).toBe('https://custom-api.com/v1');
    });

    it('should allow custom model', () => {
      const customProvider = new AnthropicProvider({
        apiKey: 'test-key',
        model: 'claude-3-opus-20240229'
      });
      expect(customProvider.model).toBe('claude-3-opus-20240229');
    });

    it('should allow custom anthropic version', () => {
      const customProvider = new AnthropicProvider({
        apiKey: 'test-key',
        anthropicVersion: '2024-01-01'
      });
      expect(customProvider.anthropicVersion).toBe('2024-01-01');
    });
  });

  describe('Capabilities', () => {
    it('should return correct capabilities', () => {
      const capabilities = provider.getCapabilities();
      expect(capabilities.streaming).toBe(true);
      expect(capabilities.reasoning).toBe(false);
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
      const invalidProvider = new AnthropicProvider({ apiKey: '' });
      const result = invalidProvider.validateConfig();
      expect(result.valid).toBe(false);
      expect(result.error).toBe('API key is required');
    });

    it('should reject whitespace-only API key', () => {
      const invalidProvider = new AnthropicProvider({ apiKey: '   ' });
      const result = invalidProvider.validateConfig();
      expect(result.valid).toBe(false);
    });
  });

  describe('Headers', () => {
    it('should build correct headers', () => {
      const headers = provider.buildHeaders();
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['x-api-key']).toBe('test-api-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });
  });

  describe('Generate (Non-streaming)', () => {
    it('should generate content successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            { type: 'text', text: 'Generated response' }
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 50
          }
        })
      });

      const result = await provider.generate(
        'You are a helpful assistant',
        'Hello, how are you?'
      );

      expect(result.content).toBe('Generated response');
      expect(result.reasoning).toBe('');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should build correct request body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Response' }]
        })
      });

      await provider.generate('System prompt', 'User prompt', {
        maxTokens: 2000,
        temperature: 0.7
      });

      const callArgs = mockFetch.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1].body);

      expect(requestBody.model).toBe('claude-3-5-sonnet-20241022');
      expect(requestBody.system).toBe('System prompt');
      expect(requestBody.messages).toEqual([
        { role: 'user', content: 'User prompt' }
      ]);
      expect(requestBody.max_tokens).toBe(2000);
      expect(requestBody.temperature).toBe(0.7);
    });

    it('should clamp temperature to max 1.0', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Response' }]
        })
      });

      await provider.generate('System', 'User', { temperature: 2.0 });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.temperature).toBe(1.0);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Temperature 2 exceeds max 1.0')
      );

      consoleSpy.mockRestore();
    });

    it('should include optional sampling parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Response' }]
        })
      });

      await provider.generate('System', 'User', {
        top_p: 0.9,
        top_k: 40,
        stop_sequences: ['STOP']
      });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.top_p).toBe(0.9);
      expect(requestBody.top_k).toBe(40);
      expect(requestBody.stop_sequences).toEqual(['STOP']);
    });

    it('should handle multiple content blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            { type: 'text', text: 'Part 1' },
            { type: 'text', text: ' Part 2' }
          ]
        })
      });

      const result = await provider.generate('System', 'User');
      expect(result.content).toBe('Part 1 Part 2');
    });

    it('should filter out non-text content blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            { type: 'text', text: 'Text content' },
            { type: 'image', data: 'base64...' },
            { type: 'text', text: ' More text' }
          ]
        })
      });

      const result = await provider.generate('System', 'User');
      expect(result.content).toBe('Text content More text');
    });

    it('should throw error when API key is missing', async () => {
      const noKeyProvider = new AnthropicProvider({ apiKey: '' });

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
          content: [{ type: 'text', text: 'Response' }]
        })
      });

      const controller = new AbortController();
      await provider.generate('System', 'User', { signal: controller.signal });

      expect(mockFetch.mock.calls[0][1].signal).toBe(controller.signal);
    });
  });

  describe('Default Values', () => {
    it('should use default max_tokens when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Response' }]
        })
      });

      await provider.generate('System', 'User');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.max_tokens).toBe(4000);
    });

    it('should use default temperature when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Response' }]
        })
      });

      await provider.generate('System', 'User');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.temperature).toBe(1.0);
    });

    it('should not include optional parameters when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Response' }]
        })
      });

      await provider.generate('System', 'User');

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.top_p).toBeUndefined();
      expect(requestBody.top_k).toBeUndefined();
      expect(requestBody.stop_sequences).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty content array', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: []
        })
      });

      const result = await provider.generate('System', 'User');
      expect(result.content).toBe('');
    });

    it('should handle content with only non-text blocks', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [
            { type: 'image', data: 'base64...' }
          ]
        })
      });

      const result = await provider.generate('System', 'User');
      expect(result.content).toBe('');
    });

    it('should handle temperature of 0', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Response' }]
        })
      });

      await provider.generate('System', 'User', { temperature: 0 });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.temperature).toBe(0);
    });

    it('should handle temperature of exactly 1.0', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          content: [{ type: 'text', text: 'Response' }]
        })
      });

      await provider.generate('System', 'User', { temperature: 1.0 });

      const requestBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(requestBody.temperature).toBe(1.0);
    });
  });
});
