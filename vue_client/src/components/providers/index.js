/**
 * Provider Component Registry
 * Maps provider names to their configuration components
 */

import DeepSeekConfig from './DeepSeekConfig.vue'
import AIHordeConfig from './AIHordeConfig.vue'
import OpenAIConfig from './OpenAIConfig.vue'
import AnthropicConfig from './AnthropicConfig.vue'
import OpenRouterConfig from './OpenRouterConfig.vue'

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

/**
 * Provider metadata for display and capabilities
 */
export const PROVIDER_METADATA = {
  deepseek: {
    name: 'DeepSeek (with reasoning)',
    supportsReasoning: true,
    supportsStreaming: true
  },
  aihorde: {
    name: 'AI Horde (free, queue-based)',
    supportsReasoning: false,
    supportsStreaming: false,
    requiresModelSelection: true
  },
  openai: {
    name: 'OpenAI GPT-4',
    supportsReasoning: false,
    supportsStreaming: true
  },
  anthropic: {
    name: 'Claude (Anthropic)',
    supportsReasoning: false,
    supportsStreaming: true
  },
  openrouter: {
    name: 'OpenRouter (multi-model)',
    supportsReasoning: false,
    supportsStreaming: true
  }
}
