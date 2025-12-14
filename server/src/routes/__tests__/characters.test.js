import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the router
import charactersRouter from '../characters.js';

describe('Characters API Routes', () => {
  let app;
  let tempDir;

  beforeAll(() => {
    // Create temp directory for test database - shared across all tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'characters-test-'));
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
    app.use('/api/characters', charactersRouter);

    // Add error handler
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error'
      });
    });
  });

  describe('GET / - List Characters', () => {
    it('should return characters array', async () => {
      const response = await request(app)
        .get('/api/characters')
        .expect(200);

      expect(response.body).toHaveProperty('characters');
      expect(Array.isArray(response.body.characters)).toBe(true);
    });
  });

  describe('POST / - Create Character', () => {
    it('should create a new character with name only', async () => {
      const response = await request(app)
        .post('/api/characters')
        .send({ name: 'New Character' })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('New Character');
      expect(response.body.description).toBe('');
    });

    it('should create a character with all fields', async () => {
      const response = await request(app)
        .post('/api/characters')
        .send({
          name: 'Full Character',
          description: 'A detailed description',
          personality: 'Brave and kind',
          scenario: 'In a fantasy world',
          first_mes: 'Hello there!'
        })
        .expect(201);

      expect(response.body.name).toBe('Full Character');
      expect(response.body.description).toBe('A detailed description');
      expect(response.body.firstMessage).toBe('Hello there!');
    });

    it('should trim whitespace from name', async () => {
      const response = await request(app)
        .post('/api/characters')
        .send({ name: '  Trimmed Name  ' })
        .expect(201);

      expect(response.body.name).toBe('Trimmed Name');
    });

    it('should return 400 if name is missing', async () => {
      const response = await request(app)
        .post('/api/characters')
        .send({ description: 'No name' })
        .expect(400);

      expect(response.body.error).toContain('Character name is required');
    });

    it('should return 400 if name is empty', async () => {
      const response = await request(app)
        .post('/api/characters')
        .send({ name: '   ' })
        .expect(400);

      expect(response.body.error).toContain('Character name is required');
    });
  });

  describe('POST /create - Create Character with Image', () => {
    it('should create character from JSON data', async () => {
      const characterData = {
        name: 'Image Character',
        description: 'Has an image',
        personality: 'Cheerful',
        scenario: 'Modern day',
        first_mes: 'Hi!'
      };

      const response = await request(app)
        .post('/api/characters/create')
        .field('characterData', JSON.stringify(characterData))
        .expect(201);

      expect(response.body.name).toBe('Image Character');
      expect(response.body.description).toBe('Has an image');
    });

    it('should return 400 if characterData is missing', async () => {
      const response = await request(app)
        .post('/api/characters/create')
        .expect(400);

      expect(response.body.error).toContain('Character data is required');
    });

    it('should return 400 if characterData is invalid JSON', async () => {
      const response = await request(app)
        .post('/api/characters/create')
        .field('characterData', 'not valid json')
        .expect(400);

      expect(response.body.error).toContain('Invalid character data JSON');
    });

    it('should return 400 if name is missing in characterData', async () => {
      const response = await request(app)
        .post('/api/characters/create')
        .field('characterData', JSON.stringify({ description: 'No name' }))
        .expect(400);

      expect(response.body.error).toContain('Character name is required');
    });
  });

  describe('GET /:characterId/data - Get Character Data', () => {
    it('should return character data', async () => {
      // Create character via API first
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Test Char', description: 'Test description' })
        .expect(201);

      const charId = createResponse.body.id;

      const response = await request(app)
        .get(`/api/characters/${charId}/data`)
        .expect(200);

      expect(response.body.character.data.name).toBe('Test Char');
      expect(response.body.character.data.description).toBe('Test description');
    });

    it('should return 500 for non-existent character', async () => {
      await request(app)
        .get('/api/characters/non-existent-id/data')
        .expect(500);
    });
  });

  describe('PUT /:characterId - Update Character', () => {
    let charId;

    beforeEach(async () => {
      // Create character via API
      const createResponse = await request(app)
        .post('/api/characters')
        .send({
          name: 'Original Name',
          description: 'Original Desc',
          personality: 'Original Personality'
        })
        .expect(201);

      charId = createResponse.body.id;
    });

    it('should update character name', async () => {
      const response = await request(app)
        .put(`/api/characters/${charId}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
    });

    it('should update character description', async () => {
      const response = await request(app)
        .put(`/api/characters/${charId}`)
        .send({ description: 'Updated Description' })
        .expect(200);

      expect(response.body.description).toBe('Updated Description');
    });

    it('should update multiple fields', async () => {
      const response = await request(app)
        .put(`/api/characters/${charId}`)
        .send({
          name: 'New Name',
          description: 'New Desc',
          personality: 'New Personality',
          scenario: 'New Scenario',
          first_mes: 'New First Message'
        })
        .expect(200);

      expect(response.body.name).toBe('New Name');
    });

    it('should update alternate greetings', async () => {
      const alternateGreetings = ['Greeting 1', 'Greeting 2'];

      const response = await request(app)
        .put(`/api/characters/${charId}`)
        .send({ alternate_greetings: alternateGreetings })
        .expect(200);

      // Verify by fetching character data
      const dataResponse = await request(app)
        .get(`/api/characters/${charId}/data`)
        .expect(200);

      expect(dataResponse.body.character.data.alternate_greetings).toEqual(alternateGreetings);
    });

    it('should update lorebook association', async () => {
      const lorebookId = 'test-lorebook-id';

      const response = await request(app)
        .put(`/api/characters/${charId}`)
        .send({ ursceal_lorebook_id: lorebookId })
        .expect(200);

      // Verify by fetching character data
      const dataResponse = await request(app)
        .get(`/api/characters/${charId}/data`)
        .expect(200);

      expect(dataResponse.body.character.data.extensions.ursceal_lorebook_id).toBe(lorebookId);
    });

    it('should clear lorebook association when set to null', async () => {
      // First set a lorebook
      await request(app)
        .put(`/api/characters/${charId}`)
        .send({ ursceal_lorebook_id: 'some-lorebook' })
        .expect(200);

      // Then clear it
      await request(app)
        .put(`/api/characters/${charId}`)
        .send({ ursceal_lorebook_id: null })
        .expect(200);

      const dataResponse = await request(app)
        .get(`/api/characters/${charId}/data`)
        .expect(200);

      expect(dataResponse.body.character.data.extensions.ursceal_lorebook_id).toBeNull();
    });
  });

  describe('GET /:characterId/stories - Get Character Stories', () => {
    it('should return empty array when character is not in any stories', async () => {
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Lonely Char', description: 'Not in any story' })
        .expect(201);

      const charId = createResponse.body.id;

      const response = await request(app)
        .get(`/api/characters/${charId}/stories`)
        .expect(200);

      expect(response.body.stories).toEqual([]);
    });
  });

  describe('DELETE /:characterId - Delete Character', () => {
    it('should delete character not used in any story', async () => {
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'To Delete', description: 'Will be deleted' })
        .expect(201);

      const charId = createResponse.body.id;

      const response = await request(app)
        .delete(`/api/characters/${charId}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify character is deleted
      await request(app)
        .get(`/api/characters/${charId}/data`)
        .expect(500);
    });
  });

  describe('GET /:characterId/image - Get Character Image', () => {
    it('should return 404 when character has no image', async () => {
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'No Image', description: 'Has no image' })
        .expect(201);

      const charId = createResponse.body.id;

      const response = await request(app)
        .get(`/api/characters/${charId}/image`)
        .expect(404);

      expect(response.body.error).toContain('no image');
    });
  });

  describe('GET /:characterId/thumbnail - Get Character Thumbnail', () => {
    it('should return 404 when character has no thumbnail', async () => {
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'No Thumb', description: 'Has no thumbnail' })
        .expect(201);

      const charId = createResponse.body.id;

      const response = await request(app)
        .get(`/api/characters/${charId}/thumbnail`)
        .expect(404);

      expect(response.body.error).toContain('no thumbnail');
    });
  });

  describe('POST /import-url - Import from URL', () => {
    it('should return 400 if URL is missing', async () => {
      const response = await request(app)
        .post('/api/characters/import-url')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('URL is required');
    });

    it('should return 400 for non-CHUB URLs', async () => {
      const response = await request(app)
        .post('/api/characters/import-url')
        .send({ url: 'https://example.com/character' })
        .expect(400);

      expect(response.body.error).toContain('Only CHUB URLs');
    });
  });

  describe('POST /import - Import PNG', () => {
    it('should return 400 if no file uploaded', async () => {
      const response = await request(app)
        .post('/api/characters/import')
        .expect(400);

      expect(response.body.error).toContain('No file uploaded');
    });
  });

  describe('PUT /:characterId/update-with-image', () => {
    let charId;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Original Name', description: 'Original Desc' })
        .expect(201);

      charId = createResponse.body.id;
    });

    it('should return 400 if characterData is missing', async () => {
      const response = await request(app)
        .put(`/api/characters/${charId}/update-with-image`)
        .expect(400);

      expect(response.body.error).toContain('Character data is required');
    });

    it('should return 400 if characterData is invalid JSON', async () => {
      const response = await request(app)
        .put(`/api/characters/${charId}/update-with-image`)
        .field('characterData', 'invalid json')
        .expect(400);

      expect(response.body.error).toContain('Invalid character data JSON');
    });

    it('should update character with valid JSON data', async () => {
      const updateData = {
        name: 'Updated Name',
        description: 'Updated Description'
      };

      const response = await request(app)
        .put(`/api/characters/${charId}/update-with-image`)
        .field('characterData', JSON.stringify(updateData))
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
      expect(response.body.description).toBe('Updated Description');
    });
  });

  // Note: Tests for story-character associations (character used in stories,
  // cannot delete character in story) are covered in sqliteStorage.test.js
});
