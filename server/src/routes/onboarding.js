/**
 * Onboarding API Routes
 * Handles the new user onboarding flow
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';
import { importDefaultCharacters, createDefaultStory } from '../services/migration.js';
import { getDefaultPresets, DEFAULT_PROMPT_TEMPLATES } from '../services/default-presets.js';

const router = express.Router();

// Initialize storage service
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new SqliteStorageService(req.app.locals.dataRoot);
  }
  next();
});

// Get onboarding status
router.get('/status', asyncHandler(async (req, res) => {
  const settings = await storage.getSettings();
  res.json({
    onboardingCompleted: settings?.onboardingCompleted || false
  });
}));

// Create persona during onboarding
router.post('/persona', asyncHandler(async (req, res) => {
  const { firstName, description } = req.body;

  if (!firstName || !firstName.trim()) {
    throw new AppError('First name is required', 400);
  }

  const characterId = uuidv4();

  // Create persona character data in V2 format
  const characterData = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: firstName.trim(),
      description: description?.trim() || '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: 'Created during onboarding as user persona',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      character_book: null,
      tags: ['persona'],
      creator: '',
      character_version: '1.0',
      extensions: {
        is_persona: true
      }
    }
  };

  // Save character (no image)
  await storage.saveCharacter(characterId, characterData, null);

  // Set as default persona
  const settings = await storage.getSettings() || {};
  settings.defaultPersonaId = characterId;
  await storage.saveSettings(settings);

  res.status(201).json({
    id: characterId,
    name: characterData.data.name,
    description: characterData.data.description,
  });
}));

// Create preset during onboarding
router.post('/preset', asyncHandler(async (req, res) => {
  const { provider, apiKey } = req.body;

  if (!provider) {
    throw new AppError('Provider is required', 400);
  }

  const validProviders = ['deepseek', 'openai', 'anthropic', 'openrouter', 'aihorde'];
  if (!validProviders.includes(provider)) {
    throw new AppError(`Invalid provider. Must be one of: ${validProviders.join(', ')}`, 400);
  }

  // AI Horde doesn't require an API key
  if (provider !== 'aihorde' && (!apiKey || !apiKey.trim())) {
    throw new AppError('API key is required for this provider', 400);
  }

  const presetId = uuidv4();

  // Get provider-specific configuration
  const presetConfig = getProviderPresetConfig(provider, apiKey);

  await storage.savePreset(presetId, {
    ...presetConfig,
    id: presetId
  });

  // Set as default preset
  await storage.setDefaultPresetId(presetId);

  res.status(201).json({
    id: presetId,
    name: presetConfig.name,
    provider: presetConfig.provider,
  });
}));

// Import default characters and stories
router.post('/import-defaults', asyncHandler(async (req, res) => {
  console.log('Importing default characters and stories...');

  // Get the default persona ID to set on stories
  const settings = await storage.getSettings();
  const defaultPersonaId = settings?.defaultPersonaId;

  // Import default characters
  const importedCharacters = await importDefaultCharacters(storage);

  // Create a default story for each imported character
  const defaultStories = [];
  for (const character of importedCharacters) {
    console.log(`Creating default story for ${character.name}...`);
    const story = await createDefaultStory(storage, character);
    if (story) {
      // Set the default persona on the story
      if (defaultPersonaId) {
        await storage.setStoryPersona(story.id, defaultPersonaId);
        console.log(`✓ Set default persona on story: ${story.title}`);
      }
      defaultStories.push(story);
    }
  }

  console.log(`Imported ${importedCharacters.length} characters and created ${defaultStories.length} stories`);

  res.json({
    importedCharacters: importedCharacters.length,
    createdStories: defaultStories.length,
    characters: importedCharacters.map(c => ({ id: c.id, name: c.name })),
    stories: defaultStories
  });
}));

// Complete onboarding
router.post('/complete', asyncHandler(async (req, res) => {
  const settings = await storage.getSettings() || {};
  settings.onboardingCompleted = true;
  await storage.saveSettings(settings);

  res.json({ success: true });
}));

// Skip onboarding (for advanced users)
router.post('/skip', asyncHandler(async (req, res) => {
  // Create default AI Horde preset if no presets exist
  const presets = await storage.listPresets();
  if (presets.length === 0) {
    const defaults = getDefaultPresets();
    const presetId = uuidv4();
    await storage.savePreset(presetId, {
      ...defaults.aihorde,
      id: presetId
    });
    await storage.setDefaultPresetId(presetId);
  }

  // Mark onboarding as completed
  const settings = await storage.getSettings() || {};
  settings.onboardingCompleted = true;
  await storage.saveSettings(settings);

  res.json({ success: true });
}));

/**
 * Get provider-specific preset configuration
 */
function getProviderPresetConfig(provider, apiKey) {
  const baseConfig = {
    generationSettings: {
      maxTokens: 4000,
      maxContextTokens: 128000,
      temperature: 0.7,
      includeDialogueExamples: false,
      top_p: null,
      top_k: null,
      frequency_penalty: null,
      presence_penalty: null,
      stop_sequences: [],
    },
    lorebookSettings: {
      scanDepth: 2000,
      tokenBudget: 1800,
      recursionDepth: 3,
      enableRecursion: true
    },
    promptTemplates: {
      systemPrompt: null,
      continue: null,
      character: null,
      instruction: null,
      rewriteThirdPerson: null,
      ideate: null
    }
  };

  switch (provider) {
    case 'deepseek':
      return {
        name: 'DeepSeek',
        provider: 'deepseek',
        apiConfig: {
          apiKey: apiKey,
          baseURL: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat'
        },
        ...baseConfig,
        generationSettings: {
          ...baseConfig.generationSettings,
          maxTokens: 4000,
          maxContextTokens: 128000,
          temperature: 1.5, // DeepSeek works well with higher temps
        }
      };

    case 'openai':
      return {
        name: 'OpenAI',
        provider: 'openai',
        apiConfig: {
          apiKey: apiKey,
          baseURL: 'https://api.openai.com/v1',
          model: 'gpt-4o'
        },
        ...baseConfig
      };

    case 'anthropic':
      return {
        name: 'Anthropic',
        provider: 'anthropic',
        apiConfig: {
          apiKey: apiKey,
          model: 'claude-sonnet-4-20250514'
        },
        ...baseConfig
      };

    case 'openrouter':
      return {
        name: 'OpenRouter',
        provider: 'openrouter',
        apiConfig: {
          apiKey: apiKey,
          baseURL: 'https://openrouter.ai/api/v1',
          model: 'deepseek/deepseek-r1'
        },
        ...baseConfig
      };

    case 'aihorde':
      return {
        name: 'AI Horde',
        provider: 'aihorde',
        apiConfig: {
          apiKey: apiKey || '0000000000',
          baseURL: 'https://aihorde.net/api/v2',
          models: [],
          workerBlacklist: [],
          trustedWorkers: false,
          slowWorkers: true
        },
        generationSettings: {
          maxTokens: 512,
          maxContextTokens: 8192,
          temperature: 0.7,
          includeDialogueExamples: false,
          timeout: 300000,
          rep_pen: 1.1,
          rep_pen_range: 320,
          sampler_order: [6, 0, 1, 3, 4, 2, 5],
        },
        lorebookSettings: baseConfig.lorebookSettings,
        promptTemplates: baseConfig.promptTemplates
      };

    default:
      throw new AppError(`Unknown provider: ${provider}`, 400);
  }
}

export default router;
