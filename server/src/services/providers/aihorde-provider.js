/**
 * AI Horde Provider Implementation
 * Extends base LLMProvider with AI Horde-specific queue functionality
 * API Docs: https://aihorde.net/api/
 */

import { LLMProvider } from './base-provider.js';
import { MacroProcessor } from '../macro-processor.js';

export class AIHordeProvider extends LLMProvider {
  constructor(config) {
    // AI Horde-specific defaults
    const hordeConfig = {
      ...config,
      baseURL: config.baseURL || "https://aihorde.net/api/v2",
      models: config.models || ["Mythomax 13B", "Noromaid 20B"],
      workerBlacklist: config.workerBlacklist || [],
      trustedWorkers: config.trustedWorkers || false,
      slowWorkers: config.slowWorkers !== false // Default true
    };

    super(hordeConfig);

    this.pollingInterval = 2000; // Poll every 2 seconds
  }

  /**
   * Get AI Horde provider capabilities
   */
  getCapabilities() {
    return {
      streaming: false,  // AI Horde does not support streaming
      reasoning: false,  // AI Horde does not provide reasoning
      visionAPI: false,
      maxContextWindow: 8192, // Varies by model, but typically around 8k
      requiresPolling: true  // Special flag for queue-based providers
    };
  }

  /**
   * Validate AI Horde configuration
   */
  validateConfig() {
    // AI Horde allows anonymous usage with key "0000000000"
    if (!this.apiKey || this.apiKey.trim() === '') {
      return {
        valid: false,
        error: 'API key is required (use "0000000000" for anonymous)'
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
   * Build system prompt from context (similar to DeepSeek but adapted for Horde)
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
      const filterAst = true;

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

        if (char.scenario && allCharacterCards.length === 1) {
          let processed = this.replacePlaceholders(char.scenario, card, persona);
          processed = macroProcessor.process(processed);
          prompt += `Scenario: ${this.filterAsterisks(processed, filterAst)}\n`;
        }
      });

      prompt += "\n";
    } else if (characterCard && characterCard.data) {
      // Single character
      const char = characterCard.data;
      const filterAst = true;

      prompt += "=== CHARACTER PROFILE ===\n";
      prompt += `Name: ${char.name}\n`;

      if (char.description) {
        let processed = this.replacePlaceholders(char.description, characterCard, persona);
        processed = macroProcessor.process(processed);
        prompt += `Description: ${this.filterAsterisks(processed, filterAst)}\n`;
      }

      if (char.personality) {
        let processed = this.replacePlaceholders(char.personality, characterCard, persona);
        processed = macroProcessor.process(processed);
        prompt += `Personality: ${this.filterAsterisks(processed, filterAst)}\n`;
      }

      if (char.scenario) {
        let processed = this.replacePlaceholders(char.scenario, characterCard, persona);
        processed = macroProcessor.process(processed);
        prompt += `\nCurrent Scenario: ${this.filterAsterisks(processed, filterAst)}\n`;
      }

      if (char.mes_example && settings.includeDialogueExamples !== false) {
        let processed = this.replacePlaceholders(char.mes_example, characterCard, persona);
        processed = macroProcessor.process(processed);
        prompt += `\n=== DIALOGUE STYLE EXAMPLES ===\n${this.filterAsterisks(processed, filterAst)}\n`;
      }
    }

    // Add lorebook entries
    if (activatedLorebooks && activatedLorebooks.length > 0) {
      const filterAst = true;
      prompt += `\n=== WORLD INFORMATION ===\n\n`;

      activatedLorebooks.forEach((entry, index) => {
        if (index > 0) prompt += '\n\n';
        let content = macroProcessor.process(entry.content);
        content = this.filterAsterisks(content, filterAst);
        prompt += content;
      });

      prompt += '\n';
    }

    // Add user persona
    if (persona && persona.name) {
      const filterAst = true;
      prompt += `\n=== USER CHARACTER (PERSONA) ===\n`;
      prompt += `Name: ${persona.name}\n`;

      if (persona.description) {
        let processed = this.replacePlaceholders(persona.description, characterCard, persona);
        processed = macroProcessor.process(processed);
        prompt += `Description: ${this.filterAsterisks(processed, filterAst)}\n`;
      }

      if (persona.writingStyle) {
        let processed = this.replacePlaceholders(persona.writingStyle, characterCard, persona);
        processed = macroProcessor.process(processed);
        prompt += `Writing Style: ${this.filterAsterisks(processed, filterAst)}\n`;
      }
    }

    prompt += `\n=== INSTRUCTIONS ===\n`;
    prompt += `Write in a narrative, novel-style format with proper paragraphs and dialogue.\n`;
    prompt += `Maintain consistency with established characters and plot.\n`;
    prompt += `Focus on showing rather than telling, with vivid descriptions and natural dialogue.\n`;
    prompt += `Write in third-person past tense perspective.\n`;
    prompt += `Do not use asterisks (*) for actions. Write everything as prose.\n`;

    return prompt;
  }

  /**
   * Build generation prompt based on type
   */
  buildGenerationPrompt(type, params) {
    const { storyContent, characterName, customInstruction, templateText } = params;

    let storyContext = "";
    let instruction = "";

    // AI Horde has smaller context windows, limit to ~32k chars (~8k tokens)
    if (storyContent && storyContent.trim()) {
      const maxChars = 32000;
      const contentToInclude =
        storyContent.length > maxChars
          ? "..." + storyContent.slice(-maxChars)
          : storyContent;

      storyContext = `Here is the current story so far:\n\n${contentToInclude}\n\n---\n\n`;
    }

    // Use template text if provided, otherwise use defaults
    if (templateText) {
      instruction = templateText;
      if (characterName) {
        instruction = instruction.replace(/\{\{charName\}\}/g, characterName);
      }
      if (customInstruction) {
        instruction = instruction.replace(/\{\{instruction\}\}/g, customInstruction);
      }
    } else {
      // Default templates
      switch (type) {
        case "continue":
          instruction =
            "Continue the story naturally from where it left off. Write the next 2-3 paragraphs maximum.";
          break;

        case "character":
          const charName = characterName || "the character";
          instruction = `Write the next part of the story from ${charName}'s perspective. Write 2-3 paragraphs maximum.`;
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
   * Submit generation request to AI Horde (non-streaming)
   * Returns request ID for polling
   */
  async submitRequest(systemPrompt, userPrompt, options = {}) {
    // Combine system and user prompts (AI Horde uses single prompt)
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const payload = {
      prompt: fullPrompt,
      params: {
        n: 1,
        max_length: options.maxTokens || 512,  // AI Horde typically allows less
        max_context_length: 8192,
        temperature: options.temperature !== undefined ? options.temperature : 1.0,
        rep_pen: 1.1,  // Repetition penalty
        rep_pen_range: 320,
        sampler_order: [6, 0, 1, 3, 4, 2, 5],
        frmtadsnsp: true, // Format for adventure/story
        frmtrmblln: false,
        frmtrmspch: false,
        frmttriminc: false,
        quiet: false
      },
      models: this.config.models || ["Mythomax 13B"],
      workers: [],
      worker_blacklist: this.config.workerBlacklist || [],
      trusted_workers: this.config.trustedWorkers || false,
      slow_workers: this.config.slowWorkers !== false,
      dry_run: false
    };

    const response = await fetch(`${this.baseURL}/generate/text/async`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": this.apiKey,
      },
      body: JSON.stringify(payload),
      signal: options.signal
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `AI Horde API request failed: ${response.statusText}`
      );
    }

    const data = await response.json();
    return data.id; // Return request ID for polling
  }

  /**
   * Check status of generation request
   */
  async checkStatus(requestId) {
    const response = await fetch(`${this.baseURL}/generate/text/status/${requestId}`, {
      method: "GET",
      headers: {
        "apikey": this.apiKey,
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `AI Horde status check failed: ${response.statusText}`
      );
    }

    const data = await response.json();
    return {
      finished: data.done || false,
      faulted: data.faulted || false,
      queuePosition: data.queue_position || 0,
      waitTime: data.wait_time || 0,
      kudos: data.kudos || 0,
      generations: data.generations || []
    };
  }

  /**
   * Generate text (non-streaming, with polling)
   */
  async generate(systemPrompt, userPrompt, options = {}) {
    // Submit request
    const requestId = await this.submitRequest(systemPrompt, userPrompt, options);

    // Poll for completion
    const timeout = options.timeout || 300000; // 5 minute default timeout
    const startTime = Date.now();

    while (true) {
      // Check timeout
      if (Date.now() - startTime > timeout) {
        throw new Error('AI Horde generation timed out');
      }

      // Check status
      const status = await this.checkStatus(requestId);

      if (status.faulted) {
        throw new Error('AI Horde generation failed');
      }

      if (status.finished && status.generations.length > 0) {
        // Extract result
        const generation = status.generations[0];
        return {
          content: generation.text || "",
          reasoning: null, // AI Horde doesn't provide reasoning
          usage: {
            totalTokens: generation.kudos || 0
          },
          metadata: {
            requestId,
            model: generation.model,
            worker: generation.worker_name,
            workerI: generation.worker_id
          }
        };
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, this.pollingInterval));
    }
  }

  /**
   * AI Horde doesn't support streaming, but we provide this method for compatibility
   * It will submit the request and poll, yielding status updates
   */
  async *generateStreamingWithStatus(systemPrompt, userPrompt, options = {}) {
    // Submit request
    const requestId = await this.submitRequest(systemPrompt, userPrompt, options);

    // Poll for completion and yield status updates
    const timeout = options.timeout || 300000;
    const startTime = Date.now();

    while (true) {
      // Check timeout
      if (Date.now() - startTime > timeout) {
        throw new Error('AI Horde generation timed out');
      }

      // Check status
      const status = await this.checkStatus(requestId);

      // Yield status update
      yield {
        type: 'status',
        queuePosition: status.queuePosition,
        waitTime: status.waitTime,
        finished: status.finished,
        faulted: status.faulted
      };

      if (status.faulted) {
        throw new Error('AI Horde generation failed');
      }

      if (status.finished && status.generations.length > 0) {
        // Yield final result
        const generation = status.generations[0];
        yield {
          type: 'complete',
          content: generation.text || "",
          metadata: {
            requestId,
            model: generation.model,
            worker: generation.worker_name
          }
        };
        return;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, this.pollingInterval));
    }
  }

  /**
   * Required by base class but not supported by AI Horde
   */
  async generateStreaming(systemPrompt, userPrompt, options = {}) {
    throw new Error('AI Horde does not support streaming. Use generate() instead or generateStreamingWithStatus() for status updates.');
  }

  /**
   * Parse AI Horde-specific errors
   */
  parseError(error) {
    if (error.message?.includes('401') || error.message?.includes('Invalid API Key')) {
      return {
        code: 'AUTH_ERROR',
        message: 'Invalid API key',
        original: error
      };
    }

    if (error.message?.includes('timeout')) {
      return {
        code: 'TIMEOUT',
        message: 'Generation timed out. Try again or use faster workers.',
        original: error
      };
    }

    if (error.message?.includes('queue')) {
      return {
        code: 'QUEUE_ERROR',
        message: 'Queue error. Please try again.',
        original: error
      };
    }

    return super.parseError(error);
  }
}
