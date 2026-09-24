/**
 * Chats API Client
 *
 * Requests for chat mode, an experimental feature turned on in Settings.
 * Replies stream as server-sent events; the server saves them itself.
 */

const baseURL = '/api/chats';

function errorFromBody(body, response) {
  const error = new Error(body.error || `Request failed: ${response.statusText}`);
  error.status = response.status;
  return error;
}

async function failedResponse(response) {
  const body = await response.json().catch(() => ({ error: response.statusText }));
  return errorFromBody(body, response);
}

async function request(path, { method = 'GET', body } = {}) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseURL}${path}`, init);
  if (!response.ok) {
    throw await failedResponse(response);
  }
  return response.json();
}

/**
 * POST a request that answers with server-sent events. Yields each event,
 * throws when the server sends an `error` event, and stops after `done`.
 */
export async function* streamEvents(path, body, signal) {
  const response = await fetch(`${baseURL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  if (!response.ok) {
    throw await failedResponse(response);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const event = JSON.parse(line.slice('data: '.length));
        if (event.type === 'error') {
          throw new Error(event.error || 'The reply failed');
        }
        yield event;
        if (event.type === 'done') return;
      }

      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export const chatsAPI = {
  list() {
    return request('');
  },

  get(chatId) {
    return request(`/${chatId}`);
  },

  /**
   * @param {{ title?: string, scenario?: string, characterIds: string[],
   *   personaCharacterId?: string|null, lorebookIds?: string[], configPresetId?: string|null }} fields
   */
  create(fields) {
    return request('', { method: 'POST', body: fields });
  },

  update(chatId, fields) {
    return request(`/${chatId}`, { method: 'PUT', body: fields });
  },

  delete(chatId) {
    return request(`/${chatId}`, { method: 'DELETE' });
  },

  /** Send a message; a character replies. characterId picks who, otherwise it's chosen. */
  send(chatId, text, { characterId = null, signal } = {}) {
    return streamEvents(`/${chatId}/messages`, { text, characterId }, signal);
  },

  /** Have a character write without a new message. */
  reply(chatId, { characterId = null, signal } = {}) {
    return streamEvents(`/${chatId}/reply`, { characterId }, signal);
  },

  /** Write another version of the last reply. */
  regenerate(chatId, turnId, { signal } = {}) {
    return streamEvents(`/${chatId}/turns/${turnId}/regenerate`, {}, signal);
  },

  /** Delete every message, keeping the chat's setup. */
  clear(chatId) {
    return request(`/${chatId}/turns`, { method: 'DELETE' });
  },

  setSwipe(chatId, turnId, index) {
    return request(`/${chatId}/turns/${turnId}/swipe`, { method: 'PUT', body: { index } });
  },

  editMessage(chatId, turnId, index, content) {
    return request(`/${chatId}/turns/${turnId}/messages/${index}`, {
      method: 'PUT',
      body: { content },
    });
  },

  deleteMessage(chatId, turnId, index) {
    return request(`/${chatId}/turns/${turnId}/messages/${index}`, { method: 'DELETE' });
  },
};
