/**
 * API Client for Úrscéal
 */

const baseURL = '/api'

async function request(endpoint, options = {}) {
  const url = `${baseURL}${endpoint}`
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
    },
  }

  const response = await fetch(url, { ...defaultOptions, ...options })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || `Request failed: ${response.statusText}`)
  }

  return response.json()
}

// Stories API
export const storiesAPI = {
  list() {
    return request('/stories')
  },

  get(storyId) {
    return request(`/stories/${storyId}`)
  },

  create(title, description = '') {
    return request('/stories', {
      method: 'POST',
      body: JSON.stringify({ title, description }),
    })
  },

  delete(storyId) {
    return request(`/stories/${storyId}`, {
      method: 'DELETE',
    })
  },

  updateContent(storyId, content) {
    return request(`/stories/${storyId}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    })
  },
}

// Characters API
export const charactersAPI = {
  list() {
    return request('/characters')
  },

  getStories(characterId) {
    return request(`/characters/${characterId}/stories`)
  },

  delete(characterId) {
    return request(`/characters/${characterId}`, {
      method: 'DELETE',
    })
  },

  addToStory(storyId, characterId) {
    return request(`/stories/${storyId}/characters`, {
      method: 'POST',
      body: JSON.stringify({ characterId }),
    })
  },
}

// Lorebooks API
export const lorebooksAPI = {
  list() {
    return request('/lorebooks')
  },

  get(lorebookId) {
    return request(`/lorebooks/${lorebookId}`)
  },

  create(name, description = '') {
    return request('/lorebooks/create', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    })
  },

  delete(lorebookId) {
    return request(`/lorebooks/${lorebookId}`, {
      method: 'DELETE',
    })
  },
}

export default {
  stories: storiesAPI,
  characters: charactersAPI,
  lorebooks: lorebooksAPI,
}
