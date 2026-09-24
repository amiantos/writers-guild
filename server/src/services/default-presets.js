/**
 * Default Configuration Presets
 * These are created on first run or during migration
 */

/**
 * Default system prompt template with granular placeholders for full customization
 *
 * Available variables:
 * - has_story_scenario, story_scenario (story-level scenario override)
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

{{#if has_story_scenario}}
=== SCENARIO ===
{{story_scenario}}

{{/if}}{{#if has_single_character}}
=== CHARACTER PROFILE ===
Name: {{character.name}}
{{#if character.description}}Description: {{character.description}}
{{/if}}{{#if character.personality}}Personality: {{character.personality}}
{{/if}}{{#unless has_story_scenario}}{{#if character.scenario}}
Current Scenario: {{character.scenario}}
{{/if}}{{/unless}}{{#if include_dialogue_examples}}{{#if character.mes_example}}
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

LANGUAGE REQUIREMENT: You MUST write in the exact same language as the existing story content. Do NOT switch to English. If the story is in Spanish, write in Spanish. If in French, write in French. Match the language of the provided text exactly.

=== PERSPECTIVE ===
Write only in third-person past tense perspective.
Use he/she/they pronouns and past tense verbs (said, walked, thought, etc.).
Do NOT use first-person (I, me, my, we) or present tense.
All narrative and dialogue tags should be in past tense.
Aspects of character information, such as their profile or dialog style examples, may be in the incorrect tense. Ignore the tense, focus on the context.

Do not use asterisks (*) for actions. Write everything as prose.`;

/**
 * Default system prompt template for chat mode: a text message conversation
 * between the user's persona and one or more characters.
 *
 * Available variables:
 * - user (the persona's name, or "User"), char (the character writing now)
 * - is_group (more than one character), character_names ("Layla and Sam"),
 *   participant_names ("Bradley, Layla, and Sam", the user first)
 * - has_chat_scenario, chat_scenario
 * - characters (array) - each has: name, description, personality, scenario, mes_example
 *   (mes_example is empty unless the preset includes dialogue examples)
 * - has_persona, persona.name, persona.description, persona.personality
 * - has_lorebook, lorebook_entries (array) - each has: content, comment
 *
 * Same template syntax as the story system prompt. Inside {{#each}}, only the
 * item's own fields are available.
 */
export const DEFAULT_CHAT_SYSTEM_PROMPT_TEMPLATE = `You write text messages in a {{#if is_group}}group chat{{/if}}{{#unless is_group}}private chat{{/unless}} between {{participant_names}}. {{user}} is the user's character, and the user writes their messages. You write the other side: only the character whose turn it is, and only what they type.

{{#if has_chat_scenario}}
=== SCENARIO ===
{{chat_scenario}}

{{/if}}=== {{#if is_group}}CHARACTERS{{/if}}{{#unless is_group}}CHARACTER{{/unless}} ===
{{#each characters}}Name: {{name}}
{{#if description}}Description: {{description}}
{{/if}}{{#if personality}}Personality: {{personality}}
{{/if}}{{#if mes_example}}How they talk:
{{mes_example}}
{{/if}}{{#unless @last}}
---
{{/unless}}{{/each}}

{{#if has_persona}}=== {{user}} (THE USER'S CHARACTER) ===
{{#if persona.description}}Description: {{persona.description}}
{{/if}}{{#if persona.personality}}Personality: {{persona.personality}}
{{/if}}
{{/if}}{{#if has_lorebook}}=== WORLD INFORMATION ===
{{#each lorebook_entries}}{{content}}{{#unless @last}}

{{/unless}}{{/each}}

{{/if}}=== MESSAGE STYLE ===
Write text messages, the way the character would type them on their phone.
Keep messages short, usually a sentence or two, and send a few short messages rather than one long one.
Write only what they type: no narration, no descriptions of actions, no asterisks, and no quotation marks around messages.
Match the character's voice and mood, and what the scenario says they're doing.
Write in the same language as the conversation.`;

/**
 * Default user prompt templates with placeholders
 * Available placeholders:
 * - {{char}} / {{charName}} - Character name
 * - {{instruction}} - Custom user instruction
 * - {{storyContent}} - Current story content
 * - {{user}} - User/persona name
 *
 * chatReply is chat mode's instruction for the next reply, rendered with the
 * same template syntax as the system prompts. Variables: char, user, is_group,
 * is_first_message (the chat is empty), is_reply (someone else spoke last),
 * is_follow_up (char spoke last), and conversation (the transcript; placed
 * before the instruction when the template doesn't use it).
 */
export const DEFAULT_PROMPT_TEMPLATES = {
  continue:
    'Continue the story naturally from where it left off. Write the next 7 paragraphs, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters.',

  character:
    'Write the next part of the story from {{char}}\'s perspective. Focus on their thoughts, actions, and dialogue. Write 2-3 paragraphs maximum, less if it makes sense stylistically or sets up a good response opportunity for other characters. (There is a chance that "{{char}}\'s" is multiple characters, at which point you may respond as any of them as is relevant to the story.)',

  instruction:
    'Continue the story naturally from where it left off. Write the next 7 paragraphs, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters. The user additionally sends along these instructions for what events they would like to see occur: {{instruction}}',

  rewriteThirdPerson:
    'Rewrite the following text to be in third person narrative perspective, using past tense. Assume reference to "you" in the original text are meant to reference the user\'s Persona, if one is provided. Change all verbs to past tense. Maintain the same events, dialogue, and meaning, but from a third-person narrator\'s viewpoint. Feel free to correct errors in grammar, punctuation, and paragraph formatting. Only return the rewritten text by itself in your response.\n\nText to rewrite:\n\n{{storyContent}}',

  ideate:
    'Instead of continuing the story, please provide 3-5 creative suggestions for what {{user}} could do next to move this story forward. Consider the characters, setting, and current situation. Format your response as a numbered list of actionable ideas.',

  storyStarter:
    'Write the opening 3-5 paragraphs for a new story. Establish the setting, introduce the characters naturally, and create an engaging hook that draws readers in. Focus on vivid scene-setting and character introduction without rushing into action. End at a natural point that invites continuation.',

  chatReply: `{{#if is_first_message}}The chat is empty. Write the first message {{char}} sends{{#if is_group}} to the group{{/if}}.{{/if}}{{#if is_reply}}Write {{char}}'s reply.{{/if}}{{#if is_follow_up}}No one has answered {{char}} yet. Write a short follow-up from {{char}}.{{/if}}
Stay in character. Write only what {{char}} sends, never anyone else's messages, and don't label messages with names.
Write one to four messages, with a line containing only --- between messages.`,
};

export function getDefaultPresets() {
  return {
    openaicompatible: {
      name: 'OpenAI Compatible',
      provider: 'openaicompatible',
      apiConfig: {
        baseURL: 'http://localhost:1234/v1',
        apiKey: '',
        model: '',
      },
      generationSettings: {
        maxTokens: 4000,
        maxContextTokens: 8192,
        temperature: 0.7,
        includeDialogueExamples: false,
        top_p: null,
        frequency_penalty: null,
        presence_penalty: null,
        stop_sequences: [],
      },
      lorebookSettings: {
        scanDepth: 2000,
        tokenBudget: 1800,
        recursionDepth: 3,
        enableRecursion: true,
      },
      promptTemplates: {
        systemPrompt: null,
        continue: null,
        character: null,
        instruction: null,
        rewriteThirdPerson: null,
        ideate: null,
        storyStarter: null,
      },
    },
    ollama: {
      name: 'Ollama',
      provider: 'ollama',
      apiConfig: {
        baseURL: 'http://localhost:11434',
        password: '',
        model: '',
      },
      generationSettings: {
        maxTokens: 200,
        maxContextTokens: 4096,
        temperature: 0.7,
        includeDialogueExamples: false,
        top_p: null,
        top_k: null,
        min_p: null,
        typical: null,
        tfs: null,
        rep_pen: null,
        rep_pen_range: null,
        mirostat: null,
        mirostat_tau: null,
        mirostat_eta: null,
        stop_sequences: [],
      },
      lorebookSettings: {
        scanDepth: 2000,
        tokenBudget: 1800,
        recursionDepth: 3,
        enableRecursion: true,
      },
      promptTemplates: {
        systemPrompt: null,
        continue: null,
        character: null,
        instruction: null,
        rewriteThirdPerson: null,
        ideate: null,
        storyStarter: null,
      },
    },
    koboldcpp: {
      name: 'KoboldCpp',
      provider: 'koboldcpp',
      apiConfig: {
        baseURL: 'http://localhost:5001/api',
        password: '',
        model: '',
      },
      generationSettings: {
        maxTokens: 200,
        maxContextTokens: 4096,
        temperature: 0.7,
        includeDialogueExamples: false,
        top_p: null,
        top_k: null,
        top_a: null,
        typical: null,
        tfs: null,
        min_p: null,
        rep_pen: null,
        rep_pen_range: null,
        rep_pen_slope: null,
        sampler_order: null,
        mirostat: null,
        mirostat_tau: null,
        mirostat_eta: null,
        stop_sequences: [],
      },
      lorebookSettings: {
        scanDepth: 2000,
        tokenBudget: 1800,
        recursionDepth: 3,
        enableRecursion: true,
      },
      promptTemplates: {
        systemPrompt: null,
        continue: null,
        character: null,
        instruction: null,
        rewriteThirdPerson: null,
        ideate: null,
        storyStarter: null,
      },
    },
    aihorde: {
      name: 'Default',
      provider: 'aihorde',
      apiConfig: {
        apiKey: '0000000000', // Default anonymous key
        baseURL: 'https://aihorde.net/api/v2',
        models: [], // Empty by default - users should select from available models
        workerBlacklist: [],
        trustedWorkers: false,
        slowWorkers: true,
      },
      generationSettings: {
        maxTokens: 512, // AI Horde typically allows less
        maxContextTokens: 8192, // Fallback; calculated dynamically based on workers
        temperature: 0.7,
        includeDialogueExamples: false,
        timeout: 300000, // 5 minute timeout for queue
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
        smoothing_factor: null,
      },
      lorebookSettings: {
        scanDepth: 2000,
        tokenBudget: 1800,
        recursionDepth: 3,
        enableRecursion: true,
      },
      promptTemplates: {
        systemPrompt: null,
        continue: null,
        character: null,
        instruction: null,
        rewriteThirdPerson: null,
        ideate: null,
        storyStarter: null,
      },
    },
  };
}

/**
 * Create a preset from existing settings (migration)
 */
export function createPresetFromSettings(settings) {
  return {
    name: 'DeepSeek',
    provider: 'deepseek',
    apiConfig: {
      apiKey: settings.apiKey || '',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-v4-flash',
    },
    generationSettings: {
      maxTokens: settings.maxTokens || 4000,
      maxContextTokens: settings.maxContextTokens || 128000,
      temperature: settings.temperature !== undefined ? settings.temperature : 1.0,
      thinking: false,
      reasoningEffort: 'high',
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
      smoothing_factor: null,
    },
    lorebookSettings: {
      scanDepth: settings.lorebookScanDepth || 2000,
      tokenBudget: settings.lorebookTokenBudget || 1800,
      recursionDepth: settings.lorebookRecursionDepth || 3,
      enableRecursion: settings.lorebookEnableRecursion !== false,
    },
    promptTemplates: {
      systemPrompt: null,
      continue: null,
      character: null,
      instruction: null,
      rewriteThirdPerson: null,
      ideate: null,
      storyStarter: null,
    },
  };
}
