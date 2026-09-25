/**
 * Ollama Provider Implementation
 * Talks to Ollama's native API (/api/chat for generation, /api/tags for model listing).
 * We use /api/chat (not /api/generate) because it accepts OpenAI-style system+user
 * messages and is what Ollama recommends for new integrations.
 * API Docs: https://docs.ollama.com/api/
 */

import { LLMProvider } from './base-provider.js';

const DEFAULT_BASE_URL = 'http://localhost:11434';
// Ollama's own default num_ctx, sent when a preset sets no context size.
const DEFAULT_CONTEXT_TOKENS = 4096;

/**
 * Normalize a user-provided baseURL so it works with or without a trailing `/api`.
 * Ollama's own docs use bare URLs (`http://localhost:11434`), but some users paste
 * with `/api` included — accept both.
 */
function normalizeBaseURL(raw) {
  let url = (raw || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  if (url.toLowerCase().endsWith('/api')) {
    url = url.slice(0, -4);
  }
  return url;
}

/**
 * Map UI/preset sampler names (chosen to match what Kobold and AI Horde use)
 * onto Ollama's `options` blob keys.
 */
const SAMPLER_NAME_MAP = {
  top_p: 'top_p',
  top_k: 'top_k',
  min_p: 'min_p',
  typical: 'typical_p',
  tfs: 'tfs_z',
  rep_pen: 'repeat_penalty',
  rep_pen_range: 'repeat_last_n',
  mirostat: 'mirostat',
  mirostat_tau: 'mirostat_tau',
  mirostat_eta: 'mirostat_eta',
  // Not mapped (Ollama has no equivalent): top_a, rep_pen_slope
};

/**
 * Parse the `parameters` string returned by /api/show into an object.
 * Modelfile params are newline-separated `key value` pairs; values may be
 * double-quoted (with simple \" / \n escapes). `stop` repeats — collected
 * into an array.
 */
export function parseModelfileParameters(paramStr) {
  const result = {};
  const stops = [];
  if (!paramStr || typeof paramStr !== 'string') return result;

  for (const rawLine of paramStr.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;

    const key = line.slice(0, spaceIdx);
    let value = line.slice(spaceIdx + 1).trim();

    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n');
    }

    if (key === 'stop') {
      stops.push(value);
      continue;
    }

    const num = Number(value);
    result[key] = Number.isFinite(num) && value !== '' ? num : value;
  }

  if (stops.length > 0) result.stop = stops;
  return result;
}

/**
 * Pull the model's architectural max context length out of the model_info
 * blob, which uses family-prefixed keys like `llama.context_length`,
 * `qwen2.context_length`, etc.
 */
export function extractContextLength(modelInfo) {
  if (!modelInfo || typeof modelInfo !== 'object') return null;
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) {
      return value;
    }
  }
  return null;
}

export class OllamaProvider extends LLMProvider {
  constructor(config) {
    const ollamaConfig = {
      ...config,
      baseURL: normalizeBaseURL(config.baseURL),
      model: config.model || '',
    };

    super(ollamaConfig);

    this.password = config.password || '';
  }

  /** The preset's context, or the num_ctx Ollama is sent when the preset has none. */
  resolveContextTokens(preset) {
    return preset.generationSettings?.maxContextTokens ?? DEFAULT_CONTEXT_TOKENS;
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

  /**
   * Build the `/api/chat` request body. Ollama takes the OpenAI-style `messages`
   * array plus an `options` blob for everything sampler-related.
   */
  buildRequestBody(systemPrompt, userPrompt, options = {}, stream = false) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    if (userPrompt) messages.push({ role: 'user', content: userPrompt });

    const ollamaOptions = {
      num_predict: options.maxTokens ?? 200,
      num_ctx: options.maxContextTokens ?? DEFAULT_CONTEXT_TOKENS,
      temperature: options.temperature ?? 0.7,
    };

    for (const [presetKey, ollamaKey] of Object.entries(SAMPLER_NAME_MAP)) {
      if (options[presetKey] !== null && options[presetKey] !== undefined) {
        ollamaOptions[ollamaKey] = options[presetKey];
      }
    }

    if (options.stop_sequences && options.stop_sequences.length > 0) {
      ollamaOptions.stop = options.stop_sequences;
    }

    const body = {
      model: this.model,
      messages,
      stream,
      options: ollamaOptions,
    };

    return body;
  }

  async generate(systemPrompt, userPrompt, options = {}) {
    if (!this.model) {
      throw new Error('Ollama: no model selected. Use Fetch Models in preset settings.');
    }

    const body = this.buildRequestBody(systemPrompt, userPrompt, options, false);

    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Ollama request failed: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      content: data.message?.content ?? '',
      reasoning: '',
      usage: {
        promptTokens: data.prompt_eval_count,
        completionTokens: data.eval_count,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      metadata: {
        model: data.model,
        totalDuration: data.total_duration,
      },
    };
  }

  async generateStreaming(systemPrompt, userPrompt, options = {}) {
    if (!this.model) {
      throw new Error('Ollama: no model selected. Use Fetch Models in preset settings.');
    }

    const body = this.buildRequestBody(systemPrompt, userPrompt, options, true);

    const controller = new AbortController();
    const signal = options.signal || controller.signal;

    const response = await fetch(`${this.baseURL}/api/chat`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Ollama stream request failed: ${response.statusText}`);
    }

    return {
      stream: this.parseStreamResponse(response.body),
      // Ollama has no server-side abort — disconnecting the request stops generation.
      abort: () => controller.abort(),
      metadata: { userPrompt, systemPrompt },
    };
  }

  /**
   * Parse Ollama's NDJSON stream: each line is a complete JSON object like
   * `{"message":{"role":"assistant","content":"..."},"done":false}`, ending
   * with `{"done":true, ...stats}`.
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

        let newlineIdx;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;

          try {
            const data = JSON.parse(line);
            const token = data.message?.content ?? '';
            if (token) {
              yield { content: token, finished: false };
            }
            if (data.done) {
              yield {
                content: null,
                finished: true,
                usage: {
                  promptTokens: data.prompt_eval_count,
                  completionTokens: data.eval_count,
                  totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
                },
              };
              return;
            }
          } catch (err) {
            console.warn('[Ollama] Failed to parse NDJSON line:', err.message);
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
      console.log('[Ollama] Stream aborted by client');
    } finally {
      reader.releaseLock();
    }

    yield { content: null, finished: true };
  }

  /**
   * Fetch the list of models installed on the Ollama instance.
   * Returns each as { id, name, contextLength, description, size, parameterSize }.
   * (contextLength is left unset — Ollama doesn't expose it via /api/tags, and
   * pulling it from /api/show would be one extra round-trip per model.)
   */
  async getAvailableModels() {
    const response = await fetch(`${this.baseURL}/api/tags`, {
      method: 'GET',
      headers: this.authHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Ollama models: ${response.statusText}`);
    }

    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models : [];

    return models
      .map((m) => {
        const details = m.details || {};
        const parts = [details.parameter_size, details.quantization_level].filter(Boolean);
        return {
          id: m.name,
          name: m.name,
          description: parts.length ? parts.join(' · ') : details.family || '',
          contextLength: 0, // unknown without /api/show
          size: m.size,
          parameterSize: details.parameter_size,
          family: details.family,
          modifiedAt: m.modified_at,
        };
      })
      .toSorted((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));
  }

  /**
   * Hit /api/show to pull model metadata. Returns the architectural context
   * length and the Modelfile's recommended parameter defaults — used to
   * auto-configure preset settings when a user picks a model.
   */
  async getModelInfo(modelName) {
    const name = modelName || this.model;
    if (!name) throw new Error('Model name is required');

    const response = await fetch(`${this.baseURL}/api/show`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch model info: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      contextLength: extractContextLength(data.model_info),
      parameters: parseModelfileParameters(data.parameters || ''),
      capabilities: Array.isArray(data.capabilities) ? data.capabilities : [],
      details: data.details || {},
    };
  }

  parseError(error) {
    const msg = error.message || '';
    if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
      return {
        code: 'AUTH_ERROR',
        message: 'Wrong bearer token, or endpoint requires authentication',
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
        message: `Could not reach Ollama at ${this.baseURL}`,
        original: error,
      };
    }
    if (msg.includes('model') && msg.toLowerCase().includes('not found')) {
      return {
        code: 'MODEL_NOT_FOUND',
        message: `Model "${this.model}" is not installed. Run \`ollama pull ${this.model}\` on the host first.`,
        original: error,
      };
    }
    return super.parseError(error);
  }
}
