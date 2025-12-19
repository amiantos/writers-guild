import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the routers
import storiesRouter from '../stories.js';
import charactersRouter from '../characters.js';

// Shared temp directory for all tests in this file
// (Required because routers use module-level storage that persists across tests)
let sharedTempDir;

beforeAll(() => {
  sharedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stories-all-tests-'));
});

afterAll(() => {
  if (sharedTempDir && fs.existsSync(sharedTempDir)) {
    fs.rmSync(sharedTempDir, { recursive: true, force: true });
  }
});

describe('Stories API Routes - CRUD Operations', () => {
  let app;

  beforeEach(() => {
    // Create Express app with the router
    app = express();
    app.use(express.json());
    app.locals.dataRoot = sharedTempDir;
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

describe('Stories API Routes - Auto-Title Functionality', () => {
  let app;

  beforeEach(() => {
    // Create Express app with both routers
    app = express();
    app.use(express.json());
    app.locals.dataRoot = sharedTempDir;
    app.use('/api/stories', storiesRouter);
    app.use('/api/characters', charactersRouter);

    // Add error handler
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error'
      });
    });
  });

  describe('POST /:id/characters - Add Character with Auto-Title Update', () => {
    it('should update title from "Untitled Story" to "A Story with [name]" when first character is added', async () => {
      // Create a character
      const charResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Alice' })
        .expect(201);
      const characterId = charResponse.body.id;

      // Create a story with "Untitled Story" title
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Untitled Story' })
        .expect(201);
      const storyId = storyResponse.body.story.id;

      // Add character to story
      const addResponse = await request(app)
        .post(`/api/stories/${storyId}/characters`)
        .send({ characterId })
        .expect(200);

      expect(addResponse.body.success).toBe(true);
      expect(addResponse.body.updatedTitle).toBe('A Story with Alice');

      // Verify story title was updated
      const getResponse = await request(app)
        .get(`/api/stories/${storyId}`)
        .expect(200);
      expect(getResponse.body.story.title).toBe('A Story with Alice');
    });

    it('should update title to "A Story with [name1] and [name2]" when second character is added', async () => {
      // Create two characters
      const char1Response = await request(app)
        .post('/api/characters')
        .send({ name: 'Alice' })
        .expect(201);
      const char2Response = await request(app)
        .post('/api/characters')
        .send({ name: 'Bob' })
        .expect(201);

      // Create a story
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Untitled Story' })
        .expect(201);
      const storyId = storyResponse.body.story.id;

      // Add first character
      await request(app)
        .post(`/api/stories/${storyId}/characters`)
        .send({ characterId: char1Response.body.id })
        .expect(200);

      // Add second character
      const addResponse = await request(app)
        .post(`/api/stories/${storyId}/characters`)
        .send({ characterId: char2Response.body.id })
        .expect(200);

      // Title should contain both names with "and" (order may vary based on DB)
      expect(addResponse.body.updatedTitle).toMatch(/^A Story with (Alice and Bob|Bob and Alice)$/);
    });

    it('should use Oxford comma for three or more characters', async () => {
      // Create three characters
      const char1 = await request(app).post('/api/characters').send({ name: 'Alice' }).expect(201);
      const char2 = await request(app).post('/api/characters').send({ name: 'Bob' }).expect(201);
      const char3 = await request(app).post('/api/characters').send({ name: 'Charlie' }).expect(201);

      // Create a story
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Untitled Story' })
        .expect(201);
      const storyId = storyResponse.body.story.id;

      // Add all three characters
      await request(app).post(`/api/stories/${storyId}/characters`).send({ characterId: char1.body.id });
      await request(app).post(`/api/stories/${storyId}/characters`).send({ characterId: char2.body.id });
      const addResponse = await request(app)
        .post(`/api/stories/${storyId}/characters`)
        .send({ characterId: char3.body.id })
        .expect(200);

      // Should have format "A Story with X, Y, and Z" (order may vary)
      const title = addResponse.body.updatedTitle;
      expect(title).toMatch(/^A Story with /);
      expect(title).toContain('Alice');
      expect(title).toContain('Bob');
      expect(title).toContain('Charlie');
      expect(title).toContain(', and ');
      // Verify it has the comma-separated format
      expect(title).toMatch(/A Story with \w+, \w+, and \w+$/);
    });

    it('should update existing auto-generated title starting with "Story with"', async () => {
      // Create a character
      const charResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Alice' })
        .expect(201);

      // Create a story with "Story with X" format (legacy format)
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Story with Someone' })
        .expect(201);
      const storyId = storyResponse.body.story.id;

      // Add character to story
      const addResponse = await request(app)
        .post(`/api/stories/${storyId}/characters`)
        .send({ characterId: charResponse.body.id })
        .expect(200);

      expect(addResponse.body.updatedTitle).toBe('A Story with Alice');
    });

    it('should update existing auto-generated title starting with "A Story with"', async () => {
      // Create two characters
      const char1 = await request(app).post('/api/characters').send({ name: 'Alice' }).expect(201);
      const char2 = await request(app).post('/api/characters').send({ name: 'Bob' }).expect(201);

      // Create a story with "A Story with" format
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'A Story with Someone' })
        .expect(201);
      const storyId = storyResponse.body.story.id;

      // Add characters to story
      await request(app).post(`/api/stories/${storyId}/characters`).send({ characterId: char1.body.id });
      const addResponse = await request(app)
        .post(`/api/stories/${storyId}/characters`)
        .send({ characterId: char2.body.id })
        .expect(200);

      // Title should contain both names with "and" (order may vary based on DB)
      expect(addResponse.body.updatedTitle).toMatch(/^A Story with (Alice and Bob|Bob and Alice)$/);
    });

    it('should NOT update custom titles that do not match auto-generated patterns', async () => {
      // Create a character
      const charResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Alice' })
        .expect(201);

      // Create a story with a custom title
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'My Custom Adventure' })
        .expect(201);
      const storyId = storyResponse.body.story.id;

      // Add character to story
      const addResponse = await request(app)
        .post(`/api/stories/${storyId}/characters`)
        .send({ characterId: charResponse.body.id })
        .expect(200);

      expect(addResponse.body.updatedTitle).toBeNull();

      // Verify story title was NOT updated
      const getResponse = await request(app)
        .get(`/api/stories/${storyId}`)
        .expect(200);
      expect(getResponse.body.story.title).toBe('My Custom Adventure');
    });

    it('should return 400 if characterId is missing', async () => {
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Test Story' })
        .expect(201);

      const response = await request(app)
        .post(`/api/stories/${storyResponse.body.story.id}/characters`)
        .send({})
        .expect(400);

      expect(response.body.error).toContain('Character ID is required');
    });
  });

  describe('DELETE /:id/characters/:characterId - Remove Character with Auto-Title Update', () => {
    it('should update title to "Untitled Story" when last character is removed', async () => {
      // Create a character
      const charResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Alice' })
        .expect(201);
      const characterId = charResponse.body.id;

      // Create a story
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Untitled Story' })
        .expect(201);
      const storyId = storyResponse.body.story.id;

      // Add character
      await request(app)
        .post(`/api/stories/${storyId}/characters`)
        .send({ characterId })
        .expect(200);

      // Remove character
      const removeResponse = await request(app)
        .delete(`/api/stories/${storyId}/characters/${characterId}`)
        .expect(200);

      expect(removeResponse.body.success).toBe(true);
      expect(removeResponse.body.updatedTitle).toBe('Untitled Story');
    });

    it('should update title when removing one of two characters', async () => {
      // Create two characters
      const char1 = await request(app).post('/api/characters').send({ name: 'Alice' }).expect(201);
      const char2 = await request(app).post('/api/characters').send({ name: 'Bob' }).expect(201);

      // Create a story
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Untitled Story' })
        .expect(201);
      const storyId = storyResponse.body.story.id;

      // Add both characters
      await request(app).post(`/api/stories/${storyId}/characters`).send({ characterId: char1.body.id });
      await request(app).post(`/api/stories/${storyId}/characters`).send({ characterId: char2.body.id });

      // Remove first character
      const removeResponse = await request(app)
        .delete(`/api/stories/${storyId}/characters/${char1.body.id}`)
        .expect(200);

      expect(removeResponse.body.updatedTitle).toBe('A Story with Bob');
    });

    it('should update title when removing one of three characters', async () => {
      // Create three characters
      const char1 = await request(app).post('/api/characters').send({ name: 'Alice' }).expect(201);
      const char2 = await request(app).post('/api/characters').send({ name: 'Bob' }).expect(201);
      const char3 = await request(app).post('/api/characters').send({ name: 'Charlie' }).expect(201);

      // Create a story
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Untitled Story' })
        .expect(201);
      const storyId = storyResponse.body.story.id;

      // Add all three characters
      await request(app).post(`/api/stories/${storyId}/characters`).send({ characterId: char1.body.id });
      await request(app).post(`/api/stories/${storyId}/characters`).send({ characterId: char2.body.id });
      await request(app).post(`/api/stories/${storyId}/characters`).send({ characterId: char3.body.id });

      // Remove middle character (Bob)
      const removeResponse = await request(app)
        .delete(`/api/stories/${storyId}/characters/${char2.body.id}`)
        .expect(200);

      // Title should contain remaining characters (order may vary based on DB)
      expect(removeResponse.body.updatedTitle).toMatch(/^A Story with (Alice and Charlie|Charlie and Alice)$/);
    });

    it('should NOT update custom titles when character is removed', async () => {
      // Create a character
      const charResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Alice' })
        .expect(201);
      const characterId = charResponse.body.id;

      // Create a story with a custom title
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'My Custom Adventure' })
        .expect(201);
      const storyId = storyResponse.body.story.id;

      // Add character
      await request(app)
        .post(`/api/stories/${storyId}/characters`)
        .send({ characterId })
        .expect(200);

      // Remove character
      const removeResponse = await request(app)
        .delete(`/api/stories/${storyId}/characters/${characterId}`)
        .expect(200);

      expect(removeResponse.body.success).toBe(true);
      expect(removeResponse.body.updatedTitle).toBeNull();

      // Verify title was not changed
      const getResponse = await request(app)
        .get(`/api/stories/${storyId}`)
        .expect(200);
      expect(getResponse.body.story.title).toBe('My Custom Adventure');
    });
  });
});
