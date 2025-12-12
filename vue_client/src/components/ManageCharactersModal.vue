<template>
  <Modal title="Manage Characters" maxWidth="900px" @close="$emit('close')">
    <!-- Filter Input -->
    <div class="filter-container">
      <input
        v-model="filterText"
        type="text"
        class="filter-input"
        placeholder="Filter by name or tags..."
      />
    </div>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>Loading characters...</p>
    </div>

    <!-- Character Grid -->
    <div v-else-if="filteredCharacters.length > 0" class="character-grid">
      <div v-for="char in filteredCharacters" :key="char.id" class="character-item">
        <CharacterCard :character="char" />
        <div class="character-actions">
          <button
            class="btn btn-small"
            :class="isCharacterInStory(char.id) ? 'btn-danger' : 'btn-primary'"
            @click="toggleCharacter(char.id)"
            :disabled="actionInProgress === char.id"
          >
            <i class="fas" :class="isCharacterInStory(char.id) ? 'fa-minus' : 'fa-plus'"></i>
            {{ isCharacterInStory(char.id) ? 'Remove' : 'Add' }}
          </button>
          <button
            class="btn btn-small"
            :class="isPersona(char.id) ? 'btn-danger' : 'btn-secondary'"
            @click="togglePersona(char.id)"
            :disabled="actionInProgress === char.id"
          >
            <i class="fas" :class="isPersona(char.id) ? 'fa-user-minus' : 'fa-user-plus'"></i>
            {{ isPersona(char.id) ? 'Remove Persona' : 'Set Persona' }}
          </button>
          <button
            class="btn btn-small btn-secondary"
            @click="goToDetails(char.id)"
          >
            <i class="fas fa-info-circle"></i>
            Details
          </button>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-state">
      <i class="fas fa-search"></i>
      <p>{{ filterText ? 'No characters match your search' : 'No characters available' }}</p>
    </div>
  </Modal>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Modal from './Modal.vue'
import CharacterCard from './CharacterCard.vue'
import { storiesAPI } from '../services/api'
import { useToast } from '../composables/useToast'
import { useDataCache } from '../composables/useDataCache'

const props = defineProps({
  story: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['close', 'updated'])

const router = useRouter()
const toast = useToast()
const { characters: cachedCharacters, loadCharacters, loadingCharacters } = useDataCache()
const filterText = ref('')
const actionInProgress = ref(null)

// Use loading state from cache
const loading = loadingCharacters

// Map cached characters with image URLs
const allCharacters = computed(() => {
  return cachedCharacters.value.map(char => ({
    ...char,
    imageUrl: `/api/characters/${char.id}/image`
  }))
})

onMounted(async () => {
  // Load characters from cache (will skip if already loaded)
  await loadCharacters()
})

const filteredCharacters = computed(() => {
  let characters = allCharacters.value

  // Apply filter if there's search text
  if (filterText.value.trim()) {
    const searchTerm = filterText.value.toLowerCase()
    characters = characters.filter(char => {
      // Search by name
      if (char.name?.toLowerCase().includes(searchTerm)) {
        return true
      }
      // Search by tags
      if (char.tags && Array.isArray(char.tags)) {
        return char.tags.some(tag => tag.toLowerCase().includes(searchTerm))
      }
      return false
    })
  }

  // Sort: selected characters and persona first, then alphabetically
  return [...characters].sort((a, b) => {
    const aSelected = isCharacterInStory(a.id) || isPersona(a.id)
    const bSelected = isCharacterInStory(b.id) || isPersona(b.id)

    // If one is selected/persona and the other isn't, selected comes first
    if (aSelected && !bSelected) return -1
    if (!aSelected && bSelected) return 1

    // Both selected or both not selected, sort alphabetically
    const nameA = (a.name || 'Unknown').toLowerCase()
    const nameB = (b.name || 'Unknown').toLowerCase()
    return nameA.localeCompare(nameB)
  })
})

function isCharacterInStory(characterId) {
  return props.story.characterIds?.includes(characterId) || false
}

function isPersona(characterId) {
  return props.story.personaCharacterId === characterId
}

async function toggleCharacter(characterId) {
  if (actionInProgress.value) return

  try {
    actionInProgress.value = characterId

    if (isCharacterInStory(characterId)) {
      // Remove character
      await storiesAPI.removeCharacterFromStory(props.story.id, characterId)
      toast.success('Character removed from story')

      // If this was the persona, that will be automatically unset
      if (isPersona(characterId)) {
        toast.info('Persona was also removed')
      }
    } else {
      // Add character
      const response = await charactersAPI.addToStory(props.story.id, characterId)
      toast.success('Character added to story')

      // Show info if lorebook was auto-added
      if (response.addedLorebookId) {
        toast.info('Character\'s lorebook was automatically added')
      }
    }

    emit('updated')
  } catch (error) {
    console.error('Failed to toggle character:', error)
    toast.error('Failed to update character: ' + error.message)
  } finally {
    actionInProgress.value = null
  }
}

async function togglePersona(characterId) {
  if (actionInProgress.value) return

  try {
    actionInProgress.value = characterId

    if (isPersona(characterId)) {
      // Remove persona
      await storiesAPI.setPersona(props.story.id, null)
      toast.success('Persona removed')
    } else {
      // Set persona
      await storiesAPI.setPersona(props.story.id, characterId)
      toast.success('Persona set')
    }

    emit('updated')
  } catch (error) {
    console.error('Failed to toggle persona:', error)
    toast.error('Failed to update persona: ' + error.message)
  } finally {
    actionInProgress.value = null
  }
}

function goToDetails(characterId) {
  router.push(`/characters/${characterId}`)
  emit('close')
}
</script>

<style scoped>
.filter-container {
  margin-bottom: 1.5rem;
}

.filter-input {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  outline: none;
}

.filter-input:focus {
  border-color: var(--accent-primary);
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: var(--text-secondary);
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--border-color);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.character-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1.5rem;
}

.character-item {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.character-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.character-actions .btn {
  width: 100%;
}

.empty-state {
  text-align: center;
  padding: 3rem;
  color: var(--text-secondary);
}

.empty-state i {
  font-size: 3rem;
  margin-bottom: 1rem;
  display: block;
}

@media (max-width: 768px) {
  .character-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 480px) {
  .character-grid {
    grid-template-columns: 1fr;
  }
}
</style>
