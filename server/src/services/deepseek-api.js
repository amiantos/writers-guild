/**
 * DeepSeek API Integration (Server-side)
 * Handles communication with DeepSeek's reasoning model
 */

import { MacroProcessor } from './macro-processor.js';

export class DeepSeekAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = "https://api.deepseek.com/v1";
    this.model = "deepseek-reasoner";
  }

  /**
   * Update the API key
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey;
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
   * Build system prompt from character card(s), persona, and lorebook entries
   */
  buildSystemPrompt(characterCard, persona, settings = {}, allCharacterCards = null, lorebookEntries = null) {
    let prompt =
      "You are a creative writing assistant helping to write a novel-style story.\n\n";

    // Initialize macro processor with context
    const macroProcessor = new MacroProcessor({
      userName: persona?.name || 'User',
      charName: characterCard?.data?.name || (allCharacterCards && allCharacterCards.length > 0 ? allCharacterCards[0].data?.name : 'Character')
    });

    // If we have multiple characters (for continue/custom), add all of them
    if (allCharacterCards && allCharacterCards.length > 0) {
      const filterAst = settings.filterAsterisks;

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

        if (char.scenario) {
          let processed = this.replacePlaceholders(char.scenario, card, persona);
          processed = macroProcessor.process(processed);
          prompt += `Scenario: ${this.filterAsterisks(processed, filterAst)}\n`;
        }
      });

      prompt += "\n";
    } else if (characterCard && characterCard.data) {
      // Single character (for character-based generation)
      const char = characterCard.data;
      const filterAst = settings.filterAsterisks;

      // Use custom system prompt if provided (with replacements and filtering)
      if (char.system_prompt) {
        let processed = this.replacePlaceholders(
          char.system_prompt,
          characterCard,
          persona
        );
        processed = macroProcessor.process(processed);
        prompt += this.filterAsterisks(processed, filterAst) + "\n\n";
      }

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
      if (char.mes_example) {
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

      // Note: post_history_instructions are intentionally ignored
    }

    // Add lorebook entries (after character profiles)
    if (lorebookEntries && lorebookEntries.length > 0) {
      const filterAst = settings.filterAsterisks;

      prompt += `\n=== WORLD INFORMATION ===\n\n`;

      lorebookEntries.forEach((entry, index) => {
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
      const filterAst = settings.filterAsterisks;

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

    // Add third-person past tense instructions
    if (settings.thirdPerson) {
      prompt += `\n=== PERSPECTIVE ===\n`;
      prompt += `Write in third-person past tense perspective.\n`;
      prompt += `Use he/she/they pronouns and past tense verbs (said, walked, thought, etc.).\n`;
      prompt += `Do NOT use first-person (I, me, my, we) or present tense.\n`;
      prompt += `All narrative and dialogue tags should be in past tense.\n`;
    }

    // Add asterisk filtering instruction
    if (settings.filterAsterisks) {
      prompt += `\nDo not use asterisks (*) for actions. Write everything as prose.\n`;
    }

    return prompt;
  }

  /**
   * Generate content with streaming
   * @param {string} userPrompt - The generation prompt
   * @param {Object} options - Generation options
   * @returns {Object} - Contains async iterator and abort controller
   */
  async generateStreaming(userPrompt, options = {}) {
    if (!this.apiKey) {
      throw new Error("API key not set");
    }

    const systemPrompt = this.buildSystemPrompt(
      options.characterCard,
      options.persona,
      options.settings,
      options.allCharacterCards,
      options.lorebookEntries
    );

    // No conversation history - document content is included in userPrompt
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
      signal: controller.signal,
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
      userPrompt,
      systemPrompt,
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
   * Generate content without streaming
   */
  async generate(userPrompt, options = {}) {
    if (!this.apiKey) {
      throw new Error("API key not set");
    }

    const systemPrompt = this.buildSystemPrompt(
      options.characterCard,
      options.persona,
      options.settings,
      options.allCharacterCards,
      options.lorebookEntries
    );

    // No conversation history - document content is included in userPrompt
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
      reasoning: choice.message.reasoning_content || "",
      content: choice.message.content || "",
      usage: data.usage,
    };
  }

  /**
   * Build a generation prompt based on type
   * Returns an object with full prompt and instruction-only version
   */
  buildGenerationPrompt(type, options = {}) {
    const { characterCard, currentContent, customPrompt, persona } = options;

    let storyContext = "";
    let instruction = "";

    // Include current content if it exists (up to ~16,000 tokens = ~64,000 characters)
    if (currentContent && currentContent.trim()) {
      const maxChars = 64000; // Rough estimate: 4 chars per token, 16k tokens
      const contentToInclude =
        currentContent.length > maxChars
          ? "..." + currentContent.slice(-maxChars)
          : currentContent;

      storyContext = `Here is the current story so far:\n\n${contentToInclude}\n\n---\n\n`;
    }

    // Add specific instruction based on type
    switch (type) {
      case "continue":
        instruction =
          "Continue the story naturally from where it left off. Write the next 2-3 paragraphs, maintaining the established tone and style.";
        break;

      case "character":
        const charName = characterCard?.data?.name || "the character";
        instruction = `Write the next part of the story from ${charName}'s perspective. Focus on their thoughts, actions, and dialogue. Write 2-3 paragraphs.`;
        break;

      case "custom":
        instruction = customPrompt || "Continue the story.";
        break;

      default:
        instruction = "Continue the story.";
    }

    return {
      fullPrompt: storyContext + instruction,
      instruction: instruction, // Just the instruction without the story context
    };
  }
}
