import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DeepSeekClient,
  DeepSeekError,
  DEFAULT_MODEL,
  assertStrictSchema,
} from '../deepseek-client.js';

const MESSAGES = [{ role: 'user', content: 'Hello' }];

const RECALL_TOOL = {
  name: 'recall',
  description: "Search a character's memories.",
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
    additionalProperties: false,
  },
};

const COMPLETION = {
  model: 'deepseek-flash',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Hi there.', reasoning_content: 'Greet back.' },
    },
  ],
  usage: {
    prompt_tokens: 5,
    completion_tokens: 3,
    prompt_cache_hit_tokens: 0,
    prompt_cache_miss_tokens: 5,
  },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A streaming response delivering each string as its own network chunk. */
function sseResponse(pieces) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function delta(fields, finishReason = null, extra = {}) {
  const chunk = { choices: [{ index: 0, delta: fields, finish_reason: finishReason }], ...extra };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

async function collect(iterable) {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
}

/** A request that never gets a response, failing only when aborted, as real fetch does. */
function silentFetch() {
  return vi.fn(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  );
}

/**
 * A request whose streamed body sends `next()` every `every` ms, closing when
 * it returns null. Aborting fails the body, as real fetch does.
 */
function streamingFetch(next, every) {
  return vi.fn(async (_url, { signal }) => {
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      },
      async pull(controller) {
        await new Promise((resolve) => setTimeout(resolve, every));
        if (signal.aborted) return;
        const piece = next();
        if (piece === null) controller.close();
        else controller.enqueue(encoder.encode(piece));
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
  });
}

describe('DeepSeekClient', () => {
  let fetchMock;
  let client;

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse(COMPLETION));
    client = new DeepSeekClient({ apiKey: 'sk-test', fetch: fetchMock });
  });

  function sentRequest() {
    const [url, init] = fetchMock.mock.calls.at(-1);
    return { url, init, body: JSON.parse(init.body) };
  }

  describe('configuration', () => {
    it('requires an API key', () => {
      expect(() => new DeepSeekClient({ apiKey: '  ' })).toThrow(DeepSeekError);
    });

    it('defaults to V4.1 Flash', () => {
      expect(DEFAULT_MODEL).toBe('deepseek-flash');
      expect(client.model).toBe(DEFAULT_MODEL);
    });
  });

  describe('requests', () => {
    it('turns thinking off explicitly and sends temperature', async () => {
      await client.chat({ messages: MESSAGES, temperature: 1.2 });

      const { url, init, body } = sentRequest();
      expect(url).toBe('https://api.deepseek.com/chat/completions');
      expect(init.headers.Authorization).toBe('Bearer sk-test');
      expect(body).toMatchObject({
        model: 'deepseek-flash',
        messages: MESSAGES,
        stream: false,
        thinking: { type: 'disabled' },
        temperature: 1.2,
      });
      expect(body).not.toHaveProperty('reasoning_effort');
    });

    it('sends reasoning_effort at the top level when thinking, without temperature', async () => {
      await client.chat({
        messages: MESSAGES,
        thinking: true,
        reasoningEffort: 'max',
        temperature: 1.2,
      });

      const { body } = sentRequest();
      expect(body.thinking).toEqual({ type: 'enabled' });
      expect(body.reasoning_effort).toBe('max');
      expect(body).not.toHaveProperty('temperature');
    });

    it('rejects tool choices thinking mode does not support, before calling the API', async () => {
      await expect(
        client.chat({
          messages: MESSAGES,
          thinking: true,
          tools: [RECALL_TOOL],
          toolChoice: 'required',
        }),
      ).rejects.toThrow(/Thinking mode does not support/);
      await expect(
        client.chat({
          messages: MESSAGES,
          thinking: true,
          tools: [RECALL_TOOL],
          toolChoice: { name: 'recall' },
        }),
      ).rejects.toThrow(DeepSeekError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects an unknown reasoning effort', async () => {
      await expect(
        client.chat({ messages: MESSAGES, thinking: true, reasoningEffort: 'medium' }),
      ).rejects.toThrow(/reasoningEffort/);
    });

    it('requires messages', async () => {
      await expect(client.chat({ messages: [] })).rejects.toThrow(/messages/);
    });

    it('wraps tools as functions and maps a named tool choice', async () => {
      await client.chat({
        messages: MESSAGES,
        tools: [RECALL_TOOL],
        toolChoice: { name: 'recall' },
      });

      const { url, body } = sentRequest();
      expect(url).toBe('https://api.deepseek.com/chat/completions');
      expect(body.tools).toEqual([
        {
          type: 'function',
          function: {
            name: 'recall',
            description: RECALL_TOOL.description,
            parameters: RECALL_TOOL.parameters,
          },
        },
      ]);
      expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'recall' } });
    });

    it('sends strict tools to the beta base URL', async () => {
      await client.chat({ messages: MESSAGES, tools: [RECALL_TOOL], strict: true });

      const { url, body } = sentRequest();
      expect(url).toBe('https://api.deepseek.com/beta/chat/completions');
      expect(body.tools[0].function.strict).toBe(true);
    });

    it('checks strict schemas before calling the API', async () => {
      const loose = {
        ...RECALL_TOOL,
        parameters: { ...RECALL_TOOL.parameters, additionalProperties: true },
      };

      await expect(
        client.chat({ messages: MESSAGES, tools: [loose], strict: true }),
      ).rejects.toThrow(/recall\.parameters/);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('asks for JSON output', async () => {
      await client.chat({
        messages: MESSAGES,
        responseFormat: 'json',
        maxTokens: 500,
        stop: ['END'],
      });

      expect(sentRequest().body).toMatchObject({
        response_format: { type: 'json_object' },
        max_tokens: 500,
        stop: ['END'],
      });
    });

    it('passes cancellation through to fetch', async () => {
      const controller = new AbortController();
      await client.chat({ messages: MESSAGES, signal: controller.signal });

      const { signal } = sentRequest().init;
      expect(signal.aborted).toBe(false);
      controller.abort();
      expect(signal.aborted).toBe(true);
    });
  });

  describe('timeouts', () => {
    it('fails a request that gets no response in time', async () => {
      client = new DeepSeekClient({
        apiKey: 'sk-test',
        fetch: silentFetch(),
        responseTimeoutMs: 20,
      });

      const error = await client.chat({ messages: MESSAGES }).catch((caught) => caught);

      expect(error).toBeInstanceOf(DeepSeekError);
      expect(error.timedOut).toBe(true);
      expect(error.message).toMatch(/^DeepSeek did not respond within/);
    });

    it('times out a streamed chat() once it goes quiet, not after the response timeout', async () => {
      client = new DeepSeekClient({
        apiKey: 'sk-test',
        fetch: streamingFetch(() => ': keep-alive\n\n', 5),
        idleTimeoutMs: 50,
        responseTimeoutMs: 60_000,
      });

      const error = await client
        .chat({ messages: MESSAGES, stream: true })
        .catch((caught) => caught);

      expect(error).toMatchObject({ name: 'DeepSeekError', timedOut: true });
      expect(error.message).toMatch(/^DeepSeek stopped responding/);
    });

    it('fails a response whose body never finishes arriving', async () => {
      client = new DeepSeekClient({
        apiKey: 'sk-test',
        fetch: streamingFetch(() => '\n', 5),
        responseTimeoutMs: 50,
      });

      const error = await client.chat({ messages: MESSAGES }).catch((caught) => caught);

      expect(error).toMatchObject({ name: 'DeepSeekError', timedOut: true });
      expect(error.message).toMatch(/^DeepSeek did not respond within/);
    });

    it('fails a stream whose events carry no text, reasoning, or tool calls', async () => {
      client = new DeepSeekClient({
        apiKey: 'sk-test',
        fetch: streamingFetch(() => delta({}), 5),
        idleTimeoutMs: 50,
      });

      await expect(collect(client.chatStream({ messages: MESSAGES }))).rejects.toMatchObject({
        name: 'DeepSeekError',
        timedOut: true,
      });
    });

    it('fails a stream that sends only keep-alive comments', async () => {
      client = new DeepSeekClient({
        apiKey: 'sk-test',
        fetch: streamingFetch(() => ': keep-alive\n\n', 5),
        idleTimeoutMs: 50,
      });

      const error = await collect(client.chatStream({ messages: MESSAGES })).catch(
        (caught) => caught,
      );

      expect(error).toBeInstanceOf(DeepSeekError);
      expect(error.message).toMatch(/^DeepSeek stopped responding: nothing arrived for/);
    });

    it('fails a stream that never starts', async () => {
      client = new DeepSeekClient({ apiKey: 'sk-test', fetch: silentFetch(), idleTimeoutMs: 20 });

      await expect(collect(client.chatStream({ messages: MESSAGES }))).rejects.toThrow(
        /^DeepSeek stopped responding/,
      );
    });

    it('keeps a slow stream going as long as data keeps arriving', async () => {
      const pieces = [...'ABCDEFGHIJ'].map((text) => delta({ content: text }));
      client = new DeepSeekClient({
        apiKey: 'sk-test',
        fetch: streamingFetch(() => pieces.shift() ?? null, 20),
        idleTimeoutMs: 150,
      });

      const events = await collect(client.chatStream({ messages: MESSAGES }));

      expect(events.at(-1).content).toBe('ABCDEFGHIJ');
    });

    it('leaves a cancellation as an AbortError', async () => {
      client = new DeepSeekClient({
        apiKey: 'sk-test',
        fetch: streamingFetch(() => ': keep-alive\n\n', 5),
        idleTimeoutMs: 5000,
      });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 20);

      await expect(
        collect(client.chatStream({ messages: MESSAGES, signal: controller.signal })),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  describe('chat', () => {
    it('returns content, reasoning, usage, and the finish reason', async () => {
      await expect(client.chat({ messages: MESSAGES })).resolves.toEqual({
        content: 'Hi there.',
        reasoning: 'Greet back.',
        toolCalls: [],
        finishReason: 'stop',
        usage: COMPLETION.usage,
        model: 'deepseek-flash',
      });
    });

    it('returns tool calls', async () => {
      const toolCalls = [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'recall', arguments: '{"query":"lighthouse"}' },
        },
      ];
      fetchMock.mockResolvedValue(
        jsonResponse({
          choices: [
            { finish_reason: 'tool_calls', message: { content: null, tool_calls: toolCalls } },
          ],
        }),
      );

      await expect(
        client.chat({ messages: MESSAGES, tools: [RECALL_TOOL] }),
      ).resolves.toMatchObject({
        content: '',
        reasoning: '',
        toolCalls,
        finishReason: 'tool_calls',
      });
    });

    it('can stream the request and still return the whole result', async () => {
      fetchMock.mockResolvedValue(
        sseResponse([
          delta({ reasoning_content: 'Look it up.' }),
          delta({
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'recall', arguments: '{"query":"lighthouse"}' },
              },
            ],
          }),
          delta({}, 'tool_calls', { usage: { prompt_tokens: 9, completion_tokens: 4 } }),
          'data: [DONE]\n\n',
        ]),
      );

      const result = await client.chat({ messages: MESSAGES, tools: [RECALL_TOOL], stream: true });

      expect(sentRequest().body.stream).toBe(true);
      expect(result).toEqual({
        content: '',
        reasoning: 'Look it up.',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'recall', arguments: '{"query":"lighthouse"}' },
          },
        ],
        finishReason: 'tool_calls',
        usage: { prompt_tokens: 9, completion_tokens: 4 },
        model: 'deepseek-flash',
      });
    });

    it('ignores keep-alive blank lines before the JSON body', async () => {
      fetchMock.mockResolvedValue(new Response(`\n\n\n${JSON.stringify(COMPLETION)}`));

      expect((await client.chat({ messages: MESSAGES })).content).toBe('Hi there.');
    });

    it('explains API errors with the status and message', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: { message: 'Authentication Fails' } }, 401),
      );

      const error = await client.chat({ messages: MESSAGES }).catch((caught) => caught);

      expect(error).toBeInstanceOf(DeepSeekError);
      expect(error.status).toBe(401);
      expect(error.message).toContain('check the API key');
      expect(error.message).toContain('Authentication Fails');
    });

    it('wraps network failures', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      await expect(client.chat({ messages: MESSAGES })).rejects.toThrow(
        /Could not reach DeepSeek: fetch failed/,
      );
    });

    it('lets aborts through unwrapped', async () => {
      const abort = new Error('The operation was aborted');
      abort.name = 'AbortError';
      fetchMock.mockRejectedValue(abort);

      await expect(client.chat({ messages: MESSAGES })).rejects.toBe(abort);
    });

    it('rejects a body that is not JSON', async () => {
      fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>'));

      await expect(client.chat({ messages: MESSAGES })).rejects.toThrow(/not valid JSON/);
    });
  });

  describe('chatStream', () => {
    it('asks for usage in the stream', async () => {
      fetchMock.mockResolvedValue(
        sseResponse([delta({ content: 'Hi' }, 'stop'), 'data: [DONE]\n\n']),
      );

      await collect(client.chatStream({ messages: MESSAGES }));

      expect(sentRequest().body).toMatchObject({
        stream: true,
        stream_options: { include_usage: true },
      });
    });

    it('yields reasoning and content as they arrive, then the assembled result', async () => {
      fetchMock.mockResolvedValue(
        sseResponse([
          delta({ reasoning_content: 'Think' }),
          delta({ reasoning_content: 'ing.' }),
          ': keep-alive\n\n',
          delta({ content: 'Hel' }),
          delta({ content: 'lo' }, 'stop', { usage: { prompt_tokens: 4, completion_tokens: 2 } }),
          'data: [DONE]\n\n',
          delta({ content: 'after done' }),
        ]),
      );

      const events = await collect(client.chatStream({ messages: MESSAGES, thinking: true }));

      expect(events.map((event) => event.type)).toEqual([
        'reasoning',
        'reasoning',
        'content',
        'content',
        'done',
      ]);
      expect(events.at(-1)).toEqual({
        type: 'done',
        content: 'Hello',
        reasoning: 'Thinking.',
        toolCalls: [],
        finishReason: 'stop',
        usage: { prompt_tokens: 4, completion_tokens: 2 },
        model: 'deepseek-flash',
      });
    });

    it('assembles tool calls from fragments, even when a network chunk splits a line', async () => {
      const argumentsStart = delta({
        tool_calls: [{ index: 0, function: { arguments: '{"query":' } }],
      });
      const cut = Math.floor(argumentsStart.length / 2);
      fetchMock.mockResolvedValue(
        sseResponse([
          delta({
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'recall', arguments: '' },
              },
            ],
          }),
          argumentsStart.slice(0, cut),
          argumentsStart.slice(cut),
          delta({ tool_calls: [{ index: 0, function: { arguments: '"lighthouse"}' } }] }),
          delta({
            tool_calls: [
              {
                index: 1,
                id: 'call_2',
                type: 'function',
                function: { name: 'lookup_lore', arguments: '{"query":"harbor"}' },
              },
            ],
          }),
          delta({ content: '' }, 'tool_calls'),
          'data: [DONE]\n\n',
        ]),
      );

      const events = await collect(client.chatStream({ messages: MESSAGES, tools: [RECALL_TOOL] }));

      expect(
        events.filter((event) => event.type === 'tool_call').map((event) => event.argumentsDelta),
      ).toEqual(['', '{"query":', '"lighthouse"}', '{"query":"harbor"}']);
      const done = events.at(-1);
      expect(done.finishReason).toBe('tool_calls');
      expect(done.toolCalls).toEqual([
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'recall', arguments: '{"query":"lighthouse"}' },
        },
        {
          id: 'call_2',
          type: 'function',
          function: { name: 'lookup_lore', arguments: '{"query":"harbor"}' },
        },
      ]);
    });

    it('fails on a malformed chunk', async () => {
      fetchMock.mockResolvedValue(sseResponse(['data: {not json}\n\n']));

      await expect(collect(client.chatStream({ messages: MESSAGES }))).rejects.toThrow(
        /malformed stream chunk/,
      );
    });

    it('cancels the response body when the caller stops reading early', async () => {
      const cancel = vi.fn();
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(delta({ content: 'first' })));
          controller.enqueue(encoder.encode(delta({ content: 'second' })));
          // Never closed: without a cancel, the connection would stay open.
        },
        cancel,
      });
      fetchMock.mockResolvedValue(new Response(body));

      for await (const event of client.chatStream({ messages: MESSAGES })) {
        if (event.type === 'content') break;
      }

      expect(cancel).toHaveBeenCalled();
    });

    it('reports API errors before streaming starts', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: { message: 'Insufficient Balance' } }, 402),
      );

      await expect(collect(client.chatStream({ messages: MESSAGES }))).rejects.toMatchObject({
        name: 'DeepSeekError',
        status: 402,
      });
    });
  });
});

describe('assertStrictSchema', () => {
  it('accepts a schema that follows the strict rules', () => {
    expect(() => assertStrictSchema(RECALL_TOOL.parameters)).not.toThrow();
  });

  it('requires additionalProperties: false on nested objects too', () => {
    const schema = {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          properties: { tag: { type: 'string' } },
          required: ['tag'],
        },
      },
      required: ['filter'],
      additionalProperties: false,
    };

    expect(() => assertStrictSchema(schema)).toThrow(
      /additionalProperties: false \(at parameters\.filter\)/,
    );
  });

  it('requires every property to be required', () => {
    const schema = {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer' } },
      required: ['query'],
      additionalProperties: false,
    };

    expect(() => assertStrictSchema(schema)).toThrow(/not required: limit/);
  });

  it('rejects keywords strict mode does not support', () => {
    const schema = {
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string', minLength: 1 } } },
      required: ['tags'],
      additionalProperties: false,
    };

    expect(() => assertStrictSchema(schema)).toThrow(/"minLength" \(at parameters\.tags\.items\)/);
  });
});
