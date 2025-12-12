<template>
  <div class="landing-wrapper">
    <header class="app-header">
      <h1>Writers Guild</h1>
      <button class="settings-btn" @click="goToSettings" title="Settings">
        <i class="fas fa-cog"></i>
      </button>
    </header>

    <main class="app-main">
      <div class="landing-page">
    <!-- Quick Access Section -->
    <div v-if="!loadingStories && !loadingCharacters && recentCharacters.length > 0" class="quick-access-section">
      <div class="quick-access-scroll">
        <div
          v-for="character in recentCharacters"
          :key="character.id"
          class="quick-access-character"
        >
          <CharacterCard :character="character" />
          <button
            class="btn btn-small btn-primary quick-continue-btn"
            @click="showCharacterStories(character.id)"
          >
            <i class="fas fa-play"></i> Continue
          </button>
        </div>
      </div>
    </div>

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
          <div class="header-actions">
            <button class="btn btn-primary" @click="showCreateCharacterModal = true">
              <i class="fas fa-plus"></i> Create
            </button>
            <button class="btn btn-secondary" @click="showImportCharacterModal = true">
              <i class="fas fa-download"></i> Import
            </button>
          </div>
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
          <div class="header-actions">
            <button class="btn btn-primary" @click="showCreateLorebookModal = true">
              <i class="fas fa-plus"></i> Create
            </button>
            <button class="btn btn-secondary" @click="showImportLorebookModal = true">
              <i class="fas fa-download"></i> Import
            </button>
          </div>
        </div>

        <div v-if="loadingLorebooks" class="loading">Loading lorebooks...</div>

        <div v-else-if="lorebooks.length === 0" class="empty-state">
          <i class="fas fa-book-open"></i>
          <p>No lorebooks yet. Create a lorebook to get started!</p>
        </div>

        <LorebooksTable
          v-else
          :lorebooks="lorebooks"
          @edit="editLorebook"
          @delete="deleteLorebook"
        />
      </template>

      <!-- Presets Tab -->
      <template #tab-presets>
        <div class="section-header">
          <h2><i class="fas fa-sliders"></i> Configuration Presets</h2>
          <button class="btn btn-primary" @click="createNewPreset">
            <i class="fas fa-plus"></i> New Preset
          </button>
        </div>

        <div v-if="loadingPresets" class="loading">Loading presets...</div>

        <div v-else-if="presets.length === 0" class="empty-state">
          <i class="fas fa-sliders"></i>
          <p>No presets yet. Create a preset to get started!</p>
        </div>

        <PresetsTable
          v-else
          :presets="presets"
          :default-preset-id="defaultPresetId"
          @edit="editPreset"
          @duplicate="duplicatePreset"
          @delete="deletePreset"
          @set-default="setDefaultPreset"
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

    <!-- Create Character Modal -->
    <CreateCharacterModal
      v-if="showCreateCharacterModal"
      @close="showCreateCharacterModal = false"
      @created="handleCharacterCreated"
    />

    <!-- Import Character Modal -->
    <ImportCharacterModal
      v-if="showImportCharacterModal"
      @close="showImportCharacterModal = false"
      @imported="handleCharacterImported"
    />

    <!-- Create Lorebook Modal -->
    <CreateLorebookModal
      v-if="showCreateLorebookModal"
      @close="showCreateLorebookModal = false"
      @created="handleLorebookCreated"
    />

    <!-- Import Lorebook Modal -->
    <ImportLorebookModal
      v-if="showImportLorebookModal"
      @close="showImportLorebookModal = false"
      @imported="handleLorebookImported"
    />

    <!-- Provider Selection Modal -->
    <ProviderSelectionModal
      v-if="showProviderSelectionModal"
      @close="showProviderSelectionModal = false"
      @select="handleProviderSelected"
    />

    <!-- Preset Editor Modal -->
    <PresetEditorModal
      v-if="showPresetEditorModal"
      :preset="editingPreset"
      :provider="selectedProvider"
      @close="showPresetEditorModal = false; editingPreset = null; selectedProvider = null"
      @saved="handlePresetSaved"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { storiesAPI, charactersAPI, lorebooksAPI, presetsAPI } from '../services/api'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'
import { useDataCache } from '../composables/useDataCache'
import Tabs from '../components/Tabs.vue'
import StoriesTable from '../components/StoriesTable.vue'
import CharactersTable from '../components/CharactersTable.vue'
import CharacterCard from '../components/CharacterCard.vue'
import LorebooksTable from '../components/LorebooksTable.vue'
import PresetsTable from '../components/PresetsTable.vue'
import CharacterStoriesModal from '../components/CharacterStoriesModal.vue'
import CreateCharacterModal from '../components/CreateCharacterModal.vue'
import ImportCharacterModal from '../components/ImportCharacterModal.vue'
import CreateLorebookModal from '../components/CreateLorebookModal.vue'
import ImportLorebookModal from '../components/ImportLorebookModal.vue'
import PresetEditorModal from '../components/PresetEditorModal.vue'
import ProviderSelectionModal from '../components/ProviderSelectionModal.vue'

const router = useRouter()
const toast = useToast()
const { confirm } = useConfirm()

// Use centralized data cache for better performance
const {
  stories,
  characters,
  lorebooks,
  presets,
  defaultPresetId,
  loadingStories,
  loadingCharacters,
  loadingLorebooks,
  loadingPresets,
  getStoryCount,
  loadStories,
  loadCharacters,
  loadLorebooks,
  loadPresets,
  loadAll,
  removeStoryLocally,
  removeCharacterLocally,
  removeLorebookLocally,
  removePresetLocally,
  setDefaultPresetIdLocally
} = useDataCache()

// Character Stories Modal
const showCharacterStoriesModal = ref(false)
const selectedCharacter = ref(null)

// Create/Import Character Modals
const showCreateCharacterModal = ref(false)
const showImportCharacterModal = ref(false)

// Create/Import Lorebook Modals
const showCreateLorebookModal = ref(false)
const showImportLorebookModal = ref(false)

// Preset Editor Modal
const showPresetEditorModal = ref(false)
const showProviderSelectionModal = ref(false)
const editingPreset = ref(null)
const selectedProvider = ref(null)

const characterStoriesForModal = computed(() => {
  if (!selectedCharacter.value) return []
  return stories.value.filter(story =>
    story.characterIds?.includes(selectedCharacter.value.id) ||
    story.personaCharacterId === selectedCharacter.value.id
  )
})

// Get characters from recently modified stories for quick access
const recentCharacters = computed(() => {
  // Get the last 15 recently modified stories
  const recentStories = stories.value.slice(0, 15)

  // Extract all character IDs from these stories (excluding persona-only characters)
  const characterIds = new Set()
  recentStories.forEach(story => {
    // Only add characters from characterIds array (not persona characters)
    if (story.characterIds) {
      story.characterIds.forEach(id => characterIds.add(id))
    }
  })

  // Map to full character objects and filter out any that don't exist
  return Array.from(characterIds)
    .map(id => characters.value.find(c => c.id === id))
    .filter(char => char != null)
})

// Tabs configuration
const tabs = [
  { key: 'stories', label: 'Stories', icon: 'fas fa-book' },
  { key: 'characters', label: 'Characters', icon: 'fas fa-users' },
  { key: 'lorebooks', label: 'Lorebooks', icon: 'fas fa-book-open' },
  { key: 'presets', label: 'Presets', icon: 'fas fa-sliders' }
]

// Active tab with localStorage persistence
const STORAGE_KEY = 'writers-guild-active-tab'
const activeTab = ref(localStorage.getItem(STORAGE_KEY) || 'stories')

// Save active tab to localStorage when it changes
watch(activeTab, (newTab) => {
  localStorage.setItem(STORAGE_KEY, newTab)
})

onMounted(async () => {
  // Load all data using cache - will skip API calls if data is fresh
  await loadAll()
})

async function createNewStory() {
  try {
    const { story } = await storiesAPI.create('Untitled Story')
    openStory(story.id)
  } catch (error) {
    console.error('Error creating story:', error)
    toast.error('Failed to create story')
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
    toast.error('Failed to create story')
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

function editLorebook(lorebookId) {
  router.push({ name: 'lorebook-detail', params: { lorebookId } })
}

async function deleteStory(story) {
  const confirmed = await confirm({
    message: `Delete story "${story.title}"? This cannot be undone.`,
    confirmText: 'Delete Story',
    variant: 'danger'
  })

  if (!confirmed) return

  try {
    await storiesAPI.delete(story.id)
    removeStoryLocally(story.id)
    toast.success('Story deleted successfully')
  } catch (error) {
    console.error('Error deleting story:', error)
    toast.error('Failed to delete story')
  }
}

async function deleteCharacter(character) {
  const storyCount = getStoryCount(character.id)

  let msg = `Delete character "${character.name}"?`
  if (storyCount > 0) {
    msg += `\n\nWarning: This character appears in ${storyCount} story(ies).`
  }
  msg += '\n\nThis cannot be undone.'

  const confirmed = await confirm({
    message: msg,
    confirmText: 'Delete Character',
    variant: 'danger'
  })

  if (!confirmed) return

  try {
    await charactersAPI.delete(character.id)
    removeCharacterLocally(character.id)
    toast.success('Character deleted successfully')
  } catch (error) {
    console.error('Error deleting character:', error)
    toast.error('Failed to delete character: ' + error.message)
  }
}

async function deleteLorebook(lorebook) {
  const confirmed = await confirm({
    message: `Delete lorebook "${lorebook.name}"?\n\nThis cannot be undone.`,
    confirmText: 'Delete Lorebook',
    variant: 'danger'
  })

  if (!confirmed) return

  try {
    await lorebooksAPI.delete(lorebook.id)
    removeLorebookLocally(lorebook.id)
    toast.success('Lorebook deleted successfully')
  } catch (error) {
    console.error('Error deleting lorebook:', error)
    toast.error('Failed to delete lorebook: ' + error.message)
  }
}

async function handleCharacterCreated(character) {
  // Force reload characters to include the new one
  await loadCharacters(true)
  // Switch to characters tab if not already there
  activeTab.value = 'characters'
}

async function handleCharacterImported(character) {
  // Force reload characters to include the imported one
  await loadCharacters(true)
  // Also force reload lorebooks in case character had embedded lorebook
  await loadLorebooks(true)
  // Switch to characters tab if not already there
  activeTab.value = 'characters'
}

async function handleLorebookCreated(lorebook) {
  // Force reload lorebooks to include the new one
  await loadLorebooks(true)
  // The modal already handles navigation to the editor
}

async function handleLorebookImported(lorebook) {
  // Force reload lorebooks to include the imported one
  await loadLorebooks(true)
  // Switch to lorebooks tab if not already there
  activeTab.value = 'lorebooks'
}

function createNewPreset() {
  editingPreset.value = null
  selectedProvider.value = null
  showProviderSelectionModal.value = true
}

function handleProviderSelected(provider) {
  selectedProvider.value = provider
  showProviderSelectionModal.value = false
  showPresetEditorModal.value = true
}

function editPreset(presetId) {
  editingPreset.value = presets.value.find(p => p.id === presetId)
  selectedProvider.value = null // When editing, provider comes from preset itself
  showPresetEditorModal.value = true
}

async function duplicatePreset(presetId) {
  try {
    const originalPreset = presets.value.find(p => p.id === presetId)
    if (!originalPreset) {
      throw new Error('Preset not found')
    }

    const duplicateData = {
      ...originalPreset,
      name: `${originalPreset.name} (Copy)`
    }
    delete duplicateData.id

    await presetsAPI.create(duplicateData)
    await loadPresets(true)
    toast.success('Preset duplicated successfully')
  } catch (error) {
    console.error('Error duplicating preset:', error)
    toast.error('Failed to duplicate preset: ' + error.message)
  }
}

async function deletePreset(preset) {
  if (preset.id === defaultPresetId.value) {
    toast.error('Cannot delete the default preset. Set another preset as default first.')
    return
  }

  const confirmed = await confirm({
    message: `Delete preset "${preset.name}"?\n\nThis cannot be undone.`,
    confirmText: 'Delete Preset',
    variant: 'danger'
  })

  if (!confirmed) return

  try {
    await presetsAPI.delete(preset.id)
    removePresetLocally(preset.id)
    toast.success('Preset deleted successfully')
  } catch (error) {
    console.error('Error deleting preset:', error)
    toast.error('Failed to delete preset: ' + error.message)
  }
}

async function setDefaultPreset(presetId) {
  try {
    await presetsAPI.setDefaultId(presetId)
    setDefaultPresetIdLocally(presetId)
    toast.success('Default preset updated')
  } catch (error) {
    console.error('Error setting default preset:', error)
    toast.error('Failed to set default preset: ' + error.message)
  }
}

async function handlePresetSaved() {
  showPresetEditorModal.value = false
  editingPreset.value = null
  await loadPresets(true)
  toast.success('Preset saved successfully')
}

function goToSettings() {
  router.push('/settings')
}
</script>

<style scoped>
.landing-wrapper {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow-y: auto;
}

.app-header {
  background-color: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  padding: 1rem 1.5rem;
  box-shadow: var(--shadow);
  position: sticky;
  top: 0;
  z-index: 200;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.app-header h1 {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--primary-color);
}

.settings-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.5rem;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;
}

.settings-btn:hover {
  color: var(--text-primary);
  background-color: var(--bg-secondary);
}

.app-main {
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

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
}

/* Quick Access Section */
.quick-access-section {
  margin-bottom: 2rem;
  background-color: var(--bg-secondary);
  border-radius: 8px;
  padding: 1.25rem;
  border: 1px solid var(--border-color);
}

.quick-access-scroll {
  display: flex;
  gap: 1rem;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.quick-access-scroll::-webkit-scrollbar {
  display: none;
}

.quick-access-character {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 210px;
}

.quick-continue-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  font-size: 0.875rem;
  padding: 0.5rem 0.75rem;
}
</style>
