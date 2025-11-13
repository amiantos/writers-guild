<template>
  <Modal
    :title="preset ? 'Edit Preset' : 'Create New Preset'"
    :close-on-overlay-click="false"
    maxWidth="800px"
    @close="$emit('close')"
  >
    <div class="editor-content">
      <!-- Basic Information -->
      <section class="form-section">
        <h3 class="section-title">Basic Information</h3>

        <div class="form-group">
          <label for="presetName">Preset Name *</label>
          <input
            id="presetName"
            ref="nameInput"
            v-model="formData.name"
            type="text"
            class="text-input"
            placeholder="My Custom Configuration"
          />
        </div>

        <div class="form-group">
          <label for="provider">AI Provider *</label>
          <select id="provider" v-model="formData.provider" class="select-input">
            <option value="deepseek">DeepSeek (with reasoning)</option>
            <option value="aihorde">AI Horde (free, queue-based)</option>
            <option value="openai">OpenAI GPT-4</option>
            <option value="anthropic">Claude (Anthropic)</option>
            <option value="openrouter">OpenRouter (multi-model)</option>
          </select>
          <small class="help-text">Different providers have different capabilities and pricing</small>
        </div>
      </section>

      <!-- API Configuration -->
      <section class="form-section">
        <h3 class="section-title">API Configuration</h3>

        <div class="form-group">
          <label for="apiKey">API Key *</label>
          <input
            id="apiKey"
            v-model="formData.apiConfig.apiKey"
            type="password"
            class="text-input"
            :placeholder="getApiKeyPlaceholder()"
          />
          <small class="help-text">{{ getApiKeyHelp() }}</small>
        </div>

        <div v-if="showAdvancedApiConfig" class="form-group">
          <label for="baseURL">Base URL</label>
          <input
            id="baseURL"
            v-model="formData.apiConfig.baseURL"
            type="text"
            class="text-input"
            :placeholder="getDefaultBaseURL()"
          />
          <small class="help-text">Leave empty to use default</small>
        </div>

        <div v-if="formData.provider !== 'aihorde'" class="form-group">
          <label for="model">Model</label>
          <input
            id="model"
            v-model="formData.apiConfig.model"
            type="text"
            class="text-input"
            :placeholder="getDefaultModel()"
          />
          <small class="help-text">{{ getModelHelp() }}</small>
        </div>

        <button
          type="button"
          class="btn-link"
          @click="showAdvancedApiConfig = !showAdvancedApiConfig"
        >
          {{ showAdvancedApiConfig ? 'Hide' : 'Show' }} Advanced API Options
        </button>
      </section>

      <!-- AI Horde Model Selection -->
      <section v-if="formData.provider === 'aihorde'" class="form-section">
        <h3 class="section-title">AI Horde Model Selection</h3>
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
                v-model="formData.apiConfig.models"
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
      </section>

      <!-- Generation Settings -->
      <section class="form-section">
        <h3 class="section-title">Generation Settings</h3>

        <div class="form-group">
          <label for="maxTokens">
            Max Tokens: {{ formData.generationSettings.maxTokens }}
          </label>
          <input
            id="maxTokens"
            v-model.number="formData.generationSettings.maxTokens"
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
            Temperature: {{ formData.generationSettings.temperature.toFixed(2) }}
          </label>
          <input
            id="temperature"
            v-model.number="formData.generationSettings.temperature"
            type="range"
            min="0"
            max="2"
            step="0.05"
            class="range-input"
          />
          <small class="help-text">Creativity/randomness (0 = focused, 2 = creative)</small>
        </div>

        <div class="form-group checkbox-group">
          <label>
            <input
              type="checkbox"
              v-model="formData.generationSettings.includeDialogueExamples"
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
            Scan Depth: {{ formData.lorebookSettings.scanDepth }} tokens
          </label>
          <input
            id="scanDepth"
            v-model.number="formData.lorebookSettings.scanDepth"
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
            Token Budget: {{ formData.lorebookSettings.tokenBudget }} tokens
          </label>
          <input
            id="tokenBudget"
            v-model.number="formData.lorebookSettings.tokenBudget"
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
            Recursion Depth: {{ formData.lorebookSettings.recursionDepth }}
          </label>
          <input
            id="recursionDepth"
            v-model.number="formData.lorebookSettings.recursionDepth"
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
              v-model="formData.lorebookSettings.enableRecursion"
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
              v-model="formData.promptTemplates.continue"
              class="textarea-input"
              rows="3"
              placeholder="Continue the story naturally..."
            ></textarea>
          </div>

          <div class="form-group">
            <label for="templateCharacter">Character Response Template</label>
            <textarea
              id="templateCharacter"
              v-model="formData.promptTemplates.character"
              class="textarea-input"
              rows="3"
              placeholder="Write from {char}'s perspective..."
            ></textarea>
          </div>

          <div class="form-group">
            <label for="templateInstruction">Custom Instruction Template</label>
            <textarea
              id="templateInstruction"
              v-model="formData.promptTemplates.instruction"
              class="textarea-input"
              rows="2"
              placeholder="{instruction}"
            ></textarea>
          </div>

          <div class="form-group">
            <label for="templateRewrite">Rewrite to Third Person Template</label>
            <textarea
              id="templateRewrite"
              v-model="formData.promptTemplates.rewriteThirdPerson"
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

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">
        Cancel
      </button>
      <button
        class="btn btn-primary"
        :disabled="!canSave || saving"
        @click="savePreset"
      >
        <i class="fas fa-save"></i>
        {{ saving ? 'Saving...' : (preset ? 'Save Changes' : 'Create Preset') }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import Modal from './Modal.vue'
import { presetsAPI } from '../services/api'
import { useToast } from '../composables/useToast'

const props = defineProps({
  preset: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close', 'saved'])

const toast = useToast()
const saving = ref(false)
const nameInput = ref(null)
const showAdvancedApiConfig = ref(false)
const showPromptTemplates = ref(false)

// AI Horde model selection state
const availableHordeModels = ref([])
const loadingHordeModels = ref(false)
const hordeModelsError = ref(null)
const recommendedHordeModels = ref([])

// Form data with defaults
const formData = ref({
  name: '',
  provider: 'deepseek',
  apiConfig: {
    apiKey: '',
    baseURL: '',
    model: '',
    models: []  // For AI Horde - array of model names
  },
  generationSettings: {
    maxTokens: 4000,
    temperature: 1.5,
    includeDialogueExamples: false
  },
  lorebookSettings: {
    scanDepth: 2000,
    tokenBudget: 1800,
    recursionDepth: 3,
    enableRecursion: true
  },
  promptTemplates: {
    continue: "Continue the story naturally from where it left off. Write the next 2-3 paragraphs maximum, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters.",
    character: "Write the next part of the story from {{char}}'s perspective. Focus on their thoughts, actions, and dialogue. Write 2-3 paragraphs maximum, less if it makes sense stylistically or sets up a good response opportunity for other characters. (There is a chance that \"{{char}}'s\" is multiple characters, at which point you may respond as any of them as is relevant to the story.)",
    instruction: "Continue the story naturally from where it left off. Write the next 2-3 paragraphs maximum, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters. The user additionally sends along these instructions for what they would like to see happen: {{instruction}}",
    rewriteThirdPerson: "Rewrite the following text to be in third person narrative perspective, using past tense. Convert all first-person pronouns (I, me, my, we, us, our) to third-person (he, she, they, him, her, them, his, her, their). Change all verbs to past tense. Maintain the same events, dialogue, and meaning, but from a third-person narrator's viewpoint."
  }
})

onMounted(async () => {
  // If editing existing preset, load its data
  if (props.preset) {
    try {
      const { preset } = await presetsAPI.get(props.preset.id)
      formData.value = {
        ...preset,
        apiConfig: {
          ...(preset.apiConfig || formData.value.apiConfig),
          models: Array.isArray(preset.apiConfig?.models) ? preset.apiConfig.models : []
        },
        generationSettings: preset.generationSettings || formData.value.generationSettings,
        lorebookSettings: preset.lorebookSettings || formData.value.lorebookSettings,
        promptTemplates: preset.promptTemplates || formData.value.promptTemplates
      }

      // If it's an AI Horde preset and has models, try to fetch available models for context
      if (preset.provider === 'aihorde' && preset.apiConfig?.models?.length > 0) {
        await fetchHordeModels()
      }
    } catch (error) {
      console.error('Failed to load preset:', error)
      toast.error('Failed to load preset: ' + error.message)
    }
  }

  // Focus name input
  if (nameInput.value) {
    nameInput.value.focus()
  }
})

const canSave = computed(() => {
  return formData.value.name.trim() && formData.value.apiConfig.apiKey.trim()
})

function getApiKeyPlaceholder() {
  const placeholders = {
    deepseek: 'sk-...',
    aihorde: '0000000000 for anonymous',
    openai: 'sk-...',
    anthropic: 'sk-ant-...',
    openrouter: 'sk-or-...'
  }
  return placeholders[formData.value.provider] || 'Enter API key'
}

function getApiKeyHelp() {
  const help = {
    deepseek: 'Get your API key from https://platform.deepseek.com',
    aihorde: 'Use "0000000000" for anonymous access, or get an API key from https://aihorde.net',
    openai: 'Get your API key from https://platform.openai.com',
    anthropic: 'Get your API key from https://console.anthropic.com',
    openrouter: 'Get your API key from https://openrouter.ai'
  }
  return help[formData.value.provider] || ''
}

function getDefaultBaseURL() {
  const urls = {
    deepseek: 'https://api.deepseek.com/v1',
    aihorde: 'https://aihorde.net/api/v2',
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    openrouter: 'https://openrouter.ai/api/v1'
  }
  return urls[formData.value.provider] || ''
}

function getDefaultModel() {
  const models = {
    deepseek: 'deepseek-reasoner',
    aihorde: 'Mythomax 13B',
    openai: 'gpt-4-turbo-preview',
    anthropic: 'claude-3-5-sonnet-20241022',
    openrouter: 'anthropic/claude-3.5-sonnet'
  }
  return models[formData.value.provider] || ''
}

function getModelHelp() {
  const help = {
    aihorde: 'Can specify multiple models separated by commas',
    deepseek: 'Use deepseek-reasoner for reasoning support',
    openai: 'e.g., gpt-4-turbo-preview, gpt-3.5-turbo',
    anthropic: 'e.g., claude-3-5-sonnet-20241022, claude-3-opus-20240229',
    openrouter: 'Browse available models at https://openrouter.ai/models'
  }
  return help[formData.value.provider] || 'Model identifier for this provider'
}

async function savePreset() {
  if (!canSave.value) return

  try {
    saving.value = true

    // Prepare data
    const presetData = {
      ...formData.value,
      // Use defaults if fields are empty
      apiConfig: {
        ...formData.value.apiConfig,
        baseURL: formData.value.apiConfig.baseURL || getDefaultBaseURL(),
        model: formData.value.apiConfig.model || getDefaultModel()
      }
    }

    if (props.preset) {
      // Update existing preset
      await presetsAPI.update(props.preset.id, presetData)
    } else {
      // Create new preset
      await presetsAPI.create(presetData)
    }

    emit('saved')
  } catch (error) {
    console.error('Failed to save preset:', error)
    toast.error('Failed to save preset: ' + error.message)
  } finally {
    saving.value = false
  }
}

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
    formData.value.apiConfig.models = [...recommendedHordeModels.value]
    toast.success(`Selected ${recommendedHordeModels.value.length} recommended models`)
  }
}

function clearSelectedModels() {
  formData.value.apiConfig.models = []
}

function isModelSelected(modelName) {
  return formData.value.apiConfig.models && formData.value.apiConfig.models.includes(modelName)
}

const selectedModelsCount = computed(() => {
  return formData.value.apiConfig.models ? formData.value.apiConfig.models.length : 0
})
</script>

<style scoped>
.editor-content {
  /* Let the Modal component handle scrolling */
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

.section-description {
  margin: 0 0 1rem 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
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
.select-input,
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
.select-input:focus,
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

.btn {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.95rem;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-primary {
  background-color: var(--accent-primary);
  color: var(--text-on-accent);
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-secondary {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--bg-quaternary);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* AI Horde Model Selection Styles */
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
