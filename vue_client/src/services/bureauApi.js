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

  /** The default correspondence style, settings, and model a Bureau starts with. */
  defaults() {
    return request('/defaults');
  },

  /**
   * The shared API key, used by every Bureau without a key of its own:
   * { sharedKey: { hasApiKey, apiKeyPreview } }.
   */
  sharedKey() {
    return request('/shared-key');
  },

  /** Save the shared API key; '' removes it. Answers like sharedKey(). */
  updateSharedKey(apiKey) {
    return request('/shared-key', { method: 'PUT', body: { apiKey } });
  },

  /**
   * With shareApiKey, the key becomes the shared key instead of the Bureau's own, if none is saved.
   * @param {{ name: string, description?: string, apiKey?: string, shareApiKey?: boolean,
   *   model?: string }} fields
   */
  create(fields) {
    return request('', { method: 'POST', body: fields });
  },

  get(bureauId) {
    return request(`/${bureauId}`);
  },

  /**
   * Partial update: name, description, apiKey ('' removes it), model, timezone,
   * settings, and bureauTime (an ISO time in the years 1 to 9999, earlier or later).
   */
  update(bureauId, updates) {
    return request(`/${bureauId}`, { method: 'PUT', body: updates });
  },

  /**
   * Let time pass: move Bureau time forward by a step, or to a later time. Answers with the Bureau.
   * @param {{ step: 'hour'|'later'|'morning'|'days'|'week' } | { to: string }} move
   */
  passTime(bureauId, move) {
    return request(`/${bureauId}/time`, { method: 'POST', body: move });
  },

  remove(bureauId) {
    return request(`/${bureauId}`, { method: 'DELETE' });
  },

  /**
   * Reset a Bureau to a blank slate: delete its chapters, messages, memories, arc notes, and the facts
   * the Archivist proposed, keeping the cast with their profiles, the facts written by hand,
   * interviews, lorebooks, settings, and Bureau time.
   */
  reset(bureauId) {
    return request(`/${bureauId}/reset`, { method: 'POST', body: {} });
  },

  listCast(bureauId) {
    return request(`/${bureauId}/cast`);
  },

  addCast(bureauId, characterId, isPersona = false) {
    return request(`/${bureauId}/cast`, { method: 'POST', body: { characterId, isPersona } });
  },

  /** @param {{ isPersona: boolean }} updates */
  updateCast(bureauId, castId, updates) {
    return request(`/${bureauId}/cast/${castId}`, { method: 'PUT', body: updates });
  },

  /**
   * A cast member's profile (the Bureau's copy of their card, and their routine), with every
   * version kept, oldest first: { castMember, profile, versions }.
   */
  getProfile(bureauId, castId) {
    return request(`/${bureauId}/cast/${castId}/profile`);
  },

  /**
   * Change a profile by hand, keeping the change as a version. Any of description, personality,
   * scenario, first_mes, mes_example, and routine.
   */
  updateProfile(bureauId, castId, updates) {
    return request(`/${bureauId}/cast/${castId}/profile`, { method: 'PUT', body: updates });
  },

  /** Put a profile back as it was at an earlier version. */
  restoreProfileVersion(bureauId, castId, versionId) {
    return request(`/${bureauId}/cast/${castId}/profile/versions/${versionId}/restore`, {
      method: 'POST',
      body: {},
    });
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

  /**
   * The Bureau's established facts, oldest first. Each says what it replaces (replaces,
   * replacesContent) and, once a change to it is accepted, what replaced it (replacedBy).
   * @param {{ status?: 'proposed'|'accepted'|'rejected' }} [options]
   */
  listFacts(bureauId, { status } = {}) {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return request(`/${bureauId}/facts${query}`);
  },

  /** Write an established fact; a fact written here is accepted as written. */
  addFact(bureauId, content) {
    return request(`/${bureauId}/facts`, { method: 'POST', body: { content } });
  },

  /** Accept, reject, or edit a fact: content, status, needsReview. */
  updateFact(bureauId, factId, updates) {
    return request(`/${bureauId}/facts/${factId}`, { method: 'PUT', body: updates });
  },

  removeFact(bureauId, factId) {
    return request(`/${bureauId}/facts/${factId}`, { method: 'DELETE' });
  },

  getRun(bureauId, runId) {
    return request(`/${bureauId}/runs/${runId}`);
  },

  /**
   * A character's memories, newest first. With q, searches all of them, best match first.
   * @param {{ status?: 'current'|'retired', q?: string }} [options]
   */
  listMemories(bureauId, castId, { status, q } = {}) {
    const params = new URLSearchParams();
    if (q) {
      params.set('q', q);
    } else if (status) {
      params.set('status', status);
    }
    const query = params.toString();
    return request(`/${bureauId}/cast/${castId}/memories${query ? `?${query}` : ''}`);
  },

  /** Write something a character knows, such as backstory. @param {{ content: string, importance?: number }} memory */
  addMemory(bureauId, castId, memory) {
    return request(`/${bureauId}/cast/${castId}/memories`, { method: 'POST', body: memory });
  },

  /** Partial update: content, importance, pinned, retired (false restores), needsReview. */
  updateMemory(bureauId, memoryId, updates) {
    return request(`/${bureauId}/memories/${memoryId}`, { method: 'PUT', body: updates });
  },

  removeMemory(bureauId, memoryId) {
    return request(`/${bureauId}/memories/${memoryId}`, { method: 'DELETE' });
  },

  /**
   * A character's arc notes, oldest first.
   * @param {{ status?: 'proposed'|'accepted'|'rejected' }} [options]
   */
  listArcNotes(bureauId, castId, { status } = {}) {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return request(`/${bureauId}/cast/${castId}/arc-notes${query}`);
  },

  /** Write how a character has changed; a note written here is accepted as written. */
  addArcNote(bureauId, castId, content) {
    return request(`/${bureauId}/cast/${castId}/arc-notes`, { method: 'POST', body: { content } });
  },

  /** Accept, reject, or edit an arc note: content, status, needsReview. */
  updateArcNote(bureauId, noteId, updates) {
    return request(`/${bureauId}/arc-notes/${noteId}`, { method: 'PUT', body: updates });
  },

  removeArcNote(bureauId, noteId) {
    return request(`/${bureauId}/arc-notes/${noteId}`, { method: 'DELETE' });
  },

  /** Export a cast member to the library as a new character, with how they've changed. */
  exportCast(bureauId, castId) {
    return request(`/${bureauId}/cast/${castId}/export`, { method: 'POST', body: {} });
  },

  /** Generate a character card from an idea, without saving it. */
  generateCharacter(bureauId, idea, { name = '', role = '' } = {}) {
    return request(`/${bureauId}/characters/generate`, {
      method: 'POST',
      body: { idea, name, role },
    });
  },

  /** Add a generated card to the cast as a draft, kept only in this Bureau. */
  addDraft(bureauId, card) {
    return request(`/${bureauId}/cast`, { method: 'POST', body: { card } });
  },

  /** Save a draft cast member to the library as a new character. */
  promoteCast(bureauId, castId) {
    return request(`/${bureauId}/cast/${castId}/promote`, { method: 'POST', body: {} });
  },

  /**
   * Save the avatar windows floating over the Bureau's chapters, replacing the ones saved before.
   * @param {Array<{ id: string, castId: string, x: number, y: number, width: number,
   *   height: number }>} avatarWindows
   */
  updateAvatarWindows(bureauId, avatarWindows) {
    return request(`/${bureauId}/avatar-windows`, { method: 'PUT', body: { avatarWindows } });
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
   * @param {{ choice: 'bureau'|'custom', customTime?: string }} [story.start] - Defaults to Bureau
   *   time. The Bureau's clock moves to the start time.
   * @param {string} [story.timeZone] - The browser's time zone.
   */
  start(bureauId, story) {
    return request(`/${bureauId}/stories`, { method: 'POST', body: story });
  },

  get(bureauId, storyId) {
    return request(`/${bureauId}/stories/${storyId}`);
  },

  /**
   * @param {{ title?: string, scenario?: string, summary?: string, castIds?: string[] }} updates -
   *   A scenario of '' clears it. Saving the summary clears its mark for review.
   */
  update(bureauId, storyId, updates) {
    return request(`/${bureauId}/stories/${storyId}`, { method: 'PUT', body: updates });
  },

  /**
   * End a story. Answers with the story and Bureau, plus `archive` (what was committed to
   * memory, or null) and `archiveError` (why committing failed, or null).
   * @param {{ choice: 'unchanged'|'custom', customTime?: string }} end - Defaults to leaving Bureau
   *   time as it is.
   */
  end(bureauId, storyId, end) {
    return request(`/${bureauId}/stories/${storyId}/end`, { method: 'POST', body: { end } });
  },

  /** Commit the story to memory: the Archivist reads every turn it hasn't read yet. */
  archive(bureauId, storyId) {
    return request(`/${bureauId}/stories/${storyId}/archive`, { method: 'POST', body: {} });
  },

  remove(bureauId, storyId) {
    return request(`/${bureauId}/stories/${storyId}`, { method: 'DELETE' });
  },

  /**
   * Add a turn without generating: prose, a direction, a scene break, or time passing in the
   * chapter ({ kind: 'time_passes', step } or a later { kind: 'time_passes', to }). Time passing
   * moves Bureau time too, so it answers with the Bureau as well as the turn.
   */
  addTurn(bureauId, storyId, turn) {
    return request(`/${bureauId}/stories/${storyId}/turns`, { method: 'POST', body: turn });
  },

  /**
   * Greetings from the cards of the chapter's cast, other than the reader's character. Each is
   * { castId, name, index, label, content }.
   */
  listGreetings(bureauId, storyId) {
    return request(`/${bureauId}/stories/${storyId}/greetings`);
  },

  /**
   * Open the chapter with a greeting kept as written, as it was listed. To have the Writer rewrite
   * it instead, generate with action 'greeting'.
   */
  addGreeting(bureauId, storyId, content) {
    return request(`/${bureauId}/stories/${storyId}/greetings`, {
      method: 'POST',
      body: { content },
    });
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
   * Undo one of the Editor's fixes, in a turn written before the Editor was removed; index is its
   * place in the run's list of fixes.
   */
  revertEdit(bureauId, storyId, turnId, { runId, index }) {
    return request(`/${bureauId}/stories/${storyId}/turns/${turnId}/revert-edit`, {
      method: 'POST',
      body: { runId, index },
    });
  },

  /**
   * Stream the next turn. Events: turn (the reader's new turn), run, stage (writing),
   * reasoning, content, and done (with userTurn and turn).
   * @param {{ action: 'write'|'direct'|'continue'|'character'|'greeting', text?: string,
   *   castId?: string }} generation - 'character' continues from castId's perspective.
   *   'greeting' has the Writer rewrite text, a greeting from castId's card, as the chapter's
   *   opening.
   */
  generate(bureauId, storyId, generation, signal) {
    return streamEvents(`/${bureauId}/stories/${storyId}/generate`, generation, signal);
  },

  /** Stream a new variant of a generated turn. */
  regenerate(bureauId, storyId, turnId, signal) {
    return streamEvents(`/${bureauId}/stories/${storyId}/turns/${turnId}/regenerate`, {}, signal);
  },
};

export const bureauThreadsAPI = {
  /** Everyone the reader can write to, each with their thread (null before the first message). */
  list(bureauId) {
    return request(`/${bureauId}/threads`);
  },

  /** A cast member's thread and messages, with the Bureau and the cast member. */
  get(bureauId, castId) {
    return request(`/${bureauId}/threads/${castId}`);
  },

  /**
   * Send a message and stream the reply. Events: message (the reader's saved message), run,
   * reasoning, content, and done (with message, replies, and bureau).
   */
  send(bureauId, castId, text, signal) {
    return streamEvents(`/${bureauId}/threads/${castId}/messages`, { text }, signal);
  },

  /** Stream a reply without a new message from the reader. */
  reply(bureauId, castId, signal) {
    return streamEvents(`/${bureauId}/threads/${castId}/reply`, {}, signal);
  },

  /** Commit the thread to memory: the Archivist reads every message it hasn't read yet. */
  archive(bureauId, castId) {
    return request(`/${bureauId}/threads/${castId}/archive`, { method: 'POST', body: {} });
  },

  editMessage(bureauId, castId, messageId, content) {
    return request(`/${bureauId}/threads/${castId}/messages/${messageId}`, {
      method: 'PUT',
      body: { content },
    });
  },

  deleteMessage(bureauId, castId, messageId) {
    return request(`/${bureauId}/threads/${castId}/messages/${messageId}`, { method: 'DELETE' });
  },
};

export const bureauInterviewsAPI = {
  /**
   * A cast member's open interview (null when there isn't one), with the Bureau, the cast member,
   * and the focuses an interview can start with.
   */
  get(bureauId, castId) {
    return request(`/${bureauId}/cast/${castId}/interview`);
  },

  /**
   * Start an interview and stream its first question. Events: interview (as it stands), run,
   * content, and done (with interview).
   * @param {{ focus: string, note?: string }} options
   */
  start(bureauId, castId, { focus, note = '' }, signal) {
    return streamEvents(`/${bureauId}/cast/${castId}/interview`, { focus, note }, signal);
  },

  /** Answer the latest question and stream the next, with the same events as start. */
  answer(bureauId, castId, text, signal) {
    return streamEvents(`/${bureauId}/cast/${castId}/interview/answers`, { text }, signal);
  },

  /** Stream a different question in place of the latest, or a question if none is waiting. */
  askAgain(bureauId, castId, signal) {
    return streamEvents(`/${bureauId}/cast/${castId}/interview/ask-again`, {}, signal);
  },

  /** Write up the answers as a new description, personality, and routine to review. */
  writeUp(bureauId, castId) {
    return request(`/${bureauId}/cast/${castId}/interview/write-up`, { method: 'POST', body: {} });
  },

  /**
   * Accept the write-up as the reader edited it. Answers with the cast member, the closed
   * interview, and `updated`: anyone else whose description gained a line.
   * @param {{ description: string, personality: string, routine: string,
   *   relationships: Array<{ castId: string, addition: string }> }} edits
   */
  accept(bureauId, castId, edits) {
    return request(`/${bureauId}/cast/${castId}/interview/accept`, { method: 'POST', body: edits });
  },

  /** Discard the open interview; the profile stays as it is. */
  discard(bureauId, castId) {
    return request(`/${bureauId}/cast/${castId}/interview`, { method: 'DELETE' });
  },
};
