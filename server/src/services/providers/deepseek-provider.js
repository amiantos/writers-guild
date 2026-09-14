/**
 * DeepSeek Provider Implementation
 * Extends base LLMProvider with DeepSeek-specific functionality
 */

import { LLMProvider } from './base-provider.js';
import { parseSSEStream, transformers } from './shared/stream-parser.js';
import {
  RESPONSE_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
  createRequestTimeout,
  formatTimeout,
} from './shared/request-timeout.js';

export class DeepSeekProvider extends LLMProvider {
  constructor(config) {
    const deepseekConfig = {
      ...config,
      baseURL: config.baseURL || 'https://api.deepseek.com/v1',
      model: config.model || 'deepseek-v4-flash',
    };

    super(deepseekConfig);

    // Tests shorten these.
    this.idleTimeoutMs = config.idleTimeoutMs ?? STREAM_IDLE_TIMEOUT_MS;
    this.responseTimeoutMs = config.responseTimeoutMs ?? RESPONSE_TIMEOUT_MS;
  }

  /**
   * Get DeepSeek provider capabilities
   */
  getCapabilities() {
    return {
      streaming: true,
      reasoning: true,
      visionAPI: false,
      maxContextWindow: 1000000, // V4 models support 1M token context
    };
  }

  /**
   * Validate DeepSeek configuration
   */
  validateConfig() {
    if (!this.apiKey || this.apiKey.trim() === '') {
      return {
        valid: false,
        error: 'API key is required',
      };
    }

    return { valid: true };
  }

  /**
   * Build the request body for /chat/completions.
   * Thinking mode is now decoupled from model choice — toggled per-request.
   * When thinking is enabled, sampling parameters are ignored by the API,
   * so we omit them to keep the payload clean.
   */
  buildRequestBody(messages, options, stream) {
    const thinkingEnabled = options.thinking === true;

    const body = {
      model: this.model,
      messages,
      stream,
      max_tokens: options.maxTokens || 4000,
      thinking: thinkingEnabled
        ? {
            type: 'enabled',
            reasoning_effort: options.reasoningEffort === 'max' ? 'max' : 'high',
          }
        : { type: 'disabled' },
    };

    if (!thinkingEnabled) {
      body.temperature = options.temperature !== undefined ? options.temperature : 1.5;
      if (options.top_p !== null && options.top_p !== undefined) {
        body.top_p = options.top_p;
      }
      if (options.frequency_penalty !== null && options.frequency_penalty !== undefined) {
        body.frequency_penalty = options.frequency_penalty;
      }
      if (options.presence_penalty !== null && options.presence_penalty !== undefined) {
        body.presence_penalty = options.presence_penalty;
      }
    }

    if (options.stop_sequences && options.stop_sequences.length > 0) {
      body.stop = options.stop_sequences;
    }

    return body;
  }

  /**
   * Generate content without streaming
   */
  async generate(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('API key not set');
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const requestBody = this.buildRequestBody(messages, options, false);
    // Nothing arrives until the whole response is ready, so the timeout covers all of it.
    const timeout = createRequestTimeout(this.responseTimeoutMs, options.signal);

    let data;
    try {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: timeout.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API request failed: ${response.statusText}`);
      }

      data = await response.json();
    } catch (error) {
      if (!timeout.timedOut) throw error;
      throw new Error(`DeepSeek did not respond within ${formatTimeout(this.responseTimeoutMs)}`, {
        cause: error,
      });
    } finally {
      timeout.clear();
    }

    const choice = data.choices[0];

    return {
      content: choice.message.content || '',
      reasoning: choice.message.reasoning_content || '',
      usage: data.usage,
    };
  }

  /**
   * Generate content with streaming
   */
  async generateStreaming(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) {
      throw new Error('API key not set');
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const controller = new AbortController();
    const requestBody = this.buildRequestBody(messages, options, true);
    // Runs from the request until the stream ends. Chunks reset it; keep-alive comments don't.
    const timeout = createRequestTimeout(this.idleTimeoutMs, options.signal || controller.signal);

    let response;
    try {
      response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: timeout.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API request failed: ${response.statusText}`);
      }
    } catch (error) {
      timeout.clear();
      throw this.streamError(error, timeout);
    }

    return {
      stream: this.parseStreamResponse(response.body, timeout),
      abort: () => controller.abort(),
      metadata: {
        userPrompt,
        systemPrompt,
      },
    };
  }

  /**
   * Parse SSE stream response using shared parser
   * @param {ReadableStream} body
   * @param {Object} [timeout] - The request's timeout, reset as chunks arrive.
   */
  async *parseStreamResponse(body, timeout) {
    try {
      for await (const chunk of parseSSEStream(body, transformers.deepseek, 'DeepSeek')) {
        timeout?.reset();
        yield chunk;
      }
    } catch (error) {
      throw this.streamError(error, timeout);
    } finally {
      timeout?.clear();
    }
  }

  /** A stream that timed out says so; any other failure passes through. */
  streamError(error, timeout) {
    if (!timeout?.timedOut) return error;
    return new Error(
      `DeepSeek stopped responding: nothing arrived for ${formatTimeout(this.idleTimeoutMs)}`,
      { cause: error },
    );
  }

  /**
   * Parse DeepSeek-specific errors
   */
  parseError(error) {
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      return {
        code: 'AUTH_ERROR',
        message: 'Invalid API key',
        original: error,
      };
    }

    if (error.message?.includes('429') || error.message?.includes('rate limit')) {
      return {
        code: 'RATE_LIMIT',
        message: 'Rate limit exceeded. Please try again later.',
        original: error,
      };
    }

    return super.parseError(error);
  }

  /**
   * Fetch available models from DeepSeek
   * @returns {Promise<Array>} Array of model objects with metadata
   */
  async getAvailableModels() {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json();

      return data.data.map((model) => ({
        id: model.id,
        name: model.id,
        description: this.getModelDescription(model.id),
        contextLength: 1000000, // V4 models: 1M tokens
        pricing: {
          prompt: 0,
          completion: 0,
        },
        created: model.created,
        ownedBy: model.owned_by,
      }));
    } catch (error) {
      console.error('Failed to fetch DeepSeek models:', error);
      return [];
    }
  }

  /**
   * Get model description based on model ID
   */
  getModelDescription(modelId) {
    const descriptions = {
      'deepseek-v4-flash':
        'DeepSeek V4 Flash — fast, low-cost, 1M context. Supports optional thinking mode.',
      'deepseek-v4-pro':
        'DeepSeek V4 Pro — higher-quality, 1M context. Supports optional thinking mode.',
      'deepseek-chat': 'Deprecated — aliases to deepseek-v4-flash (non-thinking).',
      'deepseek-reasoner': 'Deprecated — aliases to deepseek-v4-flash (thinking enabled).',
    };
    return descriptions[modelId] || '';
  }
}
