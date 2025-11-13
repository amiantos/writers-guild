/**
 * DeepSeek Provider Implementation
 * Extends base LLMProvider with DeepSeek-specific functionality
 */

import { LLMProvider } from './base-provider.js';

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
                  reasoning: delta.reasoning_content || null,
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
        console.log('[DeepSeek] Stream aborted by client');
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
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
}
