import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bureausAPI, bureauStoriesAPI } from '../bureauApi.js';

/** A fetch response whose body delivers each string as its own chunk. */
function streamResponse(pieces) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return { ok: true, status: 200, body };
}

function sse(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function collect(iterable) {
  const events = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe('bureauApi', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends JSON and returns the parsed body', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ bureau: { id: 'b1' } }) });

    const result = await bureausAPI.update('b1', { name: 'Harbor' });

    expect(result).toEqual({ bureau: { id: 'b1' } });
    expect(fetch).toHaveBeenCalledWith('/api/bureaus/b1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Harbor' }),
      signal: undefined,
    });
  });

  it('throws errors carrying the status and extra fields', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: async () => ({ error: 'Already in the cast', castMemberId: 'cast-1' }),
    });

    const error = await bureausAPI.addCast('b1', 'char-1').catch((caught) => caught);

    expect(error.message).toBe('Already in the cast');
    expect(error.status).toBe(409);
    expect(error.castMemberId).toBe('cast-1');
  });

  it('streams generation events until done, across split chunks', async () => {
    const content = sse({ type: 'content', text: 'The lamp was lit.' });
    fetch.mockResolvedValue(
      streamResponse([
        sse({ type: 'run', runId: 'run-1' }),
        content.slice(0, 10),
        content.slice(10),
        sse({ type: 'done', turn: { id: 't1' } }),
        sse({ type: 'content', text: 'ignored after done' }),
      ]),
    );

    const events = await collect(bureauStoriesAPI.generate('b1', 's1', { action: 'continue' }));

    expect(events).toEqual([
      { type: 'run', runId: 'run-1' },
      { type: 'content', text: 'The lamp was lit.' },
      { type: 'done', turn: { id: 't1' } },
    ]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/bureaus/b1/stories/s1/generate');
    expect(init.headers.Accept).toBe('text/event-stream');
  });

  it('throws when the stream reports an error', async () => {
    fetch.mockResolvedValue(
      streamResponse([
        sse({ type: 'run', runId: 'run-1' }),
        sse({ type: 'error', error: 'DeepSeek API error 402' }),
      ]),
    );

    await expect(collect(bureauStoriesAPI.regenerate('b1', 's1', 't1'))).rejects.toThrow(
      'DeepSeek API error 402',
    );
  });

  it('throws when the server refuses to start a stream', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ error: 'This Bureau has no API key.' }),
    });

    const error = await collect(
      bureauStoriesAPI.generate('b1', 's1', { action: 'continue' }),
    ).catch((caught) => caught);

    expect(error).toMatchObject({ message: 'This Bureau has no API key.', status: 400 });
  });
});
