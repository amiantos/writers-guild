import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chatsAPI } from '../chatsApi.js';

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

describe('chatsApi', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends JSON and returns the parsed body', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ chat: { id: 'c1' } }) });

    const result = await chatsAPI.update('c1', { scenario: 'Midnight.' });

    expect(result).toEqual({ chat: { id: 'c1' } });
    expect(fetch).toHaveBeenCalledWith('/api/chats/c1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'Midnight.' }),
    });
  });

  it('throws the server’s error with its status', async () => {
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: 'Chat not found' }),
    });

    await expect(chatsAPI.get('missing')).rejects.toMatchObject({
      message: 'Chat not found',
      status: 404,
    });
  });

  it('addresses messages by turn and index', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    await chatsAPI.setSwipe('c1', 't1', 2);
    await chatsAPI.editMessage('c1', 't1', 0, 'hey');
    await chatsAPI.deleteMessage('c1', 't1', 1);

    expect(fetch.mock.calls.map(([url, init]) => [init.method, url])).toEqual([
      ['PUT', '/api/chats/c1/turns/t1/swipe'],
      ['PUT', '/api/chats/c1/turns/t1/messages/0'],
      ['DELETE', '/api/chats/c1/turns/t1/messages/1'],
    ]);
  });

  it('streams a reply’s events, split across chunks, and stops after done', async () => {
    const payload =
      sse({ type: 'content', text: 'hey' }) + sse({ type: 'done', turn: { id: 't2' } });
    fetch.mockResolvedValue(
      streamResponse([
        sse({ type: 'turn', turn: { id: 't1' } }),
        payload.slice(0, 10),
        payload.slice(10),
        sse({ type: 'content', text: 'never read' }),
      ]),
    );

    const events = await collect(chatsAPI.send('c1', 'you up?', { characterId: 'layla' }));

    expect(events.map((event) => event.type)).toEqual(['turn', 'content', 'done']);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/chats/c1/messages');
    expect(init.headers.Accept).toBe('text/event-stream');
    expect(JSON.parse(init.body)).toEqual({ text: 'you up?', characterId: 'layla' });
  });

  it('reads events whose lines end in CRLF or CR, even with a CRLF split across chunks', async () => {
    const crlf = `data: ${JSON.stringify({ type: 'content', text: 'hey' })}\r\n\r\n`;
    fetch.mockResolvedValue(
      streamResponse([
        crlf.slice(0, crlf.indexOf('\r') + 1),
        crlf.slice(crlf.indexOf('\r') + 1),
        `data:${JSON.stringify({ type: 'content', text: 'you' })}\r\r`,
        sse({ type: 'done', turn: { id: 't1' } }),
      ]),
    );

    const events = await collect(chatsAPI.reply('c1'));

    expect(events.map((event) => event.text ?? event.type)).toEqual(['hey', 'you', 'done']);
  });

  it('throws when the stream ends before done', async () => {
    fetch.mockResolvedValue(streamResponse([sse({ type: 'content', text: 'hey' })]));

    await expect(collect(chatsAPI.reply('c1'))).rejects.toThrow(
      'The connection closed before the reply finished',
    );
  });

  it('throws when the stream reports an error', async () => {
    fetch.mockResolvedValue(
      streamResponse([
        sse({ type: 'content', text: 'he' }),
        sse({ type: 'error', error: 'Rate limited' }),
      ]),
    );

    await expect(collect(chatsAPI.regenerate('c1', 't1'))).rejects.toThrow('Rate limited');
  });
});
