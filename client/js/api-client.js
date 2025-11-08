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

  // ==================== Generation ====================

  /**
   * Generate content with SSE streaming
   * Returns an async iterator for streaming chunks
   */
  async* generateStream(storyId, type, customPrompt = null) {
    console.log('[API] Starting generation:', { storyId, type, customPrompt });

    const url = `${this.baseURL}/api/generate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ storyId, type, customPrompt }),
    });

    console.log('[API] Response status:', response.status);

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
    let chunkCount = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log('[API] Stream complete. Total chunks:', chunkCount);
          break;
        }

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
                console.error('[API] Stream error:', data.error);
                throw new Error(data.error);
              }

              chunkCount++;
              console.log('[API] Chunk', chunkCount, ':', {
                hasReasoning: !!data.reasoning,
                hasContent: !!data.content,
                contentLength: data.content?.length || 0,
                finished: data.finished
              });

              yield data;
            } catch (e) {
              console.error('[API] Failed to parse SSE line:', trimmed, e);
            }
          }
        }
      }
    } catch (error) {
      console.error('[API] Stream error:', error);
      throw error;
    } finally {
      reader.releaseLock();
      console.log('[API] Reader released');
    }
  }
}

// Create global instance
window.apiClient = new ApiClient();
