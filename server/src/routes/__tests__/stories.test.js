import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the router
import storiesRouter from '../stories.js';

describe('Stories API Routes - CRUD Operations', () => {
  let app;
  let tempDir;

  beforeAll(() => {
    // Create temp directory for test database - shared across all tests in this file
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stories-test-'));
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
    app.use('/api/stories', storiesRouter);

    // Add error handler
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error'
      });
    });
  });

  describe('GET / - List Stories', () => {
    it('should return stories array', async () => {
      const response = await request(app)
        .get('/api/stories')
        .expect(200);

      expect(response.body).toHaveProperty('stories');
      expect(Array.isArray(response.body.stories)).toBe(true);
    });
  });

  describe('POST / - Create Story', () => {
    it('should create a new story with title and description', async () => {
      const response = await request(app)
        .post('/api/stories')
        .send({ title: 'My New Story', description: 'A great adventure' })
        .expect(201);

      expect(response.body).toHaveProperty('story');
      expect(response.body.story.title).toBe('My New Story');
      expect(response.body.story.description).toBe('A great adventure');
      expect(response.body.story).toHaveProperty('id');
    });

    it('should create a story with just a title', async () => {
      const response = await request(app)
        .post('/api/stories')
        .send({ title: 'Minimal Story' })
        .expect(201);

      expect(response.body.story.title).toBe('Minimal Story');
      expect(response.body.story.description).toBe('');
    });

    it('should trim whitespace from title and description', async () => {
      const response = await request(app)
        .post('/api/stories')
        .send({ title: '  Trimmed Title  ', description: '  Trimmed Desc  ' })
        .expect(201);

      expect(response.body.story.title).toBe('Trimmed Title');
      expect(response.body.story.description).toBe('Trimmed Desc');
    });

    it('should return 400 if title is missing', async () => {
      const response = await request(app)
        .post('/api/stories')
        .send({ description: 'No title provided' })
        .expect(400);

      expect(response.body.error).toContain('Title is required');
    });

    it('should return 400 if title is empty', async () => {
      const response = await request(app)
        .post('/api/stories')
        .send({ title: '   ' })
        .expect(400);

      expect(response.body.error).toContain('Title is required');
    });

    it('should create story with needsRewritePrompt flag', async () => {
      const response = await request(app)
        .post('/api/stories')
        .send({ title: 'First Person Story', needsRewritePrompt: true })
        .expect(201);

      expect(response.body.story.needsRewritePrompt).toBe(true);
    });
  });

  describe('GET /:id - Get Story', () => {
    it('should return a story by ID', async () => {
      // First create a story via API
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Test Story', description: 'Test Description' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .get(`/api/stories/${storyId}`)
        .expect(200);

      expect(response.body.story.id).toBe(storyId);
      expect(response.body.story.title).toBe('Test Story');
    });

    it('should return 500 for non-existent story', async () => {
      await request(app)
        .get('/api/stories/non-existent-id')
        .expect(500);
    });
  });

  describe('PUT /:id - Update Story Metadata', () => {
    it('should update story title', async () => {
      // Create story via API
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Original Title', description: 'Description' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .put(`/api/stories/${storyId}`)
        .send({ title: 'Updated Title' })
        .expect(200);

      expect(response.body.story.title).toBe('Updated Title');
    });

    it('should update story description', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Original Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .put(`/api/stories/${storyId}`)
        .send({ description: 'Updated Description' })
        .expect(200);

      expect(response.body.story.description).toBe('Updated Description');
    });

    it('should update multiple fields at once', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Old Title', description: 'Old Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .put(`/api/stories/${storyId}`)
        .send({ title: 'New Title', description: 'New Desc' })
        .expect(200);

      expect(response.body.story.title).toBe('New Title');
      expect(response.body.story.description).toBe('New Desc');
    });

    it('should return 400 if no updates provided', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .put(`/api/stories/${storyId}`)
        .send({})
        .expect(400);

      expect(response.body.error).toContain('No updates provided');
    });

    it('should update configPresetId', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;
      const presetId = 'test-preset-id';

      const response = await request(app)
        .put(`/api/stories/${storyId}`)
        .send({ configPresetId: presetId })
        .expect(200);

      expect(response.body.story.configPresetId).toBe(presetId);
    });
  });

  describe('PUT /:id/content - Update Story Content', () => {
    it('should update story content successfully', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'New story content here.' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body).toHaveProperty('modified');
    });

    it('should return 400 if content is not provided', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({})
        .expect(400);

      expect(response.body.error).toContain('Content is required');
    });

    it('should allow empty content', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      // First set some content
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Some content' })
        .expect(200);

      // Then clear it
      const response = await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: '' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return history status after update', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'New content' })
        .expect(200);

      expect(response.body).toHaveProperty('canUndo');
      expect(response.body).toHaveProperty('canRedo');
    });
  });

  describe('DELETE /:id - Delete Story', () => {
    it('should delete a story', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'To Delete', description: 'Will be deleted' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .delete(`/api/stories/${storyId}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify story is no longer accessible
      await request(app)
        .get(`/api/stories/${storyId}`)
        .expect(500);
    });
  });

  describe('POST /:id/rewrite-prompt - Set Rewrite Flag', () => {
    it('should set rewrite prompt flag to true', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .post(`/api/stories/${storyId}/rewrite-prompt`)
        .send({ value: true })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should set rewrite prompt flag to false', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc', needsRewritePrompt: true })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .post(`/api/stories/${storyId}/rewrite-prompt`)
        .send({ value: false })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /:id/history/status - History Status', () => {
    it('should return history status for a story', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      // Add some content to create history
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Some content' })
        .expect(200);

      const response = await request(app)
        .get(`/api/stories/${storyId}/history/status`)
        .expect(200);

      expect(response.body).toHaveProperty('canUndo');
      expect(response.body).toHaveProperty('canRedo');
    });
  });

  // Note: Story-persona, story-character, and story-lorebook association tests
  // require characters and lorebooks to be created first via their respective APIs.
  // These integration tests are covered in sqliteStorage.test.js.
});
