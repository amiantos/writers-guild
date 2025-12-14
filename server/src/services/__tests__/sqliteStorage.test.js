import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteStorageService } from '../sqliteStorage.js';

describe('SqliteStorageService - Comprehensive Tests', () => {
  let storage;
  let tempDir;

  beforeEach(() => {
    // Create temp directory for test database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-storage-test-'));
    storage = new SqliteStorageService(tempDir);
  });

  afterEach(() => {
    // Close storage and clean up
    if (storage) {
      storage.close();
    }
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Settings Operations', () => {
    it('should return default settings', async () => {
      const settings = await storage.getSettings();
      expect(settings).toBeTruthy();
      expect(settings).toHaveProperty('onboardingCompleted');
    });

    it('should save and retrieve settings', async () => {
      await storage.saveSettings({
        showReasoning: true,
        autoSave: false,
        temperature: 1.2,
        lorebookScanDepth: 3000
      });

      const settings = await storage.getSettings();
      expect(settings.showReasoning).toBe(true);
      expect(settings.autoSave).toBe(false);
      expect(settings.lorebookScanDepth).toBe(3000);
    });

    it('should update only specified settings', async () => {
      await storage.saveSettings({
        showReasoning: true,
        autoSave: true
      });

      await storage.saveSettings({
        showReasoning: false
      });

      const settings = await storage.getSettings();
      expect(settings.showReasoning).toBe(false);
    });

    it('should handle default persona ID', async () => {
      await storage.saveSettings({ defaultPersonaId: 'test-persona' });
      const settings = await storage.getSettings();
      expect(settings.defaultPersonaId).toBe('test-persona');
    });

    it('should clear default persona ID with null', async () => {
      await storage.saveSettings({ defaultPersonaId: 'test-persona' });
      await storage.saveSettings({ defaultPersonaId: null });
      const settings = await storage.getSettings();
      expect(settings.defaultPersonaId).toBeNull();
    });
  });

  describe('Story Operations', () => {
    it('should create and list stories', async () => {
      const story = await storage.createStory('Test Story', 'A description');

      expect(story.id).toBeTruthy();
      expect(story.title).toBe('Test Story');
      expect(story.description).toBe('A description');

      const stories = await storage.listStories();
      expect(stories).toHaveLength(1);
      expect(stories[0].title).toBe('Test Story');
    });

    it('should get story by ID', async () => {
      const created = await storage.createStory('Get Story', 'Description');
      const story = await storage.getStory(created.id);

      expect(story.id).toBe(created.id);
      expect(story.title).toBe('Get Story');
      expect(story.content).toBe('');
    });

    it('should throw error for non-existent story', async () => {
      await expect(storage.getStory('non-existent')).rejects.toThrow('Story not found');
    });

    it('should create story with needsRewritePrompt option', async () => {
      const story = await storage.createStory('Rewrite Story', 'Desc', { needsRewritePrompt: true });
      expect(story.needsRewritePrompt).toBe(true);
    });

    it('should update story metadata', async () => {
      const story = await storage.createStory('Original', 'Original Desc');

      const updated = await storage.updateStoryMetadata(story.id, {
        title: 'Updated Title',
        description: 'Updated Desc'
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.description).toBe('Updated Desc');
    });

    it('should update story content', async () => {
      const story = await storage.createStory('Content Story', 'Desc');

      const result = await storage.updateStoryContent(story.id, 'New content here');
      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);

      const updated = await storage.getStory(story.id);
      expect(updated.content).toBe('New content here');
    });

    it('should not mark as changed when content is the same', async () => {
      const story = await storage.createStory('Same Content', 'Desc');
      await storage.updateStoryContent(story.id, 'Same content');

      const result = await storage.updateStoryContent(story.id, 'Same content');
      expect(result.changed).toBe(false);
    });

    it('should delete story', async () => {
      const story = await storage.createStory('To Delete', 'Desc');
      await storage.deleteStory(story.id);

      const stories = await storage.listStories();
      expect(stories).toHaveLength(0);
    });

    it('should set story needs rewrite prompt', async () => {
      const story = await storage.createStory('Rewrite', 'Desc');
      await storage.setStoryNeedsRewritePrompt(story.id, true);

      const updated = await storage.getStory(story.id);
      expect(updated.needsRewritePrompt).toBe(true);
    });

    it('should update avatar windows', async () => {
      const story = await storage.createStory('Avatar Story', 'Desc');
      const avatarWindows = [
        { id: 'w1', characterId: 'c1', x: 100, y: 100, width: 200, height: 200 }
      ];

      await storage.updateStoryAvatarWindows(story.id, avatarWindows);

      const updated = await storage.getStory(story.id);
      expect(updated.avatarWindows).toEqual(avatarWindows);
    });
  });

  describe('Character Operations', () => {
    const sampleCharacterData = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: 'Test Character',
        description: 'A test character',
        personality: 'Friendly',
        first_mes: 'Hello!'
      }
    };

    it('should save and list characters', async () => {
      await storage.saveCharacter('char-1', sampleCharacterData, null);

      const characters = await storage.listAllCharacters();
      expect(characters).toHaveLength(1);
      expect(characters[0].name).toBe('Test Character');
    });

    it('should get character by ID', async () => {
      await storage.saveCharacter('char-1', sampleCharacterData, null);

      const character = await storage.getCharacter('char-1');
      expect(character.data.name).toBe('Test Character');
      expect(character.data.personality).toBe('Friendly');
    });

    it('should throw error for non-existent character', async () => {
      await expect(storage.getCharacter('non-existent')).rejects.toThrow('Character not found');
    });

    it('should update existing character', async () => {
      await storage.saveCharacter('char-1', sampleCharacterData, null);

      const updatedData = {
        ...sampleCharacterData,
        data: { ...sampleCharacterData.data, name: 'Updated Name' }
      };
      await storage.saveCharacter('char-1', updatedData, null);

      const character = await storage.getCharacter('char-1');
      expect(character.data.name).toBe('Updated Name');
    });

    it('should delete character', async () => {
      await storage.saveCharacter('char-1', sampleCharacterData, null);
      await storage.deleteCharacter('char-1');

      const characters = await storage.listAllCharacters();
      expect(characters).toHaveLength(0);
    });

    it('should return false for hasCharacterImage when no image', async () => {
      await storage.saveCharacter('char-1', sampleCharacterData, null);
      const hasImage = await storage.hasCharacterImage('char-1');
      expect(hasImage).toBe(false);
    });

    it('should return null for getCharacterImage when no image', async () => {
      await storage.saveCharacter('char-1', sampleCharacterData, null);
      const image = await storage.getCharacterImage('char-1');
      expect(image).toBeNull();
    });
  });

  describe('Story-Character Associations', () => {
    let storyId;
    let characterId;

    beforeEach(async () => {
      const story = await storage.createStory('Assoc Story', 'Desc');
      storyId = story.id;

      const characterData = {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name: 'Assoc Char', description: 'Test' }
      };
      characterId = 'assoc-char';
      await storage.saveCharacter(characterId, characterData, null);
    });

    it('should add character to story', async () => {
      await storage.addCharacterToStory(storyId, characterId);

      const story = await storage.getStory(storyId);
      expect(story.characterIds).toContain(characterId);
    });

    it('should list story characters', async () => {
      await storage.addCharacterToStory(storyId, characterId);

      const characters = await storage.listStoryCharacters(storyId);
      expect(characters).toHaveLength(1);
      expect(characters[0].id).toBe(characterId);
    });

    it('should remove character from story', async () => {
      await storage.addCharacterToStory(storyId, characterId);
      await storage.removeCharacterFromStory(storyId, characterId);

      const story = await storage.getStory(storyId);
      expect(story.characterIds).not.toContain(characterId);
    });

    it('should set story persona', async () => {
      await storage.setStoryPersona(storyId, characterId);

      const story = await storage.getStory(storyId);
      expect(story.personaCharacterId).toBe(characterId);
    });

    it('should clear persona when removing character that is persona', async () => {
      await storage.addCharacterToStory(storyId, characterId);
      await storage.setStoryPersona(storyId, characterId);
      await storage.removeCharacterFromStory(storyId, characterId);

      const story = await storage.getStory(storyId);
      expect(story.personaCharacterId).toBeNull();
    });

    it('should get stories using character', async () => {
      await storage.addCharacterToStory(storyId, characterId);

      const stories = await storage.getStoriesUsingCharacter(characterId);
      expect(stories).toHaveLength(1);
    });

    it('should throw error when adding character to non-existent story', async () => {
      await expect(storage.addCharacterToStory('non-existent', characterId))
        .rejects.toThrow('Story not found');
    });

    it('should throw error when adding non-existent character to story', async () => {
      await expect(storage.addCharacterToStory(storyId, 'non-existent'))
        .rejects.toThrow('Character not found');
    });
  });

  describe('Lorebook Operations', () => {
    const sampleLorebook = {
      name: 'Test Lorebook',
      description: 'A test lorebook',
      scanDepth: 2000,
      tokenBudget: 1500,
      recursiveScanning: true,
      entries: [
        { id: 0, keys: ['dragon'], content: 'A mythical creature', enabled: true },
        { id: 1, keys: ['castle'], content: 'A stone fortress', enabled: true }
      ]
    };

    it('should save and list lorebooks', async () => {
      await storage.saveLorebook('lb-1', sampleLorebook);

      const lorebooks = await storage.listAllLorebooks();
      expect(lorebooks).toHaveLength(1);
      expect(lorebooks[0].name).toBe('Test Lorebook');
      expect(lorebooks[0].entryCount).toBe(2);
    });

    it('should get lorebook with entries', async () => {
      await storage.saveLorebook('lb-1', sampleLorebook);

      const lorebook = await storage.getLorebook('lb-1');
      expect(lorebook.name).toBe('Test Lorebook');
      expect(lorebook.entries).toHaveLength(2);
      expect(lorebook.entries[0].keys).toContain('dragon');
    });

    it('should throw error for non-existent lorebook', async () => {
      await expect(storage.getLorebook('non-existent')).rejects.toThrow('Lorebook not found');
    });

    it('should update existing lorebook', async () => {
      await storage.saveLorebook('lb-1', sampleLorebook);

      const updated = {
        ...sampleLorebook,
        name: 'Updated Lorebook',
        entries: [{ id: 0, keys: ['unicorn'], content: 'A magical horse', enabled: true }]
      };
      await storage.saveLorebook('lb-1', updated);

      const lorebook = await storage.getLorebook('lb-1');
      expect(lorebook.name).toBe('Updated Lorebook');
      expect(lorebook.entries).toHaveLength(1);
      expect(lorebook.entries[0].keys).toContain('unicorn');
    });

    it('should delete lorebook', async () => {
      await storage.saveLorebook('lb-1', sampleLorebook);
      await storage.deleteLorebook('lb-1');

      const lorebooks = await storage.listAllLorebooks();
      expect(lorebooks).toHaveLength(0);
    });
  });

  describe('Story-Lorebook Associations', () => {
    let storyId;
    let lorebookId;

    beforeEach(async () => {
      const story = await storage.createStory('LB Story', 'Desc');
      storyId = story.id;

      lorebookId = 'test-lb';
      await storage.saveLorebook(lorebookId, {
        name: 'Test LB',
        description: 'Test',
        entries: []
      });
    });

    it('should add lorebook to story', async () => {
      await storage.addLorebookToStory(storyId, lorebookId);

      const story = await storage.getStory(storyId);
      expect(story.lorebookIds).toContain(lorebookId);
    });

    it('should list story lorebooks', async () => {
      await storage.addLorebookToStory(storyId, lorebookId);

      const lorebooks = await storage.listStoryLorebooks(storyId);
      expect(lorebooks).toHaveLength(1);
      expect(lorebooks[0].id).toBe(lorebookId);
    });

    it('should remove lorebook from story', async () => {
      await storage.addLorebookToStory(storyId, lorebookId);
      await storage.removeLorebookFromStory(storyId, lorebookId);

      const story = await storage.getStory(storyId);
      expect(story.lorebookIds).not.toContain(lorebookId);
    });

    it('should throw error when adding lorebook to non-existent story', async () => {
      await expect(storage.addLorebookToStory('non-existent', lorebookId))
        .rejects.toThrow('Story not found');
    });

    it('should throw error when adding non-existent lorebook to story', async () => {
      await expect(storage.addLorebookToStory(storyId, 'non-existent'))
        .rejects.toThrow('Lorebook not found');
    });
  });

  describe('Preset Operations', () => {
    const samplePreset = {
      name: 'Test Preset',
      provider: 'deepseek',
      apiConfig: { apiKey: 'test-key' },
      generationSettings: { maxTokens: 4000 },
      lorebookSettings: { scanDepth: 2000 },
      promptTemplates: {}
    };

    it('should save and list presets', async () => {
      await storage.savePreset('preset-1', samplePreset);

      const presets = await storage.listPresets();
      expect(presets).toHaveLength(1);
      expect(presets[0].name).toBe('Test Preset');
      expect(presets[0].provider).toBe('deepseek');
    });

    it('should get preset by ID', async () => {
      await storage.savePreset('preset-1', samplePreset);

      const preset = await storage.getPreset('preset-1');
      expect(preset.name).toBe('Test Preset');
      expect(preset.apiConfig.apiKey).toBe('test-key');
    });

    it('should throw error for non-existent preset', async () => {
      await expect(storage.getPreset('non-existent')).rejects.toThrow('Preset not found');
    });

    it('should update existing preset', async () => {
      await storage.savePreset('preset-1', samplePreset);

      const updated = { ...samplePreset, name: 'Updated Preset' };
      await storage.savePreset('preset-1', updated);

      const preset = await storage.getPreset('preset-1');
      expect(preset.name).toBe('Updated Preset');
    });

    it('should delete preset', async () => {
      await storage.savePreset('preset-1', samplePreset);
      await storage.deletePreset('preset-1');

      const presets = await storage.listPresets();
      expect(presets).toHaveLength(0);
    });

    it('should get and set default preset ID', async () => {
      await storage.savePreset('preset-1', samplePreset);
      await storage.setDefaultPresetId('preset-1');

      const defaultId = await storage.getDefaultPresetId();
      expect(defaultId).toBe('preset-1');
    });
  });

  describe('Story History Operations', () => {
    let storyId;

    beforeEach(async () => {
      const story = await storage.createStory('History Story', 'Desc');
      storyId = story.id;
    });

    it('should track history after content updates', async () => {
      await storage.updateStoryContent(storyId, 'Content 1');
      await storage.updateStoryContent(storyId, 'Content 2');
      await storage.updateStoryContent(storyId, 'Content 3');

      const status = await storage.getHistoryStatus(storyId);
      expect(status.canUndo).toBe(true);
      expect(status.canRedo).toBe(false);
    });

    it('should undo content', async () => {
      await storage.updateStoryContent(storyId, 'First');
      await storage.updateStoryContent(storyId, 'Second');

      const result = await storage.undoStoryContent(storyId);
      expect(result.content).toBe('First');
      expect(result.canUndo).toBe(false);
      expect(result.canRedo).toBe(true);
    });

    it('should redo content', async () => {
      await storage.updateStoryContent(storyId, 'First');
      await storage.updateStoryContent(storyId, 'Second');
      await storage.undoStoryContent(storyId);

      const result = await storage.redoStoryContent(storyId);
      expect(result.content).toBe('Second');
      expect(result.canUndo).toBe(true);
      expect(result.canRedo).toBe(false);
    });

    it('should discard redo history when making new edits after undo', async () => {
      await storage.updateStoryContent(storyId, 'First');
      await storage.updateStoryContent(storyId, 'Second');
      await storage.undoStoryContent(storyId);

      // Make a new edit
      await storage.updateStoryContent(storyId, 'Third (new branch)');

      const status = await storage.getHistoryStatus(storyId);
      expect(status.canRedo).toBe(false);
    });

    it('should skip history when skipHistory option is true', async () => {
      await storage.updateStoryContent(storyId, 'First');
      await storage.updateStoryContent(storyId, 'Second', { skipHistory: true });

      const status = await storage.getHistoryStatus(storyId);
      // Only one entry (First), Second was skipped
      expect(status.canUndo).toBe(false);
    });
  });

  describe('Database Management', () => {
    it('should close database connection', () => {
      expect(() => storage.close()).not.toThrow();
    });

    it('should initialize storage without error', async () => {
      await expect(storage.initializeStorage()).resolves.not.toThrow();
    });
  });
});
