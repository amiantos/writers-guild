/**
 * Shared Prompt Building Service
 * Centralized logic for building system and generation prompts across all LLM providers
 */

import { MacroProcessor } from './macro-processor.js';
import { TemplateEngine } from './template-engine.js';
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE, DEFAULT_PROMPT_TEMPLATES } from './default-presets.js';

/**
 * Generation types where the model is handed existing text and expected to
 * return all of it. Only these should be told to keep image markers, and only
 * these should have dropped images re-appended on restore.
 */
export const REWRITE_GENERATION_TYPES = new Set(['rewriteThirdPerson']);

export class PromptBuilder {
  constructor(config = {}) {
    this.config = {
      // Default instruction templates (use imported defaults, allow override)
      instructionTemplates: config.instructionTemplates || {
        continue: DEFAULT_PROMPT_TEMPLATES.continue,
        character: DEFAULT_PROMPT_TEMPLATES.character,
        custom: 'Continue the story.',
      },

      // Whether to always filter asterisks (core feature)
      filterAsterisks: config.filterAsterisks ?? true,

      // Section headers
      sectionHeaders: config.sectionHeaders || {
        characterProfiles: '=== CHARACTER PROFILES ===',
        characterProfile: '=== CHARACTER PROFILE ===',
        dialogueExamples: '=== DIALOGUE STYLE EXAMPLES ===',
        worldInfo: '=== WORLD INFORMATION ===',
        persona: '=== USER CHARACTER (PERSONA) ===',
        instructions: '=== INSTRUCTIONS ===',
        perspective: '=== PERSPECTIVE ===',
      },
    };
  }

  /**
   * Replace template placeholders
   */
  replacePlaceholders(text, characterCard, persona) {
    if (!text) return text;

    let result = text;

    // Replace {{user}} with persona name
    const userName = persona?.name || 'User';
    result = result.replace(/\{\{user\}\}/gi, userName);

    // Replace {{char}} and {{character}} with character name
    const charName = characterCard?.data?.name || 'Character';
    result = result.replace(/\{\{char\}\}/gi, charName);
    result = result.replace(/\{\{character\}\}/gi, charName);

    return result;
  }

  /**
   * Filter asterisks from text
   */
  filterAsterisks(text, shouldFilter) {
    if (!text || !shouldFilter) return text;
    return text.replace(/\*/g, '');
  }

  /**
   * Process content with macros, placeholders, and asterisk filtering
   */
  processContent(text, characterCard, persona, macroProcessor) {
    if (!text) return text;

    let processed = this.replacePlaceholders(text, characterCard, persona);
    processed = macroProcessor.process(processed);
    processed = this.filterAsterisks(processed, this.config.filterAsterisks);

    return this.preserveImages(processed);
  }

  /**
   * Swap image markup for short placeholders so the model never sees a cached
   * asset URL. Locally cached URLs are ~130 chars of uuid and sha256 that a
   * model cannot reliably reproduce; [WG_IMAGE_n] it can.
   *
   * Must be applied to every piece of text that reaches the model. Anything
   * that builds prompt text without going through processContent() has to call
   * this itself — lorebook entries are built inline and need it explicitly.
   */
  preserveImages(text) {
    if (!this.imagePreserver || !text) return text;
    return this.imagePreserver.preserve(text);
  }

  /**
   * Macro + asterisk processing for lorebook entry content, which does not go
   * through processContent() (it has no character/persona placeholders to
   * replace), but still reaches the model and still carries images.
   */
  processLorebookContent(content, macroProcessor) {
    if (!content) return content;
    const processed = this.filterAsterisks(
      macroProcessor.process(content),
      this.config.filterAsterisks,
    );
    return this.preserveImages(processed);
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
      const processed = this.processContent(
        char.description,
        characterCard,
        persona,
        macroProcessor,
      );
      prompt += `Description: ${processed}\n`;
    }

    if (char.personality) {
      const processed = this.processContent(
        char.personality,
        characterCard,
        persona,
        macroProcessor,
      );
      prompt += `Personality: ${processed}\n`;
    }

    if (char.scenario) {
      const processed = this.processContent(char.scenario, characterCard, persona, macroProcessor);
      prompt += `\nCurrent Scenario: ${processed}\n`;
    }

    // Add dialogue examples if enabled
    if (char.mes_example && settings.includeDialogueExamples !== false) {
      const processed = this.processContent(
        char.mes_example,
        characterCard,
        persona,
        macroProcessor,
      );
      prompt += `\n${headers.dialogueExamples}\n${processed}\n`;
    }

    return prompt;
  }

  /**
   * Build character section (multiple characters)
   */
  buildMultipleCharactersSection(characterCards, persona, macroProcessor, _settings = {}) {
    if (!characterCards || characterCards.length === 0) return '';

    const headers = this.config.sectionHeaders;
    let prompt = `${headers.characterProfiles}\n\n`;

    characterCards.forEach((card, index) => {
      const char = card.data;

      if (index > 0) prompt += '\n---\n\n';

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

    prompt += '\n';
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
      prompt += this.processLorebookContent(entry.content, macroProcessor);
    });

    prompt += '\n';
    return prompt;
  }

  /**
   * Build persona section
   */
  buildPersonaSection(persona, characterCard, macroProcessor, _settings = {}) {
    if (!persona || !persona.name) return '';

    const headers = this.config.sectionHeaders;
    let prompt = `\n${headers.persona}\n`;
    prompt += `Name: ${persona.name}\n`;

    if (persona.description) {
      const processed = this.processContent(
        persona.description,
        characterCard,
        persona,
        macroProcessor,
      );
      prompt += `Description: ${processed}\n`;
    }

    if (persona.writingStyle) {
      const processed = this.processContent(
        persona.writingStyle,
        characterCard,
        persona,
        macroProcessor,
      );
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

    prompt += `Write only in third-person past tense perspective.\n`;
    prompt += `Use he/she/they pronouns and past tense verbs (said, walked, thought, etc.).\n`;
    prompt += `Do NOT use first-person (I, me, my, we) or present tense.\n`;
    prompt += `All narrative and dialogue tags should be in past tense.\n`;
    prompt += `Aspects of character information, such as their profile or dialog style examples, may be in the incorrect tense. Ignore the tense, focus on the context.\n`;

    // Add asterisk filtering instruction
    prompt += `\nDo not use asterisks (*) for actions. Write everything as prose.\n`;

    return prompt;
  }

  /**
   * Build complete system prompt from context
   * @param {Object} context - Generation context (persona, characterCards, activatedLorebooks, etc.)
   * @param {string} [customTemplate] - Optional custom system prompt template with placeholders
   * @returns {string} Built system prompt
   */
  buildSystemPrompt(context, customTemplate = null) {
    const { persona, characterCards, activatedLorebooks, story, settings = {} } = context;
    const characterCard = characterCards && characterCards.length === 1 ? characterCards[0] : null;
    const allCharacterCards = characterCards && characterCards.length > 1 ? characterCards : null;

    // Initialize macro processor with context
    const macroProcessor = new MacroProcessor({
      userName: persona?.name || 'User',
      charName:
        characterCard?.data?.name ||
        (allCharacterCards && allCharacterCards.length > 0
          ? allCharacterCards[0].data?.name
          : 'Character'),
    });

    // Prepare granular template data
    const templateData = {
      // Story scenario (overrides character scenarios when set)
      has_story_scenario: !!(story?.scenario && story.scenario.trim()),
      story_scenario: story?.scenario || '',

      // Character data
      has_single_character: !!characterCard,
      has_multiple_characters: !!allCharacterCards,
      character: characterCard
        ? {
            name: characterCard.data.name || '',
            description: this.processContent(
              characterCard.data.description,
              characterCard,
              persona,
              macroProcessor,
            ),
            personality: this.processContent(
              characterCard.data.personality,
              characterCard,
              persona,
              macroProcessor,
            ),
            scenario: this.processContent(
              characterCard.data.scenario,
              characterCard,
              persona,
              macroProcessor,
            ),
            mes_example: this.processContent(
              characterCard.data.mes_example,
              characterCard,
              persona,
              macroProcessor,
            ),
          }
        : null,
      characters: allCharacterCards
        ? allCharacterCards.map((card) => ({
            name: card.data.name || '',
            description: this.processContent(card.data.description, card, persona, macroProcessor),
            personality: this.processContent(card.data.personality, card, persona, macroProcessor),
            scenario: this.processContent(card.data.scenario, card, persona, macroProcessor),
          }))
        : [],

      // Lorebook data
      has_lorebook: !!(activatedLorebooks && activatedLorebooks.length > 0),
      lorebook_entries: activatedLorebooks
        ? activatedLorebooks.map((entry) => ({
            content: this.processLorebookContent(entry.content, macroProcessor),
            comment: entry.comment || '',
          }))
        : [],

      // Persona data
      has_persona: !!(persona && persona.name),
      persona:
        persona && persona.name
          ? {
              name: persona.name,
              description: this.processContent(
                persona.description,
                characterCard,
                persona,
                macroProcessor,
              ),
              writing_style: this.processContent(
                persona.writingStyle,
                characterCard,
                persona,
                macroProcessor,
              ),
            }
          : null,

      // Settings
      include_dialogue_examples: settings.includeDialogueExamples !== false,
    };

    // Use custom template if provided, otherwise use default template
    const template = customTemplate || DEFAULT_SYSTEM_PROMPT_TEMPLATE;

    // Render template with granular data
    const templateEngine = new TemplateEngine();
    const prompt = templateEngine.render(template, templateData);

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

    const contentToInclude =
      storyContent.length > maxChars ? '...' + storyContent.slice(-maxChars) : storyContent;

    return `Here is the current story so far:\n\n${contentToInclude}\n\n---\n\n`;
  }

  /**
   * Build generation prompt based on type
   */
  /**
   * Place the story into the prompt, preserving its images exactly once.
   *
   * A template either interpolates {{storyContent}} or gets the story appended
   * as separate context — never both. Preserving in both paths would register
   * every image twice and hand the model duplicate placeholders.
   *
   * @returns {{ instruction: string, storyContext: string }}
   */
  applyStoryContent(instruction, template, storyContent, maxChars, imagePreserver) {
    const usesPlaceholder = template.includes('{{storyContent}}');

    if (usesPlaceholder) {
      const preserved = imagePreserver
        ? imagePreserver.preserve(storyContent, 'story')
        : storyContent;
      return {
        // A function, so `$` patterns in the story ("$&", "$'") stay as written.
        instruction: instruction.replace(/\{\{storyContent\}\}/g, () => preserved),
        storyContext: '',
      };
    }

    if (!storyContent.trim()) {
      return { instruction, storyContext: '' };
    }

    // Only the content that survives truncation is preserved, so we never
    // register a placeholder for an image the model will not see.
    const truncated = this.truncateStoryContent(storyContent, maxChars);
    return {
      instruction,
      storyContext: imagePreserver ? imagePreserver.preserve(truncated, 'story') : truncated,
    };
  }

  buildGenerationPrompt(type, params) {
    const {
      storyContent,
      characterName,
      customInstruction,
      templateText,
      maxChars,
      userName,
      imagePreserver,
    } = params;

    let storyContext = '';
    let instruction = '';

    // Determine the actual template to use:
    // 1. Use templateText if explicitly provided (and not null)
    // 2. Otherwise use default templates
    const useCustomTemplate = templateText !== null && templateText !== undefined;

    if (useCustomTemplate) {
      instruction = templateText;

      // Replace placeholders in template
      if (characterName) {
        instruction = instruction.replace(/\{\{charName\}\}/g, characterName);
        instruction = instruction.replace(/\{\{char\}\}/g, characterName);
      }
      if (customInstruction) {
        instruction = instruction.replace(/\{\{instruction\}\}/g, () => customInstruction);
      }
      if (storyContent) {
        const applied = this.applyStoryContent(
          instruction,
          templateText,
          storyContent,
          maxChars,
          imagePreserver,
        );
        instruction = applied.instruction;
        storyContext = applied.storyContext;
      }
      instruction = instruction.replace(/\{\{user\}\}/gi, userName || 'the user');
    } else {
      // Use default templates
      const templates = this.config.instructionTemplates;

      // Get the default template based on type
      let defaultTemplate;
      switch (type) {
        case 'continue':
          defaultTemplate = DEFAULT_PROMPT_TEMPLATES.continue;
          break;
        case 'character':
          defaultTemplate = DEFAULT_PROMPT_TEMPLATES.character;
          break;
        case 'instruction':
          defaultTemplate = DEFAULT_PROMPT_TEMPLATES.instruction;
          break;
        case 'rewriteThirdPerson':
          defaultTemplate = DEFAULT_PROMPT_TEMPLATES.rewriteThirdPerson;
          break;
        case 'ideate':
          defaultTemplate = DEFAULT_PROMPT_TEMPLATES.ideate;
          break;
        case 'storyStarter':
          defaultTemplate = DEFAULT_PROMPT_TEMPLATES.storyStarter;
          break;
        case 'custom':
          defaultTemplate = templates.custom;
          break;
        default:
          defaultTemplate = templates.custom;
      }

      instruction = defaultTemplate;

      // Replace placeholders
      if (characterName) {
        instruction = instruction.replace(/\{\{charName\}\}/g, characterName);
        instruction = instruction.replace(/\{\{char\}\}/g, characterName);
      }
      if (customInstruction) {
        instruction = instruction.replace(/\{\{instruction\}\}/g, () => customInstruction);
      }
      if (storyContent) {
        const applied = this.applyStoryContent(
          instruction,
          defaultTemplate,
          storyContent,
          maxChars,
          imagePreserver,
        );
        instruction = applied.instruction;
        storyContext = applied.storyContext;
      }
      instruction = instruction.replace(/\{\{user\}\}/gi, userName || 'the user');
    }

    // Only whole-text rewrites are expected to reproduce the input, so only
    // they need the "keep the markers" instruction. Telling a `continue` to
    // preserve markers would invite it to echo images it was never asked for.
    if (imagePreserver && imagePreserver.saved.length > 0 && REWRITE_GENERATION_TYPES.has(type)) {
      instruction +=
        '\n\nIMPORTANT: Preserve any markers like [WG_IMAGE_0], [WG_IMAGE_1] etc. (image references) exactly as they appear in the text above. Do not remove or modify them.';
      console.log(`[ImagePreserver] Appended image-preservation note for ${type}`);
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
   * @param {string} [options.systemPromptTemplate] - Custom system prompt template (null = use default)
   * @returns {Object} { system: string, user: string }
   */
  buildPrompts(context, options = {}) {
    const {
      maxContextTokens = 128000,
      maxGenerationTokens = 4000,
      generationType = 'continue',
      characterName,
      customInstruction,
      templateText,
      systemPromptTemplate = null,
      userName,
      imagePreserver = null,
    } = options;

    // Exposed on the instance so processContent() can reach it — character,
    // persona and lorebook text all funnel through there, and all of it can
    // carry cached image URLs.
    this.imagePreserver = imagePreserver;

    // Build system prompt first (with custom template if provided and not null)
    const systemPrompt = this.buildSystemPrompt(
      context,
      systemPromptTemplate !== null ? systemPromptTemplate : undefined,
    );

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
      maxChars: availableChars,
      userName,
      imagePreserver,
    });

    return {
      system: systemPrompt,
      user: userPrompt,
    };
  }
}
