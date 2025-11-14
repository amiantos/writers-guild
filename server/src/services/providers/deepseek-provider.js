/**
 * DeepSeek Provider Implementation
 * Extends base LLMProvider with DeepSeek-specific functionality
 */

import { LLMProvider } from './base-provider.js';
import { parseSSEStream, transformers } from './shared/stream-parser.js';

export class DeepSeekProvider extends LLMProvider {
  constructor(config) {
    // DeepSeek-specific defaults
    const deepseekConfig = {
      ...config,
      baseURL: config.baseURL || "https://api.deepseek.com/v1",
      model: config.model || "deepseek-reasoner"
    };

    super(deepseekConfig);
    // promptBuilder is now initialized in base class
  }

  /**
   * Get DeepSeek provider capabilities
   */
  getCapabilities() {
    return {
      streaming: true,
      reasoning: true,
      visionAPI: false,
      maxContextWindow: 128000 // DeepSeek Reasoner context window
    };
  }

  /**
   * Validate DeepSeek configuration
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

  // buildPrompts() is now inherited from base class
  // No need to override unless custom logic is required

  /**
   * Generate content without streaming
   */
  async generate(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) {
      throw new Error("API key not set");
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        stream: false,
        max_tokens: options.maxTokens || 4000,
        temperature: options.temperature !== undefined ? options.temperature : 1.5,
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
    const choice = data.choices[0];

    return {
      content: choice.message.content || "",
      reasoning: choice.message.reasoning_content || "",
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

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const controller = new AbortController();

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        stream: true,
        max_tokens: options.maxTokens || 4000,
        temperature: options.temperature !== undefined ? options.temperature : 1.5,
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
   * Parse SSE stream response using shared parser
   */
  async *parseStreamResponse(body) {
    yield* parseSSEStream(body, transformers.deepseek, 'DeepSeek');
  }

  /**
   * Parse DeepSeek-specific errors
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

    return super.parseError(error);
  }

  /**
   * Fetch available models from DeepSeek
   * @returns {Promise<Array>} Array of model objects with metadata
   */
  async getAvailableModels() {
    try {
      const response = await fetch(`${this.baseURL}/models`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }

      const data = await response.json();

      // Transform DeepSeek model data
      return data.data.map(model => ({
        id: model.id,
        name: model.id, // DeepSeek doesn't provide separate display names
        description: this.getModelDescription(model.id),
        contextLength: 64000, // DeepSeek models support 64k context
        pricing: {
          prompt: 0, // Pricing not provided by API
          completion: 0
        },
        created: model.created,
        ownedBy: model.owned_by
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
      'deepseek-chat': 'DeepSeek-V3 in non-thinking mode, optimized for general conversation and tasks',
      'deepseek-reasoner': 'DeepSeek-V3 in thinking mode, optimized for advanced reasoning, math, and coding'
    };
    return descriptions[modelId] || '';
  }
}
