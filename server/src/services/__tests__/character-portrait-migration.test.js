import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { SqliteStorageService } from '../sqliteStorage.js';
import { SCHEMA_VERSION } from '../database.js';
import { generateMissingThumbnails } from '../migration.js';

/** A 512x768 gradient, with far more than 256 colours. */
function gradientPng() {
  const width = 512;
  const height = 768;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      pixels[i] = x / 2;
      pixels[i + 1] = y / 3;
      pixels[i + 2] = (x + y) % 256;
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

/** Roll the main database back to v19, before portraits, when thumbnails were 256-colour PNGs. */
function downgradeToV19(dataRoot) {
  const db = new Database(path.join(dataRoot, 'writers-guild.db'));
  db.exec('ALTER TABLE characters DROP COLUMN portrait');
  db.prepare('UPDATE schema_version SET version = 19').run();
  db.close();
}

describe('character portraits', () => {
  let dataRoot;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'character-portrait-test-'));
  });

  afterEach(() => {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('saves full-colour thumbnails and a portrait beside the image', async () => {
    const storage = new SqliteStorageService(dataRoot);
    try {
      const image = await gradientPng();
      await storage.saveCharacter('char-1', { data: { name: 'Ada' } }, image);

      for (const buffer of [
        await storage.getCharacterThumbnail('char-1'),
        await storage.getCharacterThumbnailMedium('char-1'),
        await storage.getCharacterPortrait('char-1'),
      ]) {
        const metadata = await sharp(buffer).metadata();
        expect(metadata.format).toBe('webp');
        expect(metadata.isPalette).toBeFalsy();
      }
      const portrait = await sharp(await storage.getCharacterPortrait('char-1')).metadata();
      expect([portrait.width, portrait.height]).toEqual([512, 768]);
      expect(storage.listCharacterSummaries()[0].hasPortrait).toBe(true);
    } finally {
      storage.close();
    }
  });

  it('turns photos the way their EXIF orientation says before resizing', async () => {
    const storage = new SqliteStorageService(dataRoot);
    try {
      // Stored 768x512, shown 512x768 once rotated by its orientation tag
      const sideways = await sharp(await gradientPng())
        .rotate(90)
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();
      await storage.saveCharacter('char-1', { data: { name: 'Ada' } }, sideways);

      const portrait = await sharp(await storage.getCharacterPortrait('char-1')).metadata();
      expect([portrait.width, portrait.height]).toEqual([512, 768]);
    } finally {
      storage.close();
    }
  });

  it('adds the portrait column and clears old thumbnails so they are rendered again', async () => {
    const storage = new SqliteStorageService(dataRoot);
    await storage.saveCharacter('char-1', { data: { name: 'Ada' } }, await gradientPng());
    storage.close();
    downgradeToV19(dataRoot);

    const migrated = new SqliteStorageService(dataRoot);
    try {
      expect(await migrated.hasCharacterImage('char-1')).toBe(true);
      expect(await migrated.hasCharacterThumbnail('char-1')).toBe(false);
      expect(await migrated.hasCharacterThumbnailMedium('char-1')).toBe(false);
      expect(await migrated.hasCharacterPortrait('char-1')).toBe(false);
      expect(migrated.db.prepare('SELECT version FROM schema_version').get().version).toBe(
        SCHEMA_VERSION,
      );

      // The startup backfill renders all three again
      expect(await generateMissingThumbnails(migrated)).toBe(1);
      expect(await migrated.hasCharacterThumbnail('char-1')).toBe(true);
      expect(await migrated.hasCharacterThumbnailMedium('char-1')).toBe(true);
      expect(await migrated.hasCharacterPortrait('char-1')).toBe(true);
    } finally {
      migrated.close();
    }
  });

  it('leaves the sizes of an image replaced while the backfill was rendering', async () => {
    const storage = new SqliteStorageService(dataRoot);
    try {
      const oldImage = await gradientPng();
      await storage.saveCharacter('char-1', { data: { name: 'Ada' } }, oldImage);
      const stale = await storage.generateImageSizes(oldImage);

      const newImage = await sharp(oldImage).resize(200, 300).png().toBuffer();
      await storage.saveCharacter('char-1', { data: { name: 'Ada' } }, newImage);
      const fresh = await storage.getCharacterPortrait('char-1');

      expect(await storage.setCharacterThumbnails('char-1', oldImage, stale)).toBe(false);
      expect((await storage.getCharacterPortrait('char-1')).equals(fresh)).toBe(true);
    } finally {
      storage.close();
    }
  });
});
