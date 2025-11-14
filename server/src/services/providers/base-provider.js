/**
 * Base abstract class for LLM providers
 * All provider implementations must extend this class and implement its methods
 */

import { PromptBuilder } from '../prompt-builder.js';

export class LLMProvider {
  /**
   * @param {Object} config - Provider configuration
   * @param {string} config.apiKey - API key for the provider
   * @param {string} [config.baseURL] - Base URL for API (optional, provider-specific)
   * @param {string} [config.model] - Model to use (optional, provider-specific)
   * @param {Object} [config.additionalConfig] - Additional provider-specific configuration
   */
  constructor(config) {
    if (new.target === LLMProvider) {
      throw new TypeError("Cannot construct LLMProvider instances directly - must extend this class");
    }

    this.config = config;
    this.apiKey = config.apiKey;
    this.baseURL = config.baseURL;
    this.model = config.model;

    // Initialize shared prompt builder - subclasses can override if needed
    this.promptBuilder = new PromptBuilder();
  }

  /**
   * Get provider capabilities
   * @returns {Object} Capability flags
   * @returns {boolean} capabilities.streaming - Whether provider supports streaming
   * @returns {boolean} capabilities.reasoning - Whether provider supports reasoning output
   * @returns {boolean} capabilities.visionAPI - Whether provider supports vision/image input
   * @returns {number} capabilities.maxContextWindow - Maximum context window in tokens
   */
  getCapabilities() {
    throw new Error("getCapabilities() must be implemented by subclass");
  }

  /**
   * Validate provider configuration
   * @returns {Object} Validation result
   * @returns {boolean} result.valid - Whether configuration is valid
   * @returns {string} [result.error] - Error message if invalid
   */
  validateConfig() {
    throw new Error("validateConfig() must be implemented by subclass");
  }

  /**
   * Build system prompt from context
   * @param {Object} context - Generation context
   * @param {Object} context.persona - Persona character
   * @param {Array} context.characterCards - Character cards involved
   * @param {Array} context.activatedLorebooks - Activated lorebook entries
   * @param {Object} context.story - Story object
   * @returns {string} System prompt
   * @deprecated Use buildPrompts() instead for better context management
   */
  buildSystemPrompt(context) {
    return this.promptBuilder.buildSystemPrompt(context);
  }

  /**
   * Build generation prompt from type and context
   * @param {string} type - Generation type: 'continue', 'character', 'custom'
   * @param {Object} params - Generation parameters
   * @param {string} params.storyContent - Story content
   * @param {string} [params.characterName] - Character name for 'character' type
   * @param {string} [params.customInstruction] - Custom instruction for 'custom' type
   * @param {Object} params.templateText - Prompt template text to use
   * @returns {string} User prompt
   * @deprecated Use buildPrompts() instead for better context management
   */
  buildGenerationPrompt(type, params) {
    return this.promptBuilder.buildGenerationPrompt(type, params);
  }

  /**
   * Build both system and user prompts with context management
   *
   * This is the PRIMARY method for building prompts. It provides default implementation
   * that works for most providers. Subclasses can override if they need custom logic.
   *
   * @param {Object} context - Generation context
   * @param {string} generationType - Type of generation (continue, character, custom)
   * @param {Object} customParams - Custom parameters (characterName, customInstruction, etc.)
   * @param {Object} preset - Preset configuration
   * @returns {Object|Promise<Object>} { system: string, user: string }
   */
  buildPrompts(context, generationType, customParams, preset) {
    const maxContextTokens = preset.generationSettings?.maxContextTokens || 128000;
    const maxGenerationTokens = preset.generationSettings?.maxTokens || 4000;

    // Get custom system prompt template from preset (null = use default)
    const systemPromptTemplate = preset.promptTemplates?.systemPrompt ?? null;

    return this.promptBuilder.buildPrompts(context, {
      maxContextTokens,
      maxGenerationTokens,
      generationType,
      systemPromptTemplate,
      ...customParams
    });
  }

  /**
   * Generate text (non-streaming)
   * @param {string} systemPrompt - System prompt
   * @param {string} userPrompt - User prompt
   * @param {Object} options - Generation options
   * @param {number} [options.maxTokens] - Maximum tokens to generate
   * @param {number} [options.temperature] - Temperature (creativity)
   * @param {AbortSignal} [options.signal] - Abort signal for cancellation
   * @returns {Promise<Object>} Generation result
   * @returns {string} result.content - Generated text
   * @returns {string} [result.reasoning] - Reasoning (if provider supports it)
   * @returns {Object} [result.usage] - Token usage statistics
   * @returns {Object} [result.metadata] - Provider-specific metadata
   */
  async generate(systemPrompt, userPrompt, options = {}) {
    throw new Error("generate() must be implemented by subclass");
  }

  /**
   * Generate text with streaming
   * @param {string} systemPrompt - System prompt
   * @param {string} userPrompt - User prompt
   * @param {Object} options - Generation options
   * @param {number} [options.maxTokens] - Maximum tokens to generate
   * @param {number} [options.temperature] - Temperature (creativity)
   * @param {AbortSignal} [options.signal] - Abort signal for cancellation
   * @returns {Promise<Object>} Stream result
   * @returns {AsyncGenerator} result.stream - Async generator yielding chunks
   * @returns {Object} [result.metadata] - Provider-specific metadata (request ID, etc.)
   *
   * Each chunk from stream should have format:
   * @yields {Object} chunk
   * @yields {string} [chunk.content] - Content delta
   * @yields {string} [chunk.reasoning] - Reasoning delta (if provider supports it)
   * @yields {boolean} chunk.finished - Whether generation is complete
   * @yields {Object} [chunk.usage] - Token usage (typically only on final chunk)
   */
  async generateStreaming(systemPrompt, userPrompt, options = {}) {
    throw new Error("generateStreaming() must be implemented by subclass");
  }

  /**
   * Parse provider-specific error and return standardized error
   * @param {Error} error - Original error
   * @returns {Object} Standardized error
   * @returns {string} error.code - Error code (API_ERROR, AUTH_ERROR, RATE_LIMIT, etc.)
   * @returns {string} error.message - Human-readable error message
   * @returns {Error} error.original - Original error
   */
  parseError(error) {
    // Default implementation
    return {
      code: 'API_ERROR',
      message: error.message || 'Unknown error occurred',
      original: error
    };
  }
}
