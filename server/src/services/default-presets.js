/**
 * Default Configuration Presets
 * These are created on first run or during migration
 */

/**
 * Default system prompt template with granular placeholders for full customization
 *
 * Available variables:
 * - has_single_character, has_multiple_characters, has_lorebook, has_persona
 * - character.name, character.description, character.personality, character.scenario, character.mes_example
 * - characters (array) - each has: name, description, personality, scenario
 * - lorebook_entries (array) - each has: content, comment
 * - persona.name, persona.description, persona.writing_style
 * - include_dialogue_examples (boolean from settings)
 *
 * Template syntax:
 * - {{variable}} or {{object.property}} - substitute value
 * - {{#if variable}}...{{/if}} - conditional block
 * - {{#unless variable}}...{{/unless}} - inverse conditional
 * - {{#each array}}...{{/each}} - loop block
 *   Inside loops: {{property}}, {{@index}}, {{@index_1}}, {{@first}}, {{@last}}
 */
export const DEFAULT_SYSTEM_PROMPT_TEMPLATE = `You are a creative writing assistant helping to write a novel-style story.

{{#if has_single_character}}
=== CHARACTER PROFILE ===
Name: {{character.name}}
{{#if character.description}}Description: {{character.description}}
{{/if}}{{#if character.personality}}Personality: {{character.personality}}
{{/if}}{{#if character.scenario}}
Current Scenario: {{character.scenario}}
{{/if}}{{#if include_dialogue_examples}}{{#if character.mes_example}}
=== DIALOGUE STYLE EXAMPLES ===
{{character.mes_example}}
{{/if}}{{/if}}
{{/if}}{{#if has_multiple_characters}}
=== CHARACTER PROFILES ===
{{#each characters}}
Character {{@index_1}}: {{name}}
{{#if description}}Description: {{description}}
{{/if}}{{#if personality}}Personality: {{personality}}
{{/if}}{{#unless @last}}
---
{{/unless}}{{/each}}

{{/if}}{{#if has_lorebook}}
=== WORLD INFORMATION ===
{{#each lorebook_entries}}{{content}}{{#unless @last}}

{{/unless}}{{/each}}

{{/if}}{{#if has_persona}}
=== USER CHARACTER (PERSONA) ===
Name: {{persona.name}}
{{#if persona.description}}Description: {{persona.description}}
{{/if}}{{#if persona.writing_style}}Writing Style: {{persona.writing_style}}
{{/if}}

{{/if}}
=== INSTRUCTIONS ===
Write in a narrative, novel-style format with proper paragraphs and dialogue.
Maintain consistency with established characters and plot.
Focus on showing rather than telling, with vivid descriptions and natural dialogue.

=== PERSPECTIVE ===
Write only in third-person past tense perspective.
Use he/she/they pronouns and past tense verbs (said, walked, thought, etc.).
Do NOT use first-person (I, me, my, we) or present tense.
All narrative and dialogue tags should be in past tense.
Aspects of character information, such as their profile or dialog style examples, may be in the incorrect tense. Ignore the tense, focus on the context.

Do not use asterisks (*) for actions. Write everything as prose.`;

/**
 * Default user prompt templates with placeholders
 * Available placeholders:
 * - {{char}} / {{charName}} - Character name
 * - {{instruction}} - Custom user instruction
 * - {{storyContent}} - Current story content
 * - {{user}} - User/persona name
 */
export const DEFAULT_PROMPT_TEMPLATES = {
  continue: "Continue the story naturally from where it left off. Write the next 7 paragraphs, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters.",

  character: "Write the next part of the story from {{char}}'s perspective. Focus on their thoughts, actions, and dialogue. Write 2-3 paragraphs maximum, less if it makes sense stylistically or sets up a good response opportunity for other characters. (There is a chance that \"{{char}}'s\" is multiple characters, at which point you may respond as any of them as is relevant to the story.)",

  instruction: "Continue the story naturally from where it left off. Write the next 7 paragraphs, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters. The user additionally sends along these instructions for what events they would like to see occur: {{instruction}}",

  rewriteThirdPerson: "Rewrite the following text to be in third person narrative perspective, using past tense. Assume reference to \"you\" in the original text are meant to reference the user's Persona, if one is provided. Change all verbs to past tense. Maintain the same events, dialogue, and meaning, but from a third-person narrator's viewpoint. Feel free to correct errors in grammar, punctuation, and paragraph formatting. Only return the rewritten text by itself in your response.\n\nText to rewrite:\n\n{{storyContent}}",

  ideate: "Instead of continuing the story, please provide 3-5 creative suggestions for what {{user}} could do next to move this story forward. Consider the characters, setting, and current situation. Format your response as a numbered list of actionable ideas."
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
        temperature: 0.7,
        includeDialogueExamples: false,
        timeout: 300000,  // 5 minute timeout for queue
        // Advanced sampling parameters (optional)
        top_p: null,
        top_k: null,
        top_a: null,
        typical: null,
        tfs: null,
        frequency_penalty: null,
        presence_penalty: null,
        stop_sequences: [],
        // AI Horde specific
        rep_pen: 1.1,
        rep_pen_range: 320,
        rep_pen_slope: null,
        sampler_order: [6, 0, 1, 3, 4, 2, 5],
        min_p: null,
        dynatemp_range: null,
        dynatemp_exponent: null,
        smoothing_factor: null
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
        rewriteThirdPerson: null,
        ideate: null
      }
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
      includeDialogueExamples: settings.includeDialogueExamples || false,
      // Advanced sampling parameters (optional, null = use API defaults)
      top_p: null,
      top_k: null,
      top_a: null,
      typical: null,
      tfs: null,
      frequency_penalty: null,
      presence_penalty: null,
      stop_sequences: [],
      // AI Horde specific
      rep_pen: null,
      rep_pen_range: null,
      rep_pen_slope: null,
      sampler_order: null,
      min_p: null,
      dynatemp_range: null,
      dynatemp_exponent: null,
      smoothing_factor: null
    },
    lorebookSettings: {
      scanDepth: settings.lorebookScanDepth || 2000,
      tokenBudget: settings.lorebookTokenBudget || 1800,
      recursionDepth: settings.lorebookRecursionDepth || 3,
      enableRecursion: settings.lorebookEnableRecursion !== false
    },
    promptTemplates: {
      systemPrompt: null,
      continue: null,
      character: null,
      instruction: null,
      rewriteThirdPerson: null
    }
  };
}
