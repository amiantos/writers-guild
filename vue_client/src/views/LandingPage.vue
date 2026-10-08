<template>
  <div class="landing-wrapper">
    <header class="app-header">
      <div class="header-inner">
        <h1 class="brand">Writers Guild</h1>
        <nav class="section-nav" aria-label="Sections">
          <button
            v-for="section in sections"
            :key="section.key"
            type="button"
            class="section-link"
            :aria-current="activeSection === section.key ? 'page' : undefined"
            @click="activeSection = section.key"
          >
            {{ section.label }}
          </button>
        </nav>
        <h1 class="mobile-title">{{ activeSectionLabel }}</h1>
        <div class="header-actions">
          <label v-if="onShelf" class="search search-inline">
            <i class="fas fa-magnifying-glass"></i>
            <input
              v-model="searchQuery"
              type="search"
              :placeholder="searchLabel"
              :aria-label="searchLabel"
            />
          </label>
          <button
            v-if="onShelf"
            type="button"
            class="icon-btn search-toggle"
            :aria-label="searchOpen ? 'Close search' : searchLabel"
            :aria-expanded="searchOpen"
            @click="toggleSearch"
          >
            <i :class="searchOpen ? 'fas fa-xmark' : 'fas fa-magnifying-glass'"></i>
          </button>
          <button type="button" class="icon-btn" aria-label="Settings" @click="goToSettings">
            <i class="fas fa-cog"></i>
          </button>
          <template v-if="activeSection === 'stories'">
            <button
              v-if="chatsEnabled"
              type="button"
              class="btn btn-secondary header-btn header-secondary"
              @click="createNewChat"
            >
              <i class="fas fa-comment"></i> New chat
            </button>
            <button type="button" class="btn btn-primary header-btn" @click="openNewSheet">
              <i class="fas fa-plus"></i> New story
            </button>
          </template>
          <template v-else-if="activeSection === 'characters'">
            <button
              type="button"
              class="btn btn-secondary header-btn header-secondary"
              @click="showImportCharacterModal = true"
            >
              <i class="fas fa-download"></i> Import
            </button>
            <button type="button" class="btn btn-primary header-btn" @click="openNewSheet">
              <i class="fas fa-plus"></i> New character
            </button>
          </template>
        </div>
      </div>
      <!-- Narrower screens search from a row under the bar -->
      <div v-if="searchOpen && onShelf" class="search-row">
        <label class="search">
          <i class="fas fa-magnifying-glass"></i>
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="search"
            :placeholder="searchLabel"
            :aria-label="searchLabel"
          />
        </label>
      </div>
    </header>

    <main class="app-main">
      <LibraryView
        v-if="activeSection === 'stories'"
        ref="library"
        :stories="stories"
        :chats="chats"
        :characters="characters"
        :continuities="continuities"
        :presets="presets"
        :default-preset-id="defaultPresetId"
        :chats-enabled="chatsEnabled"
        :query="queries.stories"
        :initial-filter="libraryFilter"
        :loading="loadingStories || loadingCharacters"
        @open-story="openStory"
        @open-chat="openChat"
        @edit-story="editStory"
        @new-from="startNewStory"
        @duplicate="duplicateStory"
        @delete-story="deleteStory"
        @delete-chat="deleteChat"
        @new-blank="createNewStory"
        @new-with-character="createStoryWithCharacter"
        @new-chat="createNewChat"
      />

      <CharacterShelf
        v-else-if="activeSection === 'characters'"
        ref="characterShelf"
        :characters="characters"
        :stories="stories"
        :chats="chats"
        :continuities="continuities"
        :chats-enabled="chatsEnabled"
        :query="queries.characters"
        :loading="loadingStories || loadingCharacters"
        @new-story="createStoryWithCharacter"
        @open-story="openStory"
        @open-chat="openChat"
        @edit="editCharacter"
        @delete="deleteCharacter"
        @show-in-library="showCharacterInLibrary"
        @create="showCreateCharacterModal = true"
        @generate="showCharacterGeneratorModal = true"
        @import="showImportCharacterModal = true"
      />

      <template v-else-if="activeSection === 'lorebooks'">
        <div class="section-header">
          <h2><i class="fas fa-book-open"></i> Lorebook Library</h2>
          <div class="section-actions">
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

      <template v-else-if="activeSection === 'presets'">
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
    </main>

    <button v-if="onShelf" type="button" class="new-fab" @click="openNewSheet">
      <i class="fas fa-plus"></i> New
    </button>

    <nav class="bottom-nav" aria-label="Sections">
      <button
        v-for="section in sections"
        :key="section.key"
        type="button"
        :aria-current="activeSection === section.key ? 'page' : undefined"
        @click="activeSection = section.key"
      >
        <i :class="section.icon"></i>
        <span>{{ section.label }}</span>
      </button>
    </nav>

    <!-- Create Character Modal -->
    <CreateCharacterModal
      v-if="showCreateCharacterModal"
      @close="showCreateCharacterModal = false"
      @created="handleCharacterCreated"
    />

    <!-- Character Generator Modal -->
    <CharacterGeneratorModal
      v-if="showCharacterGeneratorModal"
      :presets="presets"
      :lorebooks="lorebooks"
      @close="showCharacterGeneratorModal = false"
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
      @close="
        showPresetEditorModal = false;
        editingPreset = null;
        selectedProvider = null;
      "
      @saved="handlePresetSaved"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import {
  storiesAPI,
  charactersAPI,
  lorebooksAPI,
  presetsAPI,
  settingsAPI,
  continuitiesAPI,
} from '../services/api';
import { useToast } from '../composables/useToast';
import { useConfirm } from '../composables/useConfirm';
import { useDataCache } from '../composables/useDataCache';
import { useCharacterDeletion } from '../composables/useCharacterDeletion';
import LibraryView from '../components/library/LibraryView.vue';
import CharacterShelf from '../components/characters/CharacterShelf.vue';
import LorebooksTable from '../components/LorebooksTable.vue';
import PresetsTable from '../components/PresetsTable.vue';
import CreateCharacterModal from '../components/CreateCharacterModal.vue';
import ImportCharacterModal from '../components/ImportCharacterModal.vue';
import CharacterGeneratorModal from '../components/CharacterGeneratorModal.vue';
import CreateLorebookModal from '../components/CreateLorebookModal.vue';
import ImportLorebookModal from '../components/ImportLorebookModal.vue';
import PresetEditorModal from '../components/PresetEditorModal.vue';
import ProviderSelectionModal from '../components/ProviderSelectionModal.vue';
import { chatsAPI } from '../services/chatsApi';

const router = useRouter();
const toast = useToast();
const { confirm } = useConfirm();
const { deleteCharacter } = useCharacterDeletion();

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
  loadStories,
  loadCharacters,
  loadLorebooks,
  loadPresets,
  loadAll,
  invalidateCache,
  removeStoryLocally,
  removeLorebookLocally,
  removePresetLocally,
  setDefaultPresetIdLocally,
} = useDataCache();

// Create/Import Character Modals
const showCreateCharacterModal = ref(false);
const showImportCharacterModal = ref(false);
const showCharacterGeneratorModal = ref(false);

// Create/Import Lorebook Modals
const showCreateLorebookModal = ref(false);
const showImportLorebookModal = ref(false);

// Preset Editor Modal
const showPresetEditorModal = ref(false);
const showProviderSelectionModal = ref(false);
const editingPreset = ref(null);
const selectedProvider = ref(null);

// Chats are experimental: once they're turned on in Settings, they share the shelf with stories.
const chatsEnabled = ref(false);

const sections = [
  { key: 'stories', label: 'Stories', icon: 'fas fa-book' },
  { key: 'characters', label: 'Characters', icon: 'fas fa-users' },
  { key: 'lorebooks', label: 'Lorebooks', icon: 'fas fa-book-open' },
  { key: 'presets', label: 'Presets', icon: 'fas fa-sliders' },
];

// Active section, remembered per browser. One that no longer exists, such as Chats or Bureaus,
// falls back to Stories.
const STORAGE_KEY = 'writers-guild-active-tab';

function readSavedSection() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

const savedSection = readSavedSection();
const activeSection = ref(
  sections.some((section) => section.key === savedSection) ? savedSection : 'stories',
);

watch(activeSection, (section) => {
  try {
    localStorage.setItem(STORAGE_KEY, section);
  } catch {
    // Storage unavailable: the section lasts until reload.
  }
});

const activeSectionLabel = computed(
  () => sections.find((section) => section.key === activeSection.value)?.label,
);

// The stories' and characters' shelves each keep their own search in the header, and their own
// New sheet
const library = ref(null);
const characterShelf = ref(null);
const queries = ref({ stories: '', characters: '' });
const searchOpen = ref(false);
const searchInput = ref(null);

const onShelf = computed(() => activeSection.value in queries.value);
const searchLabel = computed(() =>
  activeSection.value === 'characters' ? 'Search characters' : 'Search stories',
);
const searchQuery = computed({
  get: () => queries.value[activeSection.value] ?? '',
  set: (value) => {
    queries.value[activeSection.value] = value;
  },
});

async function toggleSearch() {
  searchOpen.value = !searchOpen.value;
  if (searchOpen.value) {
    await nextTick();
    searchInput.value?.focus();
  } else {
    searchQuery.value = '';
  }
}

function openNewSheet() {
  (activeSection.value === 'characters' ? characterShelf : library).value?.openNew();
}

// A character's sheet opens all their stories and chats on the stories' shelf, filtered to them.
const libraryFilter = ref(null);

function showCharacterInLibrary(characterId) {
  libraryFilter.value = { kind: 'character', id: characterId };
  queries.value.stories = '';
  activeSection.value = 'stories';
}

watch(activeSection, (section) => {
  if (section !== 'stories') libraryFilter.value = null;
});

const chats = ref([]);
const loadingChats = ref(false);

// Continuities name and color the cards that use them.
const continuities = ref([]);

async function loadContinuities() {
  try {
    const { continuities: list } = await continuitiesAPI.list();
    continuities.value = list;
  } catch (error) {
    console.error('Error loading continuities:', error);
  }
}

async function loadExperimentalFeatures() {
  try {
    const { settings } = await settingsAPI.get();
    chatsEnabled.value = Boolean(settings?.experimentalChats);
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
  if (chatsEnabled.value) await loadChats();
}

async function loadChats() {
  loadingChats.value = true;
  try {
    const { chats: list } = await chatsAPI.list();
    chats.value = list;
  } catch (error) {
    console.error('Error loading chats:', error);
    toast.error('Failed to load chats');
  } finally {
    loadingChats.value = false;
  }
}

async function createNewChat() {
  try {
    const { chat } = await chatsAPI.create({});
    openChat(chat.id);
  } catch (error) {
    console.error('Error creating chat:', error);
    toast.error('Failed to create chat');
  }
}

function openChat(chatId) {
  router.push({ name: 'chat', params: { chatId } });
}

async function deleteChat(chat) {
  const confirmed = await confirm({
    message: `Delete chat "${chat.title}"? This cannot be undone.`,
    confirmText: 'Delete Chat',
    variant: 'danger',
  });

  if (!confirmed) return;

  try {
    await chatsAPI.delete(chat.id);
    chats.value = chats.value.filter((item) => item.id !== chat.id);
    toast.success('Chat deleted successfully');
  } catch (error) {
    console.error('Error deleting chat:', error);
    toast.error('Failed to delete chat');
  }
}

onMounted(async () => {
  // Load all data using cache - will skip API calls if data is fresh
  await Promise.all([loadAll(), loadExperimentalFeatures(), loadContinuities()]);
});

async function createNewStory() {
  try {
    const { story } = await storiesAPI.create('Untitled Story');
    // Invalidate stories cache so it refreshes when returning to dashboard
    invalidateCache('stories');
    // A blank story opens on Edit Story, to pick its characters and setup
    router.push({ name: 'story', params: { storyId: story.id }, query: { edit: '1' } });
  } catch (error) {
    console.error('Error creating story:', error);
    toast.error('Failed to create story');
  }
}

async function createStoryWithCharacter(characterId) {
  try {
    const character = characters.value.find((c) => c.id === characterId);
    const characterName = character?.name || 'Character';

    const { story } = await storiesAPI.create(`Story with ${characterName}`);

    // Add character to story
    await charactersAPI.addToStory(story.id, characterId);

    // Set rewrite prompt flag so StoryEditor shows the greeting selector on load
    await storiesAPI.setRewritePrompt(story.id, true);

    // Invalidate stories cache so it refreshes when returning to dashboard
    invalidateCache('stories');

    openStory(story.id);
  } catch (error) {
    console.error('Error creating story with character:', error);
    toast.error('Failed to create story');
  }
}

function openStory(storyId) {
  router.push({ name: 'story', params: { storyId } });
}

/** Open a story on its Edit Story modal. */
function editStory(storyId) {
  router.push({ name: 'story', params: { storyId }, query: { edit: '1' } });
}

function editCharacter(characterId) {
  router.push({ name: 'character-detail', params: { characterId } });
}

function editLorebook(lorebookId) {
  router.push({ name: 'lorebook-detail', params: { lorebookId } });
}

/** Start a new, empty story with this one's setup, opened on Edit Story. */
async function startNewStory(story) {
  try {
    const { story: newStory } = await storiesAPI.duplicate(story.id, { blank: true });
    invalidateCache('stories');
    router.push({ name: 'story', params: { storyId: newStory.id }, query: { edit: '1' } });
  } catch (error) {
    console.error('Error starting a new story:', error);
    toast.error('Failed to start a new story: ' + error.message);
  }
}

async function duplicateStory(story) {
  try {
    await storiesAPI.duplicate(story.id);
    await loadStories(true);
    toast.success('Story duplicated successfully');
  } catch (error) {
    console.error('Error duplicating story:', error);
    toast.error('Failed to duplicate story: ' + error.message);
  }
}

async function deleteStory(story) {
  const confirmed = await confirm({
    message: `Delete story "${story.title}"? This cannot be undone.`,
    confirmText: 'Delete Story',
    variant: 'danger',
  });

  if (!confirmed) return;

  try {
    await storiesAPI.delete(story.id);
    removeStoryLocally(story.id);
    toast.success('Story deleted successfully');
  } catch (error) {
    console.error('Error deleting story:', error);
    toast.error('Failed to delete story');
  }
}

async function deleteLorebook(lorebook) {
  const confirmed = await confirm({
    message: `Delete lorebook "${lorebook.name}"?\n\nThis cannot be undone.`,
    confirmText: 'Delete Lorebook',
    variant: 'danger',
  });

  if (!confirmed) return;

  try {
    await lorebooksAPI.delete(lorebook.id);
    removeLorebookLocally(lorebook.id);
    toast.success('Lorebook deleted successfully');
  } catch (error) {
    console.error('Error deleting lorebook:', error);
    toast.error('Failed to delete lorebook: ' + error.message);
  }
}

async function handleCharacterCreated(character) {
  // Force reload characters to include the new one
  await loadCharacters(true);
  // Switch to the characters section if not already there
  activeSection.value = 'characters';
}

async function handleCharacterImported(character) {
  // Force reload characters to include the imported one
  await loadCharacters(true);
  // Also force reload lorebooks in case character had embedded lorebook
  await loadLorebooks(true);
  // Switch to the characters section if not already there
  activeSection.value = 'characters';
}

async function handleLorebookCreated(lorebook) {
  // Force reload lorebooks to include the new one
  await loadLorebooks(true);
  // The modal already handles navigation to the editor
}

async function handleLorebookImported(lorebook) {
  // Force reload lorebooks to include the imported one
  await loadLorebooks(true);
  // Switch to the lorebooks section if not already there
  activeSection.value = 'lorebooks';
}

function createNewPreset() {
  editingPreset.value = null;
  selectedProvider.value = null;
  showProviderSelectionModal.value = true;
}

function handleProviderSelected(provider) {
  selectedProvider.value = provider;
  showProviderSelectionModal.value = false;
  showPresetEditorModal.value = true;
}

function editPreset(presetId) {
  editingPreset.value = presets.value.find((p) => p.id === presetId);
  selectedProvider.value = null; // When editing, provider comes from preset itself
  showPresetEditorModal.value = true;
}

async function duplicatePreset(presetId) {
  try {
    const originalPreset = presets.value.find((p) => p.id === presetId);
    if (!originalPreset) {
      throw new Error('Preset not found');
    }

    const duplicateData = {
      ...originalPreset,
      name: `${originalPreset.name} (Copy)`,
    };
    delete duplicateData.id;

    await presetsAPI.create(duplicateData);
    await loadPresets(true);
    toast.success('Preset duplicated successfully');
  } catch (error) {
    console.error('Error duplicating preset:', error);
    toast.error('Failed to duplicate preset: ' + error.message);
  }
}

async function deletePreset(preset) {
  if (preset.id === defaultPresetId.value) {
    toast.error('Cannot delete the default preset. Set another preset as default first.');
    return;
  }

  const confirmed = await confirm({
    message: `Delete preset "${preset.name}"?\n\nThis cannot be undone.`,
    confirmText: 'Delete Preset',
    variant: 'danger',
  });

  if (!confirmed) return;

  try {
    await presetsAPI.delete(preset.id);
    removePresetLocally(preset.id);
    toast.success('Preset deleted successfully');
  } catch (error) {
    console.error('Error deleting preset:', error);
    toast.error('Failed to delete preset: ' + error.message);
  }
}

async function setDefaultPreset(presetId) {
  try {
    await presetsAPI.setDefaultId(presetId);
    setDefaultPresetIdLocally(presetId);
    toast.success('Default preset updated');
  } catch (error) {
    console.error('Error setting default preset:', error);
    toast.error('Failed to set default preset: ' + error.message);
  }
}

async function handlePresetSaved() {
  showPresetEditorModal.value = false;
  editingPreset.value = null;
  await loadPresets(true);
  toast.success('Preset saved successfully');
}

function goToSettings() {
  router.push('/settings');
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
  box-shadow: var(--shadow);
  position: sticky;
  top: 0;
  z-index: 200;
}

.header-inner {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0.75rem 2rem;
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.brand {
  flex: none;
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.375rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--primary-color);
}

.mobile-title {
  display: none;
}

.section-nav {
  flex: none;
  display: flex;
  gap: 4px;
}

.section-link {
  padding: 0.625rem 0.875rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  white-space: nowrap;
}

.section-link:hover {
  color: var(--text-primary);
}

.section-link[aria-current='page'] {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-weight: 600;
}

.header-actions {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.search {
  flex: 0 1 240px;
  min-width: 140px;
  height: 40px;
  box-sizing: border-box;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.search input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 0.875rem;
}

.search:focus-within {
  border-color: var(--accent-primary);
}

.search-toggle,
.search-row {
  display: none !important;
}

.header-btn {
  flex: none;
  height: 40px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  white-space: nowrap;
}

.app-main {
  padding: 2.5rem 2rem 4rem;
  max-width: 1400px;
  margin: 0 auto;
  width: 100%;
  box-sizing: border-box;
}

.section-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.section-header h2 {
  margin: 0;
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.section-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
}

.new-fab,
.bottom-nav {
  display: none;
}

/* Tablets and narrow windows: search folds into a button, and New chat and Import into the New
   sheets */
@media (max-width: 1279px) {
  .search-inline,
  .header-secondary {
    display: none;
  }

  .search-toggle {
    display: flex !important;
  }

  .header-inner {
    padding: 0.75rem 1.25rem;
    gap: 1rem;
  }

  .search-row {
    display: block !important;
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 1.25rem 0.75rem;
  }

  .app-main {
    padding: 2rem 1.25rem 4rem;
  }

  .search-row .search {
    width: 100%;
  }
}

/* Phones and tablets in portrait: sections move to a tab bar, and New floats over the shelf */
@media (max-width: 900px) {
  .header-inner {
    padding: 0.5rem 0.5rem 0.5rem 1rem;
    gap: 0.5rem;
  }

  .brand,
  .section-nav,
  .header-btn {
    display: none;
  }

  .mobile-title {
    display: block;
    flex: 1;
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.625rem;
    line-height: 1.2;
    font-weight: 600;
  }

  .header-actions {
    flex: none;
    gap: 0;
  }

  .header-actions .icon-btn {
    width: 44px;
    height: 44px;
  }

  .search-row {
    padding: 0 1rem 0.75rem;
  }

  .app-main {
    padding: 1rem 1rem calc(10rem + env(safe-area-inset-bottom));
  }

  .section-header h2 {
    font-size: 1.25rem;
  }

  .new-fab {
    position: fixed;
    right: 1rem;
    bottom: calc(5.75rem + env(safe-area-inset-bottom));
    z-index: 210;
    height: 56px;
    padding: 0 1.375rem 0 1.125rem;
    border: none;
    border-radius: 28px;
    background: var(--accent-primary);
    color: #fff;
    font-size: 0.9375rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  }

  .bottom-nav {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 210;
    padding-bottom: env(safe-area-inset-bottom);
    border-top: 1px solid var(--border-color);
    background: var(--bg-primary);
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .bottom-nav button {
    height: 64px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.72rem;
    font-weight: 500;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }

  .bottom-nav button i {
    font-size: 1.25rem;
  }

  .bottom-nav button[aria-current='page'] {
    color: var(--accent-primary);
    font-weight: 600;
  }
}
</style>
