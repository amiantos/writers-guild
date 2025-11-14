/**
 * Anthropic Provider Implementation
 * Extends base LLMProvider with Anthropic-specific functionality
 * API Docs: https://docs.anthropic.com
 */

import { LLMProvider } from './base-provider.js';

export class AnthropicProvider extends LLMProvider {
  constructor(config) {
    // Anthropic-specific defaults
    const anthropicConfig = {
      ...config,
      baseURL: config.baseURL || "https://api.anthropic.com/v1",
      model: config.model || "claude-3-5-sonnet-20241022",
      anthropicVersion: config.anthropicVersion || "2023-06-01"
    };

    super(anthropicConfig);
    this.anthropicVersion = anthropicConfig.anthropicVersion;
  }

  /**
   * Get Anthropic provider capabilities
   */
  getCapabilities() {
    return {
      streaming: true,
      reasoning: false, // Anthropic doesn't expose reasoning tokens
      visionAPI: true,  // Claude 3+ supports vision
      maxContextWindow: 200000 // Claude 3.5 Sonnet context window
    };
  }

  /**
   * Validate Anthropic configuration
   */
  validateConfig() {
    if (!this.apiKey || this.apiKey.trim() === '') {
      return {
        valid: false,
        error: 'API key is required'
      };
    }

    return { valid: true };
  }

  /**
   * Build Anthropic-specific headers
   */
  buildHeaders() {
    return {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": this.anthropicVersion
    };
  }

  /**
   * Generate content without streaming
   */
  async generate(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) {
      throw new Error("API key not set");
    }

    const response = await fetch(`${this.baseURL}/messages`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: this.model,
        system: systemPrompt,
        messages: [
          { role: "user", content: userPrompt }
        ],
        max_tokens: options.maxTokens || 4000,
        temperature: options.temperature !== undefined ? options.temperature : 1.0,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || `API request failed: ${response.statusText}`
      );
    }

    const data = await response.json();

    // Anthropic returns content as an array of content blocks
    const content = data.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    return {
      content: content || "",
      reasoning: "", // Anthropic doesn't provide reasoning tokens
      usage: data.usage,
    };
  }

  /**
   * Generate content with streaming
   */
  async generateStreaming(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) {
      throw new Error("API key not set");
    }

    const controller = new AbortController();

    const response = await fetch(`${this.baseURL}/messages`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify({
        model: this.model,
        system: systemPrompt,
        messages: [
          { role: "user", content: userPrompt }
        ],
        max_tokens: options.maxTokens || 4000,
        temperature: options.temperature !== undefined ? options.temperature : 1.0,
        stream: true,
      }),
      signal: options.signal || controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || `API request failed: ${response.statusText}`
      );
    }

    return {
      stream: this.parseStreamResponse(response.body),
      abort: () => controller.abort(),
      metadata: {
        userPrompt,
        systemPrompt
      }
    };
  }

  /**
   * Parse SSE stream response
   */
  async *parseStreamResponse(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");

        // Keep the last incomplete line in buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed === "" || !trimmed.startsWith("data: ")) {
            continue;
          }

          try {
            const jsonStr = trimmed.slice(6); // Remove 'data: ' prefix
            const data = JSON.parse(jsonStr);

            // Handle different event types
            if (data.type === 'content_block_delta') {
              if (data.delta && data.delta.type === 'text_delta') {
                yield {
                  reasoning: null,
                  content: data.delta.text || null,
                  finished: false,
                };
              }
            } else if (data.type === 'message_stop') {
              yield {
                reasoning: null,
                content: null,
                finished: true,
              };
            }
          } catch (e) {
            console.warn("Failed to parse SSE line:", e);
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('[Anthropic] Stream aborted by client');
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse Anthropic-specific errors
   */
  parseError(error) {
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      return {
        code: 'AUTH_ERROR',
        message: 'Invalid API key',
        original: error
      };
    }

    if (error.message?.includes('429') || error.message?.includes('rate limit')) {
      return {
        code: 'RATE_LIMIT',
        message: 'Rate limit exceeded. Please try again later.',
        original: error
      };
    }

    if (error.message?.includes('overloaded')) {
      return {
        code: 'OVERLOADED',
        message: 'Anthropic API is overloaded. Please try again.',
        original: error
      };
    }

    return super.parseError(error);
  }

  /**
   * Fetch available models from Anthropic
   * @returns {Promise<Array>} Array of model objects with metadata
   */
  async getAvailableModels() {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        method: "GET",
        headers: this.buildHeaders()
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json();

      // Transform Anthropic model data
      return data.data.map(model => ({
        id: model.id,
        name: model.display_name || this.formatModelName(model.id),
        description: this.getModelDescription(model.id),
        contextLength: this.getContextLength(model.id),
        pricing: {
          prompt: 0, // Pricing not provided by API
          completion: 0
        },
        created: model.created_at,
        type: model.type
      }))
      .sort((a, b) => new Date(b.created) - new Date(a.created)); // Most recent first
    } catch (error) {
      console.error('Failed to fetch Anthropic models:', error);
      return [];
    }
  }

  /**
   * Format model ID into a readable name
   */
  formatModelName(modelId) {
    // Convert model IDs like "claude-3-5-sonnet-20241022" to "Claude 3.5 Sonnet"
    const parts = modelId.split('-');
    if (parts[0] === 'claude') {
      const version = parts.slice(1, parts.findIndex(p => /^\d{8}$/.test(p))).join('.');
      const variant = parts.find(p => ['opus', 'sonnet', 'haiku'].includes(p));
      if (variant) {
        return `Claude ${version} ${variant.charAt(0).toUpperCase() + variant.slice(1)}`;
      }
    }
    return modelId;
  }

  /**
   * Get model description based on model ID
   */
  getModelDescription(modelId) {
    if (modelId.includes('sonnet')) {
      return 'Balanced intelligence and speed for enterprise workloads';
    }
    if (modelId.includes('opus')) {
      return 'Most powerful model for complex tasks';
    }
    if (modelId.includes('haiku')) {
      return 'Fastest and most compact model for simple tasks';
    }
    return '';
  }

  /**
   * Get context length for model
   */
  getContextLength(modelId) {
    if (modelId.includes('claude-3')) {
      return 200000; // Claude 3 family supports 200k tokens
    }
    if (modelId.includes('claude-2')) {
      return 100000; // Claude 2 supports 100k tokens
    }
    return 100000; // Default fallback
  }
}
