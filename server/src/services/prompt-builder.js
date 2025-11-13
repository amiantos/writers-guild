/**
 * Shared Prompt Building Service
 * Centralized logic for building system and generation prompts across all LLM providers
 */

import { MacroProcessor } from './macro-processor.js';

export class PromptBuilder {
  constructor(config = {}) {
    this.config = {
      // Default instruction templates
      instructionTemplates: config.instructionTemplates || {
        continue: "Continue the story naturally from where it left off. Write the next 2-3 paragraphs maximum, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters.",
        character: "Write the next part of the story from {{charName}}'s perspective. Focus on their thoughts, actions, and dialogue. Write 2-3 paragraphs maximum, less if it makes sense stylistically or sets up a good response opportunity for other characters. (There is a chance that \"{{charName}}'s\" is multiple characters, at which point you may respond as any of them as is relevant to the story.)",
        custom: "Continue the story."
      },

      // Whether to always filter asterisks (core feature)
      filterAsterisks: config.filterAsterisks ?? true,

      // Section headers
      sectionHeaders: config.sectionHeaders || {
        characterProfiles: "=== CHARACTER PROFILES ===",
        characterProfile: "=== CHARACTER PROFILE ===",
        dialogueExamples: "=== DIALOGUE STYLE EXAMPLES ===",
        worldInfo: "=== WORLD INFORMATION ===",
        persona: "=== USER CHARACTER (PERSONA) ===",
        instructions: "=== INSTRUCTIONS ===",
        perspective: "=== PERSPECTIVE ==="
      }
    };
  }

  /**
   * Replace template placeholders
   */
  replacePlaceholders(text, characterCard, persona) {
    if (!text) return text;

    let result = text;

    // Replace {{user}} with persona name
    const userName = persona?.name || "User";
    result = result.replace(/\{\{user\}\}/gi, userName);

    // Replace {{char}} and {{character}} with character name
    const charName = characterCard?.data?.name || "Character";
    result = result.replace(/\{\{char\}\}/gi, charName);
    result = result.replace(/\{\{character\}\}/gi, charName);

    return result;
  }

  /**
   * Filter asterisks from text
   */
  filterAsterisks(text, shouldFilter) {
    if (!text || !shouldFilter) return text;
    return text.replace(/\*/g, "");
  }

  /**
   * Process content with macros, placeholders, and asterisk filtering
   */
  processContent(text, characterCard, persona, macroProcessor) {
    if (!text) return text;

    let processed = this.replacePlaceholders(text, characterCard, persona);
    processed = macroProcessor.process(processed);
    processed = this.filterAsterisks(processed, this.config.filterAsterisks);

    return processed;
  }

  /**
   * Build character section (single character)
   */
  buildSingleCharacterSection(characterCard, persona, macroProcessor, settings = {}) {
    if (!characterCard?.data) return '';

    const char = characterCard.data;
    const headers = this.config.sectionHeaders;
    let prompt = `${headers.characterProfile}\n`;
    prompt += `Name: ${char.name}\n`;

    if (char.description) {
      const processed = this.processContent(char.description, characterCard, persona, macroProcessor);
      prompt += `Description: ${processed}\n`;
    }

    if (char.personality) {
      const processed = this.processContent(char.personality, characterCard, persona, macroProcessor);
      prompt += `Personality: ${processed}\n`;
    }

    if (char.scenario) {
      const processed = this.processContent(char.scenario, characterCard, persona, macroProcessor);
      prompt += `\nCurrent Scenario: ${processed}\n`;
    }

    // Add dialogue examples if enabled
    if (char.mes_example && settings.includeDialogueExamples !== false) {
      const processed = this.processContent(char.mes_example, characterCard, persona, macroProcessor);
      prompt += `\n${headers.dialogueExamples}\n${processed}\n`;
    }

    return prompt;
  }

  /**
   * Build character section (multiple characters)
   */
  buildMultipleCharactersSection(characterCards, persona, macroProcessor, settings = {}) {
    if (!characterCards || characterCards.length === 0) return '';

    const headers = this.config.sectionHeaders;
    let prompt = `${headers.characterProfiles}\n\n`;

    characterCards.forEach((card, index) => {
      const char = card.data;

      if (index > 0) prompt += "\n---\n\n";

      prompt += `Character ${index + 1}: ${char.name}\n`;

      if (char.description) {
        const processed = this.processContent(char.description, card, persona, macroProcessor);
        prompt += `Description: ${processed}\n`;
      }

      if (char.personality) {
        const processed = this.processContent(char.personality, card, persona, macroProcessor);
        prompt += `Personality: ${processed}\n`;
      }

      // Only include scenario if there's exactly one character
      if (char.scenario && characterCards.length === 1) {
        const processed = this.processContent(char.scenario, card, persona, macroProcessor);
        prompt += `Scenario: ${processed}\n`;
      }
    });

    prompt += "\n";
    return prompt;
  }

  /**
   * Build lorebook section
   */
  buildLorebookSection(activatedLorebooks, macroProcessor, settings = {}) {
    if (!activatedLorebooks || activatedLorebooks.length === 0) return '';

    const headers = this.config.sectionHeaders;
    let prompt = `\n${headers.worldInfo}\n\n`;

    activatedLorebooks.forEach((entry, index) => {
      if (index > 0) prompt += '\n\n';

      // Optionally include comment for debugging
      if (entry.comment && settings.showPrompt) {
        prompt += `<!-- ${entry.comment} -->\n`;
      }

      // Process macros in lorebook content
      let content = entry.content;
      content = macroProcessor.process(content);
      content = this.filterAsterisks(content, this.config.filterAsterisks);

      prompt += content;
    });

    prompt += '\n';
    return prompt;
  }

  /**
   * Build persona section
   */
  buildPersonaSection(persona, characterCard, macroProcessor, settings = {}) {
    if (!persona || !persona.name) return '';

    const headers = this.config.sectionHeaders;
    let prompt = `\n${headers.persona}\n`;
    prompt += `Name: ${persona.name}\n`;

    if (persona.description) {
      const processed = this.processContent(persona.description, characterCard, persona, macroProcessor);
      prompt += `Description: ${processed}\n`;
    }

    if (persona.writingStyle) {
      const processed = this.processContent(persona.writingStyle, characterCard, persona, macroProcessor);
      prompt += `Writing Style: ${processed}\n`;
    }

    return prompt;
  }

  /**
   * Build instructions section
   */
  buildInstructionsSection() {
    const headers = this.config.sectionHeaders;
    let prompt = `\n${headers.instructions}\n`;
    prompt += `Write in a narrative, novel-style format with proper paragraphs and dialogue.\n`;
    prompt += `Maintain consistency with established characters and plot.\n`;
    prompt += `Focus on showing rather than telling, with vivid descriptions and natural dialogue.\n`;

    return prompt;
  }

  /**
   * Build perspective section
   */
  buildPerspectiveSection() {
    const headers = this.config.sectionHeaders;
    let prompt = `\n${headers.perspective}\n`;

    prompt += `Write in third-person past tense perspective.\n`;
    prompt += `Use he/she/they pronouns and past tense verbs (said, walked, thought, etc.).\n`;
    prompt += `Do NOT use first-person (I, me, my, we) or present tense.\n`;
    prompt += `All narrative and dialogue tags should be in past tense.\n`;

    // Add asterisk filtering instruction
    prompt += `\nDo not use asterisks (*) for actions. Write everything as prose.\n`;

    return prompt;
  }

  /**
   * Build complete system prompt from context
   */
  buildSystemPrompt(context) {
    const { persona, characterCards, activatedLorebooks, story, settings = {} } = context;
    const characterCard = characterCards && characterCards.length === 1 ? characterCards[0] : null;
    const allCharacterCards = characterCards && characterCards.length > 1 ? characterCards : null;

    let prompt = "You are a creative writing assistant helping to write a novel-style story.\n\n";

    // Initialize macro processor with context
    const macroProcessor = new MacroProcessor({
      userName: persona?.name || 'User',
      charName: characterCard?.data?.name || (allCharacterCards && allCharacterCards.length > 0 ? allCharacterCards[0].data?.name : 'Character')
    });

    // Add character sections
    if (allCharacterCards && allCharacterCards.length > 0) {
      prompt += this.buildMultipleCharactersSection(allCharacterCards, persona, macroProcessor, settings);
    } else if (characterCard) {
      prompt += this.buildSingleCharacterSection(characterCard, persona, macroProcessor, settings);
    }

    // Add lorebook entries
    prompt += this.buildLorebookSection(activatedLorebooks, macroProcessor, settings);

    // Add user persona
    prompt += this.buildPersonaSection(persona, characterCard, macroProcessor, settings);

    // Add instructions and perspective
    prompt += this.buildInstructionsSection();
    prompt += this.buildPerspectiveSection();

    return prompt;
  }

  /**
   * Truncate story content to fit within context limits
   */
  truncateStoryContent(storyContent, maxChars) {
    if (!storyContent || !storyContent.trim()) return '';

    // maxChars must be provided by caller
    if (!maxChars || maxChars <= 0) {
      throw new Error('maxChars must be provided and greater than 0');
    }

    const contentToInclude = storyContent.length > maxChars
      ? "..." + storyContent.slice(-maxChars)
      : storyContent;

    return `Here is the current story so far:\n\n${contentToInclude}\n\n---\n\n`;
  }

  /**
   * Build generation prompt based on type
   */
  buildGenerationPrompt(type, params) {
    const { storyContent, characterName, customInstruction, templateText, maxChars } = params;

    let storyContext = "";
    let instruction = "";

    // Use template text if provided
    if (templateText) {
      instruction = templateText;

      // Replace placeholders in template
      if (characterName) {
        instruction = instruction.replace(/\{\{charName\}\}/g, characterName);
        instruction = instruction.replace(/\{\{char\}\}/g, characterName);
      }
      if (customInstruction) {
        instruction = instruction.replace(/\{\{instruction\}\}/g, customInstruction);
      }
      if (storyContent) {
        instruction = instruction.replace(/\{\{storyContent\}\}/g, storyContent);
      }

      // If template doesn't use {{storyContent}}, add story context separately
      if (storyContent && storyContent.trim() && !templateText.includes('{{storyContent}}')) {
        storyContext = this.truncateStoryContent(storyContent, maxChars);
      }
    } else {
      // Default templates - always add story context
      if (storyContent && storyContent.trim()) {
        storyContext = this.truncateStoryContent(storyContent, maxChars);
      }

      const templates = this.config.instructionTemplates;

      switch (type) {
        case "continue":
          instruction = templates.continue;
          break;

        case "character":
          const charName = characterName || "the character";
          instruction = templates.character.replace(/\{\{charName\}\}/g, charName);
          break;

        case "custom":
          instruction = customInstruction || templates.custom;
          break;

        default:
          instruction = templates.custom;
      }
    }

    return storyContext + instruction;
  }

  /**
   * Helper: Estimate token count from characters (rough approximation)
   * @param {string} text - Text to estimate tokens for
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    if (!text) return 0;
    // Rough approximation: ~3 characters per token for English text
    return Math.ceil(text.length / 3);
  }

  /**
   * Build both system and user prompts with proper context management
   * This method replaces the separate buildSystemPrompt/buildGenerationPrompt calls
   * and ensures the combined prompts stay within context limits.
   *
   * @param {Object} context - Full generation context
   * @param {Object} options - Options for prompt building
   * @param {number} options.maxContextTokens - Maximum context window in tokens
   * @param {number} options.maxGenerationTokens - Tokens reserved for generation
   * @param {string} options.generationType - Type of generation (continue, character, custom)
   * @param {string} [options.characterName] - Character name for character generation
   * @param {string} [options.customInstruction] - Custom instruction for custom generation
   * @param {string} [options.templateText] - Template text override
   * @returns {Object} { system: string, user: string }
   */
  buildPrompts(context, options = {}) {
    const {
      maxContextTokens = 128000,
      maxGenerationTokens = 4000,
      generationType = 'continue',
      characterName,
      customInstruction,
      templateText
    } = options;

    // Build system prompt first
    const systemPrompt = this.buildSystemPrompt(context);

    // Estimate system prompt token usage
    const systemTokens = this.estimateTokens(systemPrompt);

    // Calculate available tokens for user prompt
    // Reserve some overhead for formatting and safety margin
    const overhead = 100;
    const availableForUser = maxContextTokens - systemTokens - maxGenerationTokens - overhead;

    // Convert available tokens to characters (~3 chars per token)
    const availableChars = Math.max(1000, availableForUser * 3);

    // Build user prompt with story content truncated to fit budget
    const userPrompt = this.buildGenerationPrompt(generationType, {
      storyContent: context.story?.content || '',
      characterName,
      customInstruction,
      templateText,
      maxChars: availableChars
    });

    return {
      system: systemPrompt,
      user: userPrompt
    };
  }
}
