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
   * Check if model uses max_completion_tokens instead of max_tokens
   * GPT-5, o1, o3, and newer models use max_completion_tokens
   */
  usesMaxCompletionTokens() {
    const model = this.model.toLowerCase();
    return model.includes('gpt-5') ||
           model.includes('o1') ||
           model.includes('o3') ||
           model.startsWith('chatgpt-');
  }

  /**
   * Build request body with correct token parameter
   */
  buildRequestBody(messages, options = {}) {
    const body = {
      model: this.model,
      messages: messages,
      temperature: options.temperature !== undefined ? options.temperature : 1.0,
    };

    // Use correct token parameter based on model
    if (this.usesMaxCompletionTokens()) {
      body.max_completion_tokens = options.maxTokens || 4000;
    } else {
      body.max_tokens = options.maxTokens || 4000;
    }

    return body;
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

    const body = this.buildRequestBody(messages, options);
    body.stream = false;

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
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

    const body = this.buildRequestBody(messages, options);
    body.stream = true;

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
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
   * Check if a model is a chat completion model
   */
  isChatModel(modelId) {
    const id = modelId.toLowerCase();

    // Include GPT-4, GPT-5, GPT-3.5-turbo, o1, o3, and ChatGPT models
    const isChatModel =
      id.startsWith('gpt-4') ||
      id.startsWith('gpt-5') ||
      id.startsWith('gpt-3.5-turbo') ||
      id.startsWith('chatgpt-') ||
      (id.startsWith('o1') && !id.includes('omni')) ||
      (id.startsWith('o3') && !id.includes('omni'));

    // Exclude non-chat models
    const isExcluded =
      id.includes('instruct') ||
      id.includes('search') ||
      id.includes('edit') ||
      id.includes('embedding') ||
      id.includes('davinci') ||
      id.includes('curie') ||
      id.includes('babbage') ||
      id.includes('ada') ||
      id.includes('whisper') ||
      id.includes('tts') ||
      id.includes('dall-e') ||
      id.includes('realtime') ||
      id.includes('audio') ||
      id.endsWith('-vision'); // Exclude vision-only models

    return isChatModel && !isExcluded;
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

      // Filter and transform OpenAI model data to include only chat completion models
      return data.data
        .filter(model => this.isChatModel(model.id))
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
    const id = modelId.toLowerCase();

    // GPT-5 series
    if (id.includes('gpt-5')) {
      return 128000;
    }

    // o-series (o1, o3) reasoning models
    if (id.startsWith('o1') || id.startsWith('o3')) {
      return 128000;
    }

    // GPT-4 series
    if (id.includes('gpt-4o')) {
      return 128000; // GPT-4o and GPT-4o-mini
    }
    if (id.includes('gpt-4-turbo') || id.includes('gpt-4-1')) {
      return 128000;
    }
    if (id.includes('gpt-4-32k')) {
      return 32768;
    }
    if (id.includes('gpt-4')) {
      return 8192;
    }

    // GPT-3.5 series
    if (id.includes('gpt-3.5-turbo-16k')) {
      return 16385;
    }
    if (id.includes('gpt-3.5-turbo')) {
      return 16385; // Updated context length for newer versions
    }

    // ChatGPT models
    if (id.startsWith('chatgpt-')) {
      return 128000;
    }

    return 8192; // Default fallback
  }
}
