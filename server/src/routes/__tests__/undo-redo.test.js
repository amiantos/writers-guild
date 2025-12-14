import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the router
import storiesRouter from '../stories.js';

describe('Undo/Redo API Routes', () => {
  let app;
  let tempDir;
  let storyId;

  beforeEach(async () => {
    // Create temp directory for test database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'undo-redo-test-'));

    // Create Express app with the router
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.use('/api/stories', storiesRouter);

    // Add error handler
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error'
      });
    });

    // Create a test story
    const response = await request(app)
      .post('/api/stories')
      .send({ title: 'Test Story', description: 'A test story' })
      .expect(201);

    storyId = response.body.story.id;
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('GET /:id/history/status', () => {
    it('should return canUndo: false and canRedo: false for new story', async () => {
      const response = await request(app)
        .get(`/api/stories/${storyId}/history/status`)
        .expect(200);

      expect(response.body.canUndo).toBe(false);
      expect(response.body.canRedo).toBe(false);
    });

    it('should return canUndo: true after content update', async () => {
      // Make first content change
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'First version' })
        .expect(200);

      // Make second content change
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Second version' })
        .expect(200);

      const response = await request(app)
        .get(`/api/stories/${storyId}/history/status`)
        .expect(200);

      expect(response.body.canUndo).toBe(true);
      expect(response.body.canRedo).toBe(false);
    });

    it('should return error for non-existent story', async () => {
      const response = await request(app)
        .get('/api/stories/non-existent-id/history/status')
        .expect(500);

      expect(response.body.error).toContain('Story not found');
    });
  });

  describe('PUT /:id/content - history integration', () => {
    it('should include history status in response', async () => {
      const response = await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Some content' })
        .expect(200);

      expect(response.body).toHaveProperty('canUndo');
      expect(response.body).toHaveProperty('canRedo');
    });

    it('should not create duplicate history entries for same content', async () => {
      // Save same content multiple times
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Same content' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Same content' })
        .expect(200);

      // canUndo should still be false because no actual change occurred
      const response = await request(app)
        .get(`/api/stories/${storyId}/history/status`)
        .expect(200);

      expect(response.body.canUndo).toBe(false);
    });
  });

  describe('POST /:id/undo', () => {
    it('should return error when nothing to undo', async () => {
      const response = await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(400);

      expect(response.body.error).toBe('Nothing to undo');
    });

    it('should undo to previous content version', async () => {
      // Create history
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'First version' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Second version' })
        .expect(200);

      // Undo
      const response = await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(200);

      expect(response.body.content).toBe('First version');
      expect(response.body.canUndo).toBe(false);
      expect(response.body.canRedo).toBe(true);
    });

    it('should update story content when undoing', async () => {
      // Create history
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'First version' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Second version' })
        .expect(200);

      // Undo
      await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(200);

      // Verify story content is updated
      const storyResponse = await request(app)
        .get(`/api/stories/${storyId}`)
        .expect(200);

      expect(storyResponse.body.story.content).toBe('First version');
    });

    it('should support multiple undos', async () => {
      // Create history
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Version 1' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Version 2' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Version 3' })
        .expect(200);

      // Undo twice
      let response = await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(200);

      expect(response.body.content).toBe('Version 2');
      expect(response.body.canUndo).toBe(true);

      response = await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(200);

      expect(response.body.content).toBe('Version 1');
      expect(response.body.canUndo).toBe(false);
    });

    it('should return error for non-existent story', async () => {
      const response = await request(app)
        .post('/api/stories/non-existent-id/undo')
        .expect(500);

      expect(response.body.error).toContain('Story not found');
    });
  });

  describe('POST /:id/redo', () => {
    it('should return error when nothing to redo', async () => {
      const response = await request(app)
        .post(`/api/stories/${storyId}/redo`)
        .expect(400);

      expect(response.body.error).toBe('Nothing to redo');
    });

    it('should redo after undo', async () => {
      // Create history
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'First version' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Second version' })
        .expect(200);

      // Undo
      await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(200);

      // Redo
      const response = await request(app)
        .post(`/api/stories/${storyId}/redo`)
        .expect(200);

      expect(response.body.content).toBe('Second version');
      expect(response.body.canUndo).toBe(true);
      expect(response.body.canRedo).toBe(false);
    });

    it('should update story content when redoing', async () => {
      // Create history
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'First version' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Second version' })
        .expect(200);

      // Undo
      await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(200);

      // Redo
      await request(app)
        .post(`/api/stories/${storyId}/redo`)
        .expect(200);

      // Verify story content is updated
      const storyResponse = await request(app)
        .get(`/api/stories/${storyId}`)
        .expect(200);

      expect(storyResponse.body.story.content).toBe('Second version');
    });

    it('should support multiple redos', async () => {
      // Create history
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Version 1' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Version 2' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Version 3' })
        .expect(200);

      // Undo twice
      await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(200);

      await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(200);

      // Redo twice
      let response = await request(app)
        .post(`/api/stories/${storyId}/redo`)
        .expect(200);

      expect(response.body.content).toBe('Version 2');
      expect(response.body.canRedo).toBe(true);

      response = await request(app)
        .post(`/api/stories/${storyId}/redo`)
        .expect(200);

      expect(response.body.content).toBe('Version 3');
      expect(response.body.canRedo).toBe(false);
    });

    it('should return error for non-existent story', async () => {
      const response = await request(app)
        .post('/api/stories/non-existent-id/redo')
        .expect(500);

      expect(response.body.error).toContain('Story not found');
    });
  });

  describe('Undo/Redo workflow', () => {
    it('should clear redo history when making new edit after undo', async () => {
      // Create history
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Version 1' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Version 2' })
        .expect(200);

      // Undo
      await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(200);

      // Make new edit
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'New version' })
        .expect(200);

      // Redo should now fail - redo history was cleared
      const response = await request(app)
        .post(`/api/stories/${storyId}/redo`)
        .expect(400);

      expect(response.body.error).toBe('Nothing to redo');
    });

    it('should handle undo, redo, undo, new edit workflow', async () => {
      // Create history
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'V1' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'V2' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'V3' })
        .expect(200);

      // Undo twice
      await request(app).post(`/api/stories/${storyId}/undo`).expect(200);
      await request(app).post(`/api/stories/${storyId}/undo`).expect(200);

      // Redo once
      await request(app).post(`/api/stories/${storyId}/redo`).expect(200);

      // Verify we're at V2
      let storyResponse = await request(app).get(`/api/stories/${storyId}`).expect(200);
      expect(storyResponse.body.story.content).toBe('V2');

      // Make new edit - should clear V3 from redo history
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'V4' })
        .expect(200);

      // Redo should fail
      await request(app).post(`/api/stories/${storyId}/redo`).expect(400);

      // But undo should work (V2 -> V1)
      const undoResponse = await request(app).post(`/api/stories/${storyId}/undo`).expect(200);
      expect(undoResponse.body.content).toBe('V2');
    });
  });

  describe('Edge cases', () => {
    it('should return nothing to undo when already at oldest entry', async () => {
      // Create history with just one entry
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Only version' })
        .expect(200);

      // First undo attempt should fail (only one version, nothing before it)
      const response = await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(400);

      expect(response.body.error).toBe('Nothing to undo');
    });

    it('should return nothing to undo after undoing to oldest entry', async () => {
      // Create two versions
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Version 1' })
        .expect(200);

      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Version 2' })
        .expect(200);

      // Undo once (to Version 1)
      await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(200);

      // Try to undo again - should fail, already at oldest
      const response = await request(app)
        .post(`/api/stories/${storyId}/undo`)
        .expect(400);

      expect(response.body.error).toBe('Nothing to undo');
    });

    it('should return nothing to redo when no redo history exists', async () => {
      // Create a version
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Some content' })
        .expect(200);

      // Try to redo without any prior undo
      const response = await request(app)
        .post(`/api/stories/${storyId}/redo`)
        .expect(400);

      expect(response.body.error).toBe('Nothing to redo');
    });
  });

  describe('History limits', () => {
    it('should limit history to 50 entries (prune oldest)', async () => {
      // Create 55 versions
      for (let i = 1; i <= 55; i++) {
        await request(app)
          .put(`/api/stories/${storyId}/content`)
          .send({ content: `Version ${i}` })
          .expect(200);
      }

      // Should be able to undo up to 50 times (or until we hit the limit)
      let undoCount = 0;
      let canUndo = true;

      while (canUndo && undoCount < 60) {
        const response = await request(app)
          .post(`/api/stories/${storyId}/undo`);

        if (response.status === 400) {
          canUndo = false;
        } else {
          undoCount++;
          canUndo = response.body.canUndo;
        }
      }

      // Should have been able to undo approximately 49 times
      // (50 entries minus the current position)
      expect(undoCount).toBeLessThanOrEqual(50);
      expect(undoCount).toBeGreaterThan(40); // At least 40 undos should work
    });
  });
});
