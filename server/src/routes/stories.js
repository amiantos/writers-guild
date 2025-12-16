/**
 * Stories API Routes
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';
import { PromptBuilder } from '../services/prompt-builder.js';
import { MacroProcessor } from '../services/macro-processor.js';
import { LorebookActivator } from '../services/lorebook-activator.js';
import { getProvider } from '../services/provider-factory.js';
import { createPresetFromSettings } from '../services/default-presets.js';

const router = express.Router();

// Initialize storage service (will be set in server.js)
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new SqliteStorageService(req.app.locals.dataRoot);
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
  const { title, description, needsRewritePrompt } = req.body;

  if (!title || !title.trim()) {
    throw new AppError('Title is required', 400);
  }

  const story = await storage.createStory(
    title.trim(),
    description?.trim() || '',
    { needsRewritePrompt: !!needsRewritePrompt }
  );

  // Auto-assign default persona if set in settings
  try {
    const settings = await storage.getSettings();
    if (settings && settings.defaultPersonaId) {
      await storage.setStoryPersona(story.id, settings.defaultPersonaId);
      story.personaCharacterId = settings.defaultPersonaId;
    }
  } catch (error) {
    console.error('Failed to auto-assign default persona:', error);
    // Don't fail story creation if this fails
  }

  res.status(201).json({ story });
}));

// Get story by ID
router.get('/:id', asyncHandler(async (req, res) => {
  const story = await storage.getStory(req.params.id);
  res.json({ story });
}));

// Set or clear the rewrite prompt flag for a story
router.post('/:id/rewrite-prompt', asyncHandler(async (req, res) => {
  const { value } = req.body;
  await storage.setStoryNeedsRewritePrompt(req.params.id, !!value);
  res.json({ success: true });
}));

// Validate avatar window structure
function validateAvatarWindow(win, index) {
  if (typeof win !== 'object' || win === null) {
    return `avatarWindows[${index}] must be an object`;
  }
  const requiredProps = ['id', 'characterId', 'x', 'y', 'width', 'height'];
  for (const prop of requiredProps) {
    if (!(prop in win)) {
      return `avatarWindows[${index}] is missing required property '${prop}'`;
    }
  }
  if (typeof win.id !== 'string') {
    return `avatarWindows[${index}].id must be a string`;
  }
  if (typeof win.characterId !== 'string') {
    return `avatarWindows[${index}].characterId must be a string`;
  }
  for (const numProp of ['x', 'y', 'width', 'height']) {
    if (typeof win[numProp] !== 'number' || !Number.isFinite(win[numProp])) {
      return `avatarWindows[${index}].${numProp} must be a finite number`;
    }
  }
  // Range validation
  const MAX_DIMENSION = 5000;
  if (win.width <= 0) {
    return `avatarWindows[${index}].width must be a positive number`;
  }
  if (win.width > MAX_DIMENSION) {
    return `avatarWindows[${index}].width must not exceed ${MAX_DIMENSION}`;
  }
  if (win.height <= 0) {
    return `avatarWindows[${index}].height must be a positive number`;
  }
  if (win.height > MAX_DIMENSION) {
    return `avatarWindows[${index}].height must not exceed ${MAX_DIMENSION}`;
  }
  const MIN_POS = -10000, MAX_POS = 10000;
  if (win.x < MIN_POS || win.x > MAX_POS) {
    return `avatarWindows[${index}].x must be between ${MIN_POS} and ${MAX_POS}`;
  }
  if (win.y < MIN_POS || win.y > MAX_POS) {
    return `avatarWindows[${index}].y must be between ${MIN_POS} and ${MAX_POS}`;
  }
  return null;
}

// Update avatar windows for a story
router.put('/:id/avatar-windows', asyncHandler(async (req, res) => {
  const { avatarWindows } = req.body;

  if (!Array.isArray(avatarWindows)) {
    throw new AppError('avatarWindows must be an array', 400);
  }

  // Enforce maximum number of avatar windows
  const MAX_AVATAR_WINDOWS = 20;
  if (avatarWindows.length > MAX_AVATAR_WINDOWS) {
    throw new AppError(`A maximum of ${MAX_AVATAR_WINDOWS} avatar windows is allowed`, 400);
  }

  // Validate each avatar window
  for (let i = 0; i < avatarWindows.length; i++) {
    const error = validateAvatarWindow(avatarWindows[i], i);
    if (error) {
      throw new AppError(error, 400);
    }
  }

  const result = await storage.updateStoryAvatarWindows(req.params.id, avatarWindows);
  res.json(result);
}));

// Update story metadata
router.put('/:id', asyncHandler(async (req, res) => {
  const { title, description, configPresetId } = req.body;
  const updates = {};

  if (title !== undefined) updates.title = title.trim();
  if (description !== undefined) updates.description = description.trim();
  if (configPresetId !== undefined) updates.configPresetId = configPresetId;

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

  // Include history status in response
  const historyStatus = await storage.getHistoryStatus(req.params.id);
  res.json({ ...result, ...historyStatus });
}));

// Get undo/redo status for a story
router.get('/:id/history/status', asyncHandler(async (req, res) => {
  const status = await storage.getHistoryStatus(req.params.id);
  res.json(status);
}));

// Undo story content
router.post('/:id/undo', asyncHandler(async (req, res) => {
  const result = await storage.undoStoryContent(req.params.id);

  if (!result) {
    throw new AppError('Nothing to undo', 400);
  }

  res.json(result);
}));

// Redo story content
router.post('/:id/redo', asyncHandler(async (req, res) => {
  const result = await storage.redoStoryContent(req.params.id);

  if (!result) {
    throw new AppError('Nothing to redo', 400);
  }

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
  let updatedTitle = null;
  let addedLorebookId = null;
  try {
    const characterCard = await storage.getCharacter(characterId);

    // Update story title if it's still "Untitled Story" or starts with "Story with"
    if ((story.title === 'Untitled Story' || story.title.startsWith('Story with ')) && characterCard.data?.name) {
      const newTitle = `Story with ${characterCard.data.name}`;
      await storage.updateStoryMetadata(req.params.id, {
        title: newTitle
      });
      updatedTitle = newTitle;
    }

    // Auto-add character's lorebook if it has one
    const lorebookId = characterCard.data?.extensions?.ursceal_lorebook_id;
    if (lorebookId) {
      try {
        // Check if lorebook isn't already attached
        const currentLorebooks = story.lorebookIds || [];
        if (!currentLorebooks.includes(lorebookId)) {
          await storage.addLorebookToStory(req.params.id, lorebookId);
          addedLorebookId = lorebookId;
          console.log(`Auto-added lorebook ${lorebookId} for character ${characterId}`);
        }
      } catch (error) {
        console.error('Failed to auto-add character lorebook:', error);
        // Don't fail the whole operation if lorebook addition fails
      }
    }

    if (characterCard.data?.first_mes) {
      const settings = await storage.getSettings();
      const promptBuilder = new PromptBuilder();
      const macroProcessor = new MacroProcessor({
        userName: persona?.name || 'User',
        charName: characterCard.data?.name || 'Character'
      });

      let processed = characterCard.data.first_mes;
      processed = promptBuilder.replacePlaceholders(processed, characterCard, persona);
      processed = macroProcessor.process(processed);

      processedFirstMessage = processed;
    }
  } catch (error) {
    console.error('Failed to process first message:', error);
  }

  res.json({
    success: true,
    processedFirstMessage,
    updatedTitle,
    addedLorebookId
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

  // Initialize processors for text processing
  const promptBuilder = new PromptBuilder();
  const macroProcessor = new MacroProcessor({
    userName: persona?.name || 'User',
    charName: characterCard.data?.name || 'Character'
  });

  // Process all greetings
  const greetings = [];

  // Add first_mes as first greeting
  if (characterCard.data?.first_mes) {
    let processed = characterCard.data.first_mes;
    processed = promptBuilder.replacePlaceholders(processed, characterCard, persona);
    processed = macroProcessor.process(processed);

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
      processed = promptBuilder.replacePlaceholders(processed, characterCard, persona);
      processed = macroProcessor.process(processed);

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
  // Load story
  const story = await storage.getStory(storyId);

  // Load preset configuration (story-specific or default)
  let preset = null;
  let presetId = story.configPresetId;

  // If story doesn't have a preset, use default
  if (!presetId) {
    presetId = await storage.getDefaultPresetId();
  }

  // If still no preset, try to create one from legacy settings (migration path)
  if (!presetId) {
    const settings = await storage.getSettings();
    if (settings && settings.apiKey) {
      console.log('No preset found, using legacy settings (migration needed)');
      preset = createPresetFromSettings(settings);
    } else {
      throw new AppError('No configuration preset found and no API key configured. Please configure a preset in settings.', 400);
    }
  } else {
    // Load preset
    try {
      preset = await storage.getPreset(presetId);
    } catch (error) {
      throw new AppError(`Failed to load configuration preset: ${error.message}`, 400);
    }
  }

  // Create provider instance
  let provider;
  try {
    provider = getProvider(preset);
  } catch (error) {
    throw new AppError(`Failed to initialize provider: ${error.message}`, 400);
  }

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
      // Add the ID to the card so we can look it up later
      cardData.id = charId;
      characterCards.push(cardData);
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
        // Use lorebook settings from preset
        const lorebookSettings = preset.lorebookSettings || {
          lorebookScanDepth: 2000,
          lorebookTokenBudget: 1800,
          lorebookRecursionDepth: 3,
          lorebookEnableRecursion: true
        };
        const activator = new LorebookActivator(lorebookSettings);
        activatedLorebooks = activator.activate(lorebooks, story.content || '');
        console.log(`Activated ${activatedLorebooks.length} lorebook entries from ${lorebooks.length} lorebook(s)`);
      }
    } catch (error) {
      console.error('Failed to activate lorebooks:', error);
    }
  }

  return {
    preset,
    provider,
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
async function streamGeneration(res, provider, preset, context, generationType, params, abortSignal = null) {
  console.log(`[streamGeneration] Starting ${generationType}, signal present: ${!!abortSignal}, aborted: ${abortSignal?.aborted}`);

  // Build both system and user prompts with proper context management
  const prompts = await provider.buildPrompts(
    {
      persona: context.persona,
      characterCards: params.characterCards || [],
      activatedLorebooks: context.activatedLorebooks || [],
      story: context.story,
      settings: preset.generationSettings
    },
    generationType,
    {
      characterName: params.characterName,
      customInstruction: params.customInstruction,
      templateText: preset.promptTemplates?.[generationType]
    },
    preset
  );

  const { system: systemPrompt, user: userPrompt } = prompts;

  // Send prompts for debugging
  res.write(`data: ${JSON.stringify({
    prompts: {
      system: systemPrompt,
      user: userPrompt
    }
  })}\n\n`);

  if (res.flush) res.flush();

  // Check if provider supports streaming
  const capabilities = provider.getCapabilities();

  if (capabilities.streaming) {
    console.log(`[streamGeneration] Using streaming provider, signal: ${!!abortSignal}`);
    // Start streaming generation
    const { stream, metadata } = await provider.generateStreaming(systemPrompt, userPrompt, {
      // Pass all advanced sampling parameters
      ...preset.generationSettings,
      maxContextLength: preset.generationSettings.maxContextTokens,
      signal: abortSignal
    });

    // Stream chunks
    try {
      for await (const chunk of stream) {
        // Apply asterisk filtering server-side (core feature - always enabled)
        let processedContent = chunk.content || null;
        if (processedContent) {
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
    } catch (error) {
      if (error.name === 'AbortError' || abortSignal?.aborted) {
        console.log(`[streamGeneration] Stream aborted`);
      }
      throw error;
    }
  } else if (capabilities.requiresPolling) {
    // Handle queue-based providers (AI Horde)
    const streamWithStatus = provider.generateStreamingWithStatus(systemPrompt, userPrompt, {
      // Pass all advanced sampling parameters
      ...preset.generationSettings,
      maxContextLength: preset.generationSettings.maxContextTokens,
      timeout: preset.generationSettings.timeout || 300000,
      signal: abortSignal
    });

    for await (const update of streamWithStatus) {
      if (update.type === 'status') {
        // Send queue status updates
        res.write(`data: ${JSON.stringify({
          queueStatus: {
            position: update.queuePosition,
            waitTime: update.waitTime,
            finished: update.finished,
            faulted: update.faulted
          }
        })}\n\n`);
      } else if (update.type === 'complete') {
        // Send final content
        let processedContent = update.content || '';
        processedContent = processedContent.replace(/\*/g, '');

        res.write(`data: ${JSON.stringify({
          content: processedContent,
          finished: true
        })}\n\n`);
      }

      if (res.flush) res.flush();
    }
  } else {
    // Fallback: non-streaming generation
    const result = await provider.generate(systemPrompt, userPrompt, {
      // Pass all advanced sampling parameters
      ...preset.generationSettings,
      maxContextLength: preset.generationSettings.maxContextTokens
    });

    let processedContent = result.content || '';
    processedContent = processedContent.replace(/\*/g, '');

    res.write(`data: ${JSON.stringify({
      reasoning: result.reasoning || null,
      content: processedContent,
      finished: true
    })}\n\n`);
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
  const { preset, provider, characterCards } = context;

  // Determine which characters to use and generation type
  let generationType = 'continue';
  let characterName = null;
  let useCharacterCards = characterCards;

  if (characterId) {
    // Character-specific generation
    generationType = 'character';
    const selectedChar = characterCards.find(c => c.data.name === characterId || c.id === characterId);
    if (selectedChar) {
      characterName = selectedChar.data?.name;
      useCharacterCards = [selectedChar];
    } else {
      console.error(`[Continue] Character ${characterId} not found in story's character list`);
    }
  }

  setupSSE(res);

  // Create abort controller for cancellation support
  const abortController = new AbortController();
  console.log(`[Continue] Starting generation for story ${storyId}${characterId ? ` (character: ${characterId})` : ''}`);

  // Handle client disconnection (for SSE, listen to response close event)
  res.on('close', () => {
    if (!res.writableEnded && !abortController.signal.aborted) {
      console.log('[Continue] Client disconnected, aborting generation');
      abortController.abort();
    }
  });

  try {
    await streamGeneration(res, provider, preset, context, generationType, {
      characterCards: useCharacterCards,
      characterName
    }, abortController.signal);
  } catch (error) {
    if (error.message === 'Generation cancelled' || abortController.signal.aborted) {
      console.log('[Continue] Generation was cancelled by user');
      res.write(`data: ${JSON.stringify({ cancelled: true })}\n\n`);
    } else {
      console.error('[Continue] Generation error:', error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  }
}));

// Continue with instruction
router.post('/:id/continue-with-instruction', asyncHandler(async (req, res) => {
  const { id: storyId } = req.params;
  const { instruction } = req.body;

  // If no instruction provided, fall back to normal continue
  const hasInstruction = instruction && instruction.trim();
  const generationType = hasInstruction ? 'instruction' : 'continue';

  const context = await loadGenerationContext(storyId);
  const { preset, provider, characterCards } = context;

  setupSSE(res);

  // Create abort controller for cancellation support
  const abortController = new AbortController();
  console.log(`[Continue-with-Instruction] Starting ${generationType} generation for story ${storyId}`);

  // Handle client disconnection (for SSE, listen to response close event)
  res.on('close', () => {
    if (!res.writableEnded && !abortController.signal.aborted) {
      console.log('[Continue-with-Instruction] Client disconnected, aborting generation');
      abortController.abort();
    }
  });

  try {
    await streamGeneration(res, provider, preset, context, generationType, {
      characterCards,
      customInstruction: hasInstruction ? instruction.trim() : undefined
    }, abortController.signal);
  } catch (error) {
    if (error.message === 'Generation cancelled' || abortController.signal.aborted) {
      console.log('[Continue-with-Instruction] Generation was cancelled by user');
      res.write(`data: ${JSON.stringify({ cancelled: true })}\n\n`);
    } else {
      console.error('[Continue-with-Instruction] Generation error:', error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  }
}));

// Rewrite to third person
router.post('/:id/rewrite-third-person', asyncHandler(async (req, res) => {
  const { id: storyId } = req.params;

  const context = await loadGenerationContext(storyId);
  const { preset, provider, characterCards } = context;

  setupSSE(res);

  // Create abort controller for cancellation support
  const abortController = new AbortController();
  console.log(`[Rewrite] Starting third-person rewrite for story ${storyId}`);

  // Handle client disconnection (for SSE, listen to response close event)
  res.on('close', () => {
    if (!res.writableEnded && !abortController.signal.aborted) {
      console.log('[Rewrite] Client disconnected, aborting generation');
      abortController.abort();
    }
  });

  try {
    await streamGeneration(res, provider, preset, context, 'rewriteThirdPerson', {
      characterCards
    }, abortController.signal);
  } catch (error) {
    if (error.message === 'Generation cancelled' || abortController.signal.aborted) {
      console.log('[Rewrite] Generation was cancelled by user');
      res.write(`data: ${JSON.stringify({ cancelled: true })}\n\n`);
    } else {
      console.error('[Rewrite] Generation error:', error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  }
}));

// Ideate - Ask AI for story ideas
router.post('/:id/ideate', asyncHandler(async (req, res) => {
  const { id: storyId } = req.params;

  const context = await loadGenerationContext(storyId);
  const { preset, provider, characterCards, persona } = context;

  setupSSE(res);

  // Create abort controller for cancellation support
  const abortController = new AbortController();
  console.log(`[Ideate] Starting ideation for story ${storyId}`);

  // Handle client disconnection (for SSE, listen to response close event)
  res.on('close', () => {
    if (!res.writableEnded && !abortController.signal.aborted) {
      console.log('[Ideate] Client disconnected, aborting generation');
      abortController.abort();
    }
  });

  // Get userName for ideate prompt template
  const userName = persona?.name || 'the user';

  try {
    await streamGeneration(res, provider, preset, context, 'ideate', {
      characterCards,
      userName
    }, abortController.signal);
  } catch (error) {
    if (error.message === 'Generation cancelled' || abortController.signal.aborted) {
      console.log('[Ideate] Generation was cancelled by user');
      res.write(`data: ${JSON.stringify({ cancelled: true })}\n\n`);
    } else {
      console.error('[Ideate] Generation error:', error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
    res.end();
  }
}));

export default router;

