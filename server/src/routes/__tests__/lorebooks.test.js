import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the router
import lorebooksRouter from '../lorebooks.js';

describe('Lorebooks API Routes', () => {
  let app;
  let tempDir;

  beforeAll(() => {
    // Create temp directory for test database - shared across all tests
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lorebooks-test-'));
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
    app.use('/api/lorebooks', lorebooksRouter);

    // Add error handler
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal server error'
      });
    });
  });

  describe('GET / - List Lorebooks', () => {
    it('should return lorebooks array', async () => {
      const response = await request(app)
        .get('/api/lorebooks')
        .expect(200);

      expect(response.body).toHaveProperty('lorebooks');
      expect(Array.isArray(response.body.lorebooks)).toBe(true);
    });
  });

  describe('POST /create - Create Lorebook', () => {
    it('should create a new lorebook', async () => {
      const response = await request(app)
        .post('/api/lorebooks/create')
        .send({ name: 'New Lorebook', description: 'A new lorebook' })
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('New Lorebook');
      expect(response.body.description).toBe('A new lorebook');
      expect(response.body.entryCount).toBe(0);
    });

    it('should create lorebook with just name', async () => {
      const response = await request(app)
        .post('/api/lorebooks/create')
        .send({ name: 'Minimal Lorebook' })
        .expect(200);

      expect(response.body.name).toBe('Minimal Lorebook');
      expect(response.body.description).toBe('');
    });

    it('should return 400 if name is missing', async () => {
      const response = await request(app)
        .post('/api/lorebooks/create')
        .send({ description: 'No name' })
        .expect(400);

      expect(response.body.error).toContain('Lorebook name is required');
    });

    it('should return 400 if name is empty', async () => {
      const response = await request(app)
        .post('/api/lorebooks/create')
        .send({ name: '   ' })
        .expect(400);

      expect(response.body.error).toContain('Lorebook name is required');
    });
  });

  describe('GET /:lorebookId - Get Lorebook', () => {
    it('should return lorebook with entries', async () => {
      // Create lorebook via API
      const createResponse = await request(app)
        .post('/api/lorebooks/create')
        .send({ name: 'Test Lorebook', description: 'A test lorebook' })
        .expect(200);

      const lorebookId = createResponse.body.id;

      // Add entries
      await request(app)
        .post(`/api/lorebooks/${lorebookId}/entries`)
        .send({ keys: ['dragon'], content: 'Dragons are mythical' })
        .expect(200);

      await request(app)
        .post(`/api/lorebooks/${lorebookId}/entries`)
        .send({ keys: ['castle'], content: 'A stone fortress' })
        .expect(200);

      const response = await request(app)
        .get(`/api/lorebooks/${lorebookId}`)
        .expect(200);

      expect(response.body.lorebook.name).toBe('Test Lorebook');
      expect(response.body.lorebook.entries).toHaveLength(2);
    });

    it('should return 500 for non-existent lorebook', async () => {
      await request(app)
        .get('/api/lorebooks/non-existent')
        .expect(500);
    });
  });

  describe('PUT /:lorebookId - Update Lorebook', () => {
    let lorebookId;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/lorebooks/create')
        .send({ name: 'Original Name', description: 'Original Description' })
        .expect(200);

      lorebookId = createResponse.body.id;
    });

    it('should update lorebook name', async () => {
      const response = await request(app)
        .put(`/api/lorebooks/${lorebookId}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(response.body.name).toBe('Updated Name');
    });

    it('should update lorebook description', async () => {
      const response = await request(app)
        .put(`/api/lorebooks/${lorebookId}`)
        .send({ description: 'Updated Description' })
        .expect(200);

      expect(response.body.description).toBe('Updated Description');
    });

    it('should update lorebook settings', async () => {
      const response = await request(app)
        .put(`/api/lorebooks/${lorebookId}`)
        .send({
          scanDepth: 1000,
          tokenBudget: 500,
          recursiveScanning: false
        })
        .expect(200);

      // Verify by fetching lorebook
      const getResponse = await request(app)
        .get(`/api/lorebooks/${lorebookId}`)
        .expect(200);

      expect(getResponse.body.lorebook.scanDepth).toBe(1000);
      expect(getResponse.body.lorebook.tokenBudget).toBe(500);
      expect(getResponse.body.lorebook.recursiveScanning).toBe(false);
    });
  });

  describe('DELETE /:lorebookId - Delete Lorebook', () => {
    it('should delete a lorebook', async () => {
      const createResponse = await request(app)
        .post('/api/lorebooks/create')
        .send({ name: 'To Delete', description: 'Will be deleted' })
        .expect(200);

      const lorebookId = createResponse.body.id;

      const response = await request(app)
        .delete(`/api/lorebooks/${lorebookId}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify lorebook is deleted
      await request(app)
        .get(`/api/lorebooks/${lorebookId}`)
        .expect(500);
    });
  });

  describe('Lorebook Entry Operations', () => {
    let lorebookId;

    beforeEach(async () => {
      const createResponse = await request(app)
        .post('/api/lorebooks/create')
        .send({ name: 'Entries Lorebook', description: 'For testing entries' })
        .expect(200);

      lorebookId = createResponse.body.id;
    });

    describe('POST /:lorebookId/entries - Add Entry', () => {
      it('should add a new entry with minimal data', async () => {
        const response = await request(app)
          .post(`/api/lorebooks/${lorebookId}/entries`)
          .send({
            keys: ['test'],
            content: 'Test content'
          })
          .expect(200);

        expect(response.body.entry).toHaveProperty('id');
        expect(response.body.entry.keys).toEqual(['test']);
        expect(response.body.entry.content).toBe('Test content');
        expect(response.body.entry.enabled).toBe(true);
      });

      it('should add entry with all fields', async () => {
        const entryData = {
          keys: ['dragon', 'wyrm'],
          secondaryKeys: ['fire', 'scales'],
          content: 'Dragons are powerful creatures',
          comment: 'Main dragon entry',
          enabled: true,
          constant: false,
          selective: true,
          selectiveLogic: 1,
          insertionOrder: 50,
          position: 2,
          caseSensitive: false,
          matchWholeWords: true,
          useRegex: false,
          probability: 80,
          useProbability: true,
          depth: 3,
          scanDepth: 1500,
          group: 'creatures',
          preventRecursion: true,
          delayUntilRecursion: false
        };

        const response = await request(app)
          .post(`/api/lorebooks/${lorebookId}/entries`)
          .send(entryData)
          .expect(200);

        expect(response.body.entry.keys).toEqual(['dragon', 'wyrm']);
        expect(response.body.entry.secondaryKeys).toEqual(['fire', 'scales']);
        expect(response.body.entry.selective).toBe(true);
        expect(response.body.entry.probability).toBe(80);
        expect(response.body.entry.group).toBe('creatures');
      });

      it('should auto-increment entry IDs', async () => {
        // Add first entry
        const response1 = await request(app)
          .post(`/api/lorebooks/${lorebookId}/entries`)
          .send({ keys: ['first'], content: 'First entry' })
          .expect(200);

        // Add second entry
        const response2 = await request(app)
          .post(`/api/lorebooks/${lorebookId}/entries`)
          .send({ keys: ['second'], content: 'Second entry' })
          .expect(200);

        expect(response2.body.entry.id).toBeGreaterThan(response1.body.entry.id);
      });
    });

    describe('PUT /:lorebookId/entries/:entryId - Update Entry', () => {
      // Helper function to create a fresh lorebook with an entry
      async function createLorebookWithEntry() {
        const createResponse = await request(app)
          .post('/api/lorebooks/create')
          .send({ name: 'Update Test Lorebook', description: 'For update tests' })
          .expect(200);

        const lbId = createResponse.body.id;

        const entryResponse = await request(app)
          .post(`/api/lorebooks/${lbId}/entries`)
          .send({ keys: ['original'], content: 'Original content' })
          .expect(200);

        return { lbId, entryId: entryResponse.body.entry.id };
      }

      it('should update entry content', async () => {
        const { lbId, entryId } = await createLorebookWithEntry();

        const response = await request(app)
          .put(`/api/lorebooks/${lbId}/entries/${entryId}`)
          .send({ content: 'Updated content' })
          .expect(200);

        expect(response.body.entry.content).toBe('Updated content');
      });

      it('should update entry keys', async () => {
        const { lbId, entryId } = await createLorebookWithEntry();

        const response = await request(app)
          .put(`/api/lorebooks/${lbId}/entries/${entryId}`)
          .send({ keys: ['new', 'keys'] })
          .expect(200);

        expect(response.body.entry.keys).toEqual(['new', 'keys']);
      });

      it('should toggle entry enabled state', async () => {
        const { lbId, entryId } = await createLorebookWithEntry();

        const response = await request(app)
          .put(`/api/lorebooks/${lbId}/entries/${entryId}`)
          .send({ enabled: false })
          .expect(200);

        expect(response.body.entry.enabled).toBe(false);
      });

      it('should not change entry ID', async () => {
        const { lbId, entryId } = await createLorebookWithEntry();

        const response = await request(app)
          .put(`/api/lorebooks/${lbId}/entries/${entryId}`)
          .send({ id: 999, content: 'Trying to change ID' })
          .expect(200);

        expect(response.body.entry.id).toBe(entryId);
      });

      it('should return 404 for non-existent entry', async () => {
        const { lbId } = await createLorebookWithEntry();

        const response = await request(app)
          .put(`/api/lorebooks/${lbId}/entries/999`)
          .send({ content: 'Update non-existent' })
          .expect(404);

        expect(response.body.error).toContain('Entry not found');
      });
    });

    describe('DELETE /:lorebookId/entries/:entryId - Delete Entry', () => {
      // Helper function to create a fresh lorebook with entries
      // Note: Due to how saveLorebook works (delete all + re-insert), entry IDs change
      // after each save. We refetch at the end to get the current IDs.
      async function createLorebookWithEntries() {
        const createResponse = await request(app)
          .post('/api/lorebooks/create')
          .send({ name: 'Delete Test Lorebook', description: 'For deletion tests' })
          .expect(200);

        const lbId = createResponse.body.id;

        await request(app)
          .post(`/api/lorebooks/${lbId}/entries`)
          .send({ keys: ['first'], content: 'First' })
          .expect(200);

        await request(app)
          .post(`/api/lorebooks/${lbId}/entries`)
          .send({ keys: ['second'], content: 'Second' })
          .expect(200);

        await request(app)
          .post(`/api/lorebooks/${lbId}/entries`)
          .send({ keys: ['third'], content: 'Third' })
          .expect(200);

        // Refetch to get current entry IDs (they change after each save)
        const getResponse = await request(app)
          .get(`/api/lorebooks/${lbId}`)
          .expect(200);

        const entryIds = getResponse.body.lorebook.entries.map(e => e.id);
        return { lbId, entryIds };
      }

      it('should delete an entry', async () => {
        const { lbId, entryIds } = await createLorebookWithEntries();

        const response = await request(app)
          .delete(`/api/lorebooks/${lbId}/entries/${entryIds[1]}`)
          .expect(200);

        expect(response.body.success).toBe(true);

        // Verify entry is deleted
        const getResponse = await request(app)
          .get(`/api/lorebooks/${lbId}`)
          .expect(200);

        expect(getResponse.body.lorebook.entries).toHaveLength(2);
        expect(getResponse.body.lorebook.entries.find(e => e.id === entryIds[1])).toBeUndefined();
      });

      it('should handle deleting first entry', async () => {
        const { lbId, entryIds } = await createLorebookWithEntries();

        await request(app)
          .delete(`/api/lorebooks/${lbId}/entries/${entryIds[0]}`)
          .expect(200);

        const getResponse = await request(app)
          .get(`/api/lorebooks/${lbId}`)
          .expect(200);

        expect(getResponse.body.lorebook.entries).toHaveLength(2);
      });

      it('should handle deleting last entry', async () => {
        const { lbId, entryIds } = await createLorebookWithEntries();

        await request(app)
          .delete(`/api/lorebooks/${lbId}/entries/${entryIds[2]}`)
          .expect(200);

        const getResponse = await request(app)
          .get(`/api/lorebooks/${lbId}`)
          .expect(200);

        expect(getResponse.body.lorebook.entries).toHaveLength(2);
      });
    });
  });

  describe('POST /import - Import Lorebook File', () => {
    it('should return 400 if no file provided', async () => {
      const response = await request(app)
        .post('/api/lorebooks/import')
        .expect(400);

      expect(response.body.error).toContain('No lorebook file provided');
    });

    it('should import valid lorebook JSON', async () => {
      const lorebookJson = {
        entries: {
          0: {
            uid: 0,
            keys: ['dragon'],
            content: 'A mythical creature',
            comment: 'Dragon entry',
            enabled: true,
            order: 100
          }
        },
        name: 'Imported Lorebook'
      };

      const response = await request(app)
        .post('/api/lorebooks/import')
        .attach('lorebook', Buffer.from(JSON.stringify(lorebookJson)), 'lorebook.json')
        .expect(200);

      expect(response.body).toHaveProperty('id');
      expect(response.body.name).toBe('Imported Lorebook');
      expect(response.body.entryCount).toBe(1);
    });
  });

  describe('POST /import-url - Import from URL', () => {
    it('should return 400 if URL is missing', async () => {
      const response = await request(app)
        .post('/api/lorebooks/import-url')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('URL is required');
    });

    it('should return 400 if URL is not a string', async () => {
      const response = await request(app)
        .post('/api/lorebooks/import-url')
        .send({ url: 123 })
        .expect(400);

      expect(response.body.error).toContain('URL is required');
    });
  });
});
