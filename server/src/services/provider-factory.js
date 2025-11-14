/**
 * Provider Factory
 * Creates and returns the appropriate LLM provider based on configuration
 */

import { DeepSeekProvider } from './providers/deepseek-provider.js';
import { AIHordeProvider } from './providers/aihorde-provider.js';
import { OpenRouterProvider } from './providers/openrouter-provider.js';
import { OpenAIProvider } from './providers/openai-provider.js';
import { AnthropicProvider } from './providers/anthropic-provider.js';

// Provider registry
const PROVIDERS = {
  deepseek: DeepSeekProvider,
  aihorde: AIHordeProvider,
  openrouter: OpenRouterProvider,
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
};

/**
 * Get a provider instance from a preset configuration
 * @param {Object} preset - Configuration preset
 * @param {string} preset.provider - Provider type ('deepseek', 'aihorde', etc.)
 * @param {Object} preset.apiConfig - Provider-specific API configuration
 * @returns {LLMProvider} Provider instance
 */
export function getProvider(preset) {
  if (!preset) {
    throw new Error('Preset configuration is required');
  }

  if (!preset.provider) {
    throw new Error('Provider type is required in preset');
  }

  const ProviderClass = PROVIDERS[preset.provider.toLowerCase()];

  if (!ProviderClass) {
    throw new Error(
      `Unknown provider: ${preset.provider}. Available providers: ${Object.keys(PROVIDERS).join(', ')}`
    );
  }

  // Create provider instance with API configuration
  const provider = new ProviderClass(preset.apiConfig || {});

  // Validate configuration
  const validation = provider.validateConfig();
  if (!validation.valid) {
    throw new Error(`Provider configuration invalid: ${validation.error}`);
  }

  return provider;
}

/**
 * Get list of available provider types
 * @returns {string[]} Array of provider names
 */
export function getAvailableProviders() {
  return Object.keys(PROVIDERS);
}

/**
 * Get provider capabilities without instantiating
 * @param {string} providerType - Provider type name
 * @returns {Object} Capability object
 */
export function getProviderCapabilities(providerType) {
  const ProviderClass = PROVIDERS[providerType.toLowerCase()];

  if (!ProviderClass) {
    throw new Error(`Unknown provider: ${providerType}`);
  }

  // Create temporary instance with minimal config to get capabilities
  const tempProvider = new ProviderClass({ apiKey: 'temp' });
  return tempProvider.getCapabilities();
}

/**
 * Check if a provider type exists
 * @param {string} providerType - Provider type name
 * @returns {boolean} True if provider exists
 */
export function isValidProvider(providerType) {
  return providerType && PROVIDERS.hasOwnProperty(providerType.toLowerCase());
}
