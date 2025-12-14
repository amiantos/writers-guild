import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the router
import settingsRouter from '../settings.js';

describe('Settings API Routes', () => {
  let app;
  let tempDir;

  beforeAll(() => {
    // Create temp directory for test database - shared across all tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-'));
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
    app.use('/api/settings', settingsRouter);

    // Add error handler
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error'
      });
    });
  });

  describe('GET / - Get Settings', () => {
    it('should return settings object', async () => {
      const response = await request(app)
        .get('/api/settings')
        .expect(200);

      expect(response.body).toHaveProperty('settings');
      // Settings should be an object (may be empty or have defaults)
      expect(typeof response.body.settings).toBe('object');
    });
  });

  describe('PUT / - Update Settings', () => {
    it('should update API key', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ apiKey: 'new-api-key' })
        .expect(200);

      expect(response.body.settings.apiKey).toBe('new-api-key');
    });

    it('should update maxTokens', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ maxTokens: 6000 })
        .expect(200);

      expect(response.body.settings.maxTokens).toBe(6000);
    });

    it('should update temperature', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ temperature: 0.8 })
        .expect(200);

      expect(response.body.settings.temperature).toBe(0.8);
    });

    it('should update showReasoning boolean', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ showReasoning: true })
        .expect(200);

      expect(response.body.settings.showReasoning).toBe(true);
    });

    it('should update autoSave boolean', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ autoSave: false })
        .expect(200);

      expect(response.body.settings.autoSave).toBe(false);
    });

    it('should update showPrompt boolean', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ showPrompt: true })
        .expect(200);

      expect(response.body.settings.showPrompt).toBe(true);
    });

    it('should update thirdPerson boolean', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ thirdPerson: true })
        .expect(200);

      expect(response.body.settings.thirdPerson).toBe(true);
    });

    it('should update filterAsterisks boolean', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ filterAsterisks: false })
        .expect(200);

      expect(response.body.settings.filterAsterisks).toBe(false);
    });

    it('should update includeDialogueExamples boolean', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ includeDialogueExamples: false })
        .expect(200);

      expect(response.body.settings.includeDialogueExamples).toBe(false);
    });

    it('should update lorebook settings', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({
          lorebookScanDepth: 3000,
          lorebookTokenBudget: 2500,
          lorebookRecursionDepth: 5,
          lorebookEnableRecursion: false
        })
        .expect(200);

      expect(response.body.settings.lorebookScanDepth).toBe(3000);
      expect(response.body.settings.lorebookTokenBudget).toBe(2500);
      expect(response.body.settings.lorebookRecursionDepth).toBe(5);
      expect(response.body.settings.lorebookEnableRecursion).toBe(false);
    });

    it('should update defaultPersonaId', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ defaultPersonaId: 'persona-123' })
        .expect(200);

      expect(response.body.settings.defaultPersonaId).toBe('persona-123');
    });

    it('should clear defaultPersonaId with null', async () => {
      // First set a persona
      await request(app)
        .put('/api/settings')
        .send({ defaultPersonaId: 'persona-123' })
        .expect(200);

      // Then clear it
      const response = await request(app)
        .put('/api/settings')
        .send({ defaultPersonaId: null })
        .expect(200);

      expect(response.body.settings.defaultPersonaId).toBeNull();
    });

    it('should update onboardingCompleted', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ onboardingCompleted: true })
        .expect(200);

      expect(response.body.settings.onboardingCompleted).toBe(true);
    });

    it('should update multiple settings at once', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({
          apiKey: 'multi-update-key',
          maxTokens: 5000,
          temperature: 1.0,
          showReasoning: true,
          autoSave: true
        })
        .expect(200);

      expect(response.body.settings.apiKey).toBe('multi-update-key');
      expect(response.body.settings.maxTokens).toBe(5000);
      expect(response.body.settings.temperature).toBe(1.0);
      expect(response.body.settings.showReasoning).toBe(true);
      expect(response.body.settings.autoSave).toBe(true);
    });

    it('should preserve existing settings when updating', async () => {
      // Get current settings first
      const currentResponse = await request(app)
        .get('/api/settings')
        .expect(200);

      const currentApiKey = currentResponse.body.settings.apiKey;

      // Update only temperature - other settings should be preserved
      const response = await request(app)
        .put('/api/settings')
        .send({ temperature: 1.5 })
        .expect(200);

      // apiKey should be preserved from before
      expect(response.body.settings.apiKey).toBe(currentApiKey);
      expect(response.body.settings.temperature).toBe(1.5);
    });

    it('should handle invalid maxTokens gracefully', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ maxTokens: 'not-a-number' })
        .expect(200);

      // Should fall back to default value (4000) when parsing fails
      expect(typeof response.body.settings.maxTokens).toBe('number');
    });

    it('should handle invalid temperature gracefully', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ temperature: 'not-a-number' })
        .expect(200);

      // Should fall back to default value (1.5) when parsing fails
      expect(typeof response.body.settings.temperature).toBe('number');
    });

    it('should handle empty update', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({})
        .expect(200);

      expect(response.body).toHaveProperty('settings');
    });
  });
});
