import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteStorageService } from '../sqliteStorage.js';
import { ContinuityStorage } from '../continuity/continuity-storage.js';
import {
  DEFAULT_SETS_DIR,
  importDefaultSet,
  importDefaultSets,
  listDefaultSetDirs,
  readDefaultSet,
} from '../default-sets.js';

const LOIRE_DIR = path.join(DEFAULT_SETS_DIR, 'loire');

/** A minimal valid set written to `dir`, with `overrides` applied to its manifest. */
function writeSet(dir, overrides = {}) {
  fs.mkdirSync(path.join(dir, 'characters'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'stories'), { recursive: true });
  const card = (name) => ({ spec: 'chara_card_v2', spec_version: '2.0', data: { name } });
  fs.writeFileSync(path.join(dir, 'characters/a.json'), JSON.stringify(card('Ada')));
  fs.writeFileSync(path.join(dir, 'characters/b.json'), JSON.stringify(card('Bo')));
  fs.writeFileSync(
    path.join(dir, 'lorebook.json'),
    JSON.stringify({ name: 'World', entries: { 0: { uid: 0, key: ['sea'], content: 'Wet.' } } }),
  );
  fs.writeFileSync(
    path.join(dir, 'continuity.json'),
    JSON.stringify({
      name: 'Arc',
      versions: [
        { source: 'created', content: 'Before.' },
        { source: 'archivist', story: 'stories/one.json', content: 'After.' },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'stories/one.json'),
    JSON.stringify({
      title: 'One',
      characters: ['characters/a.json', 'characters/b.json'],
      content: 'one.txt',
    }),
  );
  fs.writeFileSync(path.join(dir, 'stories/one.txt'), 'It happened.\n');
  fs.writeFileSync(
    path.join(dir, 'set.json'),
    JSON.stringify({
      name: 'Test set',
      characters: ['characters/a.json', 'characters/b.json'],
      lorebook: 'lorebook.json',
      continuity: 'continuity.json',
      stories: ['stories/one.json'],
      ...overrides,
    }),
  );
}

describe('default sets', () => {
  let tempDir;
  let storage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'default-sets-test-'));
    storage = new SqliteStorageService(path.join(tempDir, 'data'));
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('the bundled Loire set', () => {
    it('reads cleanly, with every reference resolved', async () => {
      const set = await readDefaultSet(LOIRE_DIR);

      expect(set.name).toBe('The Loire');
      expect(set.characters.map((c) => c.card.data.name)).toEqual([
        'Ingrid Halvorsen',
        'Tomás Araya',
        'Priya Venkataraman',
        'Wekesa Odhiambo',
      ]);
      for (const character of set.characters) {
        expect(character.card.data.character_book).toBeNull();
        expect(character.card.data.first_mes.length).toBeGreaterThan(0);
      }

      expect(set.lorebook.name).toBe('The Loire');
      expect(set.lorebook.entries.length).toBeGreaterThanOrEqual(10);
      expect(set.lorebook.entries.some((entry) => entry.constant)).toBe(true);

      expect(set.stories.map((s) => s.title)).toEqual(['Spin Down', 'The Cellar']);
      for (const story of set.stories) {
        expect(story.characters).toHaveLength(4);
        expect(story.scenario.length).toBeGreaterThan(0);
        expect(story.content.split(/\s+/).length).toBeGreaterThan(1000);
      }
      expect(set.stories[0].perspective).toBe('third_limited');
      expect(set.stories[0].perspectiveCharacter).toBe('characters/venkataraman.json');

      expect(set.continuity.versions).toHaveLength(2);
      expect(set.continuity.versions[1]).toMatchObject({
        source: 'archivist',
        story: 'stories/02-the-cellar.json',
      });
    });

    it('is found by listDefaultSetDirs', async () => {
      expect(await listDefaultSetDirs()).toContain(LOIRE_DIR);
    });
  });

  describe('importDefaultSet', () => {
    it('links the stories to the cast, the lorebook, the persona and the continuity', async () => {
      await storage.saveCharacter('persona-1', {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name: 'Reader', extensions: { is_persona: true } },
      });
      const set = await readDefaultSet(LOIRE_DIR);

      const result = await importDefaultSet(storage, set, { defaultPersonaId: 'persona-1' });

      expect(result.characters).toHaveLength(4);
      expect(result.stories).toHaveLength(2);
      const characterIds = result.characters.map((c) => c.id);

      for (const { id } of result.stories) {
        const story = await storage.getStory(id);
        expect(story.characterIds.sort()).toEqual([...characterIds].sort());
        expect(story.lorebookIds).toEqual([result.lorebook.id]);
        expect(story.personaCharacterId).toBe('persona-1');
        expect(story.continuityId).toBe(result.continuity.id);
        expect(story.needsRewritePrompt).toBe(false);
        expect(story.content.length).toBeGreaterThan(1000);
        expect(story.scenario.length).toBeGreaterThan(0);
      }

      const spinDown = await storage.getStory(result.stories[0].id);
      const priya = result.characters.find((c) => c.name === 'Priya Venkataraman');
      expect(spinDown.perspective).toBe('third_limited');
      expect(spinDown.perspectiveTense).toBe('past');
      expect(spinDown.perspectiveCharacterId).toBe(priya.id);

      const lorebook = await storage.getLorebook(result.lorebook.id);
      expect(lorebook.entries).toHaveLength(set.lorebook.entries.length);
    });

    it('seeds the continuity with its version history', async () => {
      const set = await readDefaultSet(LOIRE_DIR);
      const result = await importDefaultSet(storage, set);

      const continuities = new ContinuityStorage(storage.db);
      const continuity = continuities.get(result.continuity.id);
      expect(continuity.name).toBe(set.continuity.name);
      expect(continuity.content).toBe(set.continuity.versions.at(-1).content);
      expect(continuity.storyCount).toBe(2);

      const versions = continuities.listVersions(continuity.id);
      expect(versions.map((v) => v.source)).toEqual(['created', 'archivist']);
      expect(versions[0].content).toBe(set.continuity.versions[0].content);
      expect(versions[1].sourceId).toBe(`story:${result.stories[1].id}`);
      expect(versions[1].sourceTitle).toBe('The Cellar');
    });

    it('uses a PNG beside a card as its portrait', async () => {
      const setDir = path.join(tempDir, 'set');
      writeSet(setDir);
      // A 1x1 PNG; sharp needs a real image to make thumbnails from
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      );
      fs.writeFileSync(path.join(setDir, 'characters/a.png'), png);

      const set = await readDefaultSet(setDir);
      expect(set.characters[0].image).toEqual(png);
      expect(set.characters[1].image).toBeNull();

      const result = await importDefaultSet(storage, set);
      expect(await storage.hasCharacterImage(result.characters[0].id)).toBe(true);
      expect(await storage.hasCharacterImage(result.characters[1].id)).toBe(false);
    });
  });

  describe('readDefaultSet', () => {
    it('rejects a story whose cast is not in the set', async () => {
      const setDir = path.join(tempDir, 'set');
      writeSet(setDir);
      fs.writeFileSync(
        path.join(setDir, 'stories/one.json'),
        JSON.stringify({ title: 'One', characters: ['characters/zz.json'], content: 'one.txt' }),
      );
      await expect(readDefaultSet(setDir)).rejects.toThrow(/names a character not in the set/);
    });

    it('rejects a continuity version from a story not in the set', async () => {
      const setDir = path.join(tempDir, 'set');
      writeSet(setDir);
      fs.writeFileSync(
        path.join(setDir, 'continuity.json'),
        JSON.stringify({
          name: 'Arc',
          versions: [
            { source: 'created', content: 'Before.' },
            { source: 'archivist', story: 'stories/two.json', content: 'After.' },
          ],
        }),
      );
      await expect(readDefaultSet(setDir)).rejects.toThrow(/names a story not in the set/);
    });

    it('rejects a path that leaves the set folder', async () => {
      const setDir = path.join(tempDir, 'set');
      writeSet(setDir, { lorebook: '../outside.json' });
      await expect(readDefaultSet(setDir)).rejects.toThrow(/must be inside the set/);
    });
  });

  describe('importDefaultSets', () => {
    it('imports every set under the root and skips a broken one', async () => {
      const root = path.join(tempDir, 'sets');
      writeSet(path.join(root, 'good'));
      writeSet(path.join(root, 'broken'), { stories: ['stories/missing.json'] });
      fs.mkdirSync(path.join(root, 'not-a-set'));

      const result = await importDefaultSets(storage, { root });

      expect(result.characters.map((c) => c.name)).toEqual(['Ada', 'Bo']);
      expect(result.lorebooks).toHaveLength(1);
      expect(result.continuities).toHaveLength(1);
      expect(result.stories.map((s) => s.title)).toEqual(['One']);
      expect(await storage.listStories()).toHaveLength(1);
    });

    it('imports nothing when the root does not exist', async () => {
      const result = await importDefaultSets(storage, { root: path.join(tempDir, 'nowhere') });
      expect(result).toEqual({ characters: [], lorebooks: [], continuities: [], stories: [] });
    });
  });
});
