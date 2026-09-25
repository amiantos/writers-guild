/**
 * Configuration Presets API Routes
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '../middleware/error-handler.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';
import {
  getDefaultPresets,
  DEFAULT_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_CHAT_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_PROMPT_TEMPLATES,
} from '../services/default-presets.js';
import { AIHordeProvider } from '../services/providers/aihorde-provider.js';
import { OpenRouterProvider } from '../services/providers/openrouter-provider.js';
import { OpenAIProvider } from '../services/providers/openai-provider.js';
import { AnthropicProvider } from '../services/providers/anthropic-provider.js';
import { DeepSeekProvider } from '../services/providers/deepseek-provider.js';
import { KoboldCppProvider } from '../services/providers/koboldcpp-provider.js';
import { OllamaProvider } from '../services/providers/ollama-provider.js';
import { OpenAICompatibleProvider } from '../services/providers/openai-compatible-provider.js';

const router = express.Router();

// Initialize storage service
let storage;

router.use((req, res, next) => {
  if (!storage) {
    storage = new SqliteStorageService(req.app.locals.dataRoot);
  }
  next();
});

// List all presets
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const presets = await storage.listPresets();
    res.json({ presets });
  }),
);

// Get a specific preset
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const preset = await storage.getPreset(req.params.id);
    res.json({ preset });
  }),
);

// Create a new preset
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const presetId = uuidv4();
    const presetData = {
      ...req.body,
      id: presetId,
    };

    // Validate required fields
    if (!presetData.name || !presetData.provider) {
      return res.status(400).json({
        error: 'Preset name and provider are required',
      });
    }

    await storage.savePreset(presetId, presetData);
    res.status(201).json({
      preset: presetData,
    });
  }),
);

// Update an existing preset
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const presetId = req.params.id;

    // Check if preset exists
    try {
      await storage.getPreset(presetId);
    } catch (error) {
      return res.status(404).json({
        error: `Preset not found: ${presetId}`,
      });
    }

    const presetData = {
      ...req.body,
      id: presetId,
    };

    await storage.savePreset(presetId, presetData);
    res.json({
      preset: presetData,
    });
  }),
);

// Delete a preset
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const presetId = req.params.id;

    // Check if preset exists
    try {
      await storage.getPreset(presetId);
    } catch (error) {
      return res.status(404).json({
        error: `Preset not found: ${presetId}`,
      });
    }

    await storage.deletePreset(presetId);
    res.json({
      success: true,
      message: `Preset ${presetId} deleted`,
    });
  }),
);

// Get default preset ID
router.get(
  '/default/id',
  asyncHandler(async (req, res) => {
    const defaultPresetId = await storage.getDefaultPresetId();
    res.json({ defaultPresetId });
  }),
);

// Set default preset
router.put(
  '/default/id',
  asyncHandler(async (req, res) => {
    const { presetId } = req.body;

    if (!presetId) {
      return res.status(400).json({
        error: 'Preset ID is required',
      });
    }

    // Verify preset exists
    try {
      await storage.getPreset(presetId);
    } catch (error) {
      return res.status(404).json({
        error: `Preset not found: ${presetId}`,
      });
    }

    await storage.setDefaultPresetId(presetId);
    res.json({
      success: true,
      defaultPresetId: presetId,
    });
  }),
);

// Initialize default presets (can be called manually or during migration)
router.post(
  '/initialize-defaults',
  asyncHandler(async (req, res) => {
    const defaults = getDefaultPresets();
    const createdPresets = [];

    for (const presetData of Object.values(defaults)) {
      const presetId = uuidv4();
      await storage.savePreset(presetId, {
        ...presetData,
        id: presetId,
      });
      createdPresets.push({
        id: presetId,
        name: presetData.name,
        provider: presetData.provider,
      });
    }

    res.json({
      success: true,
      presets: createdPresets,
    });
  }),
);

// Get default prompt templates (single source of truth for both server and client)
router.get(
  '/defaults/templates',
  asyncHandler(async (req, res) => {
    res.json({
      systemPrompt: DEFAULT_SYSTEM_PROMPT_TEMPLATE,
      chatSystemPrompt: DEFAULT_CHAT_SYSTEM_PROMPT_TEMPLATE,
      ...DEFAULT_PROMPT_TEMPLATES,
    });
  }),
);

// Get available AI Horde models (with caching)
let hordeModelsCache = null;
let hordeAutoSelectedCache = null;
let hordeCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

router.get(
  '/aihorde/models',
  asyncHandler(async (req, res) => {
    const now = Date.now();

    // Return cached data if still valid
    if (hordeModelsCache && now - hordeCacheTime < CACHE_DURATION) {
      return res.json({
        models: hordeModelsCache,
        autoSelected: hordeAutoSelectedCache,
        cached: true,
        cacheAge: Math.floor((now - hordeCacheTime) / 1000),
      });
    }

    // Fetch fresh data
    try {
      // Create temporary provider instance (API key not required for public endpoints)
      const provider = new AIHordeProvider({ apiKey: '0000000000' });
      const models = await provider.getAvailableModels();
      const autoSelected = provider.autoSelectModels(models);

      // Update cache
      hordeModelsCache = models;
      hordeAutoSelectedCache = autoSelected;
      hordeCacheTime = now;

      res.json({
        models,
        autoSelected, // Array of recommended model names
        cached: false,
      });
    } catch (error) {
      console.error('Failed to fetch AI Horde models:', error);
      res.status(500).json({
        error: 'Failed to fetch models from AI Horde',
        message: error.message,
      });
    }
  }),
);

// Get AI Horde worker data (for context limit calculations)
router.get(
  '/aihorde/workers',
  asyncHandler(async (req, res) => {
    try {
      const provider = new AIHordeProvider({ apiKey: '0000000000' });
      const workers = await provider.getWorkerData();

      res.json({ workers });
    } catch (error) {
      console.error('Failed to fetch AI Horde workers:', error);
      res.status(500).json({
        error: 'Failed to fetch workers from AI Horde',
        message: error.message,
      });
    }
  }),
);

// Get available OpenRouter models (with caching)
let openrouterModelsCache = null;
let openrouterCacheTime = 0;
const OPENROUTER_CACHE_DURATION = 60 * 60 * 1000; // 1 hour (models change less frequently)

router.get(
  '/openrouter/models',
  asyncHandler(async (req, res) => {
    const now = Date.now();

    // Return cached data if still valid
    if (openrouterModelsCache && now - openrouterCacheTime < OPENROUTER_CACHE_DURATION) {
      return res.json({
        models: openrouterModelsCache,
        cached: true,
        cacheAge: Math.floor((now - openrouterCacheTime) / 1000),
      });
    }

    // Get API key from request (optional, but needed for some models)
    const apiKey = req.query.apiKey || req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(400).json({
        error: 'API key required to fetch OpenRouter models',
      });
    }

    // Fetch fresh data
    try {
      const provider = new OpenRouterProvider({ apiKey });
      const models = await provider.getAvailableModels();

      // Update cache
      openrouterModelsCache = models;
      openrouterCacheTime = now;

      res.json({
        models,
        cached: false,
      });
    } catch (error) {
      console.error('Failed to fetch OpenRouter models:', error);
      res.status(500).json({
        error: 'Failed to fetch models from OpenRouter',
        message: error.message,
      });
    }
  }),
);

// Get available OpenAI models (with caching)
let openaiModelsCache = null;
let openaiCacheTime = 0;
const OPENAI_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

router.get(
  '/openai/models',
  asyncHandler(async (req, res) => {
    const now = Date.now();

    // Return cached data if still valid
    if (openaiModelsCache && now - openaiCacheTime < OPENAI_CACHE_DURATION) {
      return res.json({
        models: openaiModelsCache,
        cached: true,
        cacheAge: Math.floor((now - openaiCacheTime) / 1000),
      });
    }

    // Get API key from request
    const apiKey = req.query.apiKey || req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(400).json({
        error: 'API key required to fetch OpenAI models',
      });
    }

    // Fetch fresh data
    try {
      const provider = new OpenAIProvider({ apiKey });
      const models = await provider.getAvailableModels();

      // Update cache
      openaiModelsCache = models;
      openaiCacheTime = now;

      res.json({
        models,
        cached: false,
      });
    } catch (error) {
      console.error('Failed to fetch OpenAI models:', error);
      res.status(500).json({
        error: 'Failed to fetch models from OpenAI',
        message: error.message,
      });
    }
  }),
);

// Get available Anthropic models (with caching)
let anthropicModelsCache = null;
let anthropicCacheTime = 0;
const ANTHROPIC_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

router.get(
  '/anthropic/models',
  asyncHandler(async (req, res) => {
    const now = Date.now();

    // Return cached data if still valid
    if (anthropicModelsCache && now - anthropicCacheTime < ANTHROPIC_CACHE_DURATION) {
      return res.json({
        models: anthropicModelsCache,
        cached: true,
        cacheAge: Math.floor((now - anthropicCacheTime) / 1000),
      });
    }

    // Get API key from request
    const apiKey = req.query.apiKey || req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(400).json({
        error: 'API key required to fetch Anthropic models',
      });
    }

    // Fetch fresh data
    try {
      const provider = new AnthropicProvider({ apiKey });
      const models = await provider.getAvailableModels();

      // Update cache
      anthropicModelsCache = models;
      anthropicCacheTime = now;

      res.json({
        models,
        cached: false,
      });
    } catch (error) {
      console.error('Failed to fetch Anthropic models:', error);
      res.status(500).json({
        error: 'Failed to fetch models from Anthropic',
        message: error.message,
      });
    }
  }),
);

// Get available DeepSeek models (with caching)
let deepseekModelsCache = null;
let deepseekCacheTime = 0;
const DEEPSEEK_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

router.get(
  '/deepseek/models',
  asyncHandler(async (req, res) => {
    const now = Date.now();

    // Return cached data if still valid
    if (deepseekModelsCache && now - deepseekCacheTime < DEEPSEEK_CACHE_DURATION) {
      return res.json({
        models: deepseekModelsCache,
        cached: true,
        cacheAge: Math.floor((now - deepseekCacheTime) / 1000),
      });
    }

    // Get API key from request
    const apiKey = req.query.apiKey || req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(400).json({
        error: 'API key required to fetch DeepSeek models',
      });
    }

    // Fetch fresh data
    try {
      const provider = new DeepSeekProvider({ apiKey });
      const models = await provider.getAvailableModels();

      // Update cache
      deepseekModelsCache = models;
      deepseekCacheTime = now;

      res.json({
        models,
        cached: false,
      });
    } catch (error) {
      console.error('Failed to fetch DeepSeek models:', error);
      res.status(500).json({
        error: 'Failed to fetch models from DeepSeek',
        message: error.message,
      });
    }
  }),
);

// Inspect a KoboldCpp endpoint: returns loaded model + configured max context length.
// No caching — local endpoint, can change anytime a user hot-swaps a model.
router.get(
  '/koboldcpp/info',
  asyncHandler(async (req, res) => {
    const baseURL = req.query.baseURL;
    const password = req.query.password || '';

    if (!baseURL) {
      return res.status(400).json({
        error: 'baseURL query parameter is required',
      });
    }

    try {
      const provider = new KoboldCppProvider({ baseURL, password });
      const info = await provider.getEndpointInfo();
      res.json(info);
    } catch (error) {
      console.error('Failed to inspect KoboldCpp endpoint:', error);
      res.status(502).json({
        error: 'Could not reach KoboldCpp',
        message: `Could not reach KoboldCpp at ${baseURL}. Is it running?`,
        detail: error.message,
      });
    }
  }),
);

// Inspect a specific Ollama model: pulls architectural max context + the
// Modelfile's recommended parameter defaults so the client can auto-configure
// preset settings when the user picks a model.
router.get(
  '/ollama/show',
  asyncHandler(async (req, res) => {
    const { baseURL, password = '', name } = req.query;

    if (!baseURL) {
      return res.status(400).json({ error: 'baseURL query parameter is required' });
    }
    if (!name) {
      return res.status(400).json({ error: 'name query parameter is required' });
    }

    try {
      const provider = new OllamaProvider({ baseURL, password, model: name });
      const info = await provider.getModelInfo(name);
      res.json(info);
    } catch (error) {
      console.error('Failed to fetch Ollama model info:', error);
      res.status(502).json({
        error: 'Could not fetch model info',
        message: `Could not fetch info for "${name}" from Ollama at ${baseURL}.`,
        detail: error.message,
      });
    }
  }),
);

// List models installed on a user-provided Ollama instance. No caching — local
// endpoint, the list can change anytime the user runs `ollama pull`.
router.get(
  '/ollama/models',
  asyncHandler(async (req, res) => {
    const baseURL = req.query.baseURL;
    const password = req.query.password || '';

    if (!baseURL) {
      return res.status(400).json({
        error: 'baseURL query parameter is required',
      });
    }

    try {
      const provider = new OllamaProvider({ baseURL, password });
      const models = await provider.getAvailableModels();
      res.json({ models });
    } catch (error) {
      console.error('Failed to fetch Ollama models:', error);
      res.status(502).json({
        error: 'Could not reach Ollama',
        message: `Could not reach Ollama at ${baseURL}. Is it running?`,
        detail: error.message,
      });
    }
  }),
);

// List models advertised by an OpenAI-compatible endpoint. Unlike /openai/models,
// this does NOT require an apiKey query param — local servers (LM Studio,
// llama.cpp, vLLM) typically accept any/no Bearer token. Optional token is
// forwarded if provided.
router.get(
  '/openaicompatible/models',
  asyncHandler(async (req, res) => {
    const baseURL = req.query.baseURL;
    const apiKey = req.query.apiKey || '';

    if (!baseURL) {
      return res.status(400).json({ error: 'baseURL query parameter is required' });
    }

    try {
      const provider = new OpenAICompatibleProvider({ baseURL, apiKey });
      const models = await provider.getAvailableModels();
      res.json({ models });
    } catch (error) {
      console.error('Failed to fetch OpenAI-compatible models:', error);
      res.status(502).json({
        error: 'Could not reach endpoint',
        message: `Could not reach OpenAI-compatible endpoint at ${baseURL}. Is it running?`,
        detail: error.message,
      });
    }
  }),
);

export default router;
