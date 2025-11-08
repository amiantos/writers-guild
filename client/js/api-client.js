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

  // ==================== Characters ====================

  async listCharacters(storyId) {
    return this.request(`/api/characters/story/${storyId}`);
  }

  async uploadCharacter(storyId, file) {
    const formData = new FormData();
    formData.append('character', file);

    const url = `${this.baseURL}/api/characters/story/${storyId}`;
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(error.error || `Upload failed: ${response.statusText}`);
    }

    return response.json();
  }

  async getCharacterData(storyId, characterId) {
    return this.request(`/api/characters/${storyId}/${characterId}/data`);
  }

  async deleteCharacter(storyId, characterId) {
    return this.request(`/api/characters/${storyId}/${characterId}`, {
      method: 'DELETE',
    });
  }

  // ==================== Personas ====================

  async getPersona() {
    return this.request('/api/persona');
  }

  async updatePersona(persona) {
    return this.request('/api/persona', {
      method: 'PUT',
      body: JSON.stringify(persona),
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
