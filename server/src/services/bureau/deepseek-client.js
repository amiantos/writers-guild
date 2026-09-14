/**
 * DeepSeek Client for Bureau
 *
 * Bureau's agents need multi-turn messages, tool calls, strict schemas, and
 * streamed tool-call deltas, none of which story mode's DeepSeekProvider
 * offers. This client speaks DeepSeek's OpenAI-format chat API directly;
 * orchestration (tool loops, run recording) belongs to its callers.
 *
 * API notes (api-docs.deepseek.com, checked 2026-09-12):
 * - V4.1 Flash is `deepseek-flash`.
 * - Thinking is on unless a request turns it off, so every request sets
 *   `thinking` explicitly. `reasoning_effort` is a top-level field.
 * - Thinking mode rejects `tool_choice: "required"` and named tool choices.
 * - When a request has tools, every earlier assistant message must keep its
 *   `reasoning_content`, or the API returns 400.
 * - Strict tool schemas need the beta base URL, `strict: true` on every
 *   function, every object property required, and additionalProperties false.
 * - Streams can contain `: keep-alive` comment lines, and non-streaming bodies
 *   can start with blank keep-alive lines.
 */

import {
  RESPONSE_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
  createRequestTimeout,
  formatTimeout,
} from '../providers/shared/request-timeout.js';

export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_BETA_BASE_URL = 'https://api.deepseek.com/beta';
export const DEFAULT_MODEL = 'deepseek-flash';
export const REASONING_EFFORTS = ['low', 'high', 'max'];

const STATUS_HINTS = {
  400: 'invalid request format',
  401: 'authentication failed; check the API key',
  402: 'insufficient balance',
  422: 'invalid parameters',
  429: 'rate limit reached',
  500: 'server error',
  503: 'server overloaded',
};

const UNSUPPORTED_STRICT_KEYWORDS = ['minLength', 'maxLength', 'minItems', 'maxItems'];

const STREAM_DONE = Symbol('stream done');

export class DeepSeekError extends Error {
  /**
   * @param {string} message
   * @param {Object} [details]
   * @param {number|null} [details.status] - HTTP status, when the API answered.
   * @param {*} [details.body] - Parsed or raw response body.
   * @param {boolean} [details.timedOut] - The request stalled and was stopped.
   */
  constructor(message, { status = null, body = null, timedOut = false } = {}) {
    super(message);
    this.name = 'DeepSeekError';
    this.status = status;
    this.body = body;
    this.timedOut = timedOut;
  }
}

/**
 * @typedef {Object} ChatResult
 * @property {string} content
 * @property {string} reasoning - reasoning_content, empty when thinking is off.
 * @property {Array<Object>} toolCalls - OpenAI-format tool calls.
 * @property {string|null} finishReason
 * @property {Object|null} usage
 * @property {string} model
 */

function parseJsonSafely(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Check a tool's JSON Schema against DeepSeek's strict-mode rules before
 * sending it, so a bad definition fails with a clear message instead of a 400.
 * @param {Object|undefined} schema
 * @param {string} [at] - Path used in error messages.
 * @throws {DeepSeekError}
 */
export function assertStrictSchema(schema, at = 'parameters') {
  if (!schema || typeof schema !== 'object') return;

  for (const keyword of UNSUPPORTED_STRICT_KEYWORDS) {
    if (keyword in schema) {
      throw new DeepSeekError(`Strict mode doesn't support "${keyword}" (at ${at})`);
    }
  }

  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) {
      throw new DeepSeekError(`Strict mode requires additionalProperties: false (at ${at})`);
    }
    const required = new Set(schema.required ?? []);
    const optional = Object.keys(schema.properties ?? {}).filter((name) => !required.has(name));
    if (optional.length > 0) {
      throw new DeepSeekError(
        `Strict mode requires every property to be required; not required: ${optional.join(', ')} (at ${at})`,
      );
    }
  }

  for (const [name, child] of Object.entries(schema.properties ?? {})) {
    assertStrictSchema(child, `${at}.${name}`);
  }
  if (schema.items) {
    assertStrictSchema(schema.items, `${at}.items`);
  }
  for (const [index, child] of (schema.anyOf ?? []).entries()) {
    assertStrictSchema(child, `${at}.anyOf[${index}]`);
  }
  for (const [name, child] of Object.entries(schema.$def ?? {})) {
    assertStrictSchema(child, `${at}.$def.${name}`);
  }
}

/**
 * Fold one streamed tool-call fragment into the calls assembled so far. The
 * first fragment of a call carries its id and name; later ones only carry
 * more argument text.
 * @param {Array<Object>} toolCalls - Mutated; indexed by the fragment's index.
 * @param {Object} part
 * @returns {Object} The call the fragment belongs to.
 */
export function mergeToolCallDelta(toolCalls, part) {
  const call = toolCalls[part.index] ?? {
    id: '',
    type: 'function',
    function: { name: '', arguments: '' },
  };
  if (part.id) call.id = part.id;
  if (part.type) call.type = part.type;
  if (part.function?.name) call.function.name = part.function.name;
  if (part.function?.arguments) call.function.arguments += part.function.arguments;
  toolCalls[part.index] = call;
  return call;
}

function parseEventLine(line) {
  const trimmed = line.trim();
  // Blank lines separate events; lines starting with ':' are comments (keep-alives).
  if (!trimmed.startsWith('data:')) return null;

  const data = trimmed.slice('data:'.length).trim();
  if (data === '[DONE]') return STREAM_DONE;

  const parsed = parseJsonSafely(data);
  if (!parsed) {
    throw new DeepSeekError(`DeepSeek sent a malformed stream chunk: ${data.slice(0, 200)}`);
  }
  return parsed;
}

/**
 * Parse a server-sent events body into JSON chunks. Stops at `data: [DONE]`.
 * @param {ReadableStream<Uint8Array>} body
 */
export async function* readServerSentEvents(body) {
  if (!body) throw new DeepSeekError('DeepSeek returned an empty stream');

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      // Keep a trailing partial line for the next read, unless the body has ended.
      buffer = done ? '' : lines.pop();

      for (const line of lines) {
        const event = parseEventLine(line);
        if (event === STREAM_DONE) return;
        if (event) yield event;
      }

      if (done) return;
    }
  } finally {
    // A no-op after a complete read. When the caller stopped early or a chunk
    // was malformed, cancelling closes the connection so DeepSeek stops
    // generating tokens nobody will read.
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class DeepSeekClient {
  /**
   * @param {Object} config
   * @param {string} config.apiKey
   * @param {string} [config.model]
   * @param {string} [config.baseURL]
   * @param {string} [config.betaBaseURL]
   * @param {typeof fetch} [config.fetch] - Injected by tests; defaults to global fetch.
   * @param {number} [config.idleTimeoutMs] - How long a stream may go without data.
   * @param {number} [config.responseTimeoutMs] - How long a non-streaming request may take.
   */
  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    baseURL = DEEPSEEK_BASE_URL,
    betaBaseURL = DEEPSEEK_BETA_BASE_URL,
    fetch: fetchImpl,
    idleTimeoutMs = STREAM_IDLE_TIMEOUT_MS,
    responseTimeoutMs = RESPONSE_TIMEOUT_MS,
  } = {}) {
    if (!apiKey || !apiKey.trim()) {
      throw new DeepSeekError('A DeepSeek API key is required');
    }
    this.apiKey = apiKey;
    this.model = model || DEFAULT_MODEL;
    this.baseURL = baseURL;
    this.betaBaseURL = betaBaseURL;
    this.fetch = fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.idleTimeoutMs = idleTimeoutMs;
    this.responseTimeoutMs = responseTimeoutMs;
  }

  /**
   * Build the URL and JSON body for a chat completion.
   *
   * @param {Object} options
   * @param {Array<Object>} options.messages - OpenAI-format messages.
   * @param {Array<{name: string, description?: string, parameters?: Object}>} [options.tools]
   * @param {boolean} [options.strict] - Strict tool schemas (sent to the beta base URL).
   * @param {'auto'|'none'|'required'|{name: string}} [options.toolChoice]
   * @param {boolean} [options.thinking]
   * @param {'low'|'high'|'max'} [options.reasoningEffort]
   * @param {number} [options.maxTokens]
   * @param {number} [options.temperature] - Only sent with thinking off; the API ignores it otherwise.
   * @param {'json'} [options.responseFormat]
   * @param {string[]} [options.stop]
   * @param {string} [options.model] - Overrides the client's model.
   * @param {boolean} stream
   * @returns {{ url: string, body: Object }}
   */
  buildRequest(options, stream) {
    const {
      messages,
      tools,
      strict = false,
      toolChoice,
      thinking = false,
      reasoningEffort = 'high',
      maxTokens,
      temperature,
      responseFormat,
      stop,
      model,
    } = options;

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new DeepSeekError('messages must be a non-empty array');
    }
    if (thinking && (toolChoice === 'required' || typeof toolChoice === 'object')) {
      throw new DeepSeekError('Thinking mode does not support required or named tool choices');
    }
    if (thinking && !REASONING_EFFORTS.includes(reasoningEffort)) {
      throw new DeepSeekError(`reasoningEffort must be one of: ${REASONING_EFFORTS.join(', ')}`);
    }

    const body = {
      model: model || this.model,
      messages,
      stream,
      thinking: { type: thinking ? 'enabled' : 'disabled' },
    };

    if (thinking) {
      body.reasoning_effort = reasoningEffort;
    } else if (temperature !== undefined && temperature !== null) {
      body.temperature = temperature;
    }

    const hasTools = Array.isArray(tools) && tools.length > 0;
    if (hasTools) {
      body.tools = tools.map((tool) => {
        const fn = { name: tool.name };
        if (tool.description) fn.description = tool.description;
        if (tool.parameters) fn.parameters = tool.parameters;
        if (strict) {
          assertStrictSchema(tool.parameters, `${tool.name}.parameters`);
          fn.strict = true;
        }
        return { type: 'function', function: fn };
      });
    }

    if (toolChoice !== undefined) {
      body.tool_choice =
        typeof toolChoice === 'object'
          ? { type: 'function', function: { name: toolChoice.name } }
          : toolChoice;
    }
    if (maxTokens) body.max_tokens = maxTokens;
    if (responseFormat === 'json') body.response_format = { type: 'json_object' };
    if (stop?.length) body.stop = stop;
    if (stream) body.stream_options = { include_usage: true };

    const base = strict && hasTools ? this.betaBaseURL : this.baseURL;
    return { url: `${base}/chat/completions`, body };
  }

  async post(url, body, signal) {
    let response;
    try {
      response = await this.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new DeepSeekError(`Could not reach DeepSeek: ${error.message}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const parsed = parseJsonSafely(text);
      const detail = parsed?.error?.message || text.trim() || response.statusText || 'no details';
      const hint = STATUS_HINTS[response.status];
      throw new DeepSeekError(
        `DeepSeek API error ${response.status}${hint ? ` (${hint})` : ''}: ${detail}`,
        { status: response.status, body: parsed ?? text },
      );
    }

    return response;
  }

  /**
   * Chat completion, returning the whole result at once.
   *
   * With `stream: true`, the request is streamed and assembled here instead. The
   * result is the same, but it times out only once DeepSeek goes quiet, so a
   * stalled request fails sooner and a long one still finishes.
   *
   * @param {Object} options - See buildRequest(), plus `signal` and `stream`.
   * @returns {Promise<ChatResult>}
   */
  async chat(options) {
    if (options.stream) {
      let done = null;
      for await (const event of this.chatStream(options)) {
        if (event.type === 'done') done = event;
      }
      const { type: _type, ...result } = done;
      return result;
    }

    const { url, body } = this.buildRequest(options, false);
    // Nothing arrives until the whole response is ready, so the timeout covers all of it.
    const timeout = createRequestTimeout(this.responseTimeoutMs, options.signal);

    let response;
    let text;
    try {
      response = await this.post(url, body, timeout.signal);
      text = await response.text();
    } catch (error) {
      if (!timeout.timedOut) throw error;
      throw new DeepSeekError(
        `DeepSeek did not respond within ${formatTimeout(this.responseTimeoutMs)}`,
        { timedOut: true },
      );
    } finally {
      timeout.clear();
    }

    const data = parseJsonSafely(text.trim());
    if (!data) {
      throw new DeepSeekError('DeepSeek returned a response that was not valid JSON', {
        status: response.status,
        body: text,
      });
    }

    const choice = data.choices?.[0];
    if (!choice) {
      throw new DeepSeekError('DeepSeek returned no choices', {
        status: response.status,
        body: data,
      });
    }

    return {
      content: choice.message?.content ?? '',
      reasoning: choice.message?.reasoning_content ?? '',
      toolCalls: choice.message?.tool_calls ?? [],
      finishReason: choice.finish_reason ?? null,
      usage: data.usage ?? null,
      model: data.model ?? body.model,
    };
  }

  /**
   * Streaming chat completion.
   *
   * Yields `{ type: 'reasoning', text }`, `{ type: 'content', text }`, and
   * `{ type: 'tool_call', index, id, name, argumentsDelta }` as deltas arrive,
   * then one `{ type: 'done', ...ChatResult }` with everything assembled.
   *
   * @param {Object} options - See buildRequest(), plus `signal`.
   */
  async *chatStream(options) {
    // Keep-alive comments don't reset it: a stalled request can send them for a long time.
    const timeout = createRequestTimeout(this.idleTimeoutMs, options.signal);
    try {
      yield* this.streamEvents(options, timeout);
    } catch (error) {
      if (!timeout.timedOut) throw error;
      throw new DeepSeekError(
        `DeepSeek stopped responding: nothing arrived for ${formatTimeout(this.idleTimeoutMs)}`,
        { timedOut: true },
      );
    } finally {
      timeout.clear();
    }
  }

  /** The body of chatStream(), resetting its timeout as each chunk arrives. */
  async *streamEvents(options, timeout) {
    const { url, body } = this.buildRequest(options, true);
    const response = await this.post(url, body, timeout.signal);

    let content = '';
    let reasoning = '';
    let finishReason = null;
    let usage = null;
    let model = body.model;
    const toolCalls = [];

    for await (const chunk of readServerSentEvents(response.body)) {
      timeout.reset();
      if (chunk.usage) usage = chunk.usage;
      if (chunk.model) model = chunk.model;

      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};

      if (delta.reasoning_content) {
        reasoning += delta.reasoning_content;
        yield { type: 'reasoning', text: delta.reasoning_content };
      }
      if (delta.content) {
        content += delta.content;
        yield { type: 'content', text: delta.content };
      }
      for (const part of delta.tool_calls ?? []) {
        const call = mergeToolCallDelta(toolCalls, part);
        yield {
          type: 'tool_call',
          index: part.index,
          id: call.id,
          name: call.function.name,
          argumentsDelta: part.function?.arguments ?? '',
        };
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    yield {
      type: 'done',
      content,
      reasoning,
      toolCalls: toolCalls.filter(Boolean),
      finishReason,
      usage,
      model,
    };
  }
}
