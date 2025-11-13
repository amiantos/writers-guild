/**
 * OpenRouter Provider Implementation
 * Extends base LLMProvider with OpenRouter-specific functionality
 * API Docs: https://openrouter.ai/docs
 */

import { LLMProvider } from './base-provider.js';

export class OpenRouterProvider extends LLMProvider {
  constructor(config) {
    // OpenRouter-specific defaults
    const openrouterConfig = {
      ...config,
      baseURL: config.baseURL || "https://openrouter.ai/api/v1",
      model: config.model || "anthropic/claude-3.5-sonnet",
      providers: config.providers || [], // Empty = all providers
      allowFallbacks: config.allowFallbacks !== false // Default true
    };

    super(openrouterConfig);
    this.providers = openrouterConfig.providers;
    this.allowFallbacks = openrouterConfig.allowFallbacks;
  }

  /**
   * Get OpenRouter provider capabilities
   */
  getCapabilities() {
    return {
      streaming: true,
      reasoning: true, // Supported by some models (e.g., DeepSeek R1)
      visionAPI: true,  // Many OpenRouter models support vision
      maxContextWindow: 200000 // Varies by model, using conservative default
    };
  }

  /**
   * Validate OpenRouter configuration
   */
  validateConfig() {
    if (!this.apiKey || this.apiKey.trim() === '') {
      return {
        valid: false,
        error: 'API key is required'
      };
    }

    if (!this.model || this.model.trim() === '') {
      return {
        valid: false,
        error: 'Model is required'
      };
    }

    return { valid: true };
  }

  /**
   * Build request headers with OpenRouter-specific options
   */
  buildHeaders() {
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      "HTTP-Referer": "https://github.com/yourusername/ursceal", // Optional: For rankings
      "X-Title": "Ursceal" // Optional: For rankings
    };

    // Add provider preferences if specified
    if (this.providers && this.providers.length > 0) {
      headers["X-OpenRouter-Provider"] = this.providers.join(',');
    }

    return headers;
  }

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

    const body = {
      model: this.model,
      messages: messages,
      stream: false,
      max_tokens: options.maxTokens || 4000,
      temperature: options.temperature !== undefined ? options.temperature : 1.0,
      // Enable reasoning tokens for models that support it
      reasoning: { enabled: true }
    };

    // Add route parameter if fallbacks are disabled
    if (!this.allowFallbacks) {
      body.route = "fallback";
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
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
      reasoning: choice.message.reasoning || "",
      usage: data.usage,
      metadata: {
        model: data.model, // Actual model used (may differ from requested)
        provider: response.headers.get('X-OpenRouter-Provider') || 'unknown'
      }
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

    const body = {
      model: this.model,
      messages: messages,
      stream: true,
      max_tokens: options.maxTokens || 4000,
      temperature: options.temperature !== undefined ? options.temperature : 1.0,
      // Enable reasoning tokens for models that support it
      reasoning: { enabled: true }
    };

    // Add route parameter if fallbacks are disabled
    if (!this.allowFallbacks) {
      body.route = "fallback";
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
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
        systemPrompt,
        provider: response.headers.get('X-OpenRouter-Provider') || 'unknown'
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

          if (trimmed === "" || trimmed === "data: [DONE]") {
            continue;
          }

          if (trimmed.startsWith("data: ")) {
            try {
              const jsonStr = trimmed.slice(6); // Remove 'data: ' prefix
              const data = JSON.parse(jsonStr);

              if (data.choices && data.choices[0]) {
                const delta = data.choices[0].delta;

                // Extract reasoning from either simple field or structured details
                let reasoning = delta.reasoning || null;
                if (!reasoning && delta.reasoning_details && delta.reasoning_details.length > 0) {
                  reasoning = delta.reasoning_details[0].text || null;
                }

                yield {
                  reasoning: reasoning,
                  content: delta.content || null,
                  finished: data.choices[0].finish_reason !== null,
                  usage: data.usage || null
                };
              }
            } catch (e) {
              console.warn("Failed to parse SSE line:", e);
            }
          }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('[OpenRouter] Stream aborted by client');
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse OpenRouter-specific errors
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

    if (error.message?.includes('402') || error.message?.includes('credits')) {
      return {
        code: 'INSUFFICIENT_CREDITS',
        message: 'Insufficient credits. Please add credits to your OpenRouter account.',
        original: error
      };
    }

    if (error.message?.includes('model') && error.message?.includes('not found')) {
      return {
        code: 'MODEL_NOT_FOUND',
        message: 'Model not found or not available',
        original: error
      };
    }

    return super.parseError(error);
  }

  /**
   * Fetch available models from OpenRouter
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

      // Transform and enrich model data
      return data.data.map(model => ({
        id: model.id,
        name: model.name || model.id,
        description: model.description || '',
        contextLength: model.context_length || 0,
        pricing: {
          prompt: model.pricing?.prompt || 0,
          completion: model.pricing?.completion || 0
        },
        topProvider: model.top_provider || null,
        architecture: model.architecture || null,
        // Extract vendor from model ID (e.g., "anthropic/claude-3.5-sonnet" -> "anthropic")
        vendor: model.id.split('/')[0] || 'unknown'
      }));
    } catch (error) {
      console.error('Failed to fetch OpenRouter models:', error);
      return [];
    }
  }

  /**
   * Fetch available providers for a specific model
   * @param {string} modelId - Model ID to get providers for
   * @returns {Promise<Array>} Array of provider objects
   */
  async getModelProviders(modelId) {
    try {
      // OpenRouter doesn't have a direct endpoint for this,
      // but the models endpoint includes top_provider information
      const models = await this.getAvailableModels();
      const model = models.find(m => m.id === modelId);

      if (model && model.topProvider) {
        return [{
          name: model.topProvider.name || 'Unknown',
          maxCompletionTokens: model.topProvider.max_completion_tokens || null,
          isModerationd: model.topProvider.is_moderated || false
        }];
      }

      return [];
    } catch (error) {
      console.error('Failed to fetch model providers:', error);
      return [];
    }
  }
}
