import { describe, it, expect, vi } from 'vitest';
import { runToolLoop, ToolLoopError } from '../tool-loop.js';

const MESSAGES = [
  { role: 'system', content: 'You are the Director.' },
  { role: 'user', content: 'What does Mara remember about the lighthouse?' },
];

const TOOLS = [
  {
    name: 'recall',
    description: "Search a character's memories.",
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

function modelTurn({ content = '', reasoning = '', toolCalls = [] } = {}) {
  return {
    content,
    reasoning,
    toolCalls,
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    model: 'deepseek-flash',
  };
}

function toolCall(id, name, args) {
  return {
    id,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  };
}

/** A client whose chat() answers with each turn in order. */
function fakeClient(...turns) {
  const chat = vi.fn();
  for (const turn of turns) chat.mockResolvedValueOnce(turn);
  return { model: 'deepseek-flash', chat };
}

function fakeRecorder() {
  const steps = [];
  return { steps, recordStep: (step) => steps.push(step) };
}

describe('runToolLoop', () => {
  it('returns the answer when the model needs no tools', async () => {
    const client = fakeClient(modelTurn({ content: 'She remembers the blue door.' }));

    const result = await runToolLoop({
      client,
      role: 'director',
      messages: MESSAGES,
      tools: TOOLS,
      handlers: {},
    });

    expect(result).toMatchObject({
      content: 'She remembers the blue door.',
      iterations: 1,
      finishReason: 'stop',
    });
    expect(client.chat).toHaveBeenCalledTimes(1);
  });

  it('runs requested tools and sends the results back with the reasoning', async () => {
    const recall = vi.fn(async ({ query }) => ({ memories: [`Found ${query}`] }));
    const client = fakeClient(
      modelTurn({
        reasoning: 'I should check her memories.',
        toolCalls: [toolCall('call_1', 'recall', { query: 'lighthouse' })],
      }),
      modelTurn({ content: 'She repainted the door.', reasoning: 'Now I can answer.' }),
    );

    const result = await runToolLoop({
      client,
      role: 'director',
      messages: MESSAGES,
      tools: TOOLS,
      handlers: { recall },
      options: { thinking: true, strict: true },
    });

    expect(recall).toHaveBeenCalledWith({ query: 'lighthouse' }, { signal: undefined });
    const secondRequest = client.chat.mock.calls[1][0];
    expect(secondRequest).toMatchObject({ thinking: true, strict: true, tools: TOOLS });
    expect(secondRequest.messages.slice(MESSAGES.length)).toEqual([
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'I should check her memories.',
        tool_calls: [toolCall('call_1', 'recall', { query: 'lighthouse' })],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"memories":["Found lighthouse"]}' },
    ]);
    expect(result).toMatchObject({ content: 'She repainted the door.', iterations: 2 });
    expect(result.messages.at(-1)).toEqual({
      role: 'assistant',
      content: 'She repainted the door.',
      reasoning_content: 'Now I can answer.',
    });
  });

  it('passes string results through unchanged', async () => {
    const client = fakeClient(
      modelTurn({ toolCalls: [toolCall('call_1', 'recall', { query: 'x' })] }),
      modelTurn({ content: 'Done.' }),
    );

    await runToolLoop({
      client,
      role: 'director',
      messages: MESSAGES,
      tools: TOOLS,
      handlers: { recall: () => 'plain text' },
    });

    expect(client.chat.mock.calls[1][0].messages.at(-1).content).toBe('plain text');
  });

  it.each([
    [
      'an unknown tool',
      toolCall('call_1', 'forget', { query: 'x' }),
      { recall: () => 'unused' },
      'Unknown tool: forget',
    ],
    [
      'arguments that are not JSON',
      toolCall('call_1', 'recall', '{"query":'),
      { recall: () => 'unused' },
      'Arguments for recall were not valid JSON',
    ],
    [
      'a tool that throws',
      toolCall('call_1', 'recall', { query: 'x' }),
      {
        recall: () => {
          throw new Error('Index offline');
        },
      },
      'Index offline',
    ],
  ])('reports %s back to the model and keeps going', async (_label, call, handlers, message) => {
    const client = fakeClient(
      modelTurn({ toolCalls: [call] }),
      modelTurn({ content: 'Recovered.' }),
    );
    const recorder = fakeRecorder();

    const result = await runToolLoop({
      client,
      role: 'director',
      messages: MESSAGES,
      tools: TOOLS,
      handlers,
      recorder,
    });

    expect(result.content).toBe('Recovered.');
    expect(client.chat.mock.calls[1][0].messages.at(-1)).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: JSON.stringify({ error: message }),
    });
    expect(recorder.steps[1]).toMatchObject({ kind: 'tool', error: message });
  });

  it('stops instead of reporting a tool error when the run is cancelled', async () => {
    const controller = new AbortController();
    const client = fakeClient(
      modelTurn({ toolCalls: [toolCall('call_1', 'recall', { query: 'x' })] }),
    );
    const recall = async () => {
      controller.abort();
      throw new Error('Aborted mid-tool');
    };

    await expect(
      runToolLoop({
        client,
        role: 'director',
        messages: MESSAGES,
        tools: TOOLS,
        handlers: { recall },
        signal: controller.signal,
      }),
    ).rejects.toThrow('Aborted mid-tool');
    expect(client.chat).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxIterations model calls', async () => {
    const endless = modelTurn({ toolCalls: [toolCall('call_1', 'recall', { query: 'again' })] });
    const client = { model: 'deepseek-flash', chat: vi.fn(async () => endless) };

    const error = await runToolLoop({
      client,
      role: 'director',
      messages: MESSAGES,
      tools: TOOLS,
      handlers: { recall: () => 'more' },
      maxIterations: 3,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(ToolLoopError);
    expect(client.chat).toHaveBeenCalledTimes(3);
    expect(error.messages.filter((message) => message.role === 'tool')).toHaveLength(3);
  });

  it('records the prompt once, then only the messages added since', async () => {
    const client = fakeClient(
      modelTurn({
        reasoning: 'Check first.',
        toolCalls: [toolCall('call_1', 'recall', { query: 'x' })],
      }),
      modelTurn({ content: 'Answer.' }),
    );
    const recorder = fakeRecorder();

    await runToolLoop({
      client,
      role: 'director',
      messages: MESSAGES,
      tools: TOOLS,
      handlers: { recall: () => 'found' },
      recorder,
      options: { thinking: true },
    });

    const [firstCall, toolRun, secondCall] = recorder.steps;
    expect(firstCall).toMatchObject({
      role: 'director',
      kind: 'model',
      request: {
        model: 'deepseek-flash',
        thinking: true,
        messageOffset: 0,
        messages: MESSAGES,
        tools: TOOLS,
      },
      reasoning: 'Check first.',
      usage: { prompt_tokens: 10 },
    });
    expect(toolRun).toMatchObject({
      role: 'director',
      kind: 'tool',
      request: { id: 'call_1', name: 'recall', arguments: '{"query":"x"}' },
      response: 'found',
      error: null,
    });
    expect(secondCall.request.messageOffset).toBe(MESSAGES.length);
    expect(secondCall.request.messages.map((message) => message.role)).toEqual([
      'assistant',
      'tool',
    ]);
    expect(secondCall.request).not.toHaveProperty('tools');
    expect(secondCall.response).toEqual({
      content: 'Answer.',
      finishReason: 'stop',
      model: 'deepseek-flash',
    });
  });

  it('records a failed model call and rethrows', async () => {
    const failure = new Error('DeepSeek API error 503');
    const client = { model: 'deepseek-flash', chat: vi.fn().mockRejectedValue(failure) };
    const recorder = fakeRecorder();

    await expect(
      runToolLoop({
        client,
        role: 'director',
        messages: MESSAGES,
        tools: TOOLS,
        handlers: {},
        recorder,
      }),
    ).rejects.toBe(failure);
    expect(recorder.steps).toEqual([
      expect.objectContaining({ kind: 'model', error: 'DeepSeek API error 503' }),
    ]);
  });

  it('does not change the messages it was given', async () => {
    const messages = [...MESSAGES];
    const client = fakeClient(
      modelTurn({ toolCalls: [toolCall('call_1', 'recall', { query: 'x' })] }),
      modelTurn({ content: 'Done.' }),
    );

    await runToolLoop({
      client,
      role: 'director',
      messages,
      tools: TOOLS,
      handlers: { recall: () => 'found' },
    });

    expect(messages).toEqual(MESSAGES);
  });
});
