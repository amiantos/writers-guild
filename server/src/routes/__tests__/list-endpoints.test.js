import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import charactersRouter from '../characters.js';
import lorebooksRouter from '../lorebooks.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { SqliteStorageService } from '../../services/sqliteStorage.js';

/**
 * The landing page fetches these lists on every load, so their cost scales with
 * the whole library. These tests pin the shape and the linking behaviour; the
 * cost itself is guarded by keeping the work per request proportional to the
 * number of characters rather than characters × lorebooks.
 */
describe('landing page list endpoints', () => {
  let app;
  let tempDir;
  let storage;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-endpoints-'));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    storage = new SqliteStorageService(tempDir);
    storage.db.exec(
      'DELETE FROM characters; DELETE FROM lorebooks; DELETE FROM stories; DELETE FROM story_characters; DELETE FROM story_lorebooks',
    );

    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.use('/api/characters', charactersRouter);
    app.use('/api/lorebooks', lorebooksRouter);
    app.use(errorHandler);
  });

  /** A character card linked to a lorebook, with an image present. */
  async function seedCharacter(id, name, lorebookId = null) {
    await storage.saveCharacter(
      id,
      {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
          name,
          description: 'A long description that the list does not need.',
          tags: ['knight'],
          extensions: lorebookId ? { ursceal_lorebook_id: lorebookId } : {},
        },
      },
      null,
    );
  }

  async function seedLorebook(id, name) {
    await storage.saveLorebook(id, { name, entries: [{ keys: ['k'], content: 'c' }] });
  }

  describe('GET /api/lorebooks', () => {
    it('lists the characters linked to each lorebook', async () => {
      await seedLorebook('lb-1', 'World Book');
      await seedLorebook('lb-2', 'Other Book');
      await seedCharacter('char-1', 'Alice', 'lb-1');
      await seedCharacter('char-2', 'Bob', 'lb-1');
      await seedCharacter('char-3', 'Carol', 'lb-2');

      const { body } = await request(app).get('/api/lorebooks').expect(200);
      const byId = Object.fromEntries(body.lorebooks.map((l) => [l.id, l]));

      expect(byId['lb-1'].characters.map((c) => c.name).toSorted()).toEqual(['Alice', 'Bob']);
      expect(byId['lb-2'].characters.map((c) => c.name)).toEqual(['Carol']);
    });

    it('gives a lorebook nothing links to an empty character list', async () => {
      await seedLorebook('lb-1', 'Unused Book');
      await seedCharacter('char-1', 'Alice');

      const { body } = await request(app).get('/api/lorebooks').expect(200);
      expect(body.lorebooks[0].characters).toEqual([]);
    });

    it('lists the stories each lorebook is attached to, and when it was made and edited', async () => {
      await seedLorebook('lb-1', 'World Book');
      await seedLorebook('lb-2', 'Unused Book');
      const first = await storage.createStory('First');
      const second = await storage.createStory('Second');
      await storage.addLorebookToStory(first.id, 'lb-1');
      await storage.addLorebookToStory(second.id, 'lb-1');

      const { body } = await request(app).get('/api/lorebooks').expect(200);
      const byId = Object.fromEntries(body.lorebooks.map((l) => [l.id, l]));

      expect(byId['lb-1'].storyIds.toSorted()).toEqual([first.id, second.id].toSorted());
      expect(byId['lb-2'].storyIds).toEqual([]);
      expect(byId['lb-1'].created).toEqual(expect.any(String));
      expect(byId['lb-1'].modified).toEqual(expect.any(String));
    });

    it('keeps entry counts alongside the linked characters', async () => {
      await seedLorebook('lb-1', 'World Book');
      await seedCharacter('char-1', 'Alice', 'lb-1');

      const { body } = await request(app).get('/api/lorebooks').expect(200);
      expect(body.lorebooks[0]).toMatchObject({ name: 'World Book', entryCount: 1 });
    });
  });

  describe('GET /api/characters', () => {
    it('omits description, which nothing in the list views renders', async () => {
      // This list is fetched on every landing-page load; descriptions were the
      // bulk of its payload. CharacterDetail reads the full card separately.
      await seedCharacter('char-1', 'Alice');

      const { body } = await request(app).get('/api/characters').expect(200);
      expect(body.characters[0]).not.toHaveProperty('description');
    });

    it('keeps the fields the list views do use', async () => {
      await seedCharacter('char-1', 'Alice');

      const { body } = await request(app).get('/api/characters').expect(200);
      expect(body.characters[0]).toMatchObject({
        id: 'char-1',
        name: 'Alice',
        tags: ['knight'],
        totalWords: 0,
      });
    });

    it('totals words across every story a character appears in', async () => {
      await seedCharacter('char-1', 'Alice');
      await seedCharacter('char-2', 'Bob');

      const first = await storage.createStory('One');
      const second = await storage.createStory('Two');
      await storage.updateStoryContent(first.id, 'word '.repeat(100));
      await storage.updateStoryContent(second.id, 'word '.repeat(50));
      await storage.addCharacterToStory(first.id, 'char-1');
      await storage.addCharacterToStory(second.id, 'char-1');
      await storage.addCharacterToStory(second.id, 'char-2');

      const { body } = await request(app).get('/api/characters').expect(200);
      const byName = Object.fromEntries(body.characters.map((c) => [c.name, c]));

      expect(byName.Alice.totalWords).toBe(150);
      expect(byName.Bob.totalWords).toBe(50);
    });

    it('counts a story once when the character is also its persona', async () => {
      await seedCharacter('char-1', 'Alice');
      const story = await storage.createStory('One');
      await storage.updateStoryContent(story.id, 'word '.repeat(100));
      await storage.addCharacterToStory(story.id, 'char-1');
      await storage.setStoryPersona(story.id, 'char-1');

      const { body } = await request(app).get('/api/characters').expect(200);
      expect(body.characters[0].totalWords).toBe(100);
    });

    it('reports no image URLs for a character with no image', async () => {
      await seedCharacter('char-1', 'Alice');

      const { body } = await request(app).get('/api/characters').expect(200);
      expect(body.characters[0]).toMatchObject({
        imageUrl: null,
        thumbnailUrl: null,
        thumbnailMediumUrl: null,
      });
    });
  });
});
