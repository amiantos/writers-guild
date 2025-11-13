<template>
  <BaseProviderConfig
    :config="config"
    @update:config="$emit('update:config', $event)"
    :show-max-context="true"
    :context-range="{ min: 8000, max: 200000 }"
    :context-help-text="`Context window varies by model (8k-200k tokens). Check model details for accurate limits.`"
  >
    <template #api-config>
      <div class="form-group">
        <label for="apiKey">API Key</label>
        <input
          id="apiKey"
          v-model="localApiConfig.apiKey"
          type="password"
          class="text-input"
          placeholder="sk-or-v1-..."
        />
        <small class="help-text">Get an API key from https://openrouter.ai</small>
      </div>

      <div v-if="showAdvancedApiConfig" class="form-group">
        <label for="baseURL">Base URL</label>
        <input
          id="baseURL"
          v-model="localApiConfig.baseURL"
          type="text"
          class="text-input"
          placeholder="https://openrouter.ai/api/v1"
        />
        <small class="help-text">Leave empty to use default</small>
      </div>

      <div class="form-group">
        <h4 class="subsection-title">Model Selection</h4>
        <p class="section-description">
          Select which model to use from OpenRouter. Different models have different capabilities, pricing, and context windows.
        </p>

        <div class="openrouter-actions">
          <button
            type="button"
            class="btn btn-secondary btn-small"
            @click="fetchOpenRouterModels"
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
          <!-- Model Filtering and Sorting Controls -->
          <div class="controls-section">
            <div class="control-group">
              <label for="modelSearch">Search Models</label>
              <input
                id="modelSearch"
                v-model="searchQuery"
                type="text"
                class="text-input"
                placeholder="Search by name or vendor..."
              />
            </div>

            <div class="control-row">
              <div class="control-group">
                <label for="sortBy">Sort By</label>
                <select id="sortBy" v-model="sortBy" class="select-input">
                  <option value="name">Name</option>
                  <option value="vendor">Vendor</option>
                  <option value="contextLength">Context Length</option>
                  <option value="pricing">Price (Low to High)</option>
                </select>
              </div>

              <div class="control-group checkbox-group">
                <label>
                  <input type="checkbox" v-model="groupByVendor" />
                  Group by Vendor
                </label>
              </div>
            </div>
          </div>

          <!-- Currently Selected Model -->
          <div class="selected-model-display">
            <span class="label">Selected Model:</span>
            <span class="value">{{ localApiConfig.model || 'None' }}</span>
          </div>

          <!-- Models List -->
          <div v-if="!groupByVendor" class="models-list">
            <div
              v-for="model in filteredAndSortedModels"
              :key="model.id"
              class="model-item"
              :class="{ 'model-selected': isModelSelected(model.id) }"
              @click="selectModel(model.id)"
            >
              <div class="model-header">
                <span class="model-name">{{ model.name }}</span>
                <span class="model-vendor-badge">{{ model.vendor }}</span>
              </div>
              <div class="model-details">
                <span class="model-badge">{{ formatContextLength(model.contextLength) }}</span>
                <span class="model-badge">{{ formatPricing(model.pricing) }}</span>
              </div>
              <div v-if="model.description" class="model-description">
                {{ truncateDescription(model.description) }}
              </div>
            </div>
          </div>

          <!-- Models List Grouped by Vendor -->
          <div v-else class="models-list-grouped">
            <div
              v-for="(models, vendor) in groupedModels"
              :key="vendor"
              class="vendor-group"
            >
              <h5 class="vendor-header">
                {{ vendor }}
                <span class="vendor-count">({{ models.length }} models)</span>
              </h5>
              <div class="vendor-models">
                <div
                  v-for="model in models"
                  :key="model.id"
                  class="model-item"
                  :class="{ 'model-selected': isModelSelected(model.id) }"
                  @click="selectModel(model.id)"
                >
                  <div class="model-header">
                    <span class="model-name">{{ model.name }}</span>
                  </div>
                  <div class="model-details">
                    <span class="model-badge">{{ formatContextLength(model.contextLength) }}</span>
                    <span class="model-badge">{{ formatPricing(model.pricing) }}</span>
                  </div>
                  <div v-if="model.description" class="model-description">
                    {{ truncateDescription(model.description) }}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else-if="!loadingModels" class="help-text">
          Enter your API key and click "Fetch Available Models" to see available OpenRouter models.
        </div>
      </div>

      <!-- Provider Preferences -->
      <div v-if="availableModels.length > 0" class="form-group">
        <h4 class="subsection-title">Provider Preferences (Optional)</h4>
        <p class="section-description">
          Specify which providers to prefer for routing. Leave empty to use all available providers.
        </p>

        <div class="provider-input-section">
          <input
            v-model="providerInput"
            type="text"
            class="text-input"
            placeholder="e.g., OpenAI, Anthropic, Google"
            @keypress.enter="addProvider"
          />
          <button
            type="button"
            class="btn btn-secondary btn-small"
            @click="addProvider"
            :disabled="!providerInput.trim()"
          >
            <i class="fas fa-plus"></i>
            Add Provider
          </button>
        </div>

        <div v-if="localProviders.length > 0" class="providers-list">
          <div
            v-for="(provider, index) in localProviders"
            :key="index"
            class="provider-tag"
          >
            <span>{{ provider }}</span>
            <button
              type="button"
              class="remove-btn"
              @click="removeProvider(index)"
              title="Remove provider"
            >
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>

        <small class="help-text">
          Common providers: OpenAI, Anthropic, Google, Together, Fireworks, Lepton, Deepinfra
        </small>
      </div>

      <!-- Allow Fallback Providers -->
      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" v-model="localAllowFallbacks" />
          <span>Allow Fallback Providers</span>
        </label>
        <small class="help-text">
          When enabled, OpenRouter can use alternative providers if your preferred ones are unavailable.
        </small>
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
import { ref, computed } from 'vue'
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

// OpenRouter model selection state
const availableModels = ref([])
const loadingModels = ref(false)
const modelsError = ref(null)

// Search and filtering state
const searchQuery = ref('')
const sortBy = ref('name')
const groupByVendor = ref(false)

// Provider preferences state
const providerInput = ref('')

// Local computed for API config
const localApiConfig = computed({
  get() {
    return props.config.apiConfig || {}
  },
  set(value) {
    emit('update:config', { ...props.config, apiConfig: value })
  }
})

// Local providers array that syncs with apiConfig.providers
const localProviders = computed({
  get() {
    return localApiConfig.value.providers || []
  },
  set(value) {
    localApiConfig.value = {
      ...localApiConfig.value,
      providers: value
    }
  }
})

// Local allow fallbacks that syncs with apiConfig.allowFallbacks
const localAllowFallbacks = computed({
  get() {
    return localApiConfig.value.allowFallbacks !== false // Default true
  },
  set(value) {
    localApiConfig.value = {
      ...localApiConfig.value,
      allowFallbacks: value
    }
  }
})

// Fetch OpenRouter models
async function fetchOpenRouterModels() {
  if (!localApiConfig.value.apiKey) {
    modelsError.value = 'API key is required to fetch models'
    return
  }

  try {
    loadingModels.value = true
    modelsError.value = null

    const response = await presetsAPI.getOpenRouterModels(localApiConfig.value.apiKey)
    availableModels.value = response.models || []

    if (availableModels.value.length === 0) {
      modelsError.value = 'No models available at this time'
    } else {
      toast.success(`Loaded ${availableModels.value.length} models`)
    }
  } catch (error) {
    console.error('Failed to fetch OpenRouter models:', error)
    modelsError.value = 'Failed to fetch models: ' + error.message
  } finally {
    loadingModels.value = false
  }
}

// Filter and sort models
const filteredAndSortedModels = computed(() => {
  let models = availableModels.value

  // Apply search filter
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase()
    models = models.filter(
      (m) =>
        m.name.toLowerCase().includes(query) ||
        m.id.toLowerCase().includes(query) ||
        m.vendor.toLowerCase().includes(query)
    )
  }

  // Apply sorting
  const sorted = [...models].sort((a, b) => {
    switch (sortBy.value) {
      case 'name':
        return a.name.localeCompare(b.name)
      case 'vendor':
        return a.vendor.localeCompare(b.vendor) || a.name.localeCompare(b.name)
      case 'contextLength':
        return b.contextLength - a.contextLength
      case 'pricing':
        const priceA = a.pricing.prompt + a.pricing.completion
        const priceB = b.pricing.prompt + b.pricing.completion
        return priceA - priceB
      default:
        return 0
    }
  })

  return sorted
})

// Group models by vendor
const groupedModels = computed(() => {
  const groups = {}
  filteredAndSortedModels.value.forEach((model) => {
    const vendor = model.vendor || 'Other'
    if (!groups[vendor]) {
      groups[vendor] = []
    }
    groups[vendor].push(model)
  })
  return groups
})

// Model selection methods
function selectModel(modelId) {
  localApiConfig.value = {
    ...localApiConfig.value,
    model: modelId
  }
  toast.success(`Selected model: ${modelId}`)
}

function isModelSelected(modelId) {
  return localApiConfig.value.model === modelId
}

// Provider management methods
function addProvider() {
  const provider = providerInput.value.trim()
  if (provider && !localProviders.value.includes(provider)) {
    localProviders.value = [...localProviders.value, provider]
    providerInput.value = ''
  }
}

function removeProvider(index) {
  localProviders.value = localProviders.value.filter((_, i) => i !== index)
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

function formatPricing(pricing) {
  const promptPrice = pricing.prompt * 1000000 // Convert to per 1M tokens
  const completionPrice = pricing.completion * 1000000

  if (promptPrice === 0 && completionPrice === 0) {
    return 'Free'
  }

  const avgPrice = (promptPrice + completionPrice) / 2
  if (avgPrice < 0.01) {
    return '< $0.01/1M'
  }
  return `~$${avgPrice.toFixed(2)}/1M`
}

function truncateDescription(description, maxLength = 100) {
  if (!description) return ''
  if (description.length <= maxLength) return description
  return description.substring(0, maxLength) + '...'
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

.select-input {
  width: 100%;
  padding: 0.6rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.95rem;
  font-family: inherit;
  cursor: pointer;
}

.select-input:focus {
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

/* OpenRouter specific styles */
.openrouter-actions {
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

.btn-primary {
  background-color: var(--accent-primary);
  color: white;
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

/* Controls section */
.controls-section {
  margin-bottom: 1rem;
  padding: 1rem;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

.control-row {
  display: flex;
  gap: 1rem;
  margin-top: 0.75rem;
  flex-wrap: wrap;
}

.control-group {
  flex: 1;
  min-width: 200px;
}

.control-group label {
  display: block;
  margin-bottom: 0.4rem;
  font-size: 0.9rem;
  font-weight: 500;
}

.checkbox-group {
  display: flex;
  align-items: center;
  padding-top: 1.5rem;
}

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  cursor: pointer;
}

.checkbox-group input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

/* Selected model display */
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

/* Models list */
.models-list,
.models-list-grouped {
  max-height: 500px;
  overflow-y: auto;
  padding: 0.5rem;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

.vendor-group {
  margin-bottom: 1.5rem;
}

.vendor-header {
  margin: 0 0 0.75rem 0;
  padding: 0.5rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  background-color: var(--bg-tertiary);
  border-radius: 4px;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.vendor-count {
  font-size: 0.85rem;
  font-weight: normal;
  color: var(--text-secondary);
}

.vendor-models {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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

.model-vendor-badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  background-color: var(--accent-primary);
  color: white;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 500;
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

/* Provider preferences */
.provider-input-section {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.provider-input-section .text-input {
  flex: 1;
}

.providers-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.provider-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.75rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  font-size: 0.85rem;
}

.provider-tag .remove-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.2s;
}

.provider-tag .remove-btn:hover {
  color: var(--accent-primary);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-weight: normal;
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.fa-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
