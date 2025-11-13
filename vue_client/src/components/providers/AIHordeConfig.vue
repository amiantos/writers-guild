<template>
  <div class="provider-config">
    <!-- API Configuration -->
    <section class="form-section">
      <h3 class="section-title">API Configuration</h3>

      <div class="form-group">
        <label for="apiKey">API Key</label>
        <input
          id="apiKey"
          v-model="localApiConfig.apiKey"
          type="password"
          class="text-input"
          placeholder="0000000000 for anonymous"
        />
        <small class="help-text">Use "0000000000" for anonymous access, or get an API key from https://aihorde.net</small>
      </div>

      <div v-if="showAdvancedApiConfig" class="form-group">
        <label for="baseURL">Base URL</label>
        <input
          id="baseURL"
          v-model="localApiConfig.baseURL"
          type="text"
          class="text-input"
          placeholder="https://aihorde.net/api/v2"
        />
        <small class="help-text">Leave empty to use default</small>
      </div>

      <div class="form-group">
        <h4 class="subsection-title">Model Selection</h4>
        <p class="section-description">
          Select which models to use from the AI Horde. Multiple models can be selected to increase availability and reduce queue times.
        </p>

        <div class="horde-actions">
          <button
            type="button"
            class="btn btn-secondary btn-small"
            @click="fetchHordeModels"
            :disabled="loadingHordeModels"
          >
            <i :class="loadingHordeModels ? 'fas fa-spinner fa-spin' : 'fas fa-sync'"></i>
            {{ loadingHordeModels ? 'Loading...' : 'Fetch Available Models' }}
          </button>
          <button
            v-if="availableHordeModels.length > 0"
            type="button"
            class="btn btn-primary btn-small"
            @click="autoSelectHordeModels"
          >
            <i class="fas fa-magic"></i>
            Auto-Select Recommended
          </button>
        </div>

        <div v-if="hordeModelsError" class="error-message">
          {{ hordeModelsError }}
        </div>

        <div v-if="availableHordeModels.length > 0" class="models-list">
          <div class="models-header">
            <span>{{ selectedModelsCount }} of {{ availableHordeModels.length }} models selected</span>
            <button type="button" class="btn-link-small" @click="clearSelectedModels">Clear All</button>
          </div>

          <div class="models-grid">
            <label
              v-for="model in availableHordeModels"
              :key="model.name"
              class="model-item"
              :class="{ 'model-selected': isModelSelected(model.name) }"
            >
              <input
                type="checkbox"
                :value="model.name"
                v-model="localModels"
              />
              <div class="model-info">
                <span class="model-name">{{ model.name }}</span>
                <span class="model-meta">
                  <span class="model-badge">{{ model.count }} workers</span>
                  <span v-if="model.queued > 0" class="model-badge queue">{{ model.queued }} queued</span>
                </span>
              </div>
            </label>
          </div>
        </div>

        <div v-else-if="!loadingHordeModels" class="help-text">
          Click "Fetch Available Models" to see currently available AI Horde models.
        </div>
      </div>

      <button
        type="button"
        class="btn-link"
        @click="showAdvancedApiConfig = !showAdvancedApiConfig"
      >
        {{ showAdvancedApiConfig ? 'Hide' : 'Show' }} Advanced API Options
      </button>
    </section>

    <!-- Generation Settings -->
    <section class="form-section">
      <h3 class="section-title">Generation Settings</h3>

      <div class="form-group">
        <label for="maxTokens">
          Max Tokens: {{ localGenerationSettings.maxTokens }}
        </label>
        <input
          id="maxTokens"
          v-model.number="localGenerationSettings.maxTokens"
          type="range"
          min="100"
          max="8000"
          step="100"
          class="range-input"
        />
        <small class="help-text">Maximum tokens to generate (100-8000)</small>
      </div>

      <div class="form-group">
        <label for="temperature">
          Temperature: {{ localGenerationSettings.temperature.toFixed(2) }}
        </label>
        <input
          id="temperature"
          v-model.number="localGenerationSettings.temperature"
          type="range"
          min="0"
          max="2"
          step="0.05"
          class="range-input"
        />
        <small class="help-text">Creativity/randomness (0 = focused, 2 = creative)</small>
      </div>

      <div class="form-group">
        <label for="maxContextTokens">
          Max Context Tokens: {{ (localGenerationSettings.maxContextTokens / 1000).toFixed(0) }}k
        </label>
        <input
          id="maxContextTokens"
          v-model.number="localGenerationSettings.maxContextTokens"
          type="range"
          min="2000"
          max="16000"
          step="1000"
          class="range-input"
        />
        <small class="help-text">
          Context window fallback (2k-16k tokens). Automatically calculated based on selected models and their worker availability.
        </small>
      </div>

      <div class="form-group checkbox-group">
        <label>
          <input
            type="checkbox"
            v-model="localGenerationSettings.includeDialogueExamples"
          />
          Include dialogue examples from character cards
        </label>
      </div>
    </section>

    <!-- Lorebook Settings -->
    <section class="form-section">
      <h3 class="section-title">Lorebook Settings</h3>

      <div class="form-group">
        <label for="scanDepth">
          Scan Depth: {{ localLorebookSettings.scanDepth }} tokens
        </label>
        <input
          id="scanDepth"
          v-model.number="localLorebookSettings.scanDepth"
          type="range"
          min="500"
          max="4000"
          step="100"
          class="range-input"
        />
        <small class="help-text">How much of the story to scan for keywords</small>
      </div>

      <div class="form-group">
        <label for="tokenBudget">
          Token Budget: {{ localLorebookSettings.tokenBudget }} tokens
        </label>
        <input
          id="tokenBudget"
          v-model.number="localLorebookSettings.tokenBudget"
          type="range"
          min="500"
          max="4000"
          step="100"
          class="range-input"
        />
        <small class="help-text">Maximum tokens for lorebook content</small>
      </div>

      <div class="form-group">
        <label for="recursionDepth">
          Recursion Depth: {{ localLorebookSettings.recursionDepth }}
        </label>
        <input
          id="recursionDepth"
          v-model.number="localLorebookSettings.recursionDepth"
          type="range"
          min="0"
          max="5"
          step="1"
          class="range-input"
        />
        <small class="help-text">How many levels of cascading entries to allow</small>
      </div>

      <div class="form-group checkbox-group">
        <label>
          <input
            type="checkbox"
            v-model="localLorebookSettings.enableRecursion"
          />
          Enable recursive activation
        </label>
        <small class="help-text">Allow lorebook entries to trigger other entries</small>
      </div>
    </section>

    <!-- Prompt Templates (Optional/Advanced) -->
    <div v-if="showPromptTemplates">
      <section class="form-section">
        <h3 class="section-title">Prompt Templates (Advanced)</h3>
        <p class="section-description">
          Customize the instructions sent to the AI. Use <code v-text="'{{char}}'"></code>,
          <code v-text="'{{instruction}}'"></code>, and <code v-text="'{{storyContent}}'"></code> as placeholders.
        </p>

        <div class="form-group">
          <label for="templateContinue">Continue Template</label>
          <textarea
            id="templateContinue"
            v-model="localPromptTemplates.continue"
            class="textarea-input"
            rows="3"
            placeholder="Continue the story naturally..."
          ></textarea>
        </div>

        <div class="form-group">
          <label for="templateCharacter">Character Response Template</label>
          <textarea
            id="templateCharacter"
            v-model="localPromptTemplates.character"
            class="textarea-input"
            rows="3"
            placeholder="Write from {char}'s perspective..."
          ></textarea>
        </div>

        <div class="form-group">
          <label for="templateInstruction">Custom Instruction Template</label>
          <textarea
            id="templateInstruction"
            v-model="localPromptTemplates.instruction"
            class="textarea-input"
            rows="2"
            placeholder="{instruction}"
          ></textarea>
        </div>

        <div class="form-group">
          <label for="templateRewrite">Rewrite to Third Person Template</label>
          <textarea
            id="templateRewrite"
            v-model="localPromptTemplates.rewriteThirdPerson"
            class="textarea-input"
            rows="3"
            placeholder="Rewrite to third person..."
          ></textarea>
        </div>
      </section>
    </div>

    <button
      type="button"
      class="btn-link"
      @click="showPromptTemplates = !showPromptTemplates"
    >
      {{ showPromptTemplates ? 'Hide' : 'Show' }} Prompt Templates (Advanced)
    </button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { presetsAPI } from '../../services/api'
import { useToast } from '../../composables/useToast'

const props = defineProps({
  config: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:config'])

const toast = useToast()

const showAdvancedApiConfig = ref(false)
const showPromptTemplates = ref(false)

// AI Horde model selection state
const availableHordeModels = ref([])
const loadingHordeModels = ref(false)
const hordeModelsError = ref(null)
const recommendedHordeModels = ref([])

// Create local computed properties for each section that syncs with parent
const localApiConfig = computed({
  get() {
    return props.config.apiConfig || {}
  },
  set(value) {
    emit('update:config', { ...props.config, apiConfig: value })
  }
})

const localGenerationSettings = computed({
  get() {
    return props.config.generationSettings || {}
  },
  set(value) {
    emit('update:config', { ...props.config, generationSettings: value })
  }
})

const localLorebookSettings = computed({
  get() {
    return props.config.lorebookSettings || {}
  },
  set(value) {
    emit('update:config', { ...props.config, lorebookSettings: value })
  }
})

const localPromptTemplates = computed({
  get() {
    return props.config.promptTemplates || {}
  },
  set(value) {
    emit('update:config', { ...props.config, promptTemplates: value })
  }
})

// Local models array that syncs with apiConfig.models
const localModels = computed({
  get() {
    return localApiConfig.value.models || []
  },
  set(value) {
    localApiConfig.value = {
      ...localApiConfig.value,
      models: value
    }
  }
})

const selectedModelsCount = computed(() => {
  return localModels.value.length
})

// AI Horde model selection methods
async function fetchHordeModels() {
  try {
    loadingHordeModels.value = true
    hordeModelsError.value = null

    const response = await presetsAPI.getAIHordeModels()
    availableHordeModels.value = response.models || []
    recommendedHordeModels.value = response.autoSelected || []

    if (availableHordeModels.value.length === 0) {
      hordeModelsError.value = 'No models available at this time'
    }
  } catch (error) {
    console.error('Failed to fetch AI Horde models:', error)
    hordeModelsError.value = 'Failed to fetch models: ' + error.message
  } finally {
    loadingHordeModels.value = false
  }
}

function autoSelectHordeModels() {
  if (recommendedHordeModels.value.length > 0) {
    localModels.value = [...recommendedHordeModels.value]
    toast.success(`Selected ${recommendedHordeModels.value.length} recommended models`)
  }
}

function clearSelectedModels() {
  localModels.value = []
}

function isModelSelected(modelName) {
  return localModels.value.includes(modelName)
}
</script>

<style scoped>
.provider-config {
  margin-bottom: 1rem;
}

.form-section {
  margin-bottom: 2rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid var(--border-color);
}

.form-section:last-child {
  border-bottom: none;
}

.section-title {
  margin: 0 0 0.5rem 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--text-primary);
}

.subsection-title {
  margin: 1rem 0 0.5rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.section-description {
  margin: 0 0 1rem 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.section-description code {
  background-color: var(--bg-tertiary);
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.85em;
  color: var(--text-primary);
}

.form-group {
  margin-bottom: 1.25rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--text-primary);
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: normal;
}

.checkbox-group input[type="checkbox"] {
  width: auto;
  margin: 0;
}

.text-input,
.textarea-input {
  width: 100%;
  padding: 0.6rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.95rem;
  font-family: inherit;
}

.text-input:focus,
.textarea-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.range-input {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: var(--border-color);
  outline: none;
}

.range-input::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent-primary);
  cursor: pointer;
}

.range-input::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent-primary);
  cursor: pointer;
  border: none;
}

.help-text {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.btn-link {
  background: none;
  border: none;
  color: var(--accent-primary);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0.5rem 0;
  text-decoration: underline;
}

.btn-link:hover {
  opacity: 0.8;
}

/* AI Horde specific styles */
.horde-actions {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.btn-small {
  padding: 0.5rem 0.9rem;
  font-size: 0.85rem;
}

.error-message {
  padding: 0.75rem;
  background-color: #fee;
  border: 1px solid #fcc;
  border-radius: 4px;
  color: #c33;
  font-size: 0.9rem;
  margin-bottom: 1rem;
}

.models-list {
  margin-top: 1rem;
}

.models-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid var(--border-color);
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.btn-link-small {
  background: none;
  border: none;
  color: var(--accent-primary);
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0;
  text-decoration: underline;
}

.btn-link-small:hover {
  opacity: 0.8;
}

.models-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.5rem;
  max-height: 400px;
  overflow-y: auto;
  padding: 0.5rem;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

.model-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.6rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.model-item:hover {
  background-color: var(--bg-quaternary);
  border-color: var(--accent-primary);
}

.model-item.model-selected {
  background-color: var(--bg-quaternary);
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 1px var(--accent-primary);
}

.model-item input[type="checkbox"] {
  margin-top: 0.2rem;
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.model-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.model-name {
  font-weight: 500;
  color: var(--text-primary);
  font-size: 0.9rem;
  word-break: break-word;
}

.model-meta {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.model-badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  background-color: var(--bg-secondary);
  color: var(--text-secondary);
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 500;
  border: 1px solid var(--border-color);
}

.model-badge.queue {
  background-color: #fff3cd;
  color: #856404;
  border-color: #ffc107;
}

.fa-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
