<template>
  <div class="settings-page">
    <!-- Header -->
    <header class="detail-header">
      <div class="header-left">
        <button class="btn btn-secondary btn-small" @click="goBack()">
          <i class="fas fa-arrow-left"></i> Back
        </button>
        <h1 class="settings-title">Settings</h1>
      </div>
    </header>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>Loading settings...</p>
    </div>

    <!-- Main Content -->
    <div v-else class="detail-content">
      <div class="sections-container">
        <!-- Display Settings Section -->
        <section class="edit-section">
          <div class="section-header">
            <h2>Display Settings</h2>
          </div>
          <div class="section-content">
            <div class="checkbox-group">
              <label class="checkbox-label">
                <input type="checkbox" v-model="settings.showReasoning" />
                <span>Show reasoning panel</span>
              </label>
              <p class="help-text">
                Display the model's thinking process alongside generated content.
              </p>
            </div>

            <div class="checkbox-group">
              <label class="checkbox-label">
                <input type="checkbox" v-model="settings.autoSave" />
                <span>Auto-save document</span>
              </label>
              <p class="help-text">
                Automatically save your work every 30 seconds.
              </p>
            </div>
          </div>
        </section>

        <!-- Default Persona Section -->
        <section class="edit-section">
          <div class="section-header">
            <h2>Default Persona</h2>
          </div>
          <div class="section-content">
            <div class="form-group">
              <label for="defaultPersona">Default Persona Character</label>
              <select
                id="defaultPersona"
                v-model="settings.defaultPersonaId"
                class="select-input"
              >
                <option :value="null">None</option>
                <option
                  v-for="char in characters"
                  :key="char.id"
                  :value="char.id"
                >
                  {{ char.name }}
                </option>
              </select>
              <p class="help-text">
                Automatically assign this character as the persona when creating new stories.
              </p>
            </div>
          </div>
        </section>

        <!-- Legacy Lorebook Settings Section (if needed for backwards compat) -->
        <section v-if="false" class="edit-section">
          <div class="section-header">
            <h2>Lorebook Settings</h2>
          </div>
          <div class="section-content">
            <div class="form-group">
              <label for="lorebookScanDepth">Scan Depth (Tokens)</label>
              <input
                id="lorebookScanDepth"
                v-model.number="settings.lorebookScanDepth"
                type="number"
                class="text-input"
                min="100"
                max="8000"
              />
              <p class="help-text">
                How many tokens to scan for lorebook keywords. Higher values check more content but may be slower. Default: 2000 (~8000 chars).
              </p>
            </div>

            <div class="form-group">
              <label for="lorebookTokenBudget">Token Budget</label>
              <input
                id="lorebookTokenBudget"
                v-model.number="settings.lorebookTokenBudget"
                type="number"
                class="text-input"
                min="0"
                max="4000"
              />
              <p class="help-text">
                Maximum tokens for lorebook content in each generation. Higher values allow more context but reduce space for generation. Default: 1800.
              </p>
            </div>

            <div class="form-group">
              <label for="lorebookRecursionDepth">Recursion Depth</label>
              <input
                id="lorebookRecursionDepth"
                v-model.number="settings.lorebookRecursionDepth"
                type="number"
                class="text-input"
                min="0"
                max="10"
              />
              <p class="help-text">
                Maximum cascading activation depth (how many levels of entries can trigger other entries). Default: 3.
              </p>
            </div>

            <div class="checkbox-group">
              <label class="checkbox-label">
                <input type="checkbox" v-model="settings.lorebookEnableRecursion" />
                <span>Enable recursive activation</span>
              </label>
              <p class="help-text">
                Allow lorebook entries to trigger other entries (cascading activation). Disable for simpler, more predictable behavior.
              </p>
            </div>
          </div>
        </section>

      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, nextTick } from 'vue'
import { settingsAPI, charactersAPI } from '../services/api'
import { useToast } from '../composables/useToast'
import { useNavigation } from '../composables/useNavigation'

const toast = useToast()
const { goBack } = useNavigation()

// State
const loading = ref(true)
const saving = ref(false)
const saveTimeout = ref(null)
const isInitialLoad = ref(true)
const originalApiKey = ref('')
const apiKeyChanged = ref(false)
const characters = ref([])
const settings = ref({
  defaultPersonaId: null,
  apiKey: '',
  maxTokens: 4000,
  temperature: 1.5,
  showReasoning: false,
  autoSave: true,
  includeDialogueExamples: true,
  lorebookScanDepth: 2000,
  lorebookTokenBudget: 1800,
  lorebookRecursionDepth: 3,
  lorebookEnableRecursion: true,
})

onMounted(async () => {
  await Promise.all([loadSettings(), loadCharacters()])
})

// Watch for API key changes specifically
watch(() => settings.value.apiKey, (newValue, oldValue) => {
  if (!isInitialLoad.value && newValue !== originalApiKey.value) {
    apiKeyChanged.value = true
  }
})

// Watch for settings changes and auto-save with debounce
watch(settings, () => {
  // Skip saving during initial load
  if (isInitialLoad.value) return

  // Clear existing timeout
  if (saveTimeout.value) {
    clearTimeout(saveTimeout.value)
  }

  // Set new timeout to save after 500ms of no changes
  saveTimeout.value = setTimeout(() => {
    saveSettings()
  }, 500)
}, { deep: true })

async function loadSettings() {
  try {
    loading.value = true
    const response = await settingsAPI.get()

    // Access the settings object from the response
    const serverSettings = response.settings || response

    // Store original API key (or empty if none exists)
    originalApiKey.value = serverSettings.apiKey || ''

    // Merge server settings with defaults
    settings.value = {
      defaultPersonaId: serverSettings.defaultPersonaId || null,
      apiKey: serverSettings.apiKey || '',
      maxTokens: serverSettings.maxTokens ?? 4000,
      temperature: serverSettings.temperature ?? 1.5,
      showReasoning: serverSettings.showReasoning ?? false,
      autoSave: serverSettings.autoSave ?? true,
      includeDialogueExamples: serverSettings.includeDialogueExamples ?? true,
      lorebookScanDepth: serverSettings.lorebookScanDepth ?? 2000,
      lorebookTokenBudget: serverSettings.lorebookTokenBudget ?? 1800,
      lorebookRecursionDepth: serverSettings.lorebookRecursionDepth ?? 3,
      lorebookEnableRecursion: serverSettings.lorebookEnableRecursion ?? true,
    }
  } catch (error) {
    console.error('Failed to load settings:', error)
    toast.error('Failed to load settings: ' + error.message)
  } finally {
    loading.value = false
    // Wait for next tick to ensure watch has processed initial load
    await nextTick()
    // Enable auto-save after initial load
    isInitialLoad.value = false
  }
}

async function loadCharacters() {
  try {
    const { characters: allChars } = await charactersAPI.list()
    characters.value = allChars || []
  } catch (error) {
    console.error('Failed to load characters:', error)
  }
}

async function saveSettings() {
  if (saving.value) return

  try {
    saving.value = true
    await settingsAPI.update(settings.value)
    toast.success('Settings saved')
  } catch (error) {
    console.error('Failed to save settings:', error)
    toast.error('Failed to save settings')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--bg-primary);
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.settings-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
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

.detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
}

.sections-container {
  max-width: 800px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.edit-section {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background-color: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}

.section-header h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.section-content {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.section-description {
  margin: 0 0 1rem 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.text-input,
.select-input {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.5;
  outline: none;
}

.text-input:focus,
.select-input:focus {
  border-color: var(--accent-primary);
}

.select-input {
  cursor: pointer;
}

.checkbox-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
  color: var(--text-primary);
  font-weight: 600;
  font-size: 0.875rem;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.help-text {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.4;
}
</style>
