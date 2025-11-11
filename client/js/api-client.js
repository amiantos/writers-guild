/**
 * API Client
 * Handles all communication with the Úrscéal server
 */

class ApiClient {
  constructor(baseURL = '') {
    this.baseURL = baseURL;
  }

  /**
   * Make a fetch request with error handling
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const response = await fetch(url, { ...defaultOptions, ...options });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Request failed: ${response.statusText}`);
    }

    return response.json();
  }

  // ==================== Stories ====================

  async listStories() {
    return this.request('/api/stories');
  }

  async getStory(storyId) {
    return this.request(`/api/stories/${storyId}`);
  }

  async createStory(title, description = '') {
    return this.request('/api/stories', {
      method: 'POST',
      body: JSON.stringify({ title, description }),
    });
  }

  async updateStory(storyId, updates) {
    return this.request(`/api/stories/${storyId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async updateStoryContent(storyId, content) {
    return this.request(`/api/stories/${storyId}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    });
  }

  async deleteStory(storyId) {
    return this.request(`/api/stories/${storyId}`, {
      method: 'DELETE',
    });
  }

  // ==================== Characters (Global Library) ====================

  async listAllCharacters() {
    return this.request('/api/characters');
  }

  async getCharacter(characterId) {
    const response = await this.request(`/api/characters/${characterId}/data`);
    return response.character || response;
  }

  async importCharacter(file) {
    const formData = new FormData();
    formData.append('character', file);

    const url = `${this.baseURL}/api/characters/import`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Import failed: ${response.statusText}`);
    }

    return response.json();
  }

  async importCharacterFromUrl(url) {
    return this.request('/api/characters/import-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  async createCharacter(characterData) {
    return this.request('/api/characters', {
      method: 'POST',
      body: JSON.stringify(characterData),
    });
  }

  async createCharacterWithImage(characterData, imageFile) {
    const formData = new FormData();
    formData.append('characterData', JSON.stringify(characterData));
    if (imageFile) {
      formData.append('image', imageFile);
    }

    const url = `${this.baseURL}/api/characters/create`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Create failed: ${response.statusText}`);
    }

    return response.json();
  }

  async updateCharacter(characterId, updates) {
    return this.request(`/api/characters/${characterId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async updateCharacterWithImage(characterId, characterData, imageFile) {
    const formData = new FormData();
    formData.append('characterData', JSON.stringify(characterData));
    formData.append('image', imageFile);

    const url = `${this.baseURL}/api/characters/${characterId}/update-with-image`;
    const response = await fetch(url, {
      method: 'PUT',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Update failed: ${response.statusText}`);
    }

    return response.json();
  }

  async getCharacterData(characterId) {
    return this.request(`/api/characters/${characterId}/data`);
  }

  async getCharacterStories(characterId) {
    return this.request(`/api/characters/${characterId}/stories`);
  }

  async deleteCharacter(characterId) {
    return this.request(`/api/characters/${characterId}`, {
      method: 'DELETE',
    });
  }

  // ==================== Story-Character Associations ====================

  async listStoryCharacters(storyId) {
    return this.request(`/api/stories/${storyId}/characters`);
  }

  async addCharacterToStory(storyId, characterId) {
    return this.request(`/api/stories/${storyId}/characters`, {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    });
  }

  async removeCharacterFromStory(storyId, characterId) {
    return this.request(`/api/stories/${storyId}/characters/${characterId}`, {
      method: 'DELETE',
    });
  }

  async setStoryPersona(storyId, characterId) {
    return this.request(`/api/stories/${storyId}/persona`, {
      method: 'PUT',
      body: JSON.stringify({ characterId }),
    });
  }

  async getStoryCharacterGreetings(storyId, characterId) {
    return this.request(`/api/stories/${storyId}/characters/${characterId}/greetings`);
  }

  // ==================== Settings ====================

  async getSettings() {
    return this.request('/api/settings');
  }

  async updateSettings(settings) {
    return this.request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  // ==================== Lorebooks ====================

  async listAllLorebooks() {
    return this.request('/api/lorebooks');
  }

  async getLorebook(lorebookId) {
    return this.request(`/api/lorebooks/${lorebookId}`);
  }

  async importLorebook(file) {
    const formData = new FormData();
    formData.append('lorebook', file);

    return fetch(`${this.baseURL}/api/lorebooks/import`, {
      method: 'POST',
      body: formData,
    }).then(response => {
      if (!response.ok) {
        return response.json().then(err => {
          throw new Error(err.error || 'Failed to import lorebook');
        });
      }
      return response.json();
    });
  }

  async createLorebook(name, description = '') {
    return this.request('/api/lorebooks/create', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    });
  }

  async updateLorebook(lorebookId, updates) {
    return this.request(`/api/lorebooks/${lorebookId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteLorebook(lorebookId) {
    return this.request(`/api/lorebooks/${lorebookId}`, {
      method: 'DELETE',
    });
  }

  // Lorebook entries
  async addLorebookEntry(lorebookId, entryData) {
    return this.request(`/api/lorebooks/${lorebookId}/entries`, {
      method: 'POST',
      body: JSON.stringify(entryData),
    });
  }

  async updateLorebookEntry(lorebookId, entryId, updates) {
    return this.request(`/api/lorebooks/${lorebookId}/entries/${entryId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteLorebookEntry(lorebookId, entryId) {
    return this.request(`/api/lorebooks/${lorebookId}/entries/${entryId}`, {
      method: 'DELETE',
    });
  }

  // ==================== Story-Lorebook Associations ====================

  async listStoryLorebooks(storyId) {
    return this.request(`/api/stories/${storyId}/lorebooks`);
  }

  async addLorebookToStory(storyId, lorebookId) {
    return this.request(`/api/stories/${storyId}/lorebooks`, {
      method: 'POST',
      body: JSON.stringify({ lorebookId }),
    });
  }

  async removeLorebookFromStory(storyId, lorebookId) {
    return this.request(`/api/stories/${storyId}/lorebooks/${lorebookId}`, {
      method: 'DELETE',
    });
  }

  // ==================== Generation ====================

  /**
   * Continue story with SSE streaming
   * Returns an async iterator for streaming chunks
   */
  async* continueStory(storyId, characterId = null) {
    const url = characterId
      ? `${this.baseURL}/api/stories/${storyId}/continue?characterId=${characterId}`
      : `${this.baseURL}/api/stories/${storyId}/continue`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Generation failed: ${response.statusText}`);
    }

    yield* this._processSSEStream(response);
  }

  /**
   * Continue story with custom instruction with SSE streaming
   * Returns an async iterator for streaming chunks
   */
  async* continueWithInstruction(storyId, instruction) {
    const url = `${this.baseURL}/api/stories/${storyId}/continue-with-instruction`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ instruction }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Generation failed: ${response.statusText}`);
    }

    yield* this._processSSEStream(response);
  }

  /**
   * Rewrite story to third person with SSE streaming
   * Returns an async iterator for streaming chunks
   */
  async* rewriteThirdPerson(storyId) {
    const url = `${this.baseURL}/api/stories/${storyId}/rewrite-third-person`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Generation failed: ${response.statusText}`);
    }

    yield* this._processSSEStream(response);
  }

  /**
   * Helper method to process SSE stream
   * Returns an async iterator for streaming chunks
   */
  async* _processSSEStream(response) {
    if (!response.body) {
      throw new Error('Response body is null - streaming not supported');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed === '' || trimmed === 'data: [DONE]') {
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const jsonStr = trimmed.slice(6); // Remove 'data: ' prefix
              const data = JSON.parse(jsonStr);

              if (data.error) {
                throw new Error(data.error);
              }

              yield data;
            } catch (e) {
              console.error('Failed to parse SSE line:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Stream error:', error);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Generate content with SSE streaming (DEPRECATED - use specific endpoints)
   * Returns an async iterator for streaming chunks
   */
  async* generateStream(storyId, type, customPrompt = null, characterId = null) {
    const url = `${this.baseURL}/api/generate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ storyId, type, customPrompt, characterId }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Generation failed: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null - streaming not supported');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed === '' || trimmed === 'data: [DONE]') {
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const jsonStr = trimmed.slice(6); // Remove 'data: ' prefix
              const data = JSON.parse(jsonStr);

              if (data.error) {
                throw new Error(data.error);
              }

              yield data;
            } catch (e) {
              console.error('Failed to parse SSE line:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Stream error:', error);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }
}

// Create global instance
window.apiClient = new ApiClient();
