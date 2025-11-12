<template>
  <div class="landing-wrapper">
    <header class="app-header">
      <h1>Úrscéal</h1>
    </header>

    <main class="app-main">
      <div class="landing-page">
    <Tabs v-model="activeTab" :tabs="tabs">
      <!-- Stories Tab -->
      <template #tab-stories>
        <div class="section-header">
          <h2><i class="fas fa-book"></i> All Stories</h2>
          <button class="btn btn-primary" @click="createNewStory">
            <i class="fas fa-plus"></i> New Story
          </button>
        </div>

        <div v-if="loadingStories" class="loading">Loading stories...</div>

        <div v-else-if="stories.length === 0" class="empty-state">
          <i class="fas fa-book"></i>
          <p>No stories yet. Create your first story to get started!</p>
        </div>

        <StoriesTable
          v-else
          :stories="stories"
          :characters="characters"
          @open="openStory"
          @delete="deleteStory"
        />
      </template>

      <!-- Characters Tab -->
      <template #tab-characters>
        <div class="section-header">
          <h2><i class="fas fa-users"></i> Character Library</h2>
        </div>

        <div v-if="loadingCharacters" class="loading">Loading characters...</div>

        <div v-else-if="characters.length === 0" class="empty-state">
          <i class="fas fa-user"></i>
          <p>No characters yet. Import a character to get started!</p>
        </div>

        <CharactersTable
          v-else
          :characters="characters"
          :stories="stories"
          @continue="showCharacterStories"
          @new-story="createStoryWithCharacter"
          @edit="editCharacter"
          @delete="deleteCharacter"
        />
      </template>

      <!-- Lorebooks Tab -->
      <template #tab-lorebooks>
        <div class="section-header">
          <h2><i class="fas fa-book-open"></i> Lorebook Library</h2>
        </div>

        <div v-if="loadingLorebooks" class="loading">Loading lorebooks...</div>

        <div v-else-if="lorebooks.length === 0" class="empty-state">
          <i class="fas fa-book-open"></i>
          <p>No lorebooks yet. Import a lorebook to get started!</p>
        </div>

        <LorebooksTable
          v-else
          :lorebooks="lorebooks"
          @delete="deleteLorebook"
        />
      </template>
    </Tabs>
      </div>
    </main>

    <!-- Character Stories Modal -->
    <CharacterStoriesModal
      v-if="showCharacterStoriesModal"
      :character="selectedCharacter"
      :stories="characterStoriesForModal"
      :all-characters="characters"
      @close="showCharacterStoriesModal = false"
      @open-story="openStory"
      @delete="deleteStory"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storiesAPI, charactersAPI, lorebooksAPI } from '../services/api'
import Tabs from '../components/Tabs.vue'
import StoriesTable from '../components/StoriesTable.vue'
import CharactersTable from '../components/CharactersTable.vue'
import LorebooksTable from '../components/LorebooksTable.vue'
import CharacterStoriesModal from '../components/CharacterStoriesModal.vue'

const router = useRouter()

const stories = ref([])
const characters = ref([])
const lorebooks = ref([])
const loadingStories = ref(true)
const loadingCharacters = ref(true)
const loadingLorebooks = ref(true)

// Character Stories Modal
const showCharacterStoriesModal = ref(false)
const selectedCharacter = ref(null)

const characterStoriesForModal = computed(() => {
  if (!selectedCharacter.value) return []
  return stories.value.filter(story =>
    story.characterIds?.includes(selectedCharacter.value.id) ||
    story.personaCharacterId === selectedCharacter.value.id
  )
})

// Tabs configuration
const tabs = [
  { key: 'stories', label: 'Stories', icon: 'fas fa-book' },
  { key: 'characters', label: 'Characters', icon: 'fas fa-users' },
  { key: 'lorebooks', label: 'Lorebooks', icon: 'fas fa-book-open' }
]

// Active tab with localStorage persistence
const STORAGE_KEY = 'ursceal-active-tab'
const activeTab = ref(localStorage.getItem(STORAGE_KEY) || 'stories')

// Save active tab to localStorage when it changes
watch(activeTab, (newTab) => {
  localStorage.setItem(STORAGE_KEY, newTab)
})

onMounted(async () => {
  await Promise.all([loadStories(), loadCharacters(), loadLorebooks()])
})

async function loadStories() {
  try {
    const { stories: data } = await storiesAPI.list()
    stories.value = data || []
  } catch (error) {
    console.error('Error loading stories:', error)
  } finally {
    loadingStories.value = false
  }
}

async function loadCharacters() {
  try {
    const { characters: data } = await charactersAPI.list()
    characters.value = data || []
  } catch (error) {
    console.error('Error loading characters:', error)
  } finally {
    loadingCharacters.value = false
  }
}

async function loadLorebooks() {
  try {
    const { lorebooks: data } = await lorebooksAPI.list()
    lorebooks.value = data || []
  } catch (error) {
    console.error('Error loading lorebooks:', error)
  } finally {
    loadingLorebooks.value = false
  }
}

async function createNewStory() {
  try {
    const { story } = await storiesAPI.create('Untitled Story')
    openStory(story.id)
  } catch (error) {
    console.error('Error creating story:', error)
    alert('Failed to create story')
  }
}

async function createStoryWithCharacter(characterId) {
  try {
    const character = characters.value.find(c => c.id === characterId)
    const characterName = character?.name || 'Character'

    const { story } = await storiesAPI.create(`Story with ${characterName}`)

    // Add character to story
    const response = await charactersAPI.addToStory(story.id, characterId)

    // If there's a first message, add it
    if (response.processedFirstMessage) {
      await storiesAPI.updateContent(story.id, response.processedFirstMessage + '\n\n')
    }

    openStory(story.id)
  } catch (error) {
    console.error('Error creating story with character:', error)
    alert('Failed to create story')
  }
}

function showCharacterStories(characterId) {
  const character = characters.value.find(c => c.id === characterId)
  if (character) {
    selectedCharacter.value = character
    showCharacterStoriesModal.value = true
  }
}

function openStory(storyId) {
  router.push({ name: 'story', params: { storyId } })
}

function editCharacter(characterId) {
  router.push({ name: 'character-detail', params: { characterId } })
}

async function deleteStory(story) {
  if (!confirm(`Delete story "${story.title}"? This cannot be undone.`)) {
    return
  }

  try {
    await storiesAPI.delete(story.id)
    stories.value = stories.value.filter(s => s.id !== story.id)
    alert('Story deleted successfully')
  } catch (error) {
    console.error('Error deleting story:', error)
    alert('Failed to delete story')
  }
}

async function deleteCharacter(character) {
  const storyCount = stories.value.filter(s =>
    s.characterIds?.includes(character.id) ||
    s.personaCharacterId === character.id
  ).length

  let msg = `Delete character "${character.name}"?`
  if (storyCount > 0) {
    msg += `\n\nWarning: This character appears in ${storyCount} story(ies).`
  }
  msg += '\n\nThis cannot be undone.'

  if (!confirm(msg)) return

  try {
    await charactersAPI.delete(character.id)
    characters.value = characters.value.filter(c => c.id !== character.id)
    alert('Character deleted successfully')
  } catch (error) {
    console.error('Error deleting character:', error)
    alert('Failed to delete character: ' + error.message)
  }
}

async function deleteLorebook(lorebook) {
  if (!confirm(`Delete lorebook "${lorebook.name}"?\n\nThis cannot be undone.`)) {
    return
  }

  try {
    await lorebooksAPI.delete(lorebook.id)
    lorebooks.value = lorebooks.value.filter(l => l.id !== lorebook.id)
    alert('Lorebook deleted successfully')
  } catch (error) {
    console.error('Error deleting lorebook:', error)
    alert('Failed to delete lorebook: ' + error.message)
  }
}
</script>

<style scoped>
.landing-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.app-header {
  background-color: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  padding: 1rem 1.5rem;
  box-shadow: var(--shadow);
  position: relative;
  z-index: 200;
}

.app-header h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--primary-color);
}

.app-main {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
}

.landing-page {
  /* No additional styles needed */
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.section-header h2 {
  margin: 0;
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
}
</style>
