/**
 * DeepSeek API Integration
 * Handles communication with DeepSeek's reasoning model
 */

class DeepSeekAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://api.deepseek.com/v1';
    this.model = 'deepseek-reasoner';
    this.conversationHistory = [];
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
   * Build system prompt from character card and persona
   */
  buildSystemPrompt(characterCard, persona, settings = {}) {
    let prompt = 'You are a creative writing assistant helping to write a novel-style story.\n\n';

    // Add character information
    if (characterCard && characterCard.data) {
      const char = characterCard.data;
      const filterAst = settings.filterAsterisks;

      // Use custom system prompt if provided (with replacements and filtering)
      if (char.system_prompt) {
        const processed = this.replacePlaceholders(char.system_prompt, characterCard, persona);
        prompt += this.filterAsterisks(processed, filterAst) + '\n\n';
      }

      prompt += '=== CHARACTER PROFILE ===\n';
      prompt += `Name: ${char.name}\n`;

      if (char.description) {
        const processed = this.replacePlaceholders(char.description, characterCard, persona);
        prompt += `Description: ${this.filterAsterisks(processed, filterAst)}\n`;
      }

      if (char.personality) {
        const processed = this.replacePlaceholders(char.personality, characterCard, persona);
        prompt += `Personality: ${this.filterAsterisks(processed, filterAst)}\n`;
      }

      if (char.scenario) {
        const processed = this.replacePlaceholders(char.scenario, characterCard, persona);
        prompt += `\nCurrent Scenario: ${this.filterAsterisks(processed, filterAst)}\n`;
      }

      // Add writing style examples (with replacements and filtering)
      if (char.mes_example) {
        const processed = this.replacePlaceholders(char.mes_example, characterCard, persona);
        prompt += `\n=== DIALOGUE STYLE EXAMPLES ===\n${this.filterAsterisks(processed, filterAst)}\n`;
      }

      // Add post-history instructions (with replacements and filtering)
      if (char.post_history_instructions) {
        const processed = this.replacePlaceholders(char.post_history_instructions, characterCard, persona);
        prompt += `\n=== WRITING GUIDELINES ===\n${this.filterAsterisks(processed, filterAst)}\n`;
      }
    }

    // Add user persona
    if (persona && persona.name) {
      prompt += `\n=== USER CHARACTER (PERSONA) ===\n`;
      prompt += `Name: ${persona.name}\n`;

      if (persona.description) {
        prompt += `Description: ${persona.description}\n`;
      }

      if (persona.writingStyle) {
        prompt += `Writing Style: ${persona.writingStyle}\n`;
      }
    }

    prompt += `\n=== INSTRUCTIONS ===\n`;
    prompt += `Write in a narrative, novel-style format with proper paragraphs and dialogue.\n`;
    prompt += `Maintain consistency with established characters and plot.\n`;
    prompt += `Focus on showing rather than telling, with vivid descriptions and natural dialogue.\n`;

    // Add first-person perspective instructions
    if (settings.firstPerson && persona && persona.name) {
      prompt += `\n=== PERSPECTIVE ===\n`;
      prompt += `Write in first-person omniscient perspective where "I" is ${persona.name}.\n`;
      prompt += `${persona.name} is the narrator who observes and describes events.\n`;
      prompt += `The narrator can describe the thoughts and feelings of other characters.\n`;
      prompt += `The narrator should NOT take actions or speak dialogue unless explicitly part of the scene.\n`;
      prompt += `DO NOT write actions or dialogue for ${persona.name} unless the user specifically requests it.\n`;
      prompt += `Write what ${persona.name} observes, not what ${persona.name} does.\n`;
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
      throw new Error('API key not set');
    }

    const systemPrompt = this.buildSystemPrompt(options.characterCard, options.persona, options.settings);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory,
      { role: 'user', content: userPrompt }
    ];

    const controller = new AbortController();

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        stream: true,
        max_tokens: options.maxTokens || 4000
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API request failed: ${response.statusText}`);
    }

    return {
      stream: this.parseStreamResponse(response.body),
      abort: () => controller.abort(),
      userPrompt,
      systemPrompt
    };
  }

  /**
   * Parse SSE stream response
   */
  async *parseStreamResponse(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed === '' || trimmed === 'data: [DONE]') {
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const jsonStr = trimmed.slice(6); // Remove 'data: ' prefix
              const data = JSON.parse(jsonStr);

              if (data.choices && data.choices[0]) {
                const delta = data.choices[0].delta;

                yield {
                  reasoning: delta.reasoning_content || null,
                  content: delta.content || null,
                  finished: data.choices[0].finish_reason !== null
                };
              }
            } catch (e) {
              console.warn('Failed to parse SSE line:', e);
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
      throw new Error('API key not set');
    }

    const systemPrompt = this.buildSystemPrompt(options.characterCard, options.persona);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory,
      { role: 'user', content: userPrompt }
    ];

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages,
        stream: false,
        max_tokens: options.maxTokens || 4000
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    const choice = data.choices[0];

    return {
      reasoning: choice.message.reasoning_content || '',
      content: choice.message.content || '',
      usage: data.usage
    };
  }

  /**
   * Build a generation prompt based on type
   * Returns an object with full prompt and instruction-only version
   */
  buildGenerationPrompt(type, options = {}) {
    const { characterCard, currentContent, customPrompt, persona } = options;

    let storyContext = '';
    let instruction = '';

    // Include current content if it exists (up to ~16,000 tokens = ~64,000 characters)
    if (currentContent && currentContent.trim()) {
      const maxChars = 64000; // Rough estimate: 4 chars per token, 16k tokens
      const contentToInclude = currentContent.length > maxChars
        ? '...' + currentContent.slice(-maxChars)
        : currentContent;

      storyContext = `Here is the current story so far:\n\n${contentToInclude}\n\n---\n\n`;
    }

    // Add specific instruction based on type
    switch (type) {
      case 'continue':
        instruction = 'Continue the story naturally from where it left off. Write the next 2-3 paragraphs, maintaining the established tone and style.';
        break;

      case 'character':
        const charName = characterCard?.data?.name || 'the character';
        instruction = `Write the next part of the story from ${charName}'s perspective. Focus on their thoughts, actions, and dialogue. Write 2-3 paragraphs.`;
        break;

      case 'custom':
        instruction = customPrompt || 'Continue the story.';
        break;

      default:
        instruction = 'Continue the story.';
    }

    return {
      fullPrompt: storyContext + instruction,
      instruction: instruction  // Just the instruction without the story context
    };
  }

  /**
   * Add to conversation history (excludes reasoning_content per API docs)
   */
  addToHistory(userPrompt, assistantContent) {
    this.conversationHistory.push(
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: assistantContent }
    );

    // Keep history manageable (last 20 messages = 10 exchanges)
    if (this.conversationHistory.length > 20) {
      this.conversationHistory = this.conversationHistory.slice(-20);
    }
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Get conversation history
   */
  getHistory() {
    return [...this.conversationHistory];
  }

  /**
   * Set conversation history (for loading saved sessions)
   */
  setHistory(history) {
    this.conversationHistory = history || [];
  }
}

// Export for use in other modules
window.DeepSeekAPI = DeepSeekAPI;
