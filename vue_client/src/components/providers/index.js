/**
 * Provider Component Registry
 * Maps provider names to their configuration components
 */

import DeepSeekConfig from './DeepSeekConfig.vue'
import AIHordeConfig from './AIHordeConfig.vue'
import OpenAIConfig from './OpenAIConfig.vue'
import AnthropicConfig from './AnthropicConfig.vue'
import OpenRouterConfig from './OpenRouterConfig.vue'

// Re-export consolidated provider metadata from config
export { PROVIDERS } from '../../config/providerDefaults'

export const PROVIDER_COMPONENTS = {
  deepseek: DeepSeekConfig,
  aihorde: AIHordeConfig,
  openai: OpenAIConfig,
  anthropic: AnthropicConfig,
  openrouter: OpenRouterConfig
}

/**
 * Get the configuration component for a provider
 * @param {string} provider - Provider name (e.g., 'deepseek', 'aihorde')
 * @returns {Component|null} Vue component or null if not found
 */
export function getProviderComponent(provider) {
  return PROVIDER_COMPONENTS[provider] || null
}
