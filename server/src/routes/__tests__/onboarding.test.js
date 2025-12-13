import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { SqliteStorageService } from '../../services/sqliteStorage.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the router
import onboardingRouter from '../onboarding.js';

describe('Onboarding API Routes', () => {
  let app;
  let tempDir;
  let storage;

  beforeEach(() => {
    // Create temp directory for test database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-test-'));

    // Create Express app with the router
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.use('/api/onboarding', onboardingRouter);

    // Add error handler
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error'
      });
    });
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('GET /status', () => {
    it('should return onboardingCompleted as false for fresh install', async () => {
      const response = await request(app)
        .get('/api/onboarding/status')
        .expect(200);

      expect(response.body).toHaveProperty('onboardingCompleted');
      expect(response.body.onboardingCompleted).toBe(false);
    });

    it('should return onboardingCompleted as true after completing onboarding', async () => {
      // Complete onboarding first
      await request(app)
        .post('/api/onboarding/complete')
        .expect(200);

      // Check status
      const response = await request(app)
        .get('/api/onboarding/status')
        .expect(200);

      expect(response.body.onboardingCompleted).toBe(true);
    });
  });

  describe('POST /persona', () => {
    it('should create a persona with valid data', async () => {
      const response = await request(app)
        .post('/api/onboarding/persona')
        .send({ firstName: 'John', description: 'A test user' })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('John');
      expect(response.body.description).toBe('A test user');
    });

    it('should create a persona with just firstName', async () => {
      const response = await request(app)
        .post('/api/onboarding/persona')
        .send({ firstName: 'Jane' })
        .expect(201);

      expect(response.body.name).toBe('Jane');
      expect(response.body.description).toBe('');
    });

    it('should trim whitespace from firstName', async () => {
      const response = await request(app)
        .post('/api/onboarding/persona')
        .send({ firstName: '  Alice  ', description: '  A user  ' })
        .expect(201);

      expect(response.body.name).toBe('Alice');
      expect(response.body.description).toBe('A user');
    });

    it('should return 400 if firstName is missing', async () => {
      const response = await request(app)
        .post('/api/onboarding/persona')
        .send({ description: 'A test user' })
        .expect(400);

      expect(response.body.error).toContain('First name is required');
    });

    it('should return 400 if firstName is empty', async () => {
      const response = await request(app)
        .post('/api/onboarding/persona')
        .send({ firstName: '   ', description: 'A test user' })
        .expect(400);

      expect(response.body.error).toContain('First name is required');
    });

    it('should set the created persona as default', async () => {
      // Create persona
      const personaResponse = await request(app)
        .post('/api/onboarding/persona')
        .send({ firstName: 'Bob' })
        .expect(201);

      // Verify it's set as default by checking storage
      const storage = new SqliteStorageService(tempDir);
      const settings = await storage.getSettings();
      storage.close();

      expect(settings.defaultPersonaId).toBe(personaResponse.body.id);
    });
  });

  describe('POST /preset', () => {
    it('should create a DeepSeek preset', async () => {
      const response = await request(app)
        .post('/api/onboarding/preset')
        .send({ provider: 'deepseek', apiKey: 'sk-test-key' })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('DeepSeek');
      expect(response.body.provider).toBe('deepseek');
    });

    it('should create an OpenAI preset', async () => {
      const response = await request(app)
        .post('/api/onboarding/preset')
        .send({ provider: 'openai', apiKey: 'sk-test-key' })
        .expect(201);

      expect(response.body.name).toBe('OpenAI');
      expect(response.body.provider).toBe('openai');
    });

    it('should create an Anthropic preset', async () => {
      const response = await request(app)
        .post('/api/onboarding/preset')
        .send({ provider: 'anthropic', apiKey: 'sk-ant-test' })
        .expect(201);

      expect(response.body.name).toBe('Anthropic');
      expect(response.body.provider).toBe('anthropic');
    });

    it('should create an OpenRouter preset', async () => {
      const response = await request(app)
        .post('/api/onboarding/preset')
        .send({ provider: 'openrouter', apiKey: 'sk-or-test' })
        .expect(201);

      expect(response.body.name).toBe('OpenRouter');
      expect(response.body.provider).toBe('openrouter');
    });

    it('should create an AI Horde preset without API key', async () => {
      const response = await request(app)
        .post('/api/onboarding/preset')
        .send({ provider: 'aihorde' })
        .expect(201);

      expect(response.body.name).toBe('AI Horde');
      expect(response.body.provider).toBe('aihorde');
    });

    it('should create an AI Horde preset with optional API key', async () => {
      const response = await request(app)
        .post('/api/onboarding/preset')
        .send({ provider: 'aihorde', apiKey: 'my-horde-key' })
        .expect(201);

      expect(response.body.provider).toBe('aihorde');
    });

    it('should return 400 if provider is missing', async () => {
      const response = await request(app)
        .post('/api/onboarding/preset')
        .send({ apiKey: 'test-key' })
        .expect(400);

      expect(response.body.error).toContain('Provider is required');
    });

    it('should return 400 if provider is invalid', async () => {
      const response = await request(app)
        .post('/api/onboarding/preset')
        .send({ provider: 'invalid-provider', apiKey: 'test-key' })
        .expect(400);

      expect(response.body.error).toContain('Invalid provider');
    });

    it('should return 400 if API key is missing for non-aihorde provider', async () => {
      const response = await request(app)
        .post('/api/onboarding/preset')
        .send({ provider: 'deepseek' })
        .expect(400);

      expect(response.body.error).toContain('API key is required');
    });

    it('should return 400 if API key is empty for non-aihorde provider', async () => {
      const response = await request(app)
        .post('/api/onboarding/preset')
        .send({ provider: 'openai', apiKey: '   ' })
        .expect(400);

      expect(response.body.error).toContain('API key is required');
    });

    it('should set the created preset as default', async () => {
      // Create preset
      const presetResponse = await request(app)
        .post('/api/onboarding/preset')
        .send({ provider: 'deepseek', apiKey: 'test-key' })
        .expect(201);

      // Verify it's set as default
      const storage = new SqliteStorageService(tempDir);
      const defaultId = await storage.getDefaultPresetId();
      storage.close();

      expect(defaultId).toBe(presetResponse.body.id);
    });
  });

  describe('POST /complete', () => {
    it('should mark onboarding as completed', async () => {
      const response = await request(app)
        .post('/api/onboarding/complete')
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify status changed
      const statusResponse = await request(app)
        .get('/api/onboarding/status')
        .expect(200);

      expect(statusResponse.body.onboardingCompleted).toBe(true);
    });
  });

  describe('POST /skip', () => {
    it('should mark onboarding as completed', async () => {
      const response = await request(app)
        .post('/api/onboarding/skip')
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify status changed
      const statusResponse = await request(app)
        .get('/api/onboarding/status')
        .expect(200);

      expect(statusResponse.body.onboardingCompleted).toBe(true);
    });

    it('should create a default AI Horde preset if no presets exist', async () => {
      await request(app)
        .post('/api/onboarding/skip')
        .expect(200);

      // Verify a preset was created
      const storage = new SqliteStorageService(tempDir);
      const presets = await storage.listPresets();
      const defaultId = await storage.getDefaultPresetId();
      storage.close();

      expect(presets.length).toBe(1);
      expect(presets[0].provider).toBe('aihorde');
      expect(defaultId).toBe(presets[0].id);
    });

    it('should not create a preset if one already exists', async () => {
      // Create a preset first
      await request(app)
        .post('/api/onboarding/preset')
        .send({ provider: 'deepseek', apiKey: 'test-key' })
        .expect(201);

      // Skip onboarding
      await request(app)
        .post('/api/onboarding/skip')
        .expect(200);

      // Verify only one preset exists
      const storage = new SqliteStorageService(tempDir);
      const presets = await storage.listPresets();
      storage.close();

      expect(presets.length).toBe(1);
      expect(presets[0].provider).toBe('deepseek');
    });
  });

  describe('POST /import-defaults', () => {
    it('should return import results', async () => {
      const response = await request(app)
        .post('/api/onboarding/import-defaults')
        .expect(200);

      expect(response.body).toHaveProperty('importedCharacters');
      expect(response.body).toHaveProperty('createdStories');
      expect(response.body).toHaveProperty('characters');
      expect(response.body).toHaveProperty('stories');
      expect(typeof response.body.importedCharacters).toBe('number');
      expect(typeof response.body.createdStories).toBe('number');
    });

    it('should set default persona on imported stories if persona exists', async () => {
      // Create persona first
      const personaResponse = await request(app)
        .post('/api/onboarding/persona')
        .send({ firstName: 'TestUser' })
        .expect(201);

      // Import defaults
      const importResponse = await request(app)
        .post('/api/onboarding/import-defaults')
        .expect(200);

      // Verify stories have the persona set
      if (importResponse.body.stories.length > 0) {
        const storage = new SqliteStorageService(tempDir);
        const story = await storage.getStory(importResponse.body.stories[0].id);
        storage.close();

        expect(story.personaCharacterId).toBe(personaResponse.body.id);
      }
    });
  });

  describe('Full Onboarding Flow', () => {
    it('should complete a full onboarding flow', async () => {
      // Step 1: Check initial status
      let statusResponse = await request(app)
        .get('/api/onboarding/status')
        .expect(200);
      expect(statusResponse.body.onboardingCompleted).toBe(false);

      // Step 2: Create persona
      const personaResponse = await request(app)
        .post('/api/onboarding/persona')
        .send({ firstName: 'TestUser', description: 'A test persona' })
        .expect(201);
      expect(personaResponse.body.name).toBe('TestUser');

      // Step 3: Create preset
      const presetResponse = await request(app)
        .post('/api/onboarding/preset')
        .send({ provider: 'deepseek', apiKey: 'sk-test-key' })
        .expect(201);
      expect(presetResponse.body.provider).toBe('deepseek');

      // Step 4: Import defaults
      const importResponse = await request(app)
        .post('/api/onboarding/import-defaults')
        .expect(200);
      expect(importResponse.body.importedCharacters).toBeGreaterThanOrEqual(0);

      // Step 5: Complete onboarding
      await request(app)
        .post('/api/onboarding/complete')
        .expect(200);

      // Verify final status
      statusResponse = await request(app)
        .get('/api/onboarding/status')
        .expect(200);
      expect(statusResponse.body.onboardingCompleted).toBe(true);
    });
  });
});
