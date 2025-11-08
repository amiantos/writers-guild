/**
 * Generation API Routes
 * Handles AI generation requests (proxy to DeepSeek)
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { StorageService } from '../services/storage.js';
import { CharacterParser } from '../services/character-parser.js';
import { DeepSeekAPI } from '../services/deepseek-api.js';

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
  const { storyId, type, customPrompt } = req.body;

  console.log('[Generate] Request received:', { storyId, type, hasCustomPrompt: !!customPrompt });

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
  console.log('[Generate] Loading settings...');
  const settings = await storage.getSettings();
  if (!settings || !settings.apiKey) {
    console.error('[Generate] No API key found');
    throw new AppError('DeepSeek API key not configured', 400);
  }
  console.log('[Generate] API key loaded');

  // Load story
  const story = await storage.getStory(storyId);

  // Load persona
  const persona = await storage.getPersona();

  // Load and parse all characters for this story
  const characterCards = [];
  for (const charId of story.characterIds || []) {
    try {
      const pngBuffer = await storage.getCharacter(storyId, charId);
      const cardData = await CharacterParser.parseCard(pngBuffer);
      characterCards.push(cardData);
    } catch (error) {
      console.error(`Failed to load character ${charId}:`, error);
    }
  }

  // For multi-character stories, use the first character for now
  // TODO: Could enhance this to let user select which character for character-based generation
  const characterCard = characterCards.length > 0 ? characterCards[0] : null;

  // Initialize DeepSeek API
  const deepseek = new DeepSeekAPI(settings.apiKey);

  // Build generation prompt
  const { fullPrompt } = deepseek.buildGenerationPrompt(type, {
    characterCard,
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

  console.log('[Generate] SSE headers sent, starting generation...');

  try {
    // Start generation with streaming
    const { stream } = await deepseek.generateStreaming(fullPrompt, {
      characterCard,
      persona,
      maxTokens: settings.maxTokens || 4000,
      settings,
    });

    console.log('[Generate] Starting to consume DeepSeek stream...');
    let chunkCount = 0;

    // Stream chunks to client
    for await (const chunk of stream) {
      chunkCount++;

      const data = {
        reasoning: chunk.reasoning || null,
        content: chunk.content || null,
        finished: chunk.finished || false,
      };

      const sseData = `data: ${JSON.stringify(data)}\n\n`;
      res.write(sseData);

      // Force flush after each write
      if (res.flush) {
        res.flush();
      }

      if (chunkCount % 10 === 0) {
        console.log(`[Generate] Sent ${chunkCount} chunks...`);
      }
    }

    console.log(`[Generate] Generation complete. Total chunks: ${chunkCount}`);

    // Send done message
    res.write('data: [DONE]\n\n');

    if (res.flush) {
      res.flush();
    }

    res.end();
  } catch (error) {
    console.error('[Generate] Generation error:', error);

    // Send error as SSE
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
}));

export default router;
