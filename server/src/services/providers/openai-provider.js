/**
 * OpenAI Provider Implementation
 * Extends base LLMProvider with OpenAI-specific functionality
 * API Docs: https://platform.openai.com/docs
 */

import { LLMProvider } from './base-provider.js';

export class OpenAIProvider extends LLMProvider {
  constructor(config) {
    // OpenAI-specific defaults
    const openaiConfig = {
      ...config,
      baseURL: config.baseURL || "https://api.openai.com/v1",
      model: config.model || "gpt-4-turbo-preview"
    };

    super(openaiConfig);
  }

  /**
   * Get OpenAI provider capabilities
   */
  getCapabilities() {
    return {
      streaming: true,
      reasoning: false, // OpenAI doesn't expose reasoning tokens like DeepSeek
      visionAPI: true,  // GPT-4 Vision support
      maxContextWindow: 128000 // GPT-4 Turbo context window
    };
  }

  /**
   * Validate OpenAI configuration
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
    const choice = data.choices[0];

    return {
      content: choice.message.content || "",
      reasoning: "", // OpenAI doesn't provide reasoning tokens
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
        temperature: options.temperature !== undefined ? options.temperature : 1.0,
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

          if (trimmed === "" || trimmed === "data: [DONE]") {
            continue;
          }

          if (trimmed.startsWith("data: ")) {
            try {
              const jsonStr = trimmed.slice(6); // Remove 'data: ' prefix
              const data = JSON.parse(jsonStr);

              if (data.choices && data.choices[0]) {
                const delta = data.choices[0].delta;

                yield {
                  reasoning: null, // OpenAI doesn't provide reasoning tokens
                  content: delta.content || null,
                  finished: data.choices[0].finish_reason !== null,
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
        console.log('[OpenAI] Stream aborted by client');
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse OpenAI-specific errors
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

    if (error.message?.includes('insufficient_quota')) {
      return {
        code: 'INSUFFICIENT_QUOTA',
        message: 'Insufficient quota. Please check your OpenAI account.',
        original: error
      };
    }

    return super.parseError(error);
  }

  /**
   * Fetch available models from OpenAI
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

      // Filter and transform OpenAI model data to include only relevant chat models
      return data.data
        .filter(model => {
          // Only include GPT models that support chat completions
          return model.id.includes('gpt') &&
                 !model.id.includes('instruct') &&
                 !model.id.includes('search') &&
                 !model.id.includes('edit') &&
                 !model.id.includes('embedding') &&
                 !model.id.includes('davinci') &&
                 !model.id.includes('curie') &&
                 !model.id.includes('babbage') &&
                 !model.id.includes('ada');
        })
        .map(model => ({
          id: model.id,
          name: this.formatModelName(model.id),
          description: this.getModelDescription(model.id),
          contextLength: this.getContextLength(model.id),
          pricing: {
            prompt: 0, // Pricing not provided by API
            completion: 0
          },
          created: model.created,
          ownedBy: model.owned_by
        }))
        .sort((a, b) => b.created - a.created); // Most recent first
    } catch (error) {
      console.error('Failed to fetch OpenAI models:', error);
      return [];
    }
  }

  /**
   * Format model ID into a readable name
   */
  formatModelName(modelId) {
    // Convert model IDs like "gpt-4-turbo-preview" to "GPT-4 Turbo Preview"
    return modelId
      .split('-')
      .map((part, index) => {
        if (part === 'gpt') return 'GPT';
        if (index === 1 && !isNaN(part)) return `-${part}`;
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ')
      .replace('  ', ' ');
  }

  /**
   * Get model description based on model ID
   */
  getModelDescription(modelId) {
    if (modelId.includes('gpt-5')) {
      return 'Latest flagship model with advanced reasoning capabilities';
    }
    if (modelId.includes('gpt-4-turbo') || modelId.includes('gpt-4-1')) {
      return 'Fast, multimodal model with high intelligence';
    }
    if (modelId.includes('gpt-4')) {
      return 'Advanced model for complex tasks';
    }
    if (modelId.includes('gpt-3.5-turbo')) {
      return 'Fast and cost-effective model for simpler tasks';
    }
    if (modelId.includes('o3') || modelId.includes('o1')) {
      return 'Reasoning model optimized for complex problem-solving';
    }
    return '';
  }

  /**
   * Get context length for model
   */
  getContextLength(modelId) {
    if (modelId.includes('gpt-5') || modelId.includes('gpt-4-turbo') || modelId.includes('gpt-4-1')) {
      return 128000;
    }
    if (modelId.includes('gpt-4-32k')) {
      return 32768;
    }
    if (modelId.includes('gpt-4')) {
      return 8192;
    }
    if (modelId.includes('gpt-3.5-turbo-16k')) {
      return 16385;
    }
    if (modelId.includes('gpt-3.5-turbo')) {
      return 16385; // Updated context length for newer versions
    }
    if (modelId.includes('o3') || modelId.includes('o1')) {
      return 128000;
    }
    return 8192; // Default fallback
  }
}
