import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the router
import presetsRouter from '../presets.js';

describe('Presets API Routes', () => {
  let app;
  let tempDir;

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
    // Create Express app with the router
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.use('/api/presets', presetsRouter);

    // Add error handler
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error'
      });
    });
  });

  describe('GET / - List Presets', () => {
    it('should return presets array', async () => {
      const response = await request(app)
        .get('/api/presets')
        .expect(200);

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
          temperature: 1.0
        }
      };

      const response = await request(app)
        .post('/api/presets')
        .send(presetData)
        .expect(201);

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
          apiKey: 'test-key'
        })
        .expect(201);

      const presetId = createResponse.body.preset.id;

      const response = await request(app)
        .get(`/api/presets/${presetId}`)
        .expect(200);

      expect(response.body.preset.name).toBe('Test Preset');
      expect(response.body.preset.provider).toBe('anthropic');
    });

    it('should return 500 for non-existent preset', async () => {
      await request(app)
        .get('/api/presets/non-existent')
        .expect(500);
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
          apiKey: 'original-key'
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
          provider: 'deepseek'
        })
        .expect(201);

      const presetId = createResponse.body.preset.id;

      const response = await request(app)
        .delete(`/api/presets/${presetId}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify preset is deleted
      await request(app)
        .get(`/api/presets/${presetId}`)
        .expect(500);
    });

    it('should return 404 for non-existent preset', async () => {
      const response = await request(app)
        .delete('/api/presets/non-existent')
        .expect(404);

      expect(response.body.error).toContain('Preset not found');
    });
  });

  describe('GET /default/id - Get Default Preset ID', () => {
    it('should return null when no default is set', async () => {
      const response = await request(app)
        .get('/api/presets/default/id')
        .expect(200);

      expect(response.body.defaultPresetId).toBeNull();
    });

    it('should return the default preset ID', async () => {
      // Create preset via API
      const createResponse = await request(app)
        .post('/api/presets')
        .send({
          name: 'Default',
          provider: 'deepseek'
        })
        .expect(201);

      const presetId = createResponse.body.preset.id;

      // Set as default
      await request(app)
        .put('/api/presets/default/id')
        .send({ presetId })
        .expect(200);

      const response = await request(app)
        .get('/api/presets/default/id')
        .expect(200);

      expect(response.body.defaultPresetId).toBe(presetId);
    });
  });

  describe('PUT /default/id - Set Default Preset', () => {
    it('should set the default preset', async () => {
      const createResponse = await request(app)
        .post('/api/presets')
        .send({
          name: 'New Default',
          provider: 'deepseek'
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
      const response = await request(app)
        .put('/api/presets/default/id')
        .send({})
        .expect(400);

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
      const response = await request(app)
        .post('/api/presets/initialize-defaults')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.presets).toBeInstanceOf(Array);
      expect(response.body.presets.length).toBeGreaterThan(0);
    });
  });

  describe('GET /defaults/templates - Get Default Templates', () => {
    it('should return default prompt templates', async () => {
      const response = await request(app)
        .get('/api/presets/defaults/templates')
        .expect(200);

      expect(response.body).toHaveProperty('systemPrompt');
      expect(response.body).toHaveProperty('continue');
      expect(response.body).toHaveProperty('character');
      expect(response.body).toHaveProperty('instruction');
      expect(response.body).toHaveProperty('rewriteThirdPerson');
      expect(response.body).toHaveProperty('ideate');
    });
  });

  describe('GET /aihorde/models - Get AI Horde Models', () => {
    it('should return models list', async () => {
      // This test may fail in isolation if AI Horde API is unavailable
      // In a real test environment, you'd mock the external API call
      const response = await request(app)
        .get('/api/presets/aihorde/models');

      // Either success or error response is acceptable for this test
      expect([200, 500]).toContain(response.status);

      if (response.status === 200) {
        expect(response.body).toHaveProperty('models');
        expect(response.body.models).toBeInstanceOf(Array);
      }
    });
  });

  describe('GET /openai/models - Get OpenAI Models', () => {
    it('should return 400 if API key is missing', async () => {
      const response = await request(app)
        .get('/api/presets/openai/models')
        .expect(400);

      expect(response.body.error).toContain('API key required');
    });
  });

  describe('GET /anthropic/models - Get Anthropic Models', () => {
    it('should return 400 if API key is missing', async () => {
      const response = await request(app)
        .get('/api/presets/anthropic/models')
        .expect(400);

      expect(response.body.error).toContain('API key required');
    });
  });

  describe('GET /deepseek/models - Get DeepSeek Models', () => {
    it('should return 400 if API key is missing', async () => {
      const response = await request(app)
        .get('/api/presets/deepseek/models')
        .expect(400);

      expect(response.body.error).toContain('API key required');
    });
  });

  describe('GET /openrouter/models - Get OpenRouter Models', () => {
    it('should return 400 if API key is missing', async () => {
      const response = await request(app)
        .get('/api/presets/openrouter/models')
        .expect(400);

      expect(response.body.error).toContain('API key required');
    });
  });
});
