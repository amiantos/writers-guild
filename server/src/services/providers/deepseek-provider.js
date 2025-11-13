/**
 * DeepSeek Provider Implementation
 * Extends base LLMProvider with DeepSeek-specific functionality
 */

import { LLMProvider } from './base-provider.js';
import { MacroProcessor } from '../macro-processor.js';

export class DeepSeekProvider extends LLMProvider {
  constructor(config) {
    // DeepSeek-specific defaults
    const deepseekConfig = {
      ...config,
      baseURL: config.baseURL || "https://api.deepseek.com/v1",
      model: config.model || "deepseek-reasoner"
    };

    super(deepseekConfig);
  }

  /**
   * Get DeepSeek provider capabilities
   */
  getCapabilities() {
    return {
      streaming: true,
      reasoning: true,
      visionAPI: false,
      maxContextWindow: 64000 // DeepSeek context window
    };
  }

  /**
   * Validate DeepSeek configuration
   */
  validateConfig() {
    if (!this.apiKey || this.apiKey.trim() === '') {
      return {
        valid: false,
        error: 'API key is required'
      };
    }

    return { valid: true };
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
   * Build system prompt from context
   */
  buildSystemPrompt(context) {
    const { persona, characterCards, activatedLorebooks, story, settings = {} } = context;
    const characterCard = characterCards && characterCards.length === 1 ? characterCards[0] : null;
    const allCharacterCards = characterCards && characterCards.length > 1 ? characterCards : null;

    let prompt =
      "You are a creative writing assistant helping to write a novel-style story.\n\n";

    // Initialize macro processor with context
    const macroProcessor = new MacroProcessor({
      userName: persona?.name || 'User',
      charName: characterCard?.data?.name || (allCharacterCards && allCharacterCards.length > 0 ? allCharacterCards[0].data?.name : 'Character')
    });

    // If we have multiple characters (for continue/custom), add all of them
    if (allCharacterCards && allCharacterCards.length > 0) {
      const filterAst = true; // Always filter asterisks (core feature)

      prompt += "=== CHARACTER PROFILES ===\n\n";

      allCharacterCards.forEach((card, index) => {
        const char = card.data;

        if (index > 0) prompt += "\n---\n\n";

        prompt += `Character ${index + 1}: ${char.name}\n`;

        if (char.description) {
          let processed = this.replacePlaceholders(char.description, card, persona);
          processed = macroProcessor.process(processed);
          prompt += `Description: ${this.filterAsterisks(processed, filterAst)}\n`;
        }

        if (char.personality) {
          let processed = this.replacePlaceholders(char.personality, card, persona);
          processed = macroProcessor.process(processed);
          prompt += `Personality: ${this.filterAsterisks(processed, filterAst)}\n`;
        }

        // Only include scenario if there's exactly one character (non-persona)
        if (char.scenario && allCharacterCards.length === 1) {
          let processed = this.replacePlaceholders(char.scenario, card, persona);
          processed = macroProcessor.process(processed);
          prompt += `Scenario: ${this.filterAsterisks(processed, filterAst)}\n`;
        }
      });

      prompt += "\n";
    } else if (characterCard && characterCard.data) {
      // Single character (for character-based generation)
      const char = characterCard.data;
      const filterAst = true; // Always filter asterisks (core feature)

      // Note: system_prompt is intentionally ignored (too directive for novel writing)

      prompt += "=== CHARACTER PROFILE ===\n";
      prompt += `Name: ${char.name}\n`;

      if (char.description) {
        let processed = this.replacePlaceholders(
          char.description,
          characterCard,
          persona
        );
        processed = macroProcessor.process(processed);
        prompt += `Description: ${this.filterAsterisks(
          processed,
          filterAst
        )}\n`;
      }

      if (char.personality) {
        let processed = this.replacePlaceholders(
          char.personality,
          characterCard,
          persona
        );
        processed = macroProcessor.process(processed);
        prompt += `Personality: ${this.filterAsterisks(
          processed,
          filterAst
        )}\n`;
      }

      if (char.scenario) {
        let processed = this.replacePlaceholders(
          char.scenario,
          characterCard,
          persona
        );
        processed = macroProcessor.process(processed);
        prompt += `\nCurrent Scenario: ${this.filterAsterisks(
          processed,
          filterAst
        )}\n`;
      }

      // Add writing style examples (with replacements and filtering)
      if (char.mes_example && settings.includeDialogueExamples !== false) {
        let processed = this.replacePlaceholders(
          char.mes_example,
          characterCard,
          persona
        );
        processed = macroProcessor.process(processed);
        prompt += `\n=== DIALOGUE STYLE EXAMPLES ===\n${this.filterAsterisks(
          processed,
          filterAst
        )}\n`;
      }

      // Note: post_history_instructions and system_prompt are intentionally ignored
    }

    // Add lorebook entries (after character profiles)
    if (activatedLorebooks && activatedLorebooks.length > 0) {
      const filterAst = true; // Always filter asterisks (core feature)

      prompt += `\n=== WORLD INFORMATION ===\n\n`;

      activatedLorebooks.forEach((entry, index) => {
        if (index > 0) prompt += '\n\n';

        // Optionally include comment for debugging
        if (entry.comment && settings.showPrompt) {
          prompt += `<!-- ${entry.comment} -->\n`;
        }

        // Process macros in lorebook content
        let content = entry.content;
        content = macroProcessor.process(content);

        // Filter asterisks from lorebook content if enabled
        content = this.filterAsterisks(content, filterAst);

        prompt += content;
      });

      prompt += '\n';
    }

    // Add user persona
    if (persona && persona.name) {
      const filterAst = true; // Always filter asterisks (core feature)

      prompt += `\n=== USER CHARACTER (PERSONA) ===\n`;
      prompt += `Name: ${persona.name}\n`;

      if (persona.description) {
        let processed = this.replacePlaceholders(
          persona.description,
          characterCard,
          persona
        );
        processed = macroProcessor.process(processed);
        prompt += `Description: ${this.filterAsterisks(
          processed,
          filterAst
        )}\n`;
      }

      if (persona.writingStyle) {
        let processed = this.replacePlaceholders(
          persona.writingStyle,
          characterCard,
          persona
        );
        processed = macroProcessor.process(processed);
        prompt += `Writing Style: ${this.filterAsterisks(
          processed,
          filterAst
        )}\n`;
      }
    }

    prompt += `\n=== INSTRUCTIONS ===\n`;
    prompt += `Write in a narrative, novel-style format with proper paragraphs and dialogue.\n`;
    prompt += `Maintain consistency with established characters and plot.\n`;
    prompt += `Focus on showing rather than telling, with vivid descriptions and natural dialogue.\n`;

    // Add third-person past tense instructions (core feature - always enabled)
    prompt += `\n=== PERSPECTIVE ===\n`;
    prompt += `Write in third-person past tense perspective.\n`;
    prompt += `Use he/she/they pronouns and past tense verbs (said, walked, thought, etc.).\n`;
    prompt += `Do NOT use first-person (I, me, my, we) or present tense.\n`;
    prompt += `All narrative and dialogue tags should be in past tense.\n`;

    // Add asterisk filtering instruction (core feature - always enabled)
    prompt += `\nDo not use asterisks (*) for actions. Write everything as prose.\n`;

    return prompt;
  }

  /**
   * Build generation prompt based on type
   */
  buildGenerationPrompt(type, params) {
    const { storyContent, characterName, customInstruction, templateText } = params;

    let storyContext = "";
    let instruction = "";

    // Include current content if it exists (up to ~16,000 tokens = ~64,000 characters)
    if (storyContent && storyContent.trim()) {
      const maxChars = 64000; // Rough estimate: 4 chars per token, 16k tokens
      const contentToInclude =
        storyContent.length > maxChars
          ? "..." + storyContent.slice(-maxChars)
          : storyContent;

      storyContext = `Here is the current story so far:\n\n${contentToInclude}\n\n---\n\n`;
    }

    // Use template text if provided, otherwise use defaults
    if (templateText) {
      instruction = templateText;

      // Replace placeholders in template
      if (characterName) {
        instruction = instruction.replace(/\{\{charName\}\}/g, characterName);
      }
      if (customInstruction) {
        instruction = instruction.replace(/\{\{instruction\}\}/g, customInstruction);
      }
    } else {
      // Default templates (backwards compatibility)
      switch (type) {
        case "continue":
          instruction =
            "Continue the story naturally from where it left off. Write the next 2-3 paragraphs maximum, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters.";
          break;

        case "character":
          const charName = characterName || "the character";
          instruction = `Write the next part of the story from ${charName}'s perspective. Focus on their thoughts, actions, and dialogue. Write 2-3 paragraphs maximum, less if it makes sense stylistically or sets up a good response opportunity for other characters. (There is a chance that "${charName}'s" is multiple characters, at which point you may respond as any of them as is relevant to the story.)`;
          break;

        case "custom":
          instruction = customInstruction || "Continue the story.";
          break;

        default:
          instruction = "Continue the story.";
      }
    }

    return storyContext + instruction;
  }

  /**
   * Generate content without streaming
   */
  async generate(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) {
      throw new Error("API key not set");
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        stream: false,
        max_tokens: options.maxTokens || 4000,
        temperature: options.temperature !== undefined ? options.temperature : 1.5,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || `API request failed: ${response.statusText}`
      );
    }

    const data = await response.json();
    const choice = data.choices[0];

    return {
      content: choice.message.content || "",
      reasoning: choice.message.reasoning_content || "",
      usage: data.usage,
    };
  }

  /**
   * Generate content with streaming
   */
  async generateStreaming(systemPrompt, userPrompt, options = {}) {
    if (!this.apiKey) {
      throw new Error("API key not set");
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    const controller = new AbortController();

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        stream: true,
        max_tokens: options.maxTokens || 4000,
        temperature: options.temperature !== undefined ? options.temperature : 1.5,
      }),
      signal: options.signal || controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || `API request failed: ${response.statusText}`
      );
    }

    return {
      stream: this.parseStreamResponse(response.body),
      abort: () => controller.abort(),
      metadata: {
        userPrompt,
        systemPrompt
      }
    };
  }

  /**
   * Parse SSE stream response
   */
  async *parseStreamResponse(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");

        // Keep the last incomplete line in buffer
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed === "" || trimmed === "data: [DONE]") {
            continue;
          }

          if (trimmed.startsWith("data: ")) {
            try {
              const jsonStr = trimmed.slice(6); // Remove 'data: ' prefix
              const data = JSON.parse(jsonStr);

              if (data.choices && data.choices[0]) {
                const delta = data.choices[0].delta;

                yield {
                  reasoning: delta.reasoning_content || null,
                  content: delta.content || null,
                  finished: data.choices[0].finish_reason !== null,
                };
              }
            } catch (e) {
              console.warn("Failed to parse SSE line:", e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse DeepSeek-specific errors
   */
  parseError(error) {
    if (error.message?.includes('401') || error.message?.includes('Unauthorized')) {
      return {
        code: 'AUTH_ERROR',
        message: 'Invalid API key',
        original: error
      };
    }

    if (error.message?.includes('429') || error.message?.includes('rate limit')) {
      return {
        code: 'RATE_LIMIT',
        message: 'Rate limit exceeded. Please try again later.',
        original: error
      };
    }

    return super.parseError(error);
  }
}
