/**
 * Default Configuration Presets
 * These are created on first run or during migration
 */

export const DEFAULT_PROMPT_TEMPLATES = {
  continue: "Continue the story naturally from where it left off. Write the next 2-3 paragraphs maximum, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters.",

  character: "Write the next part of the story from {{char}}'s perspective. Focus on their thoughts, actions, and dialogue. Write 2-3 paragraphs maximum, less if it makes sense stylistically or sets up a good response opportunity for other characters. (There is a chance that \"{{char}}'s\" is multiple characters, at which point you may respond as any of them as is relevant to the story.)",

  instruction: "Continue the story naturally from where it left off. Write the next 2-3 paragraphs maximum, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters. The user additionally sends along these instructions for what they would like to see happen: {{instruction}}",

  rewriteThirdPerson: "Rewrite the following text to be in third person narrative perspective, using past tense. Convert all first-person pronouns (I, me, my, we, us, our) to third-person (he, she, they, him, her, them, his, her, their). Change all verbs to past tense. Maintain the same events, dialogue, and meaning, but from a third-person narrator's viewpoint. Only return the rewritten text by itself in your response.\n\nText to rewrite:\n\n{{storyContent}}"
};

export function getDefaultPresets() {
  return {
    aihorde: {
      name: "Default",
      provider: "aihorde",
      apiConfig: {
        apiKey: "0000000000", // Default anonymous key
        baseURL: "https://aihorde.net/api/v2",
        models: [], // Empty by default - users should select from available models
        workerBlacklist: [],
        trustedWorkers: false,
        slowWorkers: true
      },
      generationSettings: {
        maxTokens: 512,  // AI Horde typically allows less
        maxContextTokens: 8192,  // Fallback; calculated dynamically based on workers
        temperature: 1.5,
        includeDialogueExamples: false,
        timeout: 300000  // 5 minute timeout for queue
      },
      lorebookSettings: {
        scanDepth: 2000,
        tokenBudget: 1800,
        recursionDepth: 3,
        enableRecursion: true
      },
      promptTemplates: { ...DEFAULT_PROMPT_TEMPLATES }
    },
  };
}

/**
 * Create a preset from existing settings (migration)
 */
export function createPresetFromSettings(settings) {
  return {
    name: "DeepSeek",
    provider: "deepseek",
    apiConfig: {
      apiKey: settings.apiKey || "",
      baseURL: "https://api.deepseek.com/v1",
      model: "deepseek-reasoner"
    },
    generationSettings: {
      maxTokens: settings.maxTokens || 4000,
      maxContextTokens: settings.maxContextTokens || 128000,
      temperature: settings.temperature !== undefined ? settings.temperature : 1.5,
      includeDialogueExamples: settings.includeDialogueExamples || false
    },
    lorebookSettings: {
      scanDepth: settings.lorebookScanDepth || 2000,
      tokenBudget: settings.lorebookTokenBudget || 1800,
      recursionDepth: settings.lorebookRecursionDepth || 3,
      enableRecursion: settings.lorebookEnableRecursion !== false
    },
    promptTemplates: { ...DEFAULT_PROMPT_TEMPLATES }
  };
}
