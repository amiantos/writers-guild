/**
 * Composable for managing model selection state and logic
 * Used by provider configuration components to handle model fetching and selection
 */

import { ref, computed } from 'vue'
import { useToast } from './useToast'

/**
 * Create a model selector with fetching and selection logic
 *
 * @param {Object} params
 * @param {import('vue').Ref} params.apiConfig - Ref to the API configuration object
 * @param {Function} params.fetchModels - Async function to fetch models, receives apiKey
 * @param {Function} params.onModelSelect - Callback when model is selected (optional)
 * @param {Object} params.updateConfig - Function to update the config (for auto-updating context)
 * @returns {Object} Model selector state and methods
 */
export function useModelSelector({ apiConfig, fetchModels, onModelSelect, updateConfig }) {
  const toast = useToast()

  // Model selection state
  const availableModels = ref([])
  const loadingModels = ref(false)
  const modelsError = ref(null)

  /**
   * Fetch available models from the provider
   * @param {boolean} silent - If true, don't show toast messages
   */
  async function fetchAvailableModels(silent = false) {
    if (!apiConfig.value.apiKey) {
      modelsError.value = 'API key is required to fetch models'
      return
    }

    try {
      loadingModels.value = true
      modelsError.value = null

      const response = await fetchModels(apiConfig.value.apiKey)
      availableModels.value = response.models || []

      if (availableModels.value.length === 0) {
        modelsError.value = 'No models available at this time'
      } else if (!silent) {
        toast.success(`Loaded ${availableModels.value.length} model${availableModels.value.length !== 1 ? 's' : ''}`)
      }
    } catch (error) {
      console.error('Failed to fetch models:', error)
      modelsError.value = 'Failed to fetch models: ' + error.message
    } finally {
      loadingModels.value = false
    }
  }

  /**
   * Select a model and optionally update context length
   * @param {Object} model - The model to select
   */
  function selectModel(model) {
    // Call the optional callback first
    if (onModelSelect) {
      onModelSelect(model)
    } else {
      // Default behavior: just update the model in API config
      // If updateConfig is provided, use it to update both model and context
      if (updateConfig && model.contextLength) {
        updateConfig({
          model: model.id,
          contextLength: model.contextLength
        })
      }
    }

    toast.success(`Selected model: ${model.name || model.id}`)
  }

  /**
   * Check if a model is currently selected
   * @param {string} modelId - The model ID to check
   * @returns {boolean}
   */
  function isModelSelected(modelId) {
    return apiConfig.value.model === modelId
  }

  /**
   * Format context length for display
   * @param {number} length - Context length in tokens
   * @returns {string}
   */
  function formatContextLength(length) {
    if (!length) return 'Unknown'
    if (length >= 1000000) {
      return `${(length / 1000000).toFixed(1)}M context`
    } else if (length >= 1000) {
      return `${(length / 1000).toFixed(0)}k context`
    }
    return `${length} tokens`
  }

  return {
    // State
    availableModels,
    loadingModels,
    modelsError,

    // Computed
    hasModels: computed(() => availableModels.value.length > 0),
    selectedModel: computed(() => apiConfig.value.model),

    // Methods
    fetchAvailableModels,
    selectModel,
    isModelSelected,
    formatContextLength,
  }
}
