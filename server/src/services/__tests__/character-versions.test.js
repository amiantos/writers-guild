import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { SqliteStorageService } from '../sqliteStorage.js';
import { SCHEMA_VERSION } from '../database.js';

function card(fields = {}) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: { name: 'Ada', description: 'An inventor.', personality: 'Curious', ...fields },
  };
}

async function png() {
  return sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

/** Roll the main database back to v12, before character versions. */
function downgradeToV12(dataRoot) {
  const db = new Database(path.join(dataRoot, 'writers-guild.db'));
  db.exec('DROP TABLE character_versions');
  db.prepare('UPDATE schema_version SET version = 12').run();
  db.close();
}

describe('character versions', () => {
  let dataRoot;
  let storage;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'character-versions-test-'));
    storage = new SqliteStorageService(dataRoot);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('keeps nothing until the card changes', async () => {
    await storage.saveCharacter('c1', card());
    expect(storage.listCharacterVersions('c1')).toEqual([]);
    expect(storage.characterEditedSinceImport('c1')).toBe(false);
  });

  it('keeps the card as imported, then each change with the fields it changed', async () => {
    await storage.saveCharacter('c1', card(), null, { originChecksum: 'source' });
    const imported = await storage.getCharacter('c1');
    await storage.saveCharacter('c1', card({ description: 'A famous inventor.' }));
    await storage.saveCharacter(
      'c1',
      card({ description: 'A famous inventor.', personality: 'Bold', name: 'Ada L.' }),
    );

    const versions = storage.listCharacterVersions('c1');
    expect(versions.map((v) => v.source)).toEqual(['original', 'edit', 'edit']);
    expect(versions[0].created).toBe(imported.metadata.created);
    expect(versions[0].data.data.description).toBe('An inventor.');
    expect(versions.map((v) => v.changed)).toEqual([[], ['description'], ['name', 'personality']]);
    expect(storage.characterEditedSinceImport('c1')).toBe(true);
  });

  it("doesn't keep a save that changes nothing", async () => {
    await storage.saveCharacter('c1', card());
    await storage.saveCharacter('c1', card({ personality: 'Bold' }));
    await storage.saveCharacter('c1', card({ personality: 'Bold' }));
    expect(storage.listCharacterVersions('c1')).toHaveLength(2);
  });

  it('notes a lorebook link, a replaced portrait, and other changes', async () => {
    await storage.saveCharacter('c1', card());
    await storage.saveCharacter('c1', card({ extensions: { ursceal_lorebook_id: 'lb1' } }));
    await storage.saveCharacter(
      'c1',
      card({ extensions: { ursceal_lorebook_id: 'lb1' } }),
      await png(),
    );
    await storage.saveCharacter(
      'c1',
      card({ extensions: { ursceal_lorebook_id: 'lb1' }, tags: ['science'] }),
    );

    const versions = storage.listCharacterVersions('c1');
    expect(versions.map((v) => v.changed)).toEqual([[], ['lorebook'], ['portrait'], ['other']]);
    expect(versions[2].imageChanged).toBe(true);
  });

  it('starts from a baseline when the card was already edited before versions were kept', async () => {
    await storage.saveCharacter('c1', card());
    await storage.saveCharacter('c1', card({ personality: 'Bold' }));
    storage.db.prepare('DELETE FROM character_versions').run();

    await storage.saveCharacter('c1', card({ personality: 'Bolder' }));
    const versions = storage.listCharacterVersions('c1');
    expect(versions.map((v) => v.source)).toEqual(['baseline', 'edit']);
    expect(versions[0].data.data.personality).toBe('Bold');
  });

  it('restores an earlier version as a new one, keeping the portrait', async () => {
    const image = await png();
    await storage.saveCharacter('c1', card(), image);
    await storage.saveCharacter('c1', card({ description: 'Changed.' }));
    const [original] = storage.listCharacterVersions('c1');

    const restored = await storage.restoreCharacterVersion('c1', original.id);
    expect(restored.data.description).toBe('An inventor.');
    expect(await storage.hasCharacterImage('c1')).toBe(true);

    const versions = storage.listCharacterVersions('c1');
    expect(versions.map((v) => v.source)).toEqual(['original', 'edit', 'restore']);
    expect(versions[2].sourceId).toBe(String(original.id));
    expect(versions[2].changed).toEqual(['description']);
    expect(storage.characterEditedSinceImport('c1')).toBe(false);
  });

  it("returns null restoring a version that isn't the character's", async () => {
    await storage.saveCharacter('c1', card());
    await storage.saveCharacter('c1', card({ description: 'Changed.' }));
    await storage.saveCharacter('c2', card());
    const [original] = storage.listCharacterVersions('c1');
    expect(await storage.restoreCharacterVersion('c2', original.id)).toBeNull();
  });

  it('deletes versions with their character', async () => {
    await storage.saveCharacter('c1', card());
    await storage.saveCharacter('c1', card({ description: 'Changed.' }));
    await storage.deleteCharacter('c1');
    expect(storage.db.prepare('SELECT COUNT(*) AS n FROM character_versions').get().n).toBe(0);
  });

  it('adds the table when migrating from v12', async () => {
    await storage.saveCharacter('c1', card());
    storage.close();
    downgradeToV12(dataRoot);

    storage = new SqliteStorageService(dataRoot);
    expect(storage.db.prepare('SELECT version FROM schema_version').get().version).toBe(
      SCHEMA_VERSION,
    );
    await storage.saveCharacter('c1', card({ description: 'Changed.' }));
    expect(storage.listCharacterVersions('c1').map((v) => v.source)).toEqual(['original', 'edit']);
  });
});
