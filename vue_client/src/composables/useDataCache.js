/**
 * Centralized data caching composable for stories, characters, lorebooks, and presets.
 * Prevents redundant API calls when navigating between views.
 */
import { ref, computed, shallowRef } from 'vue'
import { storiesAPI, charactersAPI, lorebooksAPI, presetsAPI } from '../services/api'

// Shared state - persists across component instances
const stories = shallowRef([])
const characters = shallowRef([])
const lorebooks = shallowRef([])
const presets = shallowRef([])
const defaultPresetId = ref(null)

// Loading states
const loadingStories = ref(false)
const loadingCharacters = ref(false)
const loadingLorebooks = ref(false)
const loadingPresets = ref(false)

// Cache timestamps to track freshness
const cacheTimestamps = {
  stories: 0,
  characters: 0,
  lorebooks: 0,
  presets: 0
}

// Cache duration in milliseconds (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000

// In-flight request tracking to prevent duplicate requests
let storiesPromise = null
let charactersPromise = null
let lorebooksPromise = null
let presetsPromise = null

function isCacheValid(type) {
  return Date.now() - cacheTimestamps[type] < CACHE_DURATION
}

export function useDataCache() {
  // Pre-computed story counts by character ID for O(1) lookup
  const storyCountsByCharacter = computed(() => {
    const counts = new Map()
    for (const story of stories.value) {
      // Count characters in characterIds array
      if (story.characterIds) {
        for (const charId of story.characterIds) {
          counts.set(charId, (counts.get(charId) || 0) + 1)
        }
      }
      // Count persona character
      if (story.personaCharacterId) {
        const charId = story.personaCharacterId
        // Only count if not already counted in characterIds
        if (!story.characterIds?.includes(charId)) {
          counts.set(charId, (counts.get(charId) || 0) + 1)
        }
      }
    }
    return counts
  })

  // Get story count for a character - O(1) lookup
  function getStoryCount(characterId) {
    return storyCountsByCharacter.value.get(characterId) || 0
  }

  // Load stories with caching
  async function loadStories(force = false) {
    // Return cached data if valid and not forcing refresh
    if (!force && stories.value.length > 0 && isCacheValid('stories')) {
      return stories.value
    }

    // Return in-flight request if one exists
    if (storiesPromise) {
      return storiesPromise
    }

    loadingStories.value = true
    storiesPromise = (async () => {
      try {
        const { stories: data } = await storiesAPI.list()
        stories.value = data || []
        cacheTimestamps.stories = Date.now()
        return stories.value
      } catch (error) {
        console.error('Error loading stories:', error)
        throw error
      } finally {
        loadingStories.value = false
        storiesPromise = null
      }
    })()

    return storiesPromise
  }

  // Load characters with caching
  async function loadCharacters(force = false) {
    if (!force && characters.value.length > 0 && isCacheValid('characters')) {
      return characters.value
    }

    if (charactersPromise) {
      return charactersPromise
    }

    loadingCharacters.value = true
    charactersPromise = (async () => {
      try {
        const { characters: data } = await charactersAPI.list()
        characters.value = data || []
        cacheTimestamps.characters = Date.now()
        return characters.value
      } catch (error) {
        console.error('Error loading characters:', error)
        throw error
      } finally {
        loadingCharacters.value = false
        charactersPromise = null
      }
    })()

    return charactersPromise
  }

  // Load lorebooks with caching
  async function loadLorebooks(force = false) {
    if (!force && lorebooks.value.length > 0 && isCacheValid('lorebooks')) {
      return lorebooks.value
    }

    if (lorebooksPromise) {
      return lorebooksPromise
    }

    loadingLorebooks.value = true
    lorebooksPromise = (async () => {
      try {
        const { lorebooks: data } = await lorebooksAPI.list()
        lorebooks.value = data || []
        cacheTimestamps.lorebooks = Date.now()
        return lorebooks.value
      } catch (error) {
        console.error('Error loading lorebooks:', error)
        throw error
      } finally {
        loadingLorebooks.value = false
        lorebooksPromise = null
      }
    })()

    return lorebooksPromise
  }

  // Load presets with caching
  async function loadPresets(force = false) {
    if (!force && presets.value.length > 0 && isCacheValid('presets')) {
      return { presets: presets.value, defaultPresetId: defaultPresetId.value }
    }

    if (presetsPromise) {
      return presetsPromise
    }

    loadingPresets.value = true
    presetsPromise = (async () => {
      try {
        const [presetsData, defaultData] = await Promise.all([
          presetsAPI.list(),
          presetsAPI.getDefaultId()
        ])
        presets.value = presetsData.presets || []
        defaultPresetId.value = defaultData.defaultPresetId
        cacheTimestamps.presets = Date.now()
        return { presets: presets.value, defaultPresetId: defaultPresetId.value }
      } catch (error) {
        console.error('Error loading presets:', error)
        throw error
      } finally {
        loadingPresets.value = false
        presetsPromise = null
      }
    })()

    return presetsPromise
  }

  // Load all data in parallel
  async function loadAll(force = false) {
    return Promise.all([
      loadStories(force),
      loadCharacters(force),
      loadLorebooks(force),
      loadPresets(force)
    ])
  }

  // Invalidate specific cache
  function invalidateCache(type) {
    cacheTimestamps[type] = 0
  }

  // Invalidate all caches
  function invalidateAll() {
    cacheTimestamps.stories = 0
    cacheTimestamps.characters = 0
    cacheTimestamps.lorebooks = 0
    cacheTimestamps.presets = 0
  }

  // Update local story data without API call (for optimistic updates)
  function updateStoryLocally(storyId, updates) {
    const index = stories.value.findIndex(s => s.id === storyId)
    if (index !== -1) {
      const newStories = [...stories.value]
      newStories[index] = { ...newStories[index], ...updates }
      stories.value = newStories
    }
  }

  // Remove story locally
  function removeStoryLocally(storyId) {
    stories.value = stories.value.filter(s => s.id !== storyId)
  }

  // Update character locally
  function updateCharacterLocally(characterId, updates) {
    const index = characters.value.findIndex(c => c.id === characterId)
    if (index !== -1) {
      const newCharacters = [...characters.value]
      newCharacters[index] = { ...newCharacters[index], ...updates }
      characters.value = newCharacters
    }
  }

  // Remove character locally
  function removeCharacterLocally(characterId) {
    characters.value = characters.value.filter(c => c.id !== characterId)
  }

  // Add character locally
  function addCharacterLocally(character) {
    characters.value = [...characters.value, character]
  }

  // Update lorebook locally
  function updateLorebookLocally(lorebookId, updates) {
    const index = lorebooks.value.findIndex(l => l.id === lorebookId)
    if (index !== -1) {
      const newLorebooks = [...lorebooks.value]
      newLorebooks[index] = { ...newLorebooks[index], ...updates }
      lorebooks.value = newLorebooks
    }
  }

  // Remove lorebook locally
  function removeLorebookLocally(lorebookId) {
    lorebooks.value = lorebooks.value.filter(l => l.id !== lorebookId)
  }

  // Update preset locally
  function updatePresetLocally(presetId, updates) {
    const index = presets.value.findIndex(p => p.id === presetId)
    if (index !== -1) {
      const newPresets = [...presets.value]
      newPresets[index] = { ...newPresets[index], ...updates }
      presets.value = newPresets
    }
  }

  // Remove preset locally
  function removePresetLocally(presetId) {
    presets.value = presets.value.filter(p => p.id !== presetId)
  }

  // Set default preset ID
  function setDefaultPresetIdLocally(presetId) {
    defaultPresetId.value = presetId
  }

  return {
    // Data
    stories,
    characters,
    lorebooks,
    presets,
    defaultPresetId,

    // Loading states
    loadingStories,
    loadingCharacters,
    loadingLorebooks,
    loadingPresets,

    // Computed helpers
    storyCountsByCharacter,
    getStoryCount,

    // Load functions
    loadStories,
    loadCharacters,
    loadLorebooks,
    loadPresets,
    loadAll,

    // Cache management
    invalidateCache,
    invalidateAll,

    // Local updates
    updateStoryLocally,
    removeStoryLocally,
    updateCharacterLocally,
    removeCharacterLocally,
    addCharacterLocally,
    updateLorebookLocally,
    removeLorebookLocally,
    updatePresetLocally,
    removePresetLocally,
    setDefaultPresetIdLocally
  }
}
