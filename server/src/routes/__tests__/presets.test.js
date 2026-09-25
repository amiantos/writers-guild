import { describe, it, expect, beforeEach, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the router
import presetsRouter from '../presets.js';
import { AIHordeProvider } from '../../services/providers/aihorde-provider.js';
import { OpenRouterProvider } from '../../services/providers/openrouter-provider.js';
import { OpenAIProvider } from '../../services/providers/openai-provider.js';
import { AnthropicProvider } from '../../services/providers/anthropic-provider.js';
import { DeepSeekProvider } from '../../services/providers/deepseek-provider.js';
import { KoboldCppProvider } from '../../services/providers/koboldcpp-provider.js';
import { OllamaProvider } from '../../services/providers/ollama-provider.js';
import { OpenAICompatibleProvider } from '../../services/providers/openai-compatible-provider.js';

describe('Presets API Routes', () => {
  let app;
  let tempDir;
  let fakeNow;
  let timeOffset = 0;

  function advanceTime(ms = 2 * 60 * 60 * 1000) {
    fakeNow += ms;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeAll(() => {
    // Create temp directory for test database - shared across all tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'presets-test-'));
  });

  afterAll(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    // Keep Date.now deterministic and unique per test to avoid cache bleed
    fakeNow = 1700000000000 + timeOffset++ * 10 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(fakeNow);

    // Create Express app with the router
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.use('/api/presets', presetsRouter);

    // Add error handler
    app.use((err, req, res, _next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error',
      });
    });
  });

  describe('GET / - List Presets', () => {
    it('should return presets array', async () => {
      const response = await request(app).get('/api/presets').expect(200);

      expect(response.body).toHaveProperty('presets');
      expect(Array.isArray(response.body.presets)).toBe(true);
    });
  });

  describe('POST / - Create Preset', () => {
    it('should create a new preset', async () => {
      const presetData = {
        name: 'New Preset',
        provider: 'deepseek',
        apiKey: 'sk-test-key',
        generationSettings: {
          maxTokens: 4000,
          temperature: 1.0,
        },
      };

      const response = await request(app).post('/api/presets').send(presetData).expect(201);

      expect(response.body.preset).toHaveProperty('id');
      expect(response.body.preset.name).toBe('New Preset');
      expect(response.body.preset.provider).toBe('deepseek');
    });

    it('should return 400 if name is missing', async () => {
      const response = await request(app)
        .post('/api/presets')
        .send({ provider: 'deepseek' })
        .expect(400);

      expect(response.body.error).toContain('name and provider are required');
    });

    it('should return 400 if provider is missing', async () => {
      const response = await request(app)
        .post('/api/presets')
        .send({ name: 'No Provider' })
        .expect(400);

      expect(response.body.error).toContain('name and provider are required');
    });
  });

  describe('GET /:id - Get Preset', () => {
    it('should return a preset by ID', async () => {
      // Create preset via API
      const createResponse = await request(app)
        .post('/api/presets')
        .send({
          name: 'Test Preset',
          provider: 'anthropic',
          apiKey: 'test-key',
        })
        .expect(201);

      const presetId = createResponse.body.preset.id;

      const response = await request(app).get(`/api/presets/${presetId}`).expect(200);

      expect(response.body.preset.name).toBe('Test Preset');
      expect(response.body.preset.provider).toBe('anthropic');
    });

    it('should return 500 for non-existent preset', async () => {
      await request(app).get('/api/presets/non-existent').expect(500);
    });
  });

  describe('PUT /:id - Update Preset', () => {
    let presetId;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/presets')
        .send({
          name: 'Original Name',
          provider: 'deepseek',
          apiKey: 'original-key',
        })
        .expect(201);

      presetId = createResponse.body.preset.id;
    });

    it('should update preset name', async () => {
      const response = await request(app)
        .put(`/api/presets/${presetId}`)
        .send({ name: 'Updated Name', provider: 'deepseek' })
        .expect(200);

      expect(response.body.preset.name).toBe('Updated Name');
    });

    it('should update preset provider', async () => {
      const response = await request(app)
        .put(`/api/presets/${presetId}`)
        .send({ name: 'Name', provider: 'openai', apiKey: 'sk-newkey' })
        .expect(200);

      expect(response.body.preset.provider).toBe('openai');
    });

    it('should return 404 for non-existent preset', async () => {
      const response = await request(app)
        .put('/api/presets/non-existent')
        .send({ name: 'Updated', provider: 'deepseek' })
        .expect(404);

      expect(response.body.error).toContain('Preset not found');
    });
  });

  describe('DELETE /:id - Delete Preset', () => {
    it('should delete a preset', async () => {
      const createResponse = await request(app)
        .post('/api/presets')
        .send({
          name: 'To Delete',
          provider: 'deepseek',
        })
        .expect(201);

      const presetId = createResponse.body.preset.id;

      const response = await request(app).delete(`/api/presets/${presetId}`).expect(200);

      expect(response.body.success).toBe(true);

      // Verify preset is deleted
      await request(app).get(`/api/presets/${presetId}`).expect(500);
    });

    it('should return 404 for non-existent preset', async () => {
      const response = await request(app).delete('/api/presets/non-existent').expect(404);

      expect(response.body.error).toContain('Preset not found');
    });
  });

  describe('GET /default/id - Get Default Preset ID', () => {
    it('should return null when no default is set', async () => {
      const response = await request(app).get('/api/presets/default/id').expect(200);

      expect(response.body.defaultPresetId).toBeNull();
    });

    it('should return the default preset ID', async () => {
      // Create preset via API
      const createResponse = await request(app)
        .post('/api/presets')
        .send({
          name: 'Default',
          provider: 'deepseek',
        })
        .expect(201);

      const presetId = createResponse.body.preset.id;

      // Set as default
      await request(app).put('/api/presets/default/id').send({ presetId }).expect(200);

      const response = await request(app).get('/api/presets/default/id').expect(200);

      expect(response.body.defaultPresetId).toBe(presetId);
    });
  });

  describe('PUT /default/id - Set Default Preset', () => {
    it('should set the default preset', async () => {
      const createResponse = await request(app)
        .post('/api/presets')
        .send({
          name: 'New Default',
          provider: 'deepseek',
        })
        .expect(201);

      const presetId = createResponse.body.preset.id;

      const response = await request(app)
        .put('/api/presets/default/id')
        .send({ presetId })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.defaultPresetId).toBe(presetId);
    });

    it('should return 400 if presetId is missing', async () => {
      const response = await request(app).put('/api/presets/default/id').send({}).expect(400);

      expect(response.body.error).toContain('Preset ID is required');
    });

    it('should return 404 for non-existent preset', async () => {
      const response = await request(app)
        .put('/api/presets/default/id')
        .send({ presetId: 'non-existent' })
        .expect(404);

      expect(response.body.error).toContain('Preset not found');
    });
  });

  describe('POST /initialize-defaults - Initialize Default Presets', () => {
    it('should create default presets', async () => {
      const response = await request(app).post('/api/presets/initialize-defaults').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.presets).toBeInstanceOf(Array);
      expect(response.body.presets.length).toBeGreaterThan(0);
    });
  });

  describe('GET /defaults/templates - Get Default Templates', () => {
    it('should return default prompt templates', async () => {
      const response = await request(app).get('/api/presets/defaults/templates').expect(200);

      expect(response.body).toHaveProperty('systemPrompt');
      expect(response.body).toHaveProperty('continue');
      expect(response.body).toHaveProperty('character');
      expect(response.body).toHaveProperty('instruction');
      expect(response.body).toHaveProperty('rewriteThirdPerson');
      expect(response.body).toHaveProperty('ideate');
      expect(response.body.chatSystemPrompt).toContain('=== MESSAGE STYLE ===');
      expect(response.body.chatReply).toContain('{{char}}');
    });
  });

  describe('GET /aihorde/models - Get AI Horde Models', () => {
    it('should return models and auto-selected models on success', async () => {
      const models = [
        { name: 'llama-3-70b', count: 5 },
        { name: 'qwen2.5-32b', count: 2 },
      ];
      const autoSelected = ['llama-3-70b'];

      vi.spyOn(AIHordeProvider.prototype, 'getAvailableModels').mockResolvedValue(models);
      vi.spyOn(AIHordeProvider.prototype, 'autoSelectModels').mockReturnValue(autoSelected);

      const response = await request(app).get('/api/presets/aihorde/models').expect(200);

      expect(response.body.cached).toBe(false);
      expect(response.body.models).toEqual(models);
      expect(response.body.autoSelected).toEqual(autoSelected);
    });

    it('should return cached models on second request', async () => {
      vi.spyOn(AIHordeProvider.prototype, 'getAvailableModels').mockResolvedValue([
        { name: 'llama-3-70b', count: 5 },
      ]);
      vi.spyOn(AIHordeProvider.prototype, 'autoSelectModels').mockReturnValue(['llama-3-70b']);

      const first = await request(app).get('/api/presets/aihorde/models').expect(200);
      expect(first.body.cached).toBe(false);

      const second = await request(app).get('/api/presets/aihorde/models').expect(200);
      expect(second.body.cached).toBe(true);
      expect(second.body).toHaveProperty('cacheAge');
    });

    it('should return 500 when provider fetch fails', async () => {
      vi.spyOn(AIHordeProvider.prototype, 'getAvailableModels').mockImplementation(() => {
        throw new Error('horde down');
      });

      const response = await request(app).get('/api/presets/aihorde/models').expect(500);

      expect(response.body.error).toContain('Failed to fetch models from AI Horde');
      expect(response.body.message).toBe('horde down');
    });
  });

  describe('GET /aihorde/workers - Get AI Horde Workers', () => {
    it('should return workers on success', async () => {
      const workers = [{ id: 'w1', online: true }];
      vi.spyOn(AIHordeProvider.prototype, 'getWorkerData').mockResolvedValue(workers);

      const response = await request(app).get('/api/presets/aihorde/workers').expect(200);

      expect(response.body.workers).toEqual(workers);
    });

    it('should return 500 when worker fetch fails', async () => {
      vi.spyOn(AIHordeProvider.prototype, 'getWorkerData').mockImplementation(() => {
        throw new Error('workers unavailable');
      });

      const response = await request(app).get('/api/presets/aihorde/workers').expect(500);

      expect(response.body.error).toContain('Failed to fetch workers from AI Horde');
      expect(response.body.message).toBe('workers unavailable');
    });
  });

  describe('GET /openrouter/models - Get OpenRouter Models', () => {
    it('should return 400 if API key is missing', async () => {
      const response = await request(app).get('/api/presets/openrouter/models').expect(400);

      expect(response.body.error).toContain('API key required');
    });

    it('should accept API key from x-api-key header', async () => {
      const models = [{ id: 'anthropic/claude-3.5-sonnet' }];
      vi.spyOn(OpenRouterProvider.prototype, 'getAvailableModels').mockResolvedValue(models);

      const response = await request(app)
        .get('/api/presets/openrouter/models')
        .set('x-api-key', 'or-key')
        .expect(200);

      expect(response.body.cached).toBe(false);
      expect(response.body.models).toEqual(models);
    });

    it('should return cached response within cache duration', async () => {
      vi.spyOn(OpenRouterProvider.prototype, 'getAvailableModels').mockResolvedValue([
        { id: 'm1' },
      ]);

      await request(app).get('/api/presets/openrouter/models?apiKey=or-key').expect(200);

      const response = await request(app)
        .get('/api/presets/openrouter/models?apiKey=or-key')
        .expect(200);

      expect(response.body.cached).toBe(true);
      expect(response.body).toHaveProperty('cacheAge');
    });

    it('should return 500 when provider errors', async () => {
      vi.spyOn(OpenRouterProvider.prototype, 'getAvailableModels').mockImplementation(() => {
        throw new Error('openrouter unavailable');
      });

      advanceTime(); // expire module-level cache

      const response = await request(app)
        .get('/api/presets/openrouter/models?apiKey=or-key')
        .expect(500);

      expect(response.body.error).toContain('Failed to fetch models from OpenRouter');
      expect(response.body.message).toBe('openrouter unavailable');
    });
  });

  describe('GET /openai/models - Get OpenAI Models', () => {
    it('should return 400 if API key is missing', async () => {
      const response = await request(app).get('/api/presets/openai/models').expect(400);

      expect(response.body.error).toContain('API key required');
    });

    it('should return models when API key is provided', async () => {
      const models = [{ id: 'gpt-4.1' }];
      vi.spyOn(OpenAIProvider.prototype, 'getAvailableModels').mockResolvedValue(models);

      const response = await request(app)
        .get('/api/presets/openai/models?apiKey=sk-test')
        .expect(200);

      expect(response.body.cached).toBe(false);
      expect(response.body.models).toEqual(models);
    });

    it('should return cached models on second request', async () => {
      vi.spyOn(OpenAIProvider.prototype, 'getAvailableModels').mockResolvedValue([
        { id: 'gpt-4.1' },
      ]);

      await request(app).get('/api/presets/openai/models?apiKey=sk-test').expect(200);

      const response = await request(app)
        .get('/api/presets/openai/models?apiKey=sk-test')
        .expect(200);

      expect(response.body.cached).toBe(true);
      expect(response.body).toHaveProperty('cacheAge');
    });

    it('should return 500 when provider errors', async () => {
      vi.spyOn(OpenAIProvider.prototype, 'getAvailableModels').mockImplementation(() => {
        throw new Error('openai down');
      });

      advanceTime(); // expire module-level cache

      const response = await request(app)
        .get('/api/presets/openai/models?apiKey=sk-test')
        .expect(500);

      expect(response.body.error).toContain('Failed to fetch models from OpenAI');
      expect(response.body.message).toBe('openai down');
    });
  });

  describe('GET /anthropic/models - Get Anthropic Models', () => {
    it('should return 400 if API key is missing', async () => {
      const response = await request(app).get('/api/presets/anthropic/models').expect(400);

      expect(response.body.error).toContain('API key required');
    });

    it('should return models when API key is provided', async () => {
      const models = [{ id: 'claude-3-5-sonnet-20241022' }];
      vi.spyOn(AnthropicProvider.prototype, 'getAvailableModels').mockResolvedValue(models);

      const response = await request(app)
        .get('/api/presets/anthropic/models?apiKey=ak-test')
        .expect(200);

      expect(response.body.cached).toBe(false);
      expect(response.body.models).toEqual(models);
    });

    it('should return cached models on second request', async () => {
      vi.spyOn(AnthropicProvider.prototype, 'getAvailableModels').mockResolvedValue([
        { id: 'claude-3-5-sonnet-20241022' },
      ]);

      await request(app).get('/api/presets/anthropic/models?apiKey=ak-test').expect(200);

      const response = await request(app)
        .get('/api/presets/anthropic/models?apiKey=ak-test')
        .expect(200);

      expect(response.body.cached).toBe(true);
      expect(response.body).toHaveProperty('cacheAge');
    });

    it('should return 500 when provider errors', async () => {
      vi.spyOn(AnthropicProvider.prototype, 'getAvailableModels').mockImplementation(() => {
        throw new Error('anthropic down');
      });

      advanceTime(); // expire module-level cache

      const response = await request(app)
        .get('/api/presets/anthropic/models?apiKey=ak-test')
        .expect(500);

      expect(response.body.error).toContain('Failed to fetch models from Anthropic');
      expect(response.body.message).toBe('anthropic down');
    });
  });

  describe('GET /deepseek/models - Get DeepSeek Models', () => {
    it('should return 400 if API key is missing', async () => {
      const response = await request(app).get('/api/presets/deepseek/models').expect(400);

      expect(response.body.error).toContain('API key required');
    });

    it('should return models when API key is provided', async () => {
      const models = [{ id: 'deepseek-v4-flash' }];
      vi.spyOn(DeepSeekProvider.prototype, 'getAvailableModels').mockResolvedValue(models);

      const response = await request(app)
        .get('/api/presets/deepseek/models?apiKey=ds-test')
        .expect(200);

      expect(response.body.cached).toBe(false);
      expect(response.body.models).toEqual(models);
    });

    it('should return cached models on second request', async () => {
      vi.spyOn(DeepSeekProvider.prototype, 'getAvailableModels').mockResolvedValue([
        { id: 'deepseek-v4-flash' },
      ]);

      await request(app).get('/api/presets/deepseek/models?apiKey=ds-test').expect(200);

      const response = await request(app)
        .get('/api/presets/deepseek/models?apiKey=ds-test')
        .expect(200);

      expect(response.body.cached).toBe(true);
      expect(response.body).toHaveProperty('cacheAge');
    });

    it('should return 500 when provider errors', async () => {
      vi.spyOn(DeepSeekProvider.prototype, 'getAvailableModels').mockImplementation(() => {
        throw new Error('deepseek down');
      });

      advanceTime(); // expire module-level cache

      const response = await request(app)
        .get('/api/presets/deepseek/models?apiKey=ds-test')
        .expect(500);

      expect(response.body.error).toContain('Failed to fetch models from DeepSeek');
      expect(response.body.message).toBe('deepseek down');
    });
  });

  describe('GET /koboldcpp/info - Inspect KoboldCpp Endpoint', () => {
    it('should return 400 when baseURL is missing', async () => {
      const response = await request(app).get('/api/presets/koboldcpp/info').expect(400);

      expect(response.body.error).toContain('baseURL query parameter is required');
    });

    it('should return endpoint info on success', async () => {
      const info = { model: 'L3', maxContextLength: 8192, maxLength: 256 };
      vi.spyOn(KoboldCppProvider.prototype, 'getEndpointInfo').mockResolvedValue(info);

      const response = await request(app)
        .get('/api/presets/koboldcpp/info?baseURL=http://localhost:5001')
        .expect(200);

      expect(response.body).toEqual(info);
    });

    it('should return 502 when endpoint cannot be reached', async () => {
      vi.spyOn(KoboldCppProvider.prototype, 'getEndpointInfo').mockImplementation(() => {
        throw new Error('connect ECONNREFUSED');
      });

      const response = await request(app)
        .get('/api/presets/koboldcpp/info?baseURL=http://localhost:5001')
        .expect(502);

      expect(response.body.error).toContain('Could not reach KoboldCpp');
      expect(response.body.detail).toContain('ECONNREFUSED');
    });
  });

  describe('GET /ollama/show - Inspect Ollama Model', () => {
    it('should return 400 when baseURL is missing', async () => {
      const response = await request(app).get('/api/presets/ollama/show?name=llama3').expect(400);

      expect(response.body.error).toContain('baseURL query parameter is required');
    });

    it('should return 400 when name is missing', async () => {
      const response = await request(app)
        .get('/api/presets/ollama/show?baseURL=http://localhost:11434')
        .expect(400);

      expect(response.body.error).toContain('name query parameter is required');
    });

    it('should return model info on success', async () => {
      const info = { contextLength: 8192, parameters: { temperature: 0.7 } };
      vi.spyOn(OllamaProvider.prototype, 'getModelInfo').mockResolvedValue(info);

      const response = await request(app)
        .get('/api/presets/ollama/show?baseURL=http://localhost:11434&name=llama3')
        .expect(200);

      expect(response.body).toEqual(info);
    });

    it('should return 502 when model info fetch fails', async () => {
      vi.spyOn(OllamaProvider.prototype, 'getModelInfo').mockImplementation(() => {
        throw new Error('model not found');
      });

      const response = await request(app)
        .get('/api/presets/ollama/show?baseURL=http://localhost:11434&name=missing')
        .expect(502);

      expect(response.body.error).toContain('Could not fetch model info');
      expect(response.body.detail).toContain('model not found');
    });
  });

  describe('GET /ollama/models - List Ollama Models', () => {
    it('should return 400 when baseURL is missing', async () => {
      const response = await request(app).get('/api/presets/ollama/models').expect(400);

      expect(response.body.error).toContain('baseURL query parameter is required');
    });

    it('should return models on success', async () => {
      const models = [{ name: 'llama3:8b' }];
      vi.spyOn(OllamaProvider.prototype, 'getAvailableModels').mockResolvedValue(models);

      const response = await request(app)
        .get('/api/presets/ollama/models?baseURL=http://localhost:11434')
        .expect(200);

      expect(response.body.models).toEqual(models);
    });

    it('should return 502 when endpoint cannot be reached', async () => {
      vi.spyOn(OllamaProvider.prototype, 'getAvailableModels').mockImplementation(() => {
        throw new Error('fetch failed');
      });

      const response = await request(app)
        .get('/api/presets/ollama/models?baseURL=http://localhost:11434')
        .expect(502);

      expect(response.body.error).toContain('Could not reach Ollama');
      expect(response.body.detail).toContain('fetch failed');
    });
  });

  describe('GET /openaicompatible/models - List OpenAI-Compatible Models', () => {
    it('should return 400 when baseURL is missing', async () => {
      const response = await request(app).get('/api/presets/openaicompatible/models').expect(400);

      expect(response.body.error).toContain('baseURL query parameter is required');
    });

    it('should return models on success', async () => {
      const models = [{ id: 'llama-3.1-8b-instruct' }];
      vi.spyOn(OpenAICompatibleProvider.prototype, 'getAvailableModels').mockResolvedValue(models);

      const response = await request(app)
        .get('/api/presets/openaicompatible/models?baseURL=http://localhost:1234/v1')
        .expect(200);

      expect(response.body.models).toEqual(models);
    });

    it('should return 502 when endpoint cannot be reached', async () => {
      vi.spyOn(OpenAICompatibleProvider.prototype, 'getAvailableModels').mockImplementation(() => {
        throw new Error('connect ECONNREFUSED');
      });

      const response = await request(app)
        .get('/api/presets/openaicompatible/models?baseURL=http://localhost:1234/v1')
        .expect(502);

      expect(response.body.error).toContain('Could not reach endpoint');
      expect(response.body.detail).toContain('ECONNREFUSED');
    });
  });
});
