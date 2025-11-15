/**
 * Provider-specific default configurations
 * Each provider has its own sensible defaults for API configuration,
 * generation settings, and other parameters.
 */

export const PROVIDER_DEFAULTS = {
  deepseek: {
    provider: 'deepseek',
    apiConfig: {
      apiKey: '',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-reasoner',
      models: []
    },
    generationSettings: {
      maxTokens: 4000,
      temperature: 1.5,
      maxContextTokens: 8000,
      includeDialogueExamples: false
    },
    lorebookSettings: {
      scanDepth: 2000,
      tokenBudget: 1800,
      recursionDepth: 3,
      enableRecursion: true
    },
    promptTemplates: {
      systemPrompt: null,
      continue: null,
      character: null,
      instruction: null,
      rewriteThirdPerson: null
    }
  },

  aihorde: {
    provider: 'aihorde',
    apiConfig: {
      apiKey: '0000000000', // Anonymous access
      baseURL: 'https://aihorde.net/api/v2',
      model: '',
      models: [] // Will be populated when user selects models
    },
    generationSettings: {
      maxTokens: 300,
      temperature: 0.7,
      maxContextTokens: 2048,
      includeDialogueExamples: false,
      // AI Horde specific settings
      top_p: 0.9,
      top_k: 0,
      top_a: 0,
      typical: 1,
      tfs: 1,
      rep_pen: 1.1,
      rep_pen_range: 320,
      rep_pen_slope: 0.7
    },
    lorebookSettings: {
      scanDepth: 1000,
      tokenBudget: 800,
      recursionDepth: 2,
      enableRecursion: true
    },
    promptTemplates: {
      systemPrompt: null,
      continue: null,
      character: null,
      instruction: null,
      rewriteThirdPerson: null
    }
  },

  openai: {
    provider: 'openai',
    apiConfig: {
      apiKey: '',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4-turbo-preview',
      models: []
    },
    generationSettings: {
      maxTokens: 4000,
      temperature: 1.0,
      maxContextTokens: 8000,
      includeDialogueExamples: false,
      // OpenAI specific settings
      top_p: 1.0,
      frequency_penalty: 0,
      presence_penalty: 0
    },
    lorebookSettings: {
      scanDepth: 2000,
      tokenBudget: 1800,
      recursionDepth: 3,
      enableRecursion: true
    },
    promptTemplates: {
      systemPrompt: null,
      continue: null,
      character: null,
      instruction: null,
      rewriteThirdPerson: null
    }
  },

  anthropic: {
    provider: 'anthropic',
    apiConfig: {
      apiKey: '',
      baseURL: 'https://api.anthropic.com/v1',
      model: 'claude-3-5-sonnet-20241022',
      models: []
    },
    generationSettings: {
      maxTokens: 4000,
      temperature: 1.0,
      maxContextTokens: 8000,
      includeDialogueExamples: false,
      // Anthropic specific settings
      top_p: 1.0,
      top_k: 0
    },
    lorebookSettings: {
      scanDepth: 2000,
      tokenBudget: 1800,
      recursionDepth: 3,
      enableRecursion: true
    },
    promptTemplates: {
      systemPrompt: null,
      continue: null,
      character: null,
      instruction: null,
      rewriteThirdPerson: null
    }
  },

  openrouter: {
    provider: 'openrouter',
    apiConfig: {
      apiKey: '',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'anthropic/claude-3.5-sonnet',
      models: []
    },
    generationSettings: {
      maxTokens: 4000,
      temperature: 1.0,
      maxContextTokens: 8000,
      includeDialogueExamples: false,
      // OpenRouter follows OpenAI-compatible settings
      top_p: 1.0,
      frequency_penalty: 0,
      presence_penalty: 0
    },
    lorebookSettings: {
      scanDepth: 2000,
      tokenBudget: 1800,
      recursionDepth: 3,
      enableRecursion: true
    },
    promptTemplates: {
      systemPrompt: null,
      continue: null,
      character: null,
      instruction: null,
      rewriteThirdPerson: null
    }
  }
}

/**
 * Get default configuration for a specific provider
 * @param {string} provider - Provider name
 * @returns {object} Default configuration object
 */
export function getProviderDefaults(provider) {
  const defaults = PROVIDER_DEFAULTS[provider]
  if (!defaults) {
    console.warn(`No defaults found for provider: ${provider}`)
    return PROVIDER_DEFAULTS.deepseek // Fallback to deepseek
  }

  // Deep clone to avoid mutations
  return JSON.parse(JSON.stringify(defaults))
}

/**
 * Get display information for providers
 */
export const PROVIDER_INFO = {
  deepseek: {
    name: 'DeepSeek',
    description: 'DeepSeek with reasoning capabilities',
    icon: 'fa-brain'
  },
  aihorde: {
    name: 'AI Horde',
    description: 'Free, queue-based distributed AI',
    icon: 'fa-users'
  },
  openai: {
    name: 'OpenAI GPT-4',
    description: 'OpenAI GPT-4 models',
    icon: 'fa-robot'
  },
  anthropic: {
    name: 'Claude',
    description: 'Anthropic Claude models',
    icon: 'fa-comment'
  },
  openrouter: {
    name: 'OpenRouter',
    description: 'Multi-model API router',
    icon: 'fa-route'
  }
}
