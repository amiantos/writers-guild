/**
 * API Client for Writers Guild
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

  create(title, description = '', options = {}) {
    return request('/stories', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description,
        needsRewritePrompt: options.needsRewritePrompt || false
      }),
    })
  },

  setRewritePrompt(storyId, value) {
    return request(`/stories/${storyId}/rewrite-prompt`, {
      method: 'POST',
      body: JSON.stringify({ value }),
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

  updateMetadata(storyId, updates) {
    return request(`/stories/${storyId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    })
  },

  removeCharacterFromStory(storyId, characterId) {
    return request(`/stories/${storyId}/characters/${characterId}`, {
      method: 'DELETE',
    })
  },

  addLorebookToStory(storyId, lorebookId) {
    return request(`/stories/${storyId}/lorebooks`, {
      method: 'POST',
      body: JSON.stringify({ lorebookId }),
    })
  },

  removeLorebookFromStory(storyId, lorebookId) {
    return request(`/stories/${storyId}/lorebooks/${lorebookId}`, {
      method: 'DELETE',
    })
  },

  setPersona(storyId, characterId) {
    return request(`/stories/${storyId}/persona`, {
      method: 'PUT',
      body: JSON.stringify({ characterId }),
    })
  },

  updateAvatarWindows(storyId, avatarWindows) {
    return request(`/stories/${storyId}/avatar-windows`, {
      method: 'PUT',
      body: JSON.stringify({ avatarWindows }),
    })
  },

  // Streaming generation
  async *continueStory(storyId, characterId = null, signal = null) {
    const url = `${baseURL}/stories/${storyId}/continue${characterId ? `?characterId=${characterId}` : ''}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Request failed: ${response.statusText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') return

            try {
              const parsed = JSON.parse(data)
              if (parsed.cancelled) {
                throw new Error('Generation cancelled')
              }
              if (parsed.error) {
                throw new Error(parsed.error)
              }
              yield parsed
            } catch (e) {
              if (e.message === 'Generation cancelled') throw e
              console.error('Failed to parse SSE data:', e)
              // Re-throw errors that came from the server
              if (e.message && !e.message.includes('parse')) {
                throw e
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  },

  async *continueWithInstruction(storyId, instruction, signal = null) {
    const url = `${baseURL}/stories/${storyId}/continue-with-instruction`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instruction }),
      signal
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Request failed: ${response.statusText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') return

            try {
              const parsed = JSON.parse(data)
              if (parsed.cancelled) {
                throw new Error('Generation cancelled')
              }
              if (parsed.error) {
                throw new Error(parsed.error)
              }
              yield parsed
            } catch (e) {
              if (e.message === 'Generation cancelled') throw e
              console.error('Failed to parse SSE data:', e)
              // Re-throw errors that came from the server
              if (e.message && !e.message.includes('parse')) {
                throw e
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  },

  async *rewriteThirdPerson(storyId, signal = null) {
    const url = `${baseURL}/stories/${storyId}/rewrite-third-person`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Request failed: ${response.statusText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') return

            try {
              const parsed = JSON.parse(data)
              if (parsed.cancelled) {
                throw new Error('Generation cancelled')
              }
              if (parsed.error) {
                throw new Error(parsed.error)
              }
              yield parsed
            } catch (e) {
              if (e.message === 'Generation cancelled') throw e
              console.error('Failed to parse SSE data:', e)
              // Re-throw errors that came from the server
              if (e.message && !e.message.includes('parse')) {
                throw e
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  },

  async *ideate(storyId, signal = null) {
    const url = `${baseURL}/stories/${storyId}/ideate`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Request failed: ${response.statusText}`)
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6)
            if (data === '[DONE]') return

            try {
              const parsed = JSON.parse(data)
              if (parsed.cancelled) {
                throw new Error('Generation cancelled')
              }
              if (parsed.error) {
                throw new Error(parsed.error)
              }
              yield parsed
            } catch (e) {
              if (e.message === 'Generation cancelled') throw e
              console.error('Failed to parse SSE data:', e)
              // Re-throw errors that came from the server
              if (e.message && !e.message.includes('parse')) {
                throw e
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  },
}

// Characters API
export const charactersAPI = {
  list() {
    return request('/characters')
  },

  get(characterId) {
    return request(`/characters/${characterId}/data`)
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

  update(characterId, data) {
    return request(`/characters/${characterId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  async updateWithImage(characterId, formData) {
    const url = `${baseURL}/characters/${characterId}/update-with-image`
    const response = await fetch(url, {
      method: 'PUT',
      body: formData, // multipart/form-data
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Request failed: ${response.statusText}`)
    }

    return response.json()
  },

  async importPNG(file) {
    const formData = new FormData()
    formData.append('character', file)

    const url = `${baseURL}/characters/import`
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText }))
      throw new Error(error.error || `Request failed: ${response.statusText}`)
    }

    return response.json()
  },

  async importFromURL(url) {
    return request('/characters/import-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    })
  },

  create(data) {
    return request('/characters', {
      method: 'POST',
      body: JSON.stringify(data),
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

  update(lorebookId, data) {
    return request(`/lorebooks/${lorebookId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  addEntry(lorebookId, entryData) {
    return request(`/lorebooks/${lorebookId}/entries`, {
      method: 'POST',
      body: JSON.stringify(entryData),
    })
  },

  updateEntry(lorebookId, entryId, entryData) {
    return request(`/lorebooks/${lorebookId}/entries/${entryId}`, {
      method: 'PUT',
      body: JSON.stringify(entryData),
    })
  },

  deleteEntry(lorebookId, entryId) {
    return request(`/lorebooks/${lorebookId}/entries/${entryId}`, {
      method: 'DELETE',
    })
  },

  importJSON(file) {
    const formData = new FormData()
    formData.append('lorebook', file)

    return fetch('/api/lorebooks/import', {
      method: 'POST',
      body: formData,
    }).then(async response => {
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Import failed')
      }
      return response.json()
    })
  },

  importFromURL(url) {
    return request('/lorebooks/import-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    })
  },
}

// Settings API
export const settingsAPI = {
  get() {
    return request('/settings')
  },

  update(settings) {
    return request('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    })
  },
}

// Presets API
export const presetsAPI = {
  list() {
    return request('/presets')
  },

  get(presetId) {
    return request(`/presets/${presetId}`)
  },

  create(presetData) {
    return request('/presets', {
      method: 'POST',
      body: JSON.stringify(presetData),
    })
  },

  update(presetId, presetData) {
    return request(`/presets/${presetId}`, {
      method: 'PUT',
      body: JSON.stringify(presetData),
    })
  },

  delete(presetId) {
    return request(`/presets/${presetId}`, {
      method: 'DELETE',
    })
  },

  getDefaultId() {
    return request('/presets/default/id')
  },

  setDefaultId(presetId) {
    return request('/presets/default/id', {
      method: 'PUT',
      body: JSON.stringify({ presetId }),
    })
  },

  initializeDefaults() {
    return request('/presets/initialize-defaults', {
      method: 'POST',
    })
  },

  // AI Horde specific methods
  getAIHordeModels() {
    return request('/presets/aihorde/models')
  },

  getAIHordeWorkers() {
    return request('/presets/aihorde/workers')
  },

  // OpenRouter specific methods
  getOpenRouterModels(apiKey) {
    return request(`/presets/openrouter/models?apiKey=${encodeURIComponent(apiKey)}`)
  },

  // OpenAI specific methods
  getOpenAIModels(apiKey) {
    return request(`/presets/openai/models?apiKey=${encodeURIComponent(apiKey)}`)
  },

  // Anthropic specific methods
  getAnthropicModels(apiKey) {
    return request(`/presets/anthropic/models?apiKey=${encodeURIComponent(apiKey)}`)
  },

  // DeepSeek specific methods
  getDeepSeekModels(apiKey) {
    return request(`/presets/deepseek/models?apiKey=${encodeURIComponent(apiKey)}`)
  },

  // Get default prompt templates (single source of truth from server)
  getDefaultTemplates() {
    return request('/presets/defaults/templates')
  },
}

// Onboarding API
export const onboardingAPI = {
  getStatus() {
    return request('/onboarding/status')
  },

  createPersona(firstName, description) {
    return request('/onboarding/persona', {
      method: 'POST',
      body: JSON.stringify({ firstName, description }),
    })
  },

  createPreset(provider, apiKey) {
    return request('/onboarding/preset', {
      method: 'POST',
      body: JSON.stringify({ provider, apiKey }),
    })
  },

  importDefaults() {
    return request('/onboarding/import-defaults', {
      method: 'POST',
    })
  },

  complete() {
    return request('/onboarding/complete', {
      method: 'POST',
    })
  },

  skip() {
    return request('/onboarding/skip', {
      method: 'POST',
    })
  },
}

export default {
  stories: storiesAPI,
  characters: charactersAPI,
  lorebooks: lorebooksAPI,
  settings: settingsAPI,
  presets: presetsAPI,
  onboarding: onboardingAPI,
}
