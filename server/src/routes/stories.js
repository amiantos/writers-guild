/**
 * Stories API Routes
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { StorageService } from '../services/storage.js';
import { DeepSeekAPI } from '../services/deepseek-api.js';
import { MacroProcessor } from '../services/macro-processor.js';
import { LorebookActivator } from '../services/lorebook-activator.js';

const router = express.Router();

// Initialize storage service (will be set in server.js)
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new StorageService(req.app.locals.dataRoot);
  }
  next();
});

// List all stories
router.get('/', asyncHandler(async (req, res) => {
  const stories = await storage.listStories();
  res.json({ stories });
}));

// Create new story
router.post('/', asyncHandler(async (req, res) => {
  const { title, description } = req.body;

  if (!title || !title.trim()) {
    throw new AppError('Title is required', 400);
  }

  const story = await storage.createStory(title.trim(), description?.trim() || '');
  res.status(201).json({ story });
}));

// Get story by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const story = await storage.getStory(req.params.id);
  res.json({ story });
}));

// Update story metadata
router.put('/:id', asyncHandler(async (req, res) => {
  const { title, description } = req.body;
  const updates = {};

  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description.trim();

  if (Object.keys(updates).length === 0) {
    throw new AppError('No updates provided', 400);
  }

  const story = await storage.updateStoryMetadata(req.params.id, updates);
  res.json({ story });
}));

// Update story content
router.put('/:id/content', asyncHandler(async (req, res) => {
  const { content } = req.body;

  if (content === undefined) {
    throw new AppError('Content is required', 400);
  }

  const result = await storage.updateStoryContent(req.params.id, content);
  res.json(result);
}));

// Delete story
router.delete('/:id', asyncHandler(async (req, res) => {
  await storage.deleteStory(req.params.id);
  res.json({ success: true });
}));

// ==================== Story-Character Associations ====================

// Get characters for this story
router.get('/:id/characters', asyncHandler(async (req, res) => {
  const characters = await storage.listStoryCharacters(req.params.id);

  // Load character data from JSON files
  const charactersWithData = await Promise.all(
    characters.map(async (char) => {
      try {
        const cardData = await storage.getCharacter(char.id);
        const hasImage = await storage.hasCharacterImage(char.id);

        return {
          id: char.id,
          name: cardData.data?.name || 'Unknown',
          description: cardData.data?.description || '',
          imageUrl: hasImage ? `/api/characters/${char.id}/image` : null,
        };
      } catch (error) {
        console.error(`Failed to load character ${char.id}:`, error);
        return {
          id: char.id,
          name: 'Unknown',
          description: 'Failed to load',
          imageUrl: null,
        };
      }
    })
  );

  res.json({ characters: charactersWithData });
}));

// Add existing character to story
router.post('/:id/characters', asyncHandler(async (req, res) => {
  const { characterId } = req.body;

  if (!characterId) {
    throw new AppError('Character ID is required', 400);
  }

  await storage.addCharacterToStory(req.params.id, characterId);

  // Load story for persona context
  const story = await storage.getStory(req.params.id);

  // Load persona if set
  let persona = null;
  if (story.personaCharacterId) {
    try {
      const personaCard = await storage.getCharacter(story.personaCharacterId);
      persona = {
        name: personaCard.data?.name || 'User',
        description: personaCard.data?.description || ''
      };
    } catch (error) {
      console.error('Failed to load persona:', error);
    }
  }

  // Load character card and process first message
  let processedFirstMessage = null;
  try {
    const characterCard = await storage.getCharacter(characterId);

    if (characterCard.data?.first_mes) {
      const settings = await storage.getSettings();
      const deepseek = new DeepSeekAPI(settings.apiKey || 'dummy');
      const macroProcessor = new MacroProcessor({
        userName: persona?.name || 'User',
        charName: characterCard.data?.name || 'Character'
      });

      let processed = characterCard.data.first_mes;
      processed = deepseek.replacePlaceholders(processed, characterCard, persona);
      processed = macroProcessor.process(processed);
      processed = deepseek.filterAsterisks(processed, settings.filterAsterisks);

      processedFirstMessage = processed;
    }
  } catch (error) {
    console.error('Failed to process first message:', error);
  }

  res.json({
    success: true,
    processedFirstMessage
  });
}));

// Remove character from story (doesn't delete character)
router.delete('/:id/characters/:characterId', asyncHandler(async (req, res) => {
  const { id: storyId, characterId } = req.params;
  await storage.removeCharacterFromStory(storyId, characterId);
  res.json({ success: true });
}));

// Get processed greetings for a character in story context
router.get('/:id/characters/:characterId/greetings', asyncHandler(async (req, res) => {
  const { id: storyId, characterId } = req.params;

  // Load story for persona context
  const story = await storage.getStory(storyId);

  // Load persona if set
  let persona = null;
  if (story.personaCharacterId) {
    try {
      const personaCard = await storage.getCharacter(story.personaCharacterId);
      persona = {
        name: personaCard.data?.name || 'User',
        description: personaCard.data?.description || ''
      };
    } catch (error) {
      console.error('Failed to load persona:', error);
    }
  }

  // Load character card
  const characterCard = await storage.getCharacter(characterId);

  // Load settings for filtering
  const settings = await storage.getSettings();

  // Initialize processors (API key not needed for text processing)
  const deepseek = new DeepSeekAPI(settings.apiKey || 'dummy');
  const macroProcessor = new MacroProcessor({
    userName: persona?.name || 'User',
    charName: characterCard.data?.name || 'Character'
  });

  // Process all greetings
  const greetings = [];

  // Add first_mes as first greeting
  if (characterCard.data?.first_mes) {
    let processed = characterCard.data.first_mes;
    processed = deepseek.replacePlaceholders(processed, characterCard, persona);
    processed = macroProcessor.process(processed);
    processed = deepseek.filterAsterisks(processed, settings.filterAsterisks);

    greetings.push({
      index: 0,
      label: 'First Message',
      content: processed,
      characterName: characterCard.data.name
    });
  }

  // Add alternate greetings
  if (characterCard.data?.alternate_greetings && Array.isArray(characterCard.data.alternate_greetings)) {
    characterCard.data.alternate_greetings.forEach((greeting, idx) => {
      let processed = greeting;
      processed = deepseek.replacePlaceholders(processed, characterCard, persona);
      processed = macroProcessor.process(processed);
      processed = deepseek.filterAsterisks(processed, settings.filterAsterisks);

      greetings.push({
        index: idx + 1,
        label: `Alternate Greeting ${idx + 1}`,
        content: processed,
        characterName: characterCard.data.name
      });
    });
  }

  res.json({ greetings });
}));

// Set story persona (use a character as persona)
router.put('/:id/persona', asyncHandler(async (req, res) => {
  const { characterId } = req.body; // Can be null to unset

  await storage.setStoryPersona(req.params.id, characterId);
  res.json({ success: true });
}));

// ==================== Story-Lorebook Associations ====================

// Get lorebooks for this story
router.get('/:id/lorebooks', asyncHandler(async (req, res) => {
  const lorebooks = await storage.listStoryLorebooks(req.params.id);
  res.json({ lorebooks });
}));

// Add existing lorebook to story
router.post('/:id/lorebooks', asyncHandler(async (req, res) => {
  const { lorebookId } = req.body;

  if (!lorebookId) {
    throw new AppError('Lorebook ID is required', 400);
  }

  await storage.addLorebookToStory(req.params.id, lorebookId);
  res.json({ success: true });
}));

// Remove lorebook from story (doesn't delete lorebook)
router.delete('/:id/lorebooks/:lorebookId', asyncHandler(async (req, res) => {
  const { id: storyId, lorebookId } = req.params;
  await storage.removeLorebookFromStory(storyId, lorebookId);
  res.json({ success: true });
}));

// ==================== Generation Endpoints ====================

/**
 * Helper function to load all context needed for generation
 */
async function loadGenerationContext(storyId) {
  // Load settings
  const settings = await storage.getSettings();
  if (!settings || !settings.apiKey) {
    throw new AppError('DeepSeek API key not configured', 400);
  }

  // Load story
  const story = await storage.getStory(storyId);

  // Load persona
  let persona = null;
  if (story.personaCharacterId) {
    try {
      const cardData = await storage.getCharacter(story.personaCharacterId);
      persona = {
        name: cardData.data?.name || 'User',
        description: cardData.data?.description || '',
        writingStyle: cardData.data?.personality || ''
      };
    } catch (error) {
      console.error('Failed to load persona character:', error);
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

  // Load and activate lorebooks
  let activatedLorebooks = [];
  if (story.lorebookIds && story.lorebookIds.length > 0) {
    try {
      const lorebooks = [];
      for (const lorebookId of story.lorebookIds) {
        try {
          const lorebookData = await storage.getLorebook(lorebookId);
          lorebooks.push(lorebookData);
        } catch (error) {
          console.error(`Failed to load lorebook ${lorebookId}:`, error);
        }
      }

      if (lorebooks.length > 0) {
        const activator = new LorebookActivator(settings);
        activatedLorebooks = activator.activate(lorebooks, story.content || '');
        console.log(`Activated ${activatedLorebooks.length} lorebook entries from ${lorebooks.length} lorebook(s)`);
      }
    } catch (error) {
      console.error('Failed to activate lorebooks:', error);
    }
  }

  return {
    settings,
    story,
    persona,
    characterCards,
    activatedLorebooks
  };
}

/**
 * Helper function to setup SSE streaming
 */
function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.set('Content-Encoding', 'none');
  res.flushHeaders();
}

/**
 * Helper function to stream generation
 */
async function streamGeneration(res, deepseek, prompt, options, settings) {
  // Send prompts for debugging
  const systemPrompt = deepseek.buildSystemPrompt(
    options.characterCard,
    options.persona,
    settings,
    options.allCharacterCards,
    options.lorebookEntries
  );

  res.write(`data: ${JSON.stringify({
    prompts: {
      system: systemPrompt,
      user: prompt
    }
  })}\n\n`);

  if (res.flush) res.flush();

  // Start generation
  const { stream } = await deepseek.generateStreaming(prompt, options);

  // Stream chunks
  for await (const chunk of stream) {
    // Apply asterisk filtering server-side
    let processedContent = chunk.content || null;
    if (processedContent && settings.filterAsterisks) {
      processedContent = processedContent.replace(/\*/g, '');
    }

    const data = {
      reasoning: chunk.reasoning || null,
      content: processedContent,
      finished: chunk.finished || false,
    };

    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
  }

  // Send done
  res.write('data: [DONE]\n\n');
  if (res.flush) res.flush();
  res.end();
}

// Continue story
router.post('/:id/continue', asyncHandler(async (req, res) => {
  const { id: storyId } = req.params;
  const { characterId } = req.query; // Optional: generate for specific character

  const context = await loadGenerationContext(storyId);
  const { settings, story, persona, characterCards, activatedLorebooks } = context;

  const deepseek = new DeepSeekAPI(settings.apiKey);

  // Determine character usage
  let characterCard = null;
  let allCharacterCards = null;

  if (characterId) {
    // Character-specific generation
    const selectedChar = characterCards.find(c => c.id === characterId);
    characterCard = selectedChar ? selectedChar.data : (characterCards.length > 0 ? characterCards[0].data : null);
  } else {
    // Story continuation - include all characters
    allCharacterCards = characterCards.map(c => c.data);
    characterCard = characterCards.length > 0 ? characterCards[0].data : null;
  }

  // Build prompt for continuation
  const { fullPrompt } = deepseek.buildGenerationPrompt(characterId ? 'character' : 'continue', {
    characterCard,
    allCharacterCards,
    currentContent: story.content,
    persona,
  });

  setupSSE(res);

  try {
    await streamGeneration(res, deepseek, fullPrompt, {
      characterCard,
      allCharacterCards,
      persona,
      lorebookEntries: activatedLorebooks,
      maxTokens: settings.maxTokens || 4000,
      temperature: settings.temperature !== undefined ? settings.temperature : 1.5,
      settings,
    }, settings);
  } catch (error) {
    console.error('Generation error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
}));

// Continue with instruction
router.post('/:id/continue-with-instruction', asyncHandler(async (req, res) => {
  const { id: storyId } = req.params;
  const { instruction } = req.body;

  if (!instruction || !instruction.trim()) {
    throw new AppError('Instruction is required', 400);
  }

  const context = await loadGenerationContext(storyId);
  const { settings, story, persona, characterCards, activatedLorebooks } = context;

  const deepseek = new DeepSeekAPI(settings.apiKey);

  // Include all characters
  const allCharacterCards = characterCards.map(c => c.data);
  const characterCard = characterCards.length > 0 ? characterCards[0].data : null;

  // Build prompt with custom instruction
  const { fullPrompt } = deepseek.buildGenerationPrompt('custom', {
    characterCard,
    allCharacterCards,
    currentContent: story.content,
    customPrompt: instruction.trim(),
    persona,
  });

  setupSSE(res);

  try {
    await streamGeneration(res, deepseek, fullPrompt, {
      characterCard,
      allCharacterCards,
      persona,
      lorebookEntries: activatedLorebooks,
      maxTokens: settings.maxTokens || 4000,
      temperature: settings.temperature !== undefined ? settings.temperature : 1.5,
      settings,
    }, settings);
  } catch (error) {
    console.error('Generation error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
}));

// Rewrite to third person
router.post('/:id/rewrite-third-person', asyncHandler(async (req, res) => {
  const { id: storyId } = req.params;

  const context = await loadGenerationContext(storyId);
  const { settings, story, persona, characterCards, activatedLorebooks } = context;

  const deepseek = new DeepSeekAPI(settings.apiKey);

  // Include all characters
  const allCharacterCards = characterCards.map(c => c.data);
  const characterCard = characterCards.length > 0 ? characterCards[0].data : null;

  // Build rewrite prompt (server owns this logic)
  const rewriteInstruction = `Rewrite the following text to be in third person narrative perspective. Maintain all the story beats, dialogue, and events, but convert first person ("I", "me") and second person ("you") references to third person ("he", "she", "they"). Keep the writing style and tone consistent.`;

  const { fullPrompt } = deepseek.buildGenerationPrompt('custom', {
    characterCard,
    allCharacterCards,
    currentContent: story.content,
    customPrompt: rewriteInstruction,
    persona,
  });

  setupSSE(res);

  try {
    await streamGeneration(res, deepseek, fullPrompt, {
      characterCard,
      allCharacterCards,
      persona,
      lorebookEntries: activatedLorebooks,
      maxTokens: settings.maxTokens || 4000,
      temperature: settings.temperature !== undefined ? settings.temperature : 1.5,
      settings,
    }, settings);
  } catch (error) {
    console.error('Generation error:', error);
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
}));

export default router;

