<template>
  <BaseProviderConfig
    :config="config"
    @update:config="$emit('update:config', $event)"
    :show-max-context="true"
    :context-range="{ min: 2000, max: 16000 }"
    :context-help-text="`Context window fallback (2k-16k tokens). Automatically calculated based on selected models and their worker availability.`"
    provider="aihorde"
    :model="''"
  >
    <template #api-config>
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
    </template>
  </BaseProviderConfig>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
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

// AI Horde model selection state
const availableHordeModels = ref([])
const loadingHordeModels = ref(false)
const hordeModelsError = ref(null)
const recommendedHordeModels = ref([])

// Local computed for API config
const localApiConfig = computed({
  get() {
    return props.config.apiConfig || {}
  },
  set(value) {
    emit('update:config', { ...props.config, apiConfig: value })
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

// Auto-fetch models when component mounts
onMounted(() => {
  fetchHordeModels()
})
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

.btn {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background-color: var(--accent-primary);
  color: white;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-secondary {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
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
