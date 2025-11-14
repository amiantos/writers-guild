<template>
  <BaseProviderConfig
    :config="config"
    @update:config="$emit('update:config', $event)"
    :show-max-context="true"
    :context-range="{ min: 32000, max: 128000 }"
    :context-help-text="`Context window varies by model (64k-128k tokens). Check model details for accurate limits.`"
  >
    <template #api-config>
      <div class="form-group">
        <label for="apiKey">API Key *</label>
        <input
          id="apiKey"
          v-model="localApiConfig.apiKey"
          type="password"
          class="text-input"
          placeholder="sk-..."
        />
        <small class="help-text">Get your API key from https://platform.deepseek.com</small>
      </div>

      <div v-if="showAdvancedApiConfig" class="form-group">
        <label for="baseURL">Base URL</label>
        <input
          id="baseURL"
          v-model="localApiConfig.baseURL"
          type="text"
          class="text-input"
          placeholder="https://api.deepseek.com/v1"
        />
        <small class="help-text">Leave empty to use default</small>
      </div>

      <div class="form-group">
        <h4 class="subsection-title">Model Selection</h4>
        <p class="section-description">
          Select which DeepSeek model to use. Choose "reasoner" for advanced reasoning tasks or "chat" for general conversation.
        </p>

        <div class="model-actions">
          <button
            type="button"
            class="btn btn-secondary btn-small"
            @click="fetchDeepSeekModels"
            :disabled="loadingModels || !localApiConfig.apiKey"
          >
            <i :class="loadingModels ? 'fas fa-spinner fa-spin' : 'fas fa-sync'"></i>
            {{ loadingModels ? 'Loading...' : 'Fetch Available Models' }}
          </button>
          <div v-if="!localApiConfig.apiKey" class="help-text inline-help">
            Enter your API key above to fetch models
          </div>
        </div>

        <div v-if="modelsError" class="error-message">
          {{ modelsError }}
        </div>

        <div v-if="availableModels.length > 0">
          <!-- Currently Selected Model -->
          <div class="selected-model-display">
            <span class="label">Selected Model:</span>
            <span class="value">{{ localApiConfig.model || 'None' }}</span>
          </div>

          <!-- Models List -->
          <div class="models-list">
            <div
              v-for="model in availableModels"
              :key="model.id"
              class="model-item"
              :class="{ 'model-selected': isModelSelected(model.id) }"
              @click="selectModel(model)"
            >
              <div class="model-header">
                <span class="model-name">{{ model.name }}</span>
              </div>
              <div class="model-details">
                <span class="model-badge">{{ formatContextLength(model.contextLength) }}</span>
              </div>
              <div v-if="model.description" class="model-description">
                {{ model.description }}
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="!loadingModels" class="help-text">
          Enter your API key and click "Fetch Available Models" to see available DeepSeek models.
        </div>
      </div>

      <button
        type="button"
        class="btn-link"
        @click="showAdvancedApiConfig = !showAdvancedApiConfig"
      >
        {{ showAdvancedApiConfig ? 'Hide' : 'Show' }} Advanced API Options
      </button>
    </template>
  </BaseProviderConfig>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import BaseProviderConfig from './shared/BaseProviderConfig.vue'
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

// Model selection state
const availableModels = ref([])
const loadingModels = ref(false)
const modelsError = ref(null)

// Local computed for API config
const localApiConfig = computed({
  get() {
    return props.config.apiConfig || {}
  },
  set(value) {
    emit('update:config', { ...props.config, apiConfig: value })
  }
})

// Automatically fetch models on mount if API key is present
onMounted(() => {
  if (localApiConfig.value.apiKey) {
    fetchDeepSeekModels()
  }
})

// Watch for API key changes and auto-fetch when it becomes available
let hasAutoFetched = false
watch(() => localApiConfig.value.apiKey, (newKey) => {
  if (newKey && !hasAutoFetched && availableModels.value.length === 0) {
    hasAutoFetched = true
    fetchDeepSeekModels()
  }
})

// Fetch DeepSeek models
async function fetchDeepSeekModels() {
  if (!localApiConfig.value.apiKey) {
    modelsError.value = 'API key is required to fetch models'
    return
  }

  try {
    loadingModels.value = true
    modelsError.value = null

    const response = await presetsAPI.getDeepSeekModels(localApiConfig.value.apiKey)
    availableModels.value = response.models || []

    if (availableModels.value.length === 0) {
      modelsError.value = 'No models available at this time'
    } else {
      toast.success(`Loaded ${availableModels.value.length} models`)
    }
  } catch (error) {
    console.error('Failed to fetch DeepSeek models:', error)
    modelsError.value = 'Failed to fetch models: ' + error.message
  } finally {
    loadingModels.value = false
  }
}

// Model selection methods
function selectModel(model) {
  localApiConfig.value = {
    ...localApiConfig.value,
    model: model.id
  }

  // Auto-update context length if the setting exists
  if (props.config.generationSettings && model.contextLength) {
    emit('update:config', {
      ...props.config,
      apiConfig: {
        ...localApiConfig.value,
        model: model.id
      },
      generationSettings: {
        ...props.config.generationSettings,
        maxContextTokens: model.contextLength
      }
    })
  }

  toast.success(`Selected model: ${model.name}`)
}

function isModelSelected(modelId) {
  return localApiConfig.value.model === modelId
}

// Formatting helpers
function formatContextLength(length) {
  if (length >= 1000000) {
    return `${(length / 1000000).toFixed(1)}M context`
  } else if (length >= 1000) {
    return `${(length / 1000).toFixed(0)}k context`
  }
  return `${length} tokens`
}
</script>

<style scoped>
.form-group {
  margin-bottom: 1.25rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
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

.text-input {
  width: 100%;
  padding: 0.6rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.95rem;
  font-family: inherit;
}

.text-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.help-text {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.inline-help {
  display: inline;
  margin-left: 0.5rem;
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

/* Model selection styles */
.model-actions {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  align-items: center;
}

.btn {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--bg-quaternary);
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

.selected-model-display {
  padding: 0.75rem;
  background-color: var(--bg-quaternary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}

.selected-model-display .label {
  font-weight: 600;
  color: var(--text-secondary);
  margin-right: 0.5rem;
}

.selected-model-display .value {
  color: var(--accent-primary);
  font-weight: 500;
}

.models-list {
  max-height: 400px;
  overflow-y: auto;
  padding: 0.5rem;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

.model-item {
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 0.5rem;
}

.model-item:hover {
  background-color: var(--bg-quaternary);
  border-color: var(--accent-primary);
}

.model-item.model-selected {
  background-color: var(--bg-quaternary);
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px var(--accent-primary);
}

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.model-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.model-details {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.4rem;
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

.model-description {
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.4;
  margin-top: 0.3rem;
}

.fa-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
