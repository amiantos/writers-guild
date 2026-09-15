import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeepSeekProvider } from '../deepseek-provider.js';

/** A request that never gets a response, failing only when aborted, as real fetch does. */
function silentFetch(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/**
 * A request whose streamed body sends `next()` every `every` ms, closing when it
 * returns null. Aborting fails the body, as real fetch does.
 */
function streamingFetch(next, every) {
  return async (_url, { signal }) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, every));
        if (signal.aborted) return;
        const piece = next();
        if (piece === null) controller.close();
        else controller.enqueue(encoder.encode(piece));
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  };
}

/** A request whose response sends keep-alive comments and never any data. */
const keepAliveFetch = streamingFetch(() => ': keep-alive\n\n', 5);

/** One SSE event carrying `delta`. */
function sseEvent(delta) {
  return `data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`;
}

async function drain(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe('DeepSeekProvider', () => {
  let provider;
  let mockFetch;

  beforeEach(() => {
    // Mock global fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    provider = new DeepSeekProvider({
      apiKey: 'test-api-key',
      model: 'deepseek-v4-flash',
    });
  });

  describe('Configuration', () => {
    it('should initialize with correct defaults', () => {
      const defaultProvider = new DeepSeekProvider({
        apiKey: 'test-key',
      });

      expect(defaultProvider.baseURL).toBe('https://api.deepseek.com/v1');
      expect(defaultProvider.model).toBe('deepseek-v4-flash');
    });

    it('should allow custom base URL', () => {
      const customProvider = new DeepSeekProvider({
        apiKey: 'test-key',
        baseURL: 'https://custom-api.com/v1',
      });

      expect(customProvider.baseURL).toBe('https://custom-api.com/v1');
    });

    it('should allow custom model', () => {
      const customProvider = new DeepSeekProvider({
        apiKey: 'test-key',
        model: 'deepseek-v4-pro',
      });

      expect(customProvider.model).toBe('deepseek-v4-pro');
    });
  });

  describe('Capabilities', () => {
    it('should return correct capabilities', () => {
      const capabilities = provider.getCapabilities();

      expect(capabilities.streaming).toBe(true);
      expect(capabilities.reasoning).toBe(true);
      expect(capabilities.visionAPI).toBe(false);
      expect(capabilities.maxContextWindow).toBe(1000000);
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

  describe('Thinking mode request body', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'r' } }] }),
      });
    });

    it('sends thinking: disabled by default', async () => {
      await provider.generate('System', 'User');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking).toEqual({ type: 'disabled' });
    });

    it('sends thinking: enabled with high effort by default when thinking=true', async () => {
      await provider.generate('System', 'User', { thinking: true });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking).toEqual({ type: 'enabled', reasoning_effort: 'high' });
    });

    it('honors reasoningEffort=max', async () => {
      await provider.generate('System', 'User', { thinking: true, reasoningEffort: 'max' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking).toEqual({ type: 'enabled', reasoning_effort: 'max' });
    });

    it('coerces unknown reasoningEffort values to high', async () => {
      await provider.generate('System', 'User', { thinking: true, reasoningEffort: 'low' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.thinking.reasoning_effort).toBe('high');
    });

    it('omits sampling params when thinking is enabled', async () => {
      await provider.generate('System', 'User', {
        thinking: true,
        temperature: 0.7,
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBeUndefined();
      expect(body.top_p).toBeUndefined();
      expect(body.frequency_penalty).toBeUndefined();
      expect(body.presence_penalty).toBeUndefined();
    });

    it('includes sampling params when thinking is disabled', async () => {
      await provider.generate('System', 'User', {
        temperature: 0.7,
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.temperature).toBe(0.7);
      expect(body.top_p).toBe(0.9);
      expect(body.frequency_penalty).toBe(0.5);
      expect(body.presence_penalty).toBe(0.3);
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
                reasoning_content: 'Thinking process',
              },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
          },
        }),
      });

      const result = await provider.generate('You are a helpful assistant', 'Hello, how are you?');

      expect(result.content).toBe('Generated response');
      expect(result.reasoning).toBe('Thinking process');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should build correct API request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
        }),
      });

      await provider.generate('System prompt', 'User prompt', {
        maxTokens: 2000,
        temperature: 0.7,
      });

      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://api.deepseek.com/v1/chat/completions');

      const headers = callArgs[1].headers;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['Authorization']).toBe('Bearer test-api-key');

      const requestBody = JSON.parse(callArgs[1].body);
      expect(requestBody.stream).toBe(false);
      expect(requestBody.model).toBe('deepseek-v4-flash');
      expect(requestBody.max_tokens).toBe(2000);
      expect(requestBody.temperature).toBe(0.7);
    });

    it('should throw error when API key is missing', async () => {
      const noKeyProvider = new DeepSeekProvider({ apiKey: '' });

      await expect(noKeyProvider.generate('System', 'User')).rejects.toThrow('API key not set');
    });

    it('should handle API errors with error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({
          error: { message: 'Invalid request' },
        }),
      });

      await expect(provider.generate('System', 'User')).rejects.toThrow('Invalid request');
    });

    it('should handle API errors without error message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
        json: async () => ({}),
      });

      await expect(provider.generate('System', 'User')).rejects.toThrow(
        'API request failed: Internal Server Error',
      );
    });

    it('should include optional sampling params when thinking is off', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Response' } }],
        }),
      });

      await provider.generate('System', 'User', {
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        stop_sequences: ['STOP'],
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
          choices: [{ message: { content: 'Response' } }],
        }),
      });

      const controller = new AbortController();
      await provider.generate('System', 'User', { signal: controller.signal });

      const { signal } = mockFetch.mock.calls[0][1];
      expect(signal.aborted).toBe(false);
      controller.abort();
      expect(signal.aborted).toBe(true);
    });
  });

  describe('Timeouts', () => {
    it('fails a request that gets no response in time', async () => {
      mockFetch.mockImplementation(silentFetch);
      provider = new DeepSeekProvider({ apiKey: 'test-api-key', responseTimeoutMs: 20 });

      await expect(provider.generate('System', 'User')).rejects.toThrow(
        /^DeepSeek did not respond within/,
      );
    });

    it('fails a stream that never starts', async () => {
      mockFetch.mockImplementation(silentFetch);
      provider = new DeepSeekProvider({ apiKey: 'test-api-key', idleTimeoutMs: 20 });

      await expect(provider.generateStreaming('System', 'User')).rejects.toThrow(
        /^DeepSeek stopped responding/,
      );
    });

    it('fails a stream that sends only keep-alive comments', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockImplementation(keepAliveFetch);
      provider = new DeepSeekProvider({ apiKey: 'test-api-key', idleTimeoutMs: 50 });

      const { stream } = await provider.generateStreaming('System', 'User');

      await expect(drain(stream)).rejects.toThrow(/^DeepSeek stopped responding: nothing arrived/);
      // A timeout isn't logged as the reader cancelling.
      expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('aborted by client'));
      logSpy.mockRestore();
    });

    it('keeps a slow stream going as long as text keeps arriving', async () => {
      const pieces = [...'ABCDEFGHIJ'].map((text) => sseEvent({ content: text }));
      mockFetch.mockImplementation(streamingFetch(() => pieces.shift() ?? null, 20));
      provider = new DeepSeekProvider({ apiKey: 'test-api-key', idleTimeoutMs: 150 });

      const { stream } = await provider.generateStreaming('System', 'User');
      const chunks = await drain(stream);

      expect(chunks.map((chunk) => chunk.content).join('')).toBe('ABCDEFGHIJ');
    });

    it('fails a stream whose events carry no text or reasoning', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockFetch.mockImplementation(streamingFetch(() => sseEvent({}), 5));
      provider = new DeepSeekProvider({ apiKey: 'test-api-key', idleTimeoutMs: 50 });

      const { stream } = await provider.generateStreaming('System', 'User');

      await expect(drain(stream)).rejects.toThrow(/^DeepSeek stopped responding/);
      logSpy.mockRestore();
    });

    it('leaves a cancellation as an AbortError', async () => {
      mockFetch.mockImplementation(silentFetch);
      provider = new DeepSeekProvider({ apiKey: 'test-api-key', idleTimeoutMs: 5000 });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 20);

      await expect(
        provider.generateStreaming('System', 'User', { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  describe('Generate Streaming', () => {
    it('should throw error when API key is missing', async () => {
      const noKeyProvider = new DeepSeekProvider({ apiKey: '' });

      await expect(noKeyProvider.generateStreaming('System', 'User')).rejects.toThrow(
        'API key not set',
      );
    });

    it('should return stream object with abort function', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => ({
            read: async () => ({ done: true }),
          }),
        },
      });

      const result = await provider.generateStreaming('System', 'User');

      expect(result).toHaveProperty('stream');
      expect(result).toHaveProperty('abort');
      expect(result).toHaveProperty('metadata');
      expect(typeof result.abort).toBe('function');
    });

    it('cancels the request with abort(), even when the caller passed a signal', async () => {
      mockFetch.mockImplementation(keepAliveFetch);
      const caller = new AbortController();

      const { abort } = await provider.generateStreaming('System', 'User', {
        signal: caller.signal,
      });
      abort();

      expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
      expect(caller.signal.aborted).toBe(false);
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Server Error',
        json: async () => ({
          error: { message: 'Server error' },
        }),
      });

      await expect(provider.generateStreaming('System', 'User')).rejects.toThrow('Server error');
    });

    it('forwards thinking flag through streaming path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => ({ read: async () => ({ done: true }) }) },
      });

      await provider.generateStreaming('System', 'User', {
        thinking: true,
        reasoningEffort: 'max',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.stream).toBe(true);
      expect(body.thinking).toEqual({ type: 'enabled', reasoning_effort: 'max' });
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
            { id: 'deepseek-v4-flash', created: 1234567890, owned_by: 'deepseek' },
            { id: 'deepseek-v4-pro', created: 1234567891, owned_by: 'deepseek' },
          ],
        }),
      });

      const models = await provider.getAvailableModels();

      expect(models).toHaveLength(2);
      expect(models[0].id).toBe('deepseek-v4-flash');
      expect(models[0].contextLength).toBe(1000000);
    });

    it('should return empty array on error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: 'Server Error',
      });

      const models = await provider.getAvailableModels();
      expect(models).toEqual([]);
    });
  });

  describe('getModelDescription', () => {
    it('should return description for deepseek-v4-flash', () => {
      const description = provider.getModelDescription('deepseek-v4-flash');
      expect(description).toContain('Flash');
    });

    it('should return description for deepseek-v4-pro', () => {
      const description = provider.getModelDescription('deepseek-v4-pro');
      expect(description).toContain('Pro');
    });

    it('should mark deepseek-chat as deprecated', () => {
      const description = provider.getModelDescription('deepseek-chat');
      expect(description.toLowerCase()).toContain('deprecated');
    });

    it('should mark deepseek-reasoner as deprecated', () => {
      const description = provider.getModelDescription('deepseek-reasoner');
      expect(description.toLowerCase()).toContain('deprecated');
    });

    it('should return empty string for unknown model', () => {
      const description = provider.getModelDescription('unknown-model');
      expect(description).toBe('');
    });
  });
});
