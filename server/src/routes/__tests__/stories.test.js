import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteStorageService } from '../../services/sqliteStorage.js';
import { DeepSeekProvider } from '../../services/providers/deepseek-provider.js';
import { AIHordeProvider } from '../../services/providers/aihorde-provider.js';

// Import the routers
import storiesRouter from '../stories.js';
import charactersRouter from '../characters.js';
import lorebooksRouter from '../lorebooks.js';

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

afterEach(() => {
  vi.restoreAllMocks();
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
    app.use((err, req, res, _next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error',
      });
    });
  });

  describe('GET / - List Stories', () => {
    it('should return stories array', async () => {
      const response = await request(app).get('/api/stories').expect(200);

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
      const response = await request(app).post('/api/stories').send({ title: '   ' }).expect(400);

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

      const response = await request(app).get(`/api/stories/${storyId}`).expect(200);

      expect(response.body.story.id).toBe(storyId);
      expect(response.body.story.title).toBe('Test Story');
    });

    it('should return 500 for non-existent story', async () => {
      await request(app).get('/api/stories/non-existent-id').expect(500);
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

      const response = await request(app).put(`/api/stories/${storyId}`).send({}).expect(400);

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

    it('should update scenario field', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .put(`/api/stories/${storyId}`)
        .send({ scenario: 'A dark forest' })
        .expect(200);

      expect(response.body.story.scenario).toBe('A dark forest');
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

      const response = await request(app).delete(`/api/stories/${storyId}`).expect(200);

      expect(response.body.success).toBe(true);

      // Verify story is no longer accessible
      await request(app).get(`/api/stories/${storyId}`).expect(500);
    });
  });

  describe('POST /:id/duplicate - Duplicate Story', () => {
    it('should duplicate a story with basic properties', async () => {
      // Create a story with content
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Original Story', description: 'Original description' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      // Add some content
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Story content here' })
        .expect(200);

      // Duplicate the story
      const duplicateResponse = await request(app)
        .post(`/api/stories/${storyId}/duplicate`)
        .expect(201);

      expect(duplicateResponse.body).toHaveProperty('story');
      expect(duplicateResponse.body.story.id).not.toBe(storyId);
      expect(duplicateResponse.body.story.title).toBe('Original Story (Copy)');
      expect(duplicateResponse.body.story.description).toBe('Original description');
      expect(duplicateResponse.body.story.content).toBe('Story content here');
    });

    it('should return 500 for non-existent story', async () => {
      await request(app).post('/api/stories/non-existent-id/duplicate').expect(500);
    });

    it('should duplicate story and include it in list', async () => {
      // Create a story
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'To Duplicate', description: 'Test' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      // Get count before
      const beforeList = await request(app).get('/api/stories').expect(200);
      const countBefore = beforeList.body.stories.length;

      // Duplicate
      await request(app).post(`/api/stories/${storyId}/duplicate`).expect(201);

      // Get count after
      const afterList = await request(app).get('/api/stories').expect(200);

      expect(afterList.body.stories.length).toBe(countBefore + 1);

      // Verify both original and copy exist
      const titles = afterList.body.stories.map((s) => s.title);
      expect(titles).toContain('To Duplicate');
      expect(titles).toContain('To Duplicate (Copy)');
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

  describe('PUT /:id/avatar-windows - Update Avatar Windows', () => {
    it('should update avatar windows successfully', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const avatarWindows = [
        { id: 'win1', characterId: 'char1', x: 100, y: 100, width: 200, height: 300 },
      ];

      const response = await request(app)
        .put(`/api/stories/${storyId}/avatar-windows`)
        .send({ avatarWindows })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 400 if avatarWindows is not an array', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app)
        .put(`/api/stories/${storyId}/avatar-windows`)
        .send({ avatarWindows: 'not an array' })
        .expect(400);

      expect(response.body.error).toContain('avatarWindows must be an array');
    });

    it('should return 400 if avatar window is missing required properties', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const avatarWindows = [
        { id: 'win1', x: 100, y: 100 }, // missing characterId, width, height
      ];

      const response = await request(app)
        .put(`/api/stories/${storyId}/avatar-windows`)
        .send({ avatarWindows })
        .expect(400);

      expect(response.body.error).toContain('missing required property');
    });

    it('should return 400 if avatar window has invalid dimensions', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const avatarWindows = [
        { id: 'win1', characterId: 'char1', x: 100, y: 100, width: -50, height: 300 },
      ];

      const response = await request(app)
        .put(`/api/stories/${storyId}/avatar-windows`)
        .send({ avatarWindows })
        .expect(400);

      expect(response.body.error).toContain('width must be a positive number');
    });

    it('should allow multiple avatar windows', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const avatarWindows = [
        { id: 'win1', characterId: 'char1', x: 100, y: 100, width: 200, height: 300 },
        { id: 'win2', characterId: 'char2', x: 400, y: 100, width: 200, height: 300 },
      ];

      const response = await request(app)
        .put(`/api/stories/${storyId}/avatar-windows`)
        .send({ avatarWindows })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 400 if exceeding maximum avatar windows', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      // Create 21 avatar windows (exceeding limit of 20)
      const avatarWindows = Array.from({ length: 21 }, (_, i) => ({
        id: `win${i}`,
        characterId: `char${i}`,
        x: i * 100,
        y: 100,
        width: 200,
        height: 300,
      }));

      const response = await request(app)
        .put(`/api/stories/${storyId}/avatar-windows`)
        .send({ avatarWindows })
        .expect(400);

      expect(response.body.error).toContain('maximum of 20 avatar windows');
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

      const response = await request(app).get(`/api/stories/${storyId}/history/status`).expect(200);

      expect(response.body).toHaveProperty('canUndo');
      expect(response.body).toHaveProperty('canRedo');
    });
  });

  describe('POST /:id/undo - Undo Story Content', () => {
    it('should undo content change', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      // Add first content
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'First content' })
        .expect(200);

      // Add second content
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Second content' })
        .expect(200);

      // Undo
      const response = await request(app).post(`/api/stories/${storyId}/undo`).expect(200);

      // Check response has content property
      expect(response.body).toHaveProperty('content');
      expect(response.body.content).toBe('First content');
    });

    it('should return 400 if nothing to undo', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app).post(`/api/stories/${storyId}/undo`).expect(400);

      expect(response.body.error).toContain('Nothing to undo');
    });
  });

  describe('POST /:id/redo - Redo Story Content', () => {
    it('should redo content change', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      // Add first content
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'First content' })
        .expect(200);

      // Add second content
      await request(app)
        .put(`/api/stories/${storyId}/content`)
        .send({ content: 'Second content' })
        .expect(200);

      // Undo
      await request(app).post(`/api/stories/${storyId}/undo`).expect(200);

      // Redo
      const response = await request(app).post(`/api/stories/${storyId}/redo`).expect(200);

      // Check response has content property
      expect(response.body).toHaveProperty('content');
      expect(response.body.content).toBe('Second content');
    });

    it('should return 400 if nothing to redo', async () => {
      const createResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Title', description: 'Desc' })
        .expect(201);

      const storyId = createResponse.body.story.id;

      const response = await request(app).post(`/api/stories/${storyId}/redo`).expect(400);

      expect(response.body.error).toContain('Nothing to redo');
    });
  });

  // Note: Story-persona, story-character, and story-lorebook association tests
  // require characters and lorebooks to be created first via their respective APIs.
  // These integration tests are covered in sqliteStorage.test.js.
});

describe('Stories API Routes - Story Characters', () => {
  let app;

  beforeEach(() => {
    // Create Express app with both routers
    app = express();
    app.use(express.json());
    app.locals.dataRoot = sharedTempDir;
    app.use('/api/stories', storiesRouter);
    app.use('/api/characters', charactersRouter);

    // Add error handler
    app.use((err, req, res, _next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error',
      });
    });
  });

  describe('GET /:id/characters - Get Story Characters', () => {
    it('should return empty array when story has no characters', async () => {
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Empty Story' })
        .expect(201);

      const response = await request(app)
        .get(`/api/stories/${storyResponse.body.story.id}/characters`)
        .expect(200);

      expect(response.body.characters).toEqual([]);
    });

    it('should return characters with data', async () => {
      // Create a character
      const charResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Alice', description: 'Test char' })
        .expect(201);

      // Create a story and add character
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Story with Char' })
        .expect(201);

      await request(app)
        .post(`/api/stories/${storyResponse.body.story.id}/characters`)
        .send({ characterId: charResponse.body.id })
        .expect(200);

      const response = await request(app)
        .get(`/api/stories/${storyResponse.body.story.id}/characters`)
        .expect(200);

      expect(response.body.characters.length).toBe(1);
      expect(response.body.characters[0].name).toBe('Alice');
      expect(response.body.characters[0].description).toBe('Test char');
    });
  });

  describe('GET /:id/characters/:characterId/greetings - Get Processed Greetings', () => {
    it('should return processed first message', async () => {
      // Create a character with first_mes
      const charResponse = await request(app)
        .post('/api/characters')
        .send({
          name: 'Greeter',
          description: 'Test',
          first_mes: 'Hello there!',
        })
        .expect(201);

      // Create a story
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Story' })
        .expect(201);

      // Add character to story
      await request(app)
        .post(`/api/stories/${storyResponse.body.story.id}/characters`)
        .send({ characterId: charResponse.body.id })
        .expect(200);

      const response = await request(app)
        .get(
          `/api/stories/${storyResponse.body.story.id}/characters/${charResponse.body.id}/greetings`,
        )
        .expect(200);

      expect(response.body.greetings).toBeDefined();
      expect(response.body.greetings.length).toBeGreaterThan(0);
      expect(response.body.greetings[0].label).toBe('First Message');
    });

    it('should return alternate greetings if present', async () => {
      // Create character with first_mes
      const charResponse = await request(app)
        .post('/api/characters')
        .send({
          name: 'Multi Greeter',
          description: 'Has alternates',
          first_mes: 'Hello!',
        })
        .expect(201);

      const charId = charResponse.body.id;

      // Update the character with alternate greetings
      await request(app)
        .put(`/api/characters/${charId}`)
        .send({
          alternate_greetings: ['Alternate 1', 'Alternate 2'],
        })
        .expect(200);

      // Verify the character was updated correctly
      const charDataResponse = await request(app).get(`/api/characters/${charId}/data`).expect(200);

      expect(charDataResponse.body.character.data.first_mes).toBe('Hello!');
      expect(charDataResponse.body.character.data.alternate_greetings).toEqual([
        'Alternate 1',
        'Alternate 2',
      ]);

      // Create a story
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Story' })
        .expect(201);

      // Add character to story
      await request(app)
        .post(`/api/stories/${storyResponse.body.story.id}/characters`)
        .send({ characterId: charId })
        .expect(200);

      const response = await request(app)
        .get(`/api/stories/${storyResponse.body.story.id}/characters/${charId}/greetings`)
        .expect(200);

      // Should have: first_mes + 2 alternate greetings = 3 total
      expect(response.body.greetings.length).toBe(3);
      expect(response.body.greetings[0].label).toBe('First Message');
      expect(response.body.greetings[1].label).toBe('Alternate Greeting 1');
      expect(response.body.greetings[2].label).toBe('Alternate Greeting 2');
    });
  });

  describe('PUT /:id/persona - Set Story Persona', () => {
    it('should set persona character', async () => {
      // Create a character
      const charResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Persona Char', description: 'The persona' })
        .expect(201);

      // Create a story
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Story' })
        .expect(201);

      // Set persona
      const response = await request(app)
        .put(`/api/stories/${storyResponse.body.story.id}/persona`)
        .send({ characterId: charResponse.body.id })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify persona was set
      const storyData = await request(app)
        .get(`/api/stories/${storyResponse.body.story.id}`)
        .expect(200);

      expect(storyData.body.story.personaCharacterId).toBe(charResponse.body.id);
    });

    it('should unset persona when characterId is null', async () => {
      // Create a story
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Story' })
        .expect(201);

      // Unset persona
      const response = await request(app)
        .put(`/api/stories/${storyResponse.body.story.id}/persona`)
        .send({ characterId: null })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });
});

describe('Stories API Routes - Story Lorebooks', () => {
  let app;
  let storage;

  // One connection for the whole file. Opening a SqliteStorageService per test
  // leaks an unclosed better-sqlite3 handle to the same WAL database that the
  // routers already hold a connection to.
  beforeAll(() => {
    storage = new SqliteStorageService(sharedTempDir);
  });

  beforeEach(() => {
    // Create Express app with routers
    app = express();
    app.use(express.json());
    app.locals.dataRoot = sharedTempDir;
    app.use('/api/stories', storiesRouter);
    app.use('/api/lorebooks', lorebooksRouter);
    app.use('/api/characters', charactersRouter);

    // Add error handler
    app.use((err, req, res, _next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error',
      });
    });
  });

  describe('GET /:id/lorebooks - Get Story Lorebooks', () => {
    it('should return empty array when story has no lorebooks', async () => {
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Empty Story' })
        .expect(201);

      const response = await request(app)
        .get(`/api/stories/${storyResponse.body.story.id}/lorebooks`)
        .expect(200);

      expect(response.body.lorebooks).toEqual([]);
    });
  });

  describe('POST /:id/lorebooks - Add Lorebook to Story', () => {
    it('should add lorebook to story', async () => {
      // Create a lorebook using storage directly
      const { v4: uuidv4 } = await import('uuid');
      const lorebookId = uuidv4();
      await storage.saveLorebook(lorebookId, {
        name: 'Test Lorebook',
        description: 'Test description',
      });

      // Create a story
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Story' })
        .expect(201);

      const response = await request(app)
        .post(`/api/stories/${storyResponse.body.story.id}/lorebooks`)
        .send({ lorebookId })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 400 if lorebookId is missing', async () => {
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Story' })
        .expect(201);

      const response = await request(app)
        .post(`/api/stories/${storyResponse.body.story.id}/lorebooks`)
        .send({})
        .expect(400);

      expect(response.body.error).toContain('Lorebook ID is required');
    });
  });

  describe('DELETE /:id/lorebooks/:lorebookId - Remove Lorebook from Story', () => {
    it('should remove lorebook from story', async () => {
      // Create a lorebook using storage directly
      const { v4: uuidv4 } = await import('uuid');
      const lorebookId = uuidv4();
      await storage.saveLorebook(lorebookId, {
        name: 'Test Lorebook',
        description: 'Test description',
      });

      // Create a story
      const storyResponse = await request(app)
        .post('/api/stories')
        .send({ title: 'Story' })
        .expect(201);

      const storyId = storyResponse.body.story.id;

      // Add lorebook first
      await request(app).post(`/api/stories/${storyId}/lorebooks`).send({ lorebookId }).expect(200);

      // Remove lorebook
      const response = await request(app)
        .delete(`/api/stories/${storyId}/lorebooks/${lorebookId}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });
});

describe('Stories API Routes - Generation Endpoints', () => {
  let app;
  let storage;

  async function createStoryWithPreset(options = {}) {
    const storyResponse = await request(app)
      .post('/api/stories')
      .send({ title: 'Gen Story', description: 'For SSE tests' })
      .expect(201);

    const storyId = storyResponse.body.story.id;

    const presetId = `preset-${Date.now()}-${Math.random()}`;
    await storage.savePreset(presetId, {
      id: presetId,
      name: options.name || 'Test DeepSeek Preset',
      provider: options.provider || 'deepseek',
      apiConfig: options.apiConfig || {
        apiKey: 'test-api-key',
        model: 'deepseek-v4-flash',
      },
      generationSettings: {
        maxTokens: 128,
        maxContextTokens: 4096,
        temperature: 1.0,
      },
      promptTemplates: {
        continue: '{{story}}',
        character: '{{story}}',
        instruction: '{{story}}',
        rewriteThirdPerson: '{{story}}',
        ideate: '{{story}}',
        storyStarter: '{{story}}',
      },
    });

    await request(app)
      .put(`/api/stories/${storyId}`)
      .send({ configPresetId: presetId })
      .expect(200);

    return { storyId, presetId };
  }

  // See note above: one connection per file, not per test.
  beforeAll(() => {
    storage = new SqliteStorageService(sharedTempDir);
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.locals.dataRoot = sharedTempDir;
    app.use('/api/stories', storiesRouter);
    app.use('/api/characters', charactersRouter);

    app.use((err, req, res, _next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error',
      });
    });
  });

  it.each([
    'continue',
    'continue-with-instruction',
    'rewrite-third-person',
    'ideate',
    'story-starter',
  ])('should return 400 for /%s when no preset is configured', async (endpoint) => {
    const storyResponse = await request(app)
      .post('/api/stories')
      .send({ title: 'No Preset Story' })
      .expect(201);

    const response = await request(app)
      .post(`/api/stories/${storyResponse.body.story.id}/${endpoint}`)
      .send({ instruction: 'continue please' })
      .expect(400);

    expect(response.body.error).toContain('preset');
  });

  it('POST /:id/continue should stream content and strip asterisks', async () => {
    const { storyId } = await createStoryWithPreset();

    vi.spyOn(DeepSeekProvider.prototype, 'buildPrompts').mockResolvedValue({
      system: 'system prompt',
      user: 'user prompt',
    });
    vi.spyOn(DeepSeekProvider.prototype, 'getCapabilities').mockReturnValue({
      streaming: true,
      reasoning: true,
      visionAPI: false,
      maxContextWindow: 1000000,
    });
    vi.spyOn(DeepSeekProvider.prototype, 'generateStreaming').mockResolvedValue({
      stream: (async function* () {
        yield { content: '*hello* ', finished: false };
        yield { content: '*world*', finished: true };
      })(),
      metadata: {},
    });

    const response = await request(app).post(`/api/stories/${storyId}/continue`).expect(200);

    expect(response.text).toContain('"prompts"');
    expect(response.text).toContain('"content":"hello "');
    expect(response.text).toContain('"content":"world"');
    expect(response.text).toContain('data: [DONE]');
  });

  it('POST /:id/continue should use character mode when characterId query is provided', async () => {
    const { storyId } = await createStoryWithPreset();

    const charResponse = await request(app)
      .post('/api/characters')
      .send({ name: 'Alice', description: 'Test character' })
      .expect(201);

    await request(app)
      .post(`/api/stories/${storyId}/characters`)
      .send({ characterId: charResponse.body.id })
      .expect(200);

    const buildPromptsSpy = vi.spyOn(DeepSeekProvider.prototype, 'buildPrompts').mockResolvedValue({
      system: 'system prompt',
      user: 'user prompt',
    });
    vi.spyOn(DeepSeekProvider.prototype, 'getCapabilities').mockReturnValue({
      streaming: true,
      reasoning: true,
      visionAPI: false,
      maxContextWindow: 1000000,
    });
    vi.spyOn(DeepSeekProvider.prototype, 'generateStreaming').mockResolvedValue({
      stream: (async function* () {
        yield { content: 'ok', finished: true };
      })(),
      metadata: {},
    });

    await request(app)
      .post(`/api/stories/${storyId}/continue?characterId=${charResponse.body.id}`)
      .expect(200);

    expect(buildPromptsSpy).toHaveBeenCalled();
    expect(buildPromptsSpy.mock.calls[0][1]).toBe('character');
    expect(buildPromptsSpy.mock.calls[0][2].characterName).toBe('Alice');
  });

  it('POST /:id/rewrite-third-person should restore preserved images in final chunk', async () => {
    const { storyId } = await createStoryWithPreset();

    await request(app)
      .put(`/api/stories/${storyId}/content`)
      .send({ content: 'Look ![img](https://example.com/pic.png)' })
      .expect(200);

    vi.spyOn(DeepSeekProvider.prototype, 'buildPrompts').mockImplementation(
      async (context, generationType, params) => {
        params.imagePreserver.preserve(context.story.content);
        return { system: 'system prompt', user: 'user prompt [WG_IMAGE_0]' };
      },
    );

    vi.spyOn(DeepSeekProvider.prototype, 'getCapabilities').mockReturnValue({
      streaming: true,
      reasoning: true,
      visionAPI: false,
      maxContextWindow: 1000000,
    });

    vi.spyOn(DeepSeekProvider.prototype, 'generateStreaming').mockResolvedValue({
      stream: (async function* () {
        yield { content: '[WG_IMAGE_0] rewritten', finished: true };
      })(),
      metadata: {},
    });

    const response = await request(app)
      .post(`/api/stories/${storyId}/rewrite-third-person`)
      .expect(200);

    expect(response.text).toContain(
      '"finalContent":"![img](https://example.com/pic.png) rewritten"',
    );
    expect(response.text).toContain('"imagesRestored":true');
  });

  it('POST /:id/ideate should support polling providers', async () => {
    const { storyId } = await createStoryWithPreset({
      name: 'AI Horde Preset',
      provider: 'aihorde',
      apiConfig: { apiKey: '0000000000', models: ['test-model'] },
    });

    // The workers take less context than the preset's, and the request must ask for that.
    vi.spyOn(AIHordeProvider.prototype, 'resolveContextTokens').mockResolvedValue(2048);
    const buildPrompts = vi.spyOn(AIHordeProvider.prototype, 'buildPrompts').mockResolvedValue({
      system: 'system prompt',
      user: 'user prompt',
    });
    vi.spyOn(AIHordeProvider.prototype, 'getCapabilities').mockReturnValue({
      streaming: false,
      requiresPolling: true,
      reasoning: false,
      visionAPI: false,
      maxContextWindow: 8192,
    });
    const generate = vi
      .spyOn(AIHordeProvider.prototype, 'generateStreamingWithStatus')
      .mockImplementation(() =>
        (async function* () {
          yield { type: 'status', queuePosition: 2, waitTime: 5, finished: false, faulted: false };
          yield { type: 'complete', content: '*done*' };
        })(),
      );

    const response = await request(app).post(`/api/stories/${storyId}/ideate`).expect(200);

    expect(buildPrompts.mock.calls[0][2].maxContextTokens).toBe(2048);
    expect(generate.mock.calls[0][2].maxContextLength).toBe(2048);

    expect(response.text).toContain('"queueStatus"');
    expect(response.text).toContain('"content":"done"');
    expect(response.text).toContain('"finished":true');
    expect(response.text).toContain('data: [DONE]');
  });

  it('POST /:id/story-starter should send cancelled event when generation is cancelled', async () => {
    const { storyId } = await createStoryWithPreset();

    vi.spyOn(DeepSeekProvider.prototype, 'buildPrompts').mockResolvedValue({
      system: 'system prompt',
      user: 'user prompt',
    });
    vi.spyOn(DeepSeekProvider.prototype, 'getCapabilities').mockReturnValue({
      streaming: true,
      reasoning: true,
      visionAPI: false,
      maxContextWindow: 1000000,
    });
    vi.spyOn(DeepSeekProvider.prototype, 'generateStreaming').mockImplementation(() => {
      throw new Error('Generation cancelled');
    });

    const response = await request(app).post(`/api/stories/${storyId}/story-starter`).expect(200);

    expect(response.text).toContain('"cancelled":true');
  });

  it('POST /:id/story-starter should send error event when generation fails', async () => {
    const { storyId } = await createStoryWithPreset();

    vi.spyOn(DeepSeekProvider.prototype, 'buildPrompts').mockResolvedValue({
      system: 'system prompt',
      user: 'user prompt',
    });
    vi.spyOn(DeepSeekProvider.prototype, 'getCapabilities').mockReturnValue({
      streaming: true,
      reasoning: true,
      visionAPI: false,
      maxContextWindow: 1000000,
    });
    vi.spyOn(DeepSeekProvider.prototype, 'generateStreaming').mockImplementation(() => {
      throw new Error('provider crashed');
    });

    const response = await request(app).post(`/api/stories/${storyId}/story-starter`).expect(200);

    expect(response.text).toContain('"error":"provider crashed"');
  });

  it('POST /:id/continue-with-instruction should return content via the non-streaming fallback', async () => {
    const { storyId } = await createStoryWithPreset();

    vi.spyOn(DeepSeekProvider.prototype, 'buildPrompts').mockResolvedValue({
      system: 'system prompt',
      user: 'user prompt',
    });
    vi.spyOn(DeepSeekProvider.prototype, 'getCapabilities').mockReturnValue({
      streaming: false,
      requiresPolling: false,
      reasoning: false,
      visionAPI: false,
      maxContextWindow: 8192,
    });
    vi.spyOn(DeepSeekProvider.prototype, 'generate').mockResolvedValue({
      content: 'final text',
      reasoning: '',
    });

    const response = await request(app)
      .post(`/api/stories/${storyId}/continue-with-instruction`)
      .send({ instruction: 'Keep going' })
      .expect(200);

    // This previously asserted `"error":"update is not defined"` — the branch
    // read an out-of-scope `update` and threw for every non-streaming
    // provider. It now returns the generated content.
    expect(response.text).toContain('final text');
    expect(response.text).not.toContain('update is not defined');
  });

  it('POST /:id/ideate should emit cancelled event when provider throws cancellation', async () => {
    const { storyId } = await createStoryWithPreset();

    vi.spyOn(DeepSeekProvider.prototype, 'buildPrompts').mockResolvedValue({
      system: 'system prompt',
      user: 'user prompt',
    });
    vi.spyOn(DeepSeekProvider.prototype, 'getCapabilities').mockReturnValue({
      streaming: true,
      reasoning: true,
      visionAPI: false,
      maxContextWindow: 1000000,
    });
    vi.spyOn(DeepSeekProvider.prototype, 'generateStreaming').mockImplementation(() => {
      throw new Error('Generation cancelled');
    });

    const response = await request(app).post(`/api/stories/${storyId}/ideate`).expect(200);

    expect(response.text).toContain('"cancelled":true');
  });

  it('POST /:id/ideate should emit error event when provider throws non-cancel error', async () => {
    const { storyId } = await createStoryWithPreset();

    vi.spyOn(DeepSeekProvider.prototype, 'buildPrompts').mockResolvedValue({
      system: 'system prompt',
      user: 'user prompt',
    });
    vi.spyOn(DeepSeekProvider.prototype, 'getCapabilities').mockReturnValue({
      streaming: true,
      reasoning: true,
      visionAPI: false,
      maxContextWindow: 1000000,
    });
    vi.spyOn(DeepSeekProvider.prototype, 'generateStreaming').mockImplementation(() => {
      throw new Error('ideate failed');
    });

    const response = await request(app).post(`/api/stories/${storyId}/ideate`).expect(200);

    expect(response.text).toContain('"error":"ideate failed"');
  });

  it('POST /:id/continue should return 400 when preset cannot be loaded', async () => {
    const storyResponse = await request(app)
      .post('/api/stories')
      .send({ title: 'Missing preset story' })
      .expect(201);

    await request(app)
      .put(`/api/stories/${storyResponse.body.story.id}`)
      .send({ configPresetId: 'missing-preset-id' })
      .expect(200);

    const response = await request(app)
      .post(`/api/stories/${storyResponse.body.story.id}/continue`)
      .expect(400);

    expect(response.body.error).toContain('Failed to load configuration preset');
  });

  it('POST /:id/continue should return 400 when provider initialization fails', async () => {
    const { storyId } = await createStoryWithPreset({
      provider: 'nonexistent-provider',
    });

    const response = await request(app).post(`/api/stories/${storyId}/continue`).expect(400);

    expect(response.body.error).toContain('Failed to initialize provider');
  });
});
