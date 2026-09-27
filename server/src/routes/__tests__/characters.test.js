import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createTestPng, createTestCharacterPng } from './test-helpers.js';

// Import the routers
import charactersRouter from '../characters.js';
import assetsRouter from '../assets.js';
import storiesRouter from '../stories.js';
import { SqliteStorageService } from '../../services/sqliteStorage.js';

describe('Characters API Routes', () => {
  let app;
  let tempDir;
  let storage;

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
    // Create storage instance
    storage = new SqliteStorageService(tempDir);

    // Create Express app with the routers
    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.use('/api/characters', charactersRouter);
    app.use('/api/assets', assetsRouter);
    app.use('/api/stories', storiesRouter);

    // Add error handler
    app.use((err, req, res, _next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error',
        ...err.details,
      });
    });
  });

  describe('GET / - List Characters', () => {
    it('should return characters array', async () => {
      const response = await request(app).get('/api/characters').expect(200);

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
          first_mes: 'Hello there!',
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
      const response = await request(app).post('/api/characters').send({ name: '   ' }).expect(400);

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
        first_mes: 'Hi!',
      };

      const response = await request(app)
        .post('/api/characters/create')
        .field('characterData', JSON.stringify(characterData))
        .expect(201);

      expect(response.body.name).toBe('Image Character');
      expect(response.body.description).toBe('Has an image');
    });

    it('should return 400 if characterData is missing', async () => {
      const response = await request(app).post('/api/characters/create').expect(400);

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

      const response = await request(app).get(`/api/characters/${charId}/data`).expect(200);

      expect(response.body.character.data.name).toBe('Test Char');
      expect(response.body.character.data.description).toBe('Test description');
    });

    it('should return 500 for non-existent character', async () => {
      await request(app).get('/api/characters/non-existent-id/data').expect(500);
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
          personality: 'Original Personality',
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
          first_mes: 'New First Message',
        })
        .expect(200);

      expect(response.body.name).toBe('New Name');
    });

    it('should update alternate greetings', async () => {
      const alternateGreetings = ['Greeting 1', 'Greeting 2'];

      await request(app)
        .put(`/api/characters/${charId}`)
        .send({ alternate_greetings: alternateGreetings })
        .expect(200);

      // Verify by fetching character data
      const dataResponse = await request(app).get(`/api/characters/${charId}/data`).expect(200);

      expect(dataResponse.body.character.data.alternate_greetings).toEqual(alternateGreetings);
    });

    it('should update lorebook association', async () => {
      const lorebookId = 'test-lorebook-id';

      await request(app)
        .put(`/api/characters/${charId}`)
        .send({ ursceal_lorebook_id: lorebookId })
        .expect(200);

      // Verify by fetching character data
      const dataResponse = await request(app).get(`/api/characters/${charId}/data`).expect(200);

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

      const dataResponse = await request(app).get(`/api/characters/${charId}/data`).expect(200);

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

      const response = await request(app).get(`/api/characters/${charId}/stories`).expect(200);

      expect(response.body.stories).toEqual([]);
    });

    it('should return stories that include the character', async () => {
      // Create character
      const charResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Multi Story Char', description: 'In multiple stories' })
        .expect(201);

      const charId = charResponse.body.id;

      // Create stories and add character to them using storage directly
      const story1 = await storage.createStory('Story One', 'First story');
      await storage.addCharacterToStory(story1.id, charId);

      const story2 = await storage.createStory('Story Two', 'Second story');
      await storage.setStoryPersona(story2.id, charId);

      const response = await request(app).get(`/api/characters/${charId}/stories`).expect(200);

      expect(response.body.stories.length).toBe(2);
      expect(response.body.stories.map((s) => s.title)).toContain('Story One');
      expect(response.body.stories.map((s) => s.title)).toContain('Story Two');
    });
  });

  describe('DELETE /:characterId - Delete Character', () => {
    it('should delete character not used in any story', async () => {
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'To Delete', description: 'Will be deleted' })
        .expect(201);

      const charId = createResponse.body.id;

      const response = await request(app).delete(`/api/characters/${charId}`).expect(200);

      expect(response.body.success).toBe(true);

      // Verify character is deleted
      await request(app).get(`/api/characters/${charId}/data`).expect(500);
    });

    it('should return 409 when character is used in a story', async () => {
      // Create character
      const charResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Story Char', description: 'In a story' })
        .expect(201);

      const charId = charResponse.body.id;

      // Create a story and add character to it using storage directly
      const story = await storage.createStory('Test Story', 'A story');
      await storage.addCharacterToStory(story.id, charId);

      // Try to delete character
      const response = await request(app).delete(`/api/characters/${charId}`).expect(409);

      expect(response.body.error).toContain('Cannot delete character');
      expect(response.body.error).toContain('Used in 1 story');
      expect(response.body.stories.map((s) => s.id)).toEqual([story.id]);
    });

    it('should list the other characters each blocking story involves', async () => {
      const target = await request(app)
        .post('/api/characters')
        .send({ name: 'Target', description: 'Being deleted' })
        .expect(201);
      const castmate = await request(app)
        .post('/api/characters')
        .send({ name: 'Castmate', description: 'Shares a story' })
        .expect(201);

      const shared = await storage.createStory('Shared Story', 'Two characters');
      await storage.addCharacterToStory(shared.id, target.body.id);
      await storage.setStoryPersona(shared.id, castmate.body.id);
      const solo = await storage.createStory('Solo Story', 'Just the target');
      await storage.addCharacterToStory(solo.id, target.body.id);

      const response = await request(app).delete(`/api/characters/${target.body.id}`).expect(409);

      const byTitle = Object.fromEntries(response.body.stories.map((s) => [s.title, s]));
      expect(byTitle['Shared Story'].otherCharacters).toEqual([
        { id: castmate.body.id, name: 'Castmate' },
      ]);
      expect(byTitle['Solo Story'].otherCharacters).toEqual([]);
    });

    it('should delete the character and its stories when deleteStories=true', async () => {
      const target = await request(app)
        .post('/api/characters')
        .send({ name: 'Doomed', description: 'Being deleted' })
        .expect(201);
      const other = await request(app)
        .post('/api/characters')
        .send({ name: 'Survivor', description: 'Stays' })
        .expect(201);

      const asCast = await storage.createStory('Cast Story', 'Target in cast');
      await storage.addCharacterToStory(asCast.id, target.body.id);
      await storage.addCharacterToStory(asCast.id, other.body.id);
      const asPersona = await storage.createStory('Persona Story', 'Target as persona');
      await storage.setStoryPersona(asPersona.id, target.body.id);
      const unrelated = await storage.createStory('Unrelated Story', 'Target not in it');
      await storage.addCharacterToStory(unrelated.id, other.body.id);

      const response = await request(app)
        .delete(`/api/characters/${target.body.id}?deleteStories=true`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.deletedStoryIds.toSorted()).toEqual(
        [asCast.id, asPersona.id].toSorted(),
      );

      const remaining = (await storage.listStories()).map((s) => s.id);
      expect(remaining).toContain(unrelated.id);
      expect(remaining).not.toContain(asCast.id);
      expect(remaining).not.toContain(asPersona.id);
      await request(app).get(`/api/characters/${target.body.id}/data`).expect(500);
      await request(app).get(`/api/characters/${other.body.id}/data`).expect(200);
    });
  });

  describe('GET /:characterId/image - Get Character Image', () => {
    it('should return 404 when character has no image', async () => {
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'No Image', description: 'Has no image' })
        .expect(201);

      const charId = createResponse.body.id;

      const response = await request(app).get(`/api/characters/${charId}/image`).expect(404);

      expect(response.body.error).toContain('no image');
    });

    it('should return image with correct content type and cache headers', async () => {
      // Create a character with image using /create endpoint
      const testPng = createTestPng();
      const characterData = {
        name: 'Image Char',
        description: 'Has image',
      };

      const createResponse = await request(app)
        .post('/api/characters/create')
        .field('characterData', JSON.stringify(characterData))
        .attach('image', testPng, {
          filename: 'test.png',
          contentType: 'image/png',
        })
        .expect(201);

      const charId = createResponse.body.id;

      const response = await request(app).get(`/api/characters/${charId}/image`).expect(200);

      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('public, max-age=86400');
      expect(response.body).toBeDefined();
    });
  });

  describe('GET /:characterId/thumbnail - Get Character Thumbnail', () => {
    it('should return 404 when character has no thumbnail', async () => {
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'No Thumb', description: 'Has no thumbnail' })
        .expect(201);

      const charId = createResponse.body.id;

      const response = await request(app).get(`/api/characters/${charId}/thumbnail`).expect(404);

      expect(response.body.error).toContain('no thumbnail');
    });

    it('should return thumbnail with correct headers', async () => {
      // Create character with image (should generate thumbnail)
      const testPng = createTestPng();
      const characterData = {
        name: 'Thumb Char',
        description: 'Has thumbnail',
      };

      const createResponse = await request(app)
        .post('/api/characters/create')
        .field('characterData', JSON.stringify(characterData))
        .attach('image', testPng, {
          filename: 'test.png',
          contentType: 'image/png',
        })
        .expect(201);

      const charId = createResponse.body.id;

      // Wait a bit for thumbnail generation
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app).get(`/api/characters/${charId}/thumbnail`).expect(200);

      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('public, max-age=86400');
    });
  });

  describe('GET /:characterId/thumbnail-medium - Get Character Medium Thumbnail', () => {
    it('should return 404 when character has no medium thumbnail', async () => {
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'No Medium', description: 'Has no medium thumbnail' })
        .expect(201);

      const charId = createResponse.body.id;

      const response = await request(app)
        .get(`/api/characters/${charId}/thumbnail-medium`)
        .expect(404);

      expect(response.body.error).toContain('no medium thumbnail');
    });

    it('should return medium thumbnail with correct headers', async () => {
      // Create character with image
      const testPng = createTestPng();
      const characterData = {
        name: 'Medium Thumb Char',
        description: 'Has medium thumbnail',
      };

      const createResponse = await request(app)
        .post('/api/characters/create')
        .field('characterData', JSON.stringify(characterData))
        .attach('image', testPng, {
          filename: 'test.png',
          contentType: 'image/png',
        })
        .expect(201);

      const charId = createResponse.body.id;

      // Wait a bit for thumbnail generation
      await new Promise((resolve) => setTimeout(resolve, 100));

      const response = await request(app)
        .get(`/api/characters/${charId}/thumbnail-medium`)
        .expect(200);

      expect(response.headers['content-type']).toBe('image/png');
      expect(response.headers['cache-control']).toBe('public, max-age=86400');
    });
  });

  describe('POST /import-url - Import from URL', () => {
    it('should return 400 if URL is missing', async () => {
      const response = await request(app).post('/api/characters/import-url').send({}).expect(400);

      expect(response.body.error).toContain('URL is required');
    });

    it('should return 400 for non-CHUB URLs', async () => {
      const response = await request(app)
        .post('/api/characters/import-url')
        .send({ url: 'https://example.com/character' })
        .expect(400);

      expect(response.body.error).toContain('Only CHUB URLs');
    });

    it('should return 400 for non-CHUB non-image URLs', async () => {
      const response = await request(app)
        .post('/api/characters/import-url')
        .send({ url: 'https://example.com/character' })
        .expect(400);

      expect(response.body.error).toContain('Only CHUB URLs');
    });

    it('should import character from PNG image URL', async () => {
      const characterPng = await createTestCharacterPng({
        name: 'URL Image Char',
        description: 'Imported from image URL',
        first_mes: 'Hello from URL!',
      });

      const mockResponse = {
        ok: true,
        statusText: 'OK',
        arrayBuffer: async () =>
          characterPng.buffer.slice(
            characterPng.byteOffset,
            characterPng.byteOffset + characterPng.byteLength,
          ),
      };
      vi.stubGlobal('fetch', async () => mockResponse);

      try {
        const response = await request(app)
          .post('/api/characters/import-url')
          .send({ url: 'https://example.com/character-card.png' })
          .expect(201);

        expect(response.body.name).toBe('URL Image Char');
        expect(response.body.description).toBe('Imported from image URL');
        expect(response.body.firstMessage).toBe('Hello from URL!');
        expect(response.body.imageUrl).toMatch(/^\/api\/characters\/.+\/image$/);
        expect(response.body.id).toBeDefined();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should import character from JPEG image URL', async () => {
      const characterPng = await createTestCharacterPng({
        name: 'JPEG URL Char',
      });

      const mockResponse = {
        ok: true,
        statusText: 'OK',
        arrayBuffer: async () =>
          characterPng.buffer.slice(
            characterPng.byteOffset,
            characterPng.byteOffset + characterPng.byteLength,
          ),
      };
      vi.stubGlobal('fetch', async () => mockResponse);

      try {
        const response = await request(app)
          .post('/api/characters/import-url')
          .send({ url: 'https://example.com/avatar.jpg' })
          .expect(201);

        expect(response.body.name).toBe('JPEG URL Char');
        expect(response.body.imageUrl).toMatch(/^\/api\/characters\/.+\/image$/);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should import character from WebP image URL', async () => {
      const characterPng = await createTestCharacterPng({
        name: 'WebP URL Char',
      });

      const mockResponse = {
        ok: true,
        statusText: 'OK',
        arrayBuffer: async () =>
          characterPng.buffer.slice(
            characterPng.byteOffset,
            characterPng.byteOffset + characterPng.byteLength,
          ),
      };
      vi.stubGlobal('fetch', async () => mockResponse);

      try {
        const response = await request(app)
          .post('/api/characters/import-url')
          .send({ url: 'https://example.com/card.webp' })
          .expect(201);

        expect(response.body.name).toBe('WebP URL Char');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should import character from image URL with query parameters', async () => {
      const characterPng = await createTestCharacterPng({
        name: 'Query URL Char',
      });

      const mockResponse = {
        ok: true,
        statusText: 'OK',
        arrayBuffer: async () =>
          characterPng.buffer.slice(
            characterPng.byteOffset,
            characterPng.byteOffset + characterPng.byteLength,
          ),
      };
      vi.stubGlobal('fetch', async () => mockResponse);

      try {
        const response = await request(app)
          .post('/api/characters/import-url')
          .send({ url: 'https://example.com/character.png?width=256&format=png' })
          .expect(201);

        expect(response.body.name).toBe('Query URL Char');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should return 400 when image URL fetch fails', async () => {
      vi.stubGlobal('fetch', async () => ({
        ok: false,
        statusText: 'Not Found',
      }));

      try {
        const response = await request(app)
          .post('/api/characters/import-url')
          .send({ url: 'https://example.com/missing.png' })
          .expect(400);

        expect(response.body.error).toContain('Failed to fetch image');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should return 400 when image URL returns invalid PNG', async () => {
      const notPng = Buffer.from('not a real PNG image');
      vi.stubGlobal('fetch', async () => ({
        ok: true,
        statusText: 'OK',
        arrayBuffer: async () =>
          notPng.buffer.slice(notPng.byteOffset, notPng.byteOffset + notPng.byteLength),
      }));

      try {
        const response = await request(app)
          .post('/api/characters/import-url')
          .send({ url: 'https://example.com/fake.png' })
          .expect(400);

        expect(response.body.error).toContain('Failed to import image character');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should not check CHUB URL after successful image URL import', async () => {
      // Verifies that a successful image URL import returns 201 and does NOT
      // fall through to the CHUB URL check (which would throw a 400 error).
      const characterPng = await createTestCharacterPng({
        name: 'No Fallthrough Char',
      });

      const mockResponse = {
        ok: true,
        statusText: 'OK',
        arrayBuffer: async () =>
          characterPng.buffer.slice(
            characterPng.byteOffset,
            characterPng.byteOffset + characterPng.byteLength,
          ),
      };
      vi.stubGlobal('fetch', async () => mockResponse);

      try {
        const response = await request(app)
          .post('/api/characters/import-url')
          .send({ url: 'https://example.com/some-card.png' })
          .expect(201);

        // If execution fell through to the CHUB check, we'd get a 400 error
        // instead of this 201 response.
        expect(response.body.name).toBe('No Fallthrough Char');
        expect(response.body.id).toBeDefined();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('POST /import - Import PNG', () => {
    it('should return 400 if no file uploaded', async () => {
      const response = await request(app).post('/api/characters/import').expect(400);

      expect(response.body.error).toContain('No file uploaded');
    });

    it('should return 400 for invalid file type', async () => {
      const response = await request(app)
        .post('/api/characters/import')
        .attach('character', Buffer.from('not an image'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(400);

      expect(response.body.error).toContain('Only PNG, JPEG, WebP, and AVIF images are allowed');
    });

    it('should reject files larger than 10MB', async () => {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11MB

      const response = await request(app)
        .post('/api/characters/import')
        .attach('character', largeBuffer, {
          filename: 'large.png',
          contentType: 'image/png',
        })
        .expect(500); // multer might throw 500 for size limits

      expect(response.body.error).toBeDefined();
    });
  });

  describe('POST /import-json - Import Character JSON', () => {
    it('should import valid character JSON', async () => {
      const characterJson = {
        name: 'Imported Char',
        description: 'From JSON',
        personality: 'Friendly',
        first_mes: 'Hello from JSON!',
      };

      const response = await request(app)
        .post('/api/characters/import-json')
        .attach('character', Buffer.from(JSON.stringify(characterJson)), {
          filename: 'character.json',
          contentType: 'application/json',
        })
        .expect(201);

      expect(response.body.name).toBe('Imported Char');
      expect(response.body.description).toBe('From JSON');
      expect(response.body.firstMessage).toBe('Hello from JSON!');
    });

    it('should normalize flat character format to V2', async () => {
      // Flat format (V1 style)
      const flatCharacter = {
        name: 'Flat Char',
        description: 'Flat format',
        first_mes: 'Hi',
      };

      const response = await request(app)
        .post('/api/characters/import-json')
        .attach('character', Buffer.from(JSON.stringify(flatCharacter)), {
          filename: 'character.json',
        })
        .expect(201);

      expect(response.body.name).toBe('Flat Char');

      // Verify it was stored in V2 format
      const dataResponse = await request(app)
        .get(`/api/characters/${response.body.id}/data`)
        .expect(200);

      expect(dataResponse.body.character.spec).toBe('chara_card_v2');
    });

    it('should return 400 if no file provided', async () => {
      const response = await request(app).post('/api/characters/import-json').expect(400);

      expect(response.body.error).toContain('No character file provided');
    });

    it('should return 400 for invalid JSON', async () => {
      const response = await request(app)
        .post('/api/characters/import-json')
        .attach('character', Buffer.from('not valid json'), {
          filename: 'bad.json',
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid JSON file');
    });

    it('should return 400 for missing name in character data', async () => {
      const invalidChar = {
        description: 'No name field',
      };

      const response = await request(app)
        .post('/api/characters/import-json')
        .attach('character', Buffer.from(JSON.stringify(invalidChar)), {
          filename: 'bad.json',
        })
        .expect(400);

      expect(response.body.error).toContain('missing name or data field');
    });

    it('should extract embedded lorebook if present', async () => {
      const characterWithLorebook = {
        name: 'Char With Lore',
        description: 'Has lorebook',
        character_book: {
          name: 'Embedded Lore',
          entries: [
            {
              uid: 1,
              key: ['magic'],
              content: 'Magic lore content',
              comment: 'Magic entry',
            },
          ],
        },
      };

      const response = await request(app)
        .post('/api/characters/import-json')
        .attach('character', Buffer.from(JSON.stringify(characterWithLorebook)), {
          filename: 'char.json',
        })
        .expect(201);

      expect(response.body.embeddedLorebook).toBeDefined();
      expect(response.body.embeddedLorebook.entryCount).toBe(1);
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
        description: 'Updated Description',
      };

      const response = await request(app)
        .put(`/api/characters/${charId}/update-with-image`)
        .field('characterData', JSON.stringify(updateData))
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
      expect(response.body.description).toBe('Updated Description');
    });
  });

  describe('GET / - List Characters with Data', () => {
    it('should list characters sorted alphabetically', async () => {
      // Clean up any existing characters by using a fresh temp dir
      // Create characters in non-alphabetical order
      await request(app)
        .post('/api/characters')
        .send({ name: 'Zebra Char', description: 'Z' })
        .expect(201);

      await request(app)
        .post('/api/characters')
        .send({ name: 'Apple Char', description: 'A' })
        .expect(201);

      await request(app)
        .post('/api/characters')
        .send({ name: 'Mango Char', description: 'M' })
        .expect(201);

      const response = await request(app).get('/api/characters').expect(200);

      // Find our test characters in the list
      const testChars = response.body.characters.filter((c) =>
        ['Zebra Char', 'Apple Char', 'Mango Char'].includes(c.name),
      );

      const names = testChars.map((c) => c.name);
      expect(names[0]).toBe('Apple Char');
      expect(names[1]).toBe('Mango Char');
      expect(names[2]).toBe('Zebra Char');
    });

    it('should include image URLs when character has image', async () => {
      // Create character with image
      const testPng = createTestPng();
      const characterData = {
        name: 'Image List Char',
        description: 'Has image',
      };

      const createResponse = await request(app)
        .post('/api/characters/create')
        .field('characterData', JSON.stringify(characterData))
        .attach('image', testPng, {
          filename: 'test.png',
          contentType: 'image/png',
        })
        .expect(201);

      const charId = createResponse.body.id;

      const response = await request(app).get('/api/characters').expect(200);

      const char = response.body.characters.find((c) => c.id === charId);
      expect(char).toBeDefined();
      expect(char.imageUrl).toBe(`/api/characters/${charId}/image`);
      expect(char.thumbnailUrl).toBe(`/api/characters/${charId}/thumbnail`);
    });

    it('should calculate total words from stories', async () => {
      // Create character
      const charResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Wordy Char', description: 'Tracks words' })
        .expect(201);

      const charId = charResponse.body.id;

      // Create stories and update word counts using storage directly
      const story1 = await storage.createStory('Story 1', 'First');
      await storage.addCharacterToStory(story1.id, charId);
      // Update word count
      await storage.stmts.updateStoryContent.run('', 1000, new Date().toISOString(), story1.id);

      const story2 = await storage.createStory('Story 2', 'Second');
      await storage.setStoryPersona(story2.id, charId);
      await storage.stmts.updateStoryContent.run('', 500, new Date().toISOString(), story2.id);

      const response = await request(app).get('/api/characters').expect(200);

      const char = response.body.characters.find((c) => c.id === charId);
      expect(char.totalWords).toBe(1500);
    });
  });

  describe('POST /create - Create Character with Image', () => {
    it('should create character with image', async () => {
      const testPng = createTestPng();
      const characterData = {
        name: 'Image Character',
        description: 'Has an image',
        personality: 'Cheerful',
        scenario: 'Modern day',
        first_mes: 'Hi!',
      };

      const response = await request(app)
        .post('/api/characters/create')
        .field('characterData', JSON.stringify(characterData))
        .attach('image', testPng, {
          filename: 'test.png',
          contentType: 'image/png',
        })
        .expect(201);

      expect(response.body.name).toBe('Image Character');
      expect(response.body.imageUrl).toContain('/api/characters/');
    });
  });

  describe('POST /import-url - Import from URL', () => {
    it('should return 400 if URL is missing', async () => {
      const response = await request(app).post('/api/characters/import-url').send({}).expect(400);

      expect(response.body.error).toContain('URL is required');
    });

    it('should return 400 for non-CHUB URLs', async () => {
      const response = await request(app)
        .post('/api/characters/import-url')
        .send({ url: 'https://example.com/character' })
        .expect(400);

      expect(response.body.error).toContain('Only CHUB URLs');
    });

    it('should return 400 for non-string URL', async () => {
      const response = await request(app)
        .post('/api/characters/import-url')
        .send({ url: 123 })
        .expect(400);

      expect(response.body.error).toContain('URL is required');
    });

    it('should handle import errors gracefully', async () => {
      // Mock the ChubImporter to throw an error
      const { ChubImporter } = await import('../../services/chub-importer.js');
      const originalImport = ChubImporter.importFromUrl;
      ChubImporter.importFromUrl = async () => {
        throw new Error('Network error');
      };

      const response = await request(app)
        .post('/api/characters/import-url')
        .send({ url: 'https://chub.ai/characters/test' })
        .expect(400);

      expect(response.body.error).toContain('Failed to import character');

      // Restore original method
      ChubImporter.importFromUrl = originalImport;
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
          personality: 'Original Personality',
        })
        .expect(201);

      charId = createResponse.body.id;
    });

    it('should update system_prompt field', async () => {
      await request(app)
        .put(`/api/characters/${charId}`)
        .send({ system_prompt: 'New system prompt' })
        .expect(200);

      // Verify by fetching character data
      const dataResponse = await request(app).get(`/api/characters/${charId}/data`).expect(200);

      expect(dataResponse.body.character.data.system_prompt).toBe('New system prompt');
    });

    it('should update mes_example field', async () => {
      await request(app)
        .put(`/api/characters/${charId}`)
        .send({ mes_example: 'Example dialogue' })
        .expect(200);

      // Verify by fetching character data
      const dataResponse = await request(app).get(`/api/characters/${charId}/data`).expect(200);

      expect(dataResponse.body.character.data.mes_example).toBe('Example dialogue');
    });
  });

  describe('import progress streaming', () => {
    let origFetch;

    beforeEach(() => {
      const pngBuffer = createTestPng();
      origFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(pngBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
    });

    afterEach(() => {
      globalThis.fetch = origFetch;
    });

    /** Parse an SSE body into the sequence of JSON events it carried. */
    function parseEvents(text) {
      return text
        .split('\n\n')
        .filter((block) => block.startsWith('data: '))
        .map((block) => JSON.parse(block.slice('data: '.length)));
    }

    function cardWithImages(name) {
      return Buffer.from(
        JSON.stringify({
          name,
          description: 'One ![a](https://example.com/one.png)',
          first_mes: 'Two ![b](https://example.com/two.png)',
        }),
      );
    }

    it('streams per-image progress and a terminal done event', async () => {
      const response = await request(app)
        .post('/api/characters/import-json')
        .set('Accept', 'text/event-stream')
        .attach('character', cardWithImages('Streamed'), 'card.json')
        .expect(200);

      expect(response.headers['content-type']).toContain('text/event-stream');

      const events = parseEvents(response.text);
      const start = events.find((e) => e.phase === 'start');
      const images = events.filter((e) => e.phase === 'image');
      const done = events.find((e) => e.type === 'done');

      expect(start.total).toBe(2);
      expect(images).toHaveLength(2);
      // Progress is monotonic and terminates at the total.
      expect(images.map((e) => e.completed)).toEqual([1, 2]);
      expect(images.every((e) => e.ok)).toBe(true);

      // The done event carries the same payload the JSON response would.
      expect(done.id).toBeTruthy();
      expect(done.name).toBe('Streamed');
    });

    it('reports failed downloads without failing the import', async () => {
      globalThis.fetch = async () => new Response('nope', { status: 404 });

      const response = await request(app)
        .post('/api/characters/import-json')
        .set('Accept', 'text/event-stream')
        .attach('character', cardWithImages('Partial'), 'card.json')
        .expect(200);

      const events = parseEvents(response.text);
      const images = events.filter((e) => e.phase === 'image');
      const done = events.find((e) => e.type === 'done');

      expect(images.every((e) => e.ok === false)).toBe(true);
      // Import still succeeds — caching is non-fatal by design.
      expect(done.id).toBeTruthy();
      expect(done.name).toBe('Partial');
    });

    it('streams the embedded lorebook images as a second stage', async () => {
      // A CHUB character with an embedded lorebook caches two sets: the card,
      // then the lorebook — often the larger of the two. Both must report.
      const card = Buffer.from(
        JSON.stringify({
          name: 'With Lore',
          description: 'Card image ![a](https://example.com/card.png)',
          character_book: {
            name: 'Embedded',
            entries: [
              { keys: ['k'], content: 'Lore one ![b](https://example.com/lore1.png)' },
              { keys: ['j'], content: 'Lore two ![c](https://example.com/lore2.png)' },
            ],
          },
        }),
      );

      const response = await request(app)
        .post('/api/characters/import-json')
        .set('Accept', 'text/event-stream')
        .attach('character', card, 'card.json')
        .expect(200);

      const events = parseEvents(response.text);
      const starts = events.filter((e) => e.phase === 'start');

      // Two distinct stages, tagged by entity type.
      expect(starts).toHaveLength(2);
      expect(starts[0].entityType).toBe('characters');
      expect(starts[0].total).toBe(1);
      expect(starts[1].entityType).toBe('lorebooks');
      expect(starts[1].total).toBe(2);

      const lorebookImages = events.filter(
        (e) => e.phase === 'image' && e.entityType === 'lorebooks',
      );
      expect(lorebookImages).toHaveLength(2);

      const done = events.find((e) => e.type === 'done');
      expect(done.embeddedLorebook).toBeTruthy();
      expect(done.embeddedLorebook.entryCount).toBe(2);
    });

    it('delivers a late failure as an error event rather than hanging the stream', async () => {
      // Once progress events have flushed headers the status line is already
      // sent. A throw after that point must still reach the client as a
      // terminal event, or the reader waits forever for a done that never comes.
      const spy = vi
        .spyOn(SqliteStorageService.prototype, 'saveCharacter')
        .mockRejectedValueOnce(new Error('disk on fire'));

      try {
        const response = await request(app)
          .post('/api/characters/import-json')
          .set('Accept', 'text/event-stream')
          .attach('character', cardWithImages('Doomed'), 'card.json')
          .expect(200);

        const events = parseEvents(response.text);
        const error = events.find((e) => e.type === 'error');

        expect(error).toBeTruthy();
        expect(error.error).toContain('disk on fire');
        // And no bogus success terminator.
        expect(events.find((e) => e.type === 'done')).toBeUndefined();
      } finally {
        spy.mockRestore();
      }
    });

    it('still returns plain JSON when the client does not ask to stream', async () => {
      const response = await request(app)
        .post('/api/characters/import-json')
        .attach('character', cardWithImages('Plain'), 'card.json')
        .expect(201);

      expect(response.headers['content-type']).toContain('application/json');
      expect(response.body.name).toBe('Plain');
      expect(response.text).not.toContain('data:');
    });
  });

  describe('image caching persistence', () => {
    // Regression guard: the cacher rewrites cardData in place, so it must run
    // BEFORE saveCharacter. If the order flips, the download still happens and
    // the asset lands on disk, but the persisted card keeps the external URL.
    let origFetch;

    beforeEach(() => {
      const pngBuffer = createTestPng();
      origFetch = globalThis.fetch;
      globalThis.fetch = async () =>
        new Response(pngBuffer, {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        });
    });

    afterEach(() => {
      globalThis.fetch = origFetch;
    });

    it('persists rewritten image URLs on create', async () => {
      const createResponse = await request(app)
        .post('/api/characters')
        .send({
          name: 'Persist Create',
          description: 'External image ![img](https://example.com/photo.png)',
        })
        .expect(201);

      const dataResponse = await request(app)
        .get(`/api/characters/${createResponse.body.id}/data`)
        .expect(200);

      const { description } = dataResponse.body.character.data;
      expect(description).toContain('/api/assets/characters/');
      expect(description).not.toContain('https://example.com/photo.png');
    });

    it('persists rewritten image URLs on update', async () => {
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Persist Update', description: 'No images yet' })
        .expect(201);

      const charId = createResponse.body.id;

      await request(app)
        .put(`/api/characters/${charId}`)
        .send({
          description: 'Now with an image ![img](https://example.com/added.png)',
        })
        .expect(200);

      const dataResponse = await request(app).get(`/api/characters/${charId}/data`).expect(200);

      const { description } = dataResponse.body.character.data;
      expect(description).toContain('/api/assets/characters/');
      expect(description).not.toContain('https://example.com/added.png');
    });

    it('serves the cached asset that a create produced', async () => {
      const createResponse = await request(app)
        .post('/api/characters')
        .send({
          name: 'Persist Serve',
          description: 'External image ![img](https://example.com/served.png)',
        })
        .expect(201);

      const dataResponse = await request(app)
        .get(`/api/characters/${createResponse.body.id}/data`)
        .expect(200);

      // Pull the rewritten local path back out and fetch it end-to-end.
      const match = dataResponse.body.character.data.description.match(
        /\/api\/assets\/characters\/[^)\s]+/,
      );
      expect(match).not.toBeNull();

      await request(app).get(match[0]).expect(200);
    });
  });

  describe('extractAndSaveEmbeddedLorebook error handling', () => {
    it('should handle lorebook with no entries (empty array)', async () => {
      const characterWithEmptyLorebook = {
        name: 'Empty Lore',
        description: 'Has empty lorebook',
        character_book: {
          name: 'Empty',
          entries: [],
        },
      };

      const response = await request(app)
        .post('/api/characters/import-json')
        .attach('character', Buffer.from(JSON.stringify(characterWithEmptyLorebook)), {
          filename: 'char.json',
        })
        .expect(201);

      // No embedded lorebook should be created when entries are empty
      expect(response.body.embeddedLorebook).toBeNull();

      // Verify character was still created
      expect(response.body.name).toBe('Empty Lore');
    });

    it('should handle character data with no extensions field on update-with-image', async () => {
      // Create a character
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'No Ext Char' })
        .expect(201);

      const charId = createResponse.body.id;

      // Update with only ursceal_lorebook_id (covers extensions init path)
      await request(app)
        .put(`/api/characters/${charId}`)
        .send({ ursceal_lorebook_id: 'some-lorebook-id' })
        .expect(200);

      // Verify via data endpoint
      const dataResponse = await request(app).get(`/api/characters/${charId}/data`).expect(200);

      expect(dataResponse.body.character.data.extensions.ursceal_lorebook_id).toBe(
        'some-lorebook-id',
      );
    });
  });

  describe('POST /:characterId/update-with-image edge cases', () => {
    it('should update lorebook association via update-with-image', async () => {
      // Create a character
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Lorebook Update Char' })
        .expect(201);

      const charId = createResponse.body.id;

      // Update with lorebook_id (covers extensions init in update-with-image)
      await request(app)
        .put(`/api/characters/${charId}/update-with-image`)
        .field(
          'characterData',
          JSON.stringify({
            name: 'Lorebook Updated',
            ursceal_lorebook_id: 'test-lorebook-id',
          }),
        )
        .expect(200);

      // Verify via data endpoint
      const dataResponse = await request(app).get(`/api/characters/${charId}/data`).expect(200);

      expect(dataResponse.body.character.data.extensions.ursceal_lorebook_id).toBe(
        'test-lorebook-id',
      );
    });

    it('should accept image with character update', async () => {
      // Create a character
      const createResponse = await request(app)
        .post('/api/characters')
        .send({ name: 'Update Img Char' })
        .expect(201);

      const charId = createResponse.body.id;

      // Update with image
      const testPng = createTestPng();
      const response = await request(app)
        .put(`/api/characters/${charId}/update-with-image`)
        .field('characterData', JSON.stringify({ name: 'Updated Img', description: 'With image' }))
        .attach('image', testPng, {
          filename: 'avatar.png',
          contentType: 'image/png',
        })
        .expect(200);

      expect(response.body.name).toBe('Updated Img');
      expect(response.body.description).toBe('With image');
      expect(response.body.imageUrl).toContain(`/api/characters/${charId}/image`);
    });
  });
});
