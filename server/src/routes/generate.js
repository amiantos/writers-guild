/**
 * Generation API Routes
 * Handles AI generation requests (proxy to DeepSeek)
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { StorageService } from '../services/storage.js';
import { DeepSeekAPI } from '../services/deepseek-api.js';
import { LorebookActivator } from '../services/lorebook-activator.js';

const router = express.Router();

// Initialize storage service
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new StorageService(req.app.locals.dataRoot);
  }
  next();
});

// Generate content (SSE streaming)
router.post('/', asyncHandler(async (req, res) => {
  const { storyId, type, customPrompt, characterId } = req.body;

  if (!storyId) {
    throw new AppError('Story ID is required', 400);
  }

  if (!type || !['continue', 'character', 'custom'].includes(type)) {
    throw new AppError('Invalid generation type', 400);
  }

  if (type === 'custom' && !customPrompt) {
    throw new AppError('Custom prompt is required for custom generation type', 400);
  }

  // Load settings
  const settings = await storage.getSettings();
  if (!settings || !settings.apiKey) {
    throw new AppError('DeepSeek API key not configured', 400);
  }

  // Load story
  const story = await storage.getStory(storyId);

  // Load persona (character only)
  let persona = null;
  if (story.personaCharacterId) {
    // Use a character as persona
    try {
      const cardData = await storage.getCharacter(story.personaCharacterId);

      // Convert character card to persona format
      persona = {
        name: cardData.data?.name || 'User',
        description: cardData.data?.description || '',
        writingStyle: cardData.data?.personality || ''
      };
    } catch (error) {
      console.error('Failed to load persona character:', error);
      persona = null;
    }
  }

  // Load all characters for this story
  const characterCards = [];
  for (const charId of story.characterIds || []) {
    try {
      const cardData = await storage.getCharacter(charId);
      characterCards.push({ id: charId, data: cardData });
    } catch (error) {
      console.error(`Failed to load character ${charId}:`, error);
    }
  }

  // Select character(s) for generation
  let characterCard = null;
  let allCharacterCards = null;

  if (type === 'character') {
    // Character-based generation: use specified character or first
    if (characterId) {
      const selectedChar = characterCards.find(c => c.id === characterId);
      characterCard = selectedChar ? selectedChar.data : (characterCards.length > 0 ? characterCards[0].data : null);
    } else {
      characterCard = characterCards.length > 0 ? characterCards[0].data : null;
    }
  } else {
    // Continue/Custom: include ALL characters
    allCharacterCards = characterCards.map(c => c.data);
    // Still pass first as main for backward compatibility
    characterCard = characterCards.length > 0 ? characterCards[0].data : null;
  }

  // Load and activate lorebooks for this story
  let activatedLorebooks = [];
  if (story.lorebookIds && story.lorebookIds.length > 0) {
    try {
      // Load all lorebooks for this story
      const lorebooks = [];
      for (const lorebookId of story.lorebookIds) {
        try {
          const lorebookData = await storage.getLorebook(lorebookId);
          lorebooks.push(lorebookData);
        } catch (error) {
          console.error(`Failed to load lorebook ${lorebookId}:`, error);
        }
      }

      // Activate lorebook entries based on story content
      if (lorebooks.length > 0) {
        const activator = new LorebookActivator(settings);
        activatedLorebooks = activator.activate(lorebooks, story.content || '');

        console.log(`Activated ${activatedLorebooks.length} lorebook entries from ${lorebooks.length} lorebook(s)`);
      }
    } catch (error) {
      console.error('Failed to activate lorebooks:', error);
      // Continue without lorebooks rather than failing the request
    }
  }

  // Initialize DeepSeek API
  const deepseek = new DeepSeekAPI(settings.apiKey);

  // Build generation prompt
  const { fullPrompt } = deepseek.buildGenerationPrompt(type, {
    characterCard,
    allCharacterCards, // Pass all characters for continue/custom
    currentContent: story.content,
    customPrompt,
    persona,
  });

  // Set up SSE with proper headers to prevent buffering
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Disable compression for this response
  res.set('Content-Encoding', 'none');

  // Flush headers immediately
  res.flushHeaders();

  try {
    // Build system prompt for debugging
    const systemPrompt = deepseek.buildSystemPrompt(
      characterCard,
      persona,
      settings,
      allCharacterCards,
      activatedLorebooks
    );

    // Send prompts as first event for debugging
    res.write(`data: ${JSON.stringify({
      prompts: {
        system: systemPrompt,
        user: fullPrompt
      }
    })}\n\n`);

    if (res.flush) {
      res.flush();
    }

    // Start generation with streaming
    const { stream } = await deepseek.generateStreaming(fullPrompt, {
      characterCard,
      allCharacterCards,
      persona,
      lorebookEntries: activatedLorebooks,
      maxTokens: settings.maxTokens || 4000,
      temperature: settings.temperature !== undefined ? settings.temperature : 1.5,
      settings,
    });

    // Stream chunks to client
    for await (const chunk of stream) {
      // Apply asterisk filtering server-side if enabled
      let processedContent = chunk.content || null;
      if (processedContent && settings.filterAsterisks) {
        processedContent = processedContent.replace(/\*/g, '');
      }

      const data = {
        reasoning: chunk.reasoning || null,
        content: processedContent,
        finished: chunk.finished || false,
      };

      const sseData = `data: ${JSON.stringify(data)}\n\n`;
      res.write(sseData);

      // Force flush after each write
      if (res.flush) {
        res.flush();
      }
    }

    // Send done message
    res.write('data: [DONE]\n\n');

    if (res.flush) {
      res.flush();
    }

    res.end();
  } catch (error) {
    console.error('Generation error:', error);

    // Send error as SSE
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
}));

export default router;
