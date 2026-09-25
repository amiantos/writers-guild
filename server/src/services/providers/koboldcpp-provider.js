/**
 * KoboldCpp Provider Implementation
 * Talks to KoboldCpp's native API (not the OpenAI shim) so we get access to
 * its full sampler surface, dedicated streaming endpoint, and genkey-based abort.
 * API Docs: https://lite.koboldai.net/koboldcpp_api
 */

import { LLMProvider } from './base-provider.js';

const DEFAULT_BASE_URL = 'http://localhost:5001/api';
const DEFAULT_MAX_TOKENS = 200;
const DEFAULT_MAX_CONTEXT = 4096;

/**
 * Normalize a user-provided baseURL so it works whether or not they include the
 * trailing `/api`. Kobold's own docs and KoboldAI Lite tell users to enter the
 * URL with `/api`, but tools like ooba omit it — accept both.
 */
function normalizeBaseURL(raw) {
  let url = (raw || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  if (url.toLowerCase().endsWith('/api')) {
    url = url.slice(0, -4);
  }
  return url;
}

export class KoboldCppProvider extends LLMProvider {
  constructor(config) {
    const koboldConfig = {
      ...config,
      baseURL: normalizeBaseURL(config.baseURL),
      model: config.model || '',
    };

    super(koboldConfig);

    this.password = config.password || '';
  }

  /** The preset's context, or the one Kobold is sent when the preset has none. */
  resolveContextTokens(preset) {
    return preset.generationSettings?.maxContextTokens ?? DEFAULT_MAX_CONTEXT;
  }

  getCapabilities() {
    return {
      streaming: true,
      reasoning: false,
      visionAPI: false,
      maxContextWindow: 8192,
    };
  }

  validateConfig() {
    if (!this.baseURL || this.baseURL.trim() === '') {
      return { valid: false, error: 'Base URL is required' };
    }
    return { valid: true };
  }

  authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.password) {
      headers['Authorization'] = `Bearer ${this.password}`;
    }
    return headers;
  }

  generateGenkey() {
    return `KCPP_${Math.random().toString(36).slice(2, 12)}`;
  }

  /**
   * Build the native /api/v1/generate request body.
   * System prompt goes in `memory` (Kobold preserves it from truncation),
   * user prompt goes in `prompt`.
   */
  buildRequestBody(systemPrompt, userPrompt, options = {}, genkey = null) {
    const body = {
      prompt: userPrompt || '',
      memory: systemPrompt || '',
      max_length: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      max_context_length: options.maxContextTokens ?? DEFAULT_MAX_CONTEXT,
      temperature: options.temperature ?? 0.7,
      use_default_badwordsids: true,
      trim_stop: true,
    };

    if (genkey) body.genkey = genkey;

    const passthrough = [
      'top_p',
      'top_k',
      'top_a',
      'typical',
      'tfs',
      'min_p',
      'rep_pen',
      'rep_pen_range',
      'rep_pen_slope',
      'sampler_order',
      'mirostat',
      'mirostat_tau',
      'mirostat_eta',
    ];
    for (const key of passthrough) {
      if (options[key] !== null && options[key] !== undefined) {
        body[key] = options[key];
      }
    }

    if (options.stop_sequences && options.stop_sequences.length > 0) {
      body.stop_sequence = options.stop_sequences;
    }

    return body;
  }

  async generate(systemPrompt, userPrompt, options = {}) {
    const genkey = this.generateGenkey();
    const body = this.buildRequestBody(systemPrompt, userPrompt, options, genkey);

    const response = await fetch(`${this.baseURL}/api/v1/generate`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail?.msg ||
          errorData.msg ||
          `KoboldCpp request failed: ${response.statusText}`,
      );
    }

    const data = await response.json();
    const text = data.results?.[0]?.text ?? '';

    return {
      content: text,
      reasoning: '',
      usage: undefined,
      metadata: { genkey },
    };
  }

  async generateStreaming(systemPrompt, userPrompt, options = {}) {
    const genkey = this.generateGenkey();
    const body = this.buildRequestBody(systemPrompt, userPrompt, options, genkey);

    const controller = new AbortController();
    const signal = options.signal || controller.signal;

    // When the caller aborts, also tell Kobold to stop generating server-side.
    // Without this, the fetch disconnects but Kobold keeps producing tokens.
    const onAbort = () => {
      this.sendAbort(genkey).catch((err) => {
        console.warn('[KoboldCpp] Failed to send abort:', err.message);
      });
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const response = await fetch(`${this.baseURL}/api/extra/generate/stream`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail?.msg ||
          errorData.msg ||
          `KoboldCpp stream request failed: ${response.statusText}`,
      );
    }

    return {
      stream: this.parseStreamResponse(response.body),
      abort: () => {
        controller.abort();
      },
      metadata: { genkey, userPrompt, systemPrompt },
    };
  }

  /**
   * Parse KoboldCpp's SSE format:
   *   event: message
   *   data: {"token": "..."}
   *
   * Events are separated by blank lines. The connection closing signals completion.
   */
  async *parseStreamResponse(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by blank lines
        let sepIdx;
        while ((sepIdx = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx + 2);

          let dataLine = null;
          for (const rawLine of event.split('\n')) {
            const line = rawLine.replace(/\r$/, '');
            if (line.startsWith('data:')) {
              dataLine = line.slice(5).trimStart();
            }
          }
          if (!dataLine) continue;

          try {
            const data = JSON.parse(dataLine);
            const token = data.token ?? '';
            if (token) {
              yield { content: token, finished: false };
            }
            if (data.finish_reason) {
              yield { content: null, finished: true };
              return;
            }
          } catch (err) {
            console.warn('[KoboldCpp] Failed to parse SSE event:', err.message);
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
      console.log('[KoboldCpp] Stream aborted by client');
    } finally {
      reader.releaseLock();
    }

    yield { content: null, finished: true };
  }

  async sendAbort(genkey) {
    if (!genkey) return;
    const response = await fetch(`${this.baseURL}/api/extra/abort`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ genkey }),
    });
    if (!response.ok) {
      throw new Error(`Abort request failed: ${response.statusText}`);
    }
  }

  /**
   * Fetch the currently loaded model name from /api/v1/model.
   * Returns the bare model identifier (Kobold prefixes it with "koboldcpp/").
   */
  async getCurrentModel() {
    const response = await fetch(`${this.baseURL}/api/v1/model`, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch model: ${response.statusText}`);
    }
    const data = await response.json();
    return data.result || '';
  }

  /**
   * Fetch the actual context window Kobold allocated memory for. This is the real
   * ceiling clients must stay under (the `--contextsize` flag is what the operator
   * *asked for*; the "true" endpoint returns what Kobold actually ended up with).
   * Returns the integer value, or null if the endpoint is unavailable.
   */
  async getMaxContextLength() {
    const response = await fetch(`${this.baseURL}/api/extra/true_max_context_length`, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch max context length: ${response.statusText}`);
    }
    const data = await response.json();
    return typeof data.value === 'number' ? data.value : null;
  }

  /**
   * Fetch the configured per-request max generation tokens (--defaultgenamt).
   * Returns the integer value, or null if the endpoint is unavailable.
   */
  async getMaxLength() {
    const response = await fetch(`${this.baseURL}/api/v1/config/max_length`, {
      method: 'GET',
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch max length: ${response.statusText}`);
    }
    const data = await response.json();
    return typeof data.value === 'number' ? data.value : null;
  }

  /**
   * Fetch model name + Kobold's operator-set ceilings (max context + max generation)
   * in one call, used by the "Detect" UI flow. The two ceiling fetches are
   * best-effort: if either endpoint fails, model is still returned.
   */
  async getEndpointInfo() {
    const model = await this.getCurrentModel();
    let maxContextLength = null;
    let maxLength = null;
    try {
      maxContextLength = await this.getMaxContextLength();
    } catch (err) {
      console.warn('[KoboldCpp] Could not fetch true_max_context_length:', err.message);
    }
    try {
      maxLength = await this.getMaxLength();
    } catch (err) {
      console.warn('[KoboldCpp] Could not fetch max_length:', err.message);
    }
    return { model, maxContextLength, maxLength };
  }

  parseError(error) {
    const msg = error.message || '';
    if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
      return {
        code: 'AUTH_ERROR',
        message: 'Wrong password, or endpoint requires --password',
        original: error,
      };
    }
    if (
      msg.includes('ECONNREFUSED') ||
      msg.includes('fetch failed') ||
      error.cause?.code === 'ECONNREFUSED'
    ) {
      return {
        code: 'CONNECTION_ERROR',
        message: `Could not reach KoboldCpp at ${this.baseURL}`,
        original: error,
      };
    }
    return super.parseError(error);
  }
}
