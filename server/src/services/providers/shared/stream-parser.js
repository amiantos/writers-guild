/**
 * Shared SSE (Server-Sent Events) stream parser for OpenAI-compatible streaming APIs
 *
 * This utility handles the common SSE parsing logic used by multiple providers
 * (DeepSeek, OpenAI, OpenRouter) and allows customization via a transform function.
 */

/**
 * Parse an SSE stream from an OpenAI-compatible API
 *
 * @param {ReadableStream} body - The response body stream
 * @param {Function} transformDelta - Function to transform the delta object into yield format
 *                                     Signature: (delta, data) => { reasoning, content, finished, ...custom }
 * @param {string} providerName - Name of the provider (for logging)
 * @returns {AsyncGenerator} Yields parsed stream chunks
 */
export async function* parseSSEStream(body, transformDelta, providerName = 'Provider') {
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
              const finishReason = data.choices[0].finish_reason;

              // Use the transform function to extract provider-specific fields
              const result = transformDelta(delta, data);

              yield {
                ...result,
                finished: finishReason !== null,
              };
            }
          } catch (e) {
            console.warn(`[${providerName}] Failed to parse SSE line:`, e);
          }
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log(`[${providerName}] Stream aborted by client`);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Common transform functions for different providers
 */
export const transformers = {
  /**
   * DeepSeek: Extracts reasoning_content field
   */
  deepseek: (delta) => ({
    reasoning: delta.reasoning_content || null,
    content: delta.content || null,
  }),

  /**
   * OpenAI: No reasoning support
   */
  openai: (delta) => ({
    reasoning: null,
    content: delta.content || null,
  }),

  /**
   * OpenRouter: Supports multiple reasoning field formats
   */
  openrouter: (delta, data) => {
    // Extract reasoning from either simple field or structured details
    let reasoning = delta.reasoning || null;
    if (!reasoning && delta.reasoning_details && delta.reasoning_details.length > 0) {
      reasoning = delta.reasoning_details[0].text || null;
    }

    return {
      reasoning: reasoning,
      content: delta.content || null,
      usage: data.usage || null,
    };
  },
};
