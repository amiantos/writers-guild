/**
 * Bureau API Client
 *
 * Requests for the experimental Bureau mode (docs/bureau-design.md), kept
 * apart from services/api.js so story mode's client stays untouched.
 */

const baseURL = '/api/bureaus';

function errorFromBody(body, response) {
  const error = new Error(body.error || `Request failed: ${response.statusText}`);
  error.status = response.status;
  for (const [key, value] of Object.entries(body)) {
    if (key !== 'error' && key !== 'message' && key !== 'stack') error[key] = value;
  }
  return error;
}

async function failedResponse(response) {
  const body = await response.json().catch(() => ({ error: response.statusText }));
  return errorFromBody(body, response);
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const init = { method, signal };
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
    body: JSON.stringify(body),
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
          throw new Error(event.error || 'Generation failed');
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

export const bureausAPI = {
  list() {
    return request('');
  },

  /** The default house style, settings, and model a Bureau starts with. */
  defaults() {
    return request('/defaults');
  },

  /** @param {{ name: string, description?: string, apiKey?: string, model?: string }} fields */
  create(fields) {
    return request('', { method: 'POST', body: fields });
  },

  get(bureauId) {
    return request(`/${bureauId}`);
  },

  /** Partial update: name, description, apiKey ('' removes it), model, houseStyle, timezone, settings. */
  update(bureauId, updates) {
    return request(`/${bureauId}`, { method: 'PUT', body: updates });
  },

  remove(bureauId) {
    return request(`/${bureauId}`, { method: 'DELETE' });
  },

  listCast(bureauId) {
    return request(`/${bureauId}/cast`);
  },

  addCast(bureauId, characterId, isPersona = false) {
    return request(`/${bureauId}/cast`, { method: 'POST', body: { characterId, isPersona } });
  },

  updateCast(bureauId, castId, updates) {
    return request(`/${bureauId}/cast/${castId}`, { method: 'PUT', body: updates });
  },

  removeCast(bureauId, castId) {
    return request(`/${bureauId}/cast/${castId}`, { method: 'DELETE' });
  },

  listLorebooks(bureauId) {
    return request(`/${bureauId}/lorebooks`);
  },

  attachLorebook(bureauId, lorebookId) {
    return request(`/${bureauId}/lorebooks`, { method: 'POST', body: { lorebookId } });
  },

  detachLorebook(bureauId, lorebookId) {
    return request(`/${bureauId}/lorebooks/${lorebookId}`, { method: 'DELETE' });
  },

  getRun(bureauId, runId) {
    return request(`/${bureauId}/runs/${runId}`);
  },
};

export const bureauStoriesAPI = {
  list(bureauId) {
    return request(`/${bureauId}/stories`);
  },

  /**
   * @param {string} bureauId
   * @param {Object} story
   * @param {string} [story.title]
   * @param {string[]} [story.castIds] - Defaults to the whole cast.
   * @param {{ choice: 'present'|'bureau'|'custom', customTime?: string }} story.start
   * @param {string} [story.timeZone] - The browser's time zone.
   */
  start(bureauId, story) {
    return request(`/${bureauId}/stories`, { method: 'POST', body: story });
  },

  get(bureauId, storyId) {
    return request(`/${bureauId}/stories/${storyId}`);
  },

  update(bureauId, storyId, updates) {
    return request(`/${bureauId}/stories/${storyId}`, { method: 'PUT', body: updates });
  },

  /** @param {{ choice: 'present'|'custom'|'unchanged', customTime?: string }} end */
  end(bureauId, storyId, end) {
    return request(`/${bureauId}/stories/${storyId}/end`, { method: 'POST', body: { end } });
  },

  remove(bureauId, storyId) {
    return request(`/${bureauId}/stories/${storyId}`, { method: 'DELETE' });
  },

  addTurn(bureauId, storyId, turn) {
    return request(`/${bureauId}/stories/${storyId}/turns`, { method: 'POST', body: turn });
  },

  editTurn(bureauId, storyId, turnId, content) {
    return request(`/${bureauId}/stories/${storyId}/turns/${turnId}`, {
      method: 'PUT',
      body: { content },
    });
  },

  deleteTurn(bureauId, storyId, turnId) {
    return request(`/${bureauId}/stories/${storyId}/turns/${turnId}`, { method: 'DELETE' });
  },

  selectVariant(bureauId, storyId, turnId, variantId) {
    return request(`/${bureauId}/stories/${storyId}/turns/${turnId}/variant`, {
      method: 'PUT',
      body: { variantId },
    });
  },

  /**
   * Stream the next turn. Events: turn (the reader's new turn), run, reasoning,
   * content, and done (with userTurn and turn).
   * @param {{ action: 'write'|'direct'|'continue', text?: string, leadCastId?: string|null }} generation
   */
  generate(bureauId, storyId, generation, signal) {
    return streamEvents(`/${bureauId}/stories/${storyId}/generate`, generation, signal);
  },

  /** Stream a new variant of a generated turn. */
  regenerate(bureauId, storyId, turnId, signal) {
    return streamEvents(`/${bureauId}/stories/${storyId}/turns/${turnId}/regenerate`, {}, signal);
  },
};
