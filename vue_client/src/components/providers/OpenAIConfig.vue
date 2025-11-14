<template>
  <BaseProviderConfig
    :config="config"
    @update:config="$emit('update:config', $event)"
    :show-max-context="true"
    :context-range="{ min: 8000, max: 128000 }"
    :context-help-text="`Context window varies by model (8k-128k tokens). Check model details for accurate limits.`"
  >
    <template #api-config>
      <!-- API Configuration Section -->
      <ApiConfigSection
        v-model="localApiConfig"
        provider-id="openai"
        placeholder="sk-..."
        help-text="Get your API key from https://platform.openai.com"
        base-u-r-l-placeholder="https://api.openai.com/v1"
      />

      <!-- Model Selection Section -->
      <ModelSelector
        :models="availableModels"
        :selected-model="localApiConfig.model"
        :loading="loadingModels"
        :error="modelsError"
        :can-fetch="!!localApiConfig.apiKey"
        description="Select which model to use from OpenAI. Different models have different capabilities and context windows."
        empty-state-text="Enter your API key and click 'Fetch Available Models' to see available OpenAI models."
        @fetch="fetchModels"
        @select="selectModel"
      />
    </template>
  </BaseProviderConfig>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import BaseProviderConfig from './shared/BaseProviderConfig.vue'
import ApiConfigSection from './shared/ApiConfigSection.vue'
import ModelSelector from './shared/ModelSelector.vue'
import { presetsAPI } from '../../services/api'
import { useModelSelector } from '../../composables/useModelSelector'

const props = defineProps({
  config: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:config'])

// Local computed for API config
const localApiConfig = computed({
  get() {
    return props.config.apiConfig || {}
  },
  set(value) {
    emit('update:config', { ...props.config, apiConfig: value })
  }
})

// Use the shared model selector composable
const {
  availableModels,
  loadingModels,
  modelsError,
  fetchAvailableModels,
  selectModel: baseSelectModel,
} = useModelSelector({
  apiConfig: localApiConfig,
  fetchModels: presetsAPI.getOpenAIModels,
  updateConfig: (updates) => {
    // Update both API config and generation settings
    emit('update:config', {
      ...props.config,
      apiConfig: {
        ...localApiConfig.value,
        model: updates.model
      },
      generationSettings: {
        ...props.config.generationSettings,
        maxContextTokens: updates.contextLength
      }
    })
  }
})

// Wrapper to handle model selection
function selectModel(model) {
  baseSelectModel(model)
}

// Wrapper for fetch
function fetchModels() {
  fetchAvailableModels()
}

// Auto-fetch models on mount if API key is present
onMounted(() => {
  if (localApiConfig.value.apiKey) {
    fetchAvailableModels(true) // silent fetch on mount
  }
})
</script>

<style scoped>
/* All styles are now in the shared components */
</style>
