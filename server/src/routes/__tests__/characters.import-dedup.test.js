import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import charactersRouter from '../characters.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { SqliteStorageService } from '../../services/sqliteStorage.js';

/**
 * A V2 card as it would arrive in a .json import.
 * `character_book` is the SillyTavern-embedded lorebook.
 */
function cardJson({ name = 'Alice', description = 'A knight.', book = null } = {}) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name,
      description,
      personality: 'Brave',
      scenario: '',
      first_mes: 'Hail.',
      mes_example: '',
      ...(book ? { character_book: book } : {}),
    },
  };
}

function worldBook(content = 'Dragons are real.') {
  return {
    name: 'World Book',
    entries: [
      { keys: ['dragon'], content, enabled: true, insertion_order: 100 },
      { keys: ['castle'], content: 'A castle stands here.', enabled: true, insertion_order: 100 },
    ],
  };
}

describe('Character import deduplication', () => {
  let app;
  let tempDir;
  let storage;

  const importJson = (card) =>
    request(app)
      .post('/api/characters/import-json')
      .attach('character', Buffer.from(JSON.stringify(card)), 'card.json');

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'characters-dedup-test-'));
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    storage = new SqliteStorageService(tempDir);
    // Each test starts from an empty library so counts are unambiguous.
    storage.db.exec('DELETE FROM characters; DELETE FROM lorebooks; DELETE FROM stories');

    app = express();
    app.use(express.json());
    app.locals.dataRoot = tempDir;
    app.use('/api/characters', charactersRouter);
    app.use(errorHandler);
  });

  describe('re-importing the same card', () => {
    it('rejects the second import and names the character it already has', async () => {
      const card = cardJson();
      await importJson(card).expect(201);

      const response = await importJson(card).expect(409);

      expect(response.body.error).toContain('already been imported');
      expect(response.body.existingCharacterName).toBe('Alice');
      expect(response.body.existingCharacterId).toBeTruthy();
    });

    it('does not leave a second character behind', async () => {
      await importJson(cardJson()).expect(201);
      await importJson(cardJson()).expect(409);

      const { body } = await request(app).get('/api/characters').expect(200);
      expect(body.characters).toHaveLength(1);
    });

    it('allows a re-import once the stored copy has been edited', async () => {
      // The point of freezing import_internal_checksum: a card the user has
      // since changed no longer blocks getting a clean copy back.
      const { body: first } = await importJson(cardJson()).expect(201);

      await request(app)
        .put(`/api/characters/${first.id}`)
        .send({ description: 'A knight, retired.' })
        .expect(200);

      const { body: second } = await importJson(cardJson()).expect(201);
      expect(second.id).not.toBe(first.id);

      const { body } = await request(app).get('/api/characters').expect(200);
      expect(body.characters).toHaveLength(2);
    });

    it('imports a genuinely different card with the same name', async () => {
      await importJson(cardJson({ description: 'A knight.' })).expect(201);
      await importJson(cardJson({ description: 'A baker.' })).expect(201);

      const { body } = await request(app).get('/api/characters').expect(200);
      expect(body.characters).toHaveLength(2);
    });

    it('never renames an imported card', async () => {
      // data.name is the {{char}} macro and goes straight into the prompt, so a
      // disambiguating suffix would change what the model writes.
      await importJson(cardJson({ description: 'A knight.' })).expect(201);
      await importJson(cardJson({ description: 'A baker.' })).expect(201);

      const { body } = await request(app).get('/api/characters').expect(200);
      expect(body.characters.map((c) => c.name)).toEqual(['Alice', 'Alice']);
    });
  });

  describe('embedded lorebooks', () => {
    it('reuses one lorebook across characters that ship the same book', async () => {
      // The original report: two characters carrying the same world book
      // registered it twice.
      const first = await importJson(cardJson({ name: 'Alice', book: worldBook() })).expect(201);
      const second = await importJson(cardJson({ name: 'Bob', book: worldBook() })).expect(201);

      expect(first.body.embeddedLorebook.reused).toBe(false);
      expect(second.body.embeddedLorebook.reused).toBe(true);
      expect(second.body.embeddedLorebook.id).toBe(first.body.embeddedLorebook.id);

      const lorebooks = storage.db.prepare('SELECT id FROM lorebooks').all();
      expect(lorebooks).toHaveLength(1);
    });

    it('links both characters to the shared lorebook', async () => {
      const first = await importJson(cardJson({ name: 'Alice', book: worldBook() })).expect(201);
      const second = await importJson(cardJson({ name: 'Bob', book: worldBook() })).expect(201);

      const linkOf = async (id) =>
        (await storage.getCharacter(id)).data.extensions.ursceal_lorebook_id;

      expect(await linkOf(second.body.id)).toBe(first.body.embeddedLorebook.id);
    });

    it('still creates a separate lorebook when the content differs', async () => {
      await importJson(cardJson({ name: 'Alice', book: worldBook('Dragons are real.') }));
      await importJson(cardJson({ name: 'Bob', book: worldBook('Dragons are a myth.') }));

      expect(storage.db.prepare('SELECT id FROM lorebooks').all()).toHaveLength(2);
    });

    it('gives a colliding lorebook name a suffix instead of overwriting', async () => {
      await importJson(cardJson({ name: 'Alice', book: worldBook('One.') })).expect(201);
      // Same character name, different book content — same derived lorebook name.
      await importJson(cardJson({ name: 'Alice', description: 'B', book: worldBook('Two.') }));

      const names = storage.db
        .prepare('SELECT name FROM lorebooks ORDER BY name')
        .all()
        .map((r) => r.name);
      expect(names).toEqual(["Alice's Lorebook", "Alice's Lorebook (2)"]);
    });
  });

  describe('deleting a character that has a lorebook', () => {
    it('reports the lorebook it would strand', async () => {
      const { body } = await importJson(cardJson({ name: 'Alice', book: worldBook() }));

      const response = await request(app).delete(`/api/characters/${body.id}`).expect(200);

      expect(response.body.orphanedLorebook).toMatchObject({
        id: body.embeddedLorebook.id,
        name: "Alice's Lorebook",
      });
    });

    it('does not delete the lorebook itself', async () => {
      // The client asks first; this route only reports.
      const { body } = await importJson(cardJson({ name: 'Alice', book: worldBook() }));
      await request(app).delete(`/api/characters/${body.id}`).expect(200);

      expect(storage.db.prepare('SELECT id FROM lorebooks').all()).toHaveLength(1);
    });

    it('stays quiet when another character still uses the lorebook', async () => {
      const first = await importJson(cardJson({ name: 'Alice', book: worldBook() }));
      await importJson(cardJson({ name: 'Bob', book: worldBook() }));

      const response = await request(app).delete(`/api/characters/${first.body.id}`).expect(200);
      expect(response.body.orphanedLorebook).toBeUndefined();
    });

    it('stays quiet when a story still has the lorebook attached', async () => {
      // Stories attach lorebooks directly, and stories.js auto-attaches a
      // character's lorebook when the character joins a story. Counting only
      // characters would offer to delete a lorebook still in active use.
      const { body } = await importJson(cardJson({ name: 'Alice', book: worldBook() }));
      const story = await storage.createStory('A Tale');
      await storage.addLorebookToStory(story.id, body.embeddedLorebook.id);

      const response = await request(app).delete(`/api/characters/${body.id}`).expect(200);
      expect(response.body.orphanedLorebook).toBeUndefined();
    });

    it('reports the lorebook when only stories deleted with the character used it', async () => {
      const { body } = await importJson(cardJson({ name: 'Alice', book: worldBook() }));
      const story = await storage.createStory('A Tale');
      await storage.addCharacterToStory(story.id, body.id);
      await storage.addLorebookToStory(story.id, body.embeddedLorebook.id);

      const response = await request(app)
        .delete(`/api/characters/${body.id}`)
        .send({ deleteStoryIds: [story.id] })
        .expect(200);
      expect(response.body.orphanedLorebook).toMatchObject({ id: body.embeddedLorebook.id });
    });

    it('says nothing for a character with no lorebook', async () => {
      const { body } = await importJson(cardJson());
      const response = await request(app).delete(`/api/characters/${body.id}`).expect(200);
      expect(response.body).toEqual({ success: true });
    });
  });

  describe('checksum bookkeeping through the routes', () => {
    const row = (id) =>
      storage.db
        .prepare(
          `SELECT import_origin_checksum, import_internal_checksum, current_checksum
           FROM characters WHERE id = ?`,
        )
        .get(id);

    it('records an origin checksum on import', async () => {
      const { body } = await importJson(cardJson()).expect(201);
      expect(row(body.id).import_origin_checksum).toBeTruthy();
    });

    it('keeps the origin checksum after the character is edited', async () => {
      const { body } = await importJson(cardJson()).expect(201);
      const before = row(body.id);

      await request(app)
        .put(`/api/characters/${body.id}`)
        .send({ description: 'Changed.' })
        .expect(200);

      const after = row(body.id);
      expect(after.import_origin_checksum).toBe(before.import_origin_checksum);
      expect(after.import_internal_checksum).toBe(before.import_internal_checksum);
      expect(after.current_checksum).not.toBe(before.current_checksum);
    });

    it('leaves no origin checksum on a character created in the app', async () => {
      const { body } = await request(app)
        .post('/api/characters')
        .send({ name: 'Home-grown' })
        .expect(201);

      expect(row(body.id).import_origin_checksum).toBeNull();
      expect(row(body.id).current_checksum).toBeTruthy();
    });
  });
});
