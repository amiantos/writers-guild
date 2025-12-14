import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SqliteStorageService } from '../sqliteStorage.js';
import { v4 as uuidv4 } from 'uuid';

describe('SqliteStorageService - History Operations', () => {
  let storage;
  let tempDir;

  beforeEach(() => {
    // Create temp directory for test database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-history-test-'));
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

  describe('ensureHistoryInitialized', () => {
    it('should initialize history for existing story with content but no history', async () => {
      // Create a story with content directly, bypassing normal API flow
      const storyId = uuidv4();
      const now = new Date().toISOString();

      // Insert story directly with content (simulating pre-history-feature story)
      storage.stmts.insertStory.run({
        id: storyId,
        title: 'Test Story',
        description: 'A story with existing content',
        content: 'This is existing content that was created before the history feature.',
        wordCount: 10,
        needsRewritePrompt: 0,
        personaCharacterId: null,
        configPresetId: null,
        created: now,
        modified: now
      });

      // Verify no history exists yet
      const historyCountBefore = storage.stmts.countHistory.get(storyId);
      expect(historyCountBefore.count).toBe(0);

      // Call getHistoryStatus which triggers ensureHistoryInitialized
      const status = await storage.getHistoryStatus(storyId);

      // Verify history was created
      const historyCountAfter = storage.stmts.countHistory.get(storyId);
      expect(historyCountAfter.count).toBe(1);

      // canUndo should be false (only one entry, can't undo to before it)
      expect(status.canUndo).toBe(false);
      expect(status.canRedo).toBe(false);
    });

    it('should not create duplicate history when called multiple times', async () => {
      // Create a story with content directly
      const storyId = uuidv4();
      const now = new Date().toISOString();

      storage.stmts.insertStory.run({
        id: storyId,
        title: 'Test Story',
        description: 'Description',
        content: 'Some content',
        wordCount: 2,
        needsRewritePrompt: 0,
        personaCharacterId: null,
        configPresetId: null,
        created: now,
        modified: now
      });

      // Call getHistoryStatus multiple times
      await storage.getHistoryStatus(storyId);
      await storage.getHistoryStatus(storyId);
      await storage.getHistoryStatus(storyId);

      // Should still only have one history entry
      const historyCount = storage.stmts.countHistory.get(storyId);
      expect(historyCount.count).toBe(1);
    });

    it('should not create history for story with empty content', async () => {
      // Create a story with no content
      const storyId = uuidv4();
      const now = new Date().toISOString();

      storage.stmts.insertStory.run({
        id: storyId,
        title: 'Empty Story',
        description: 'Description',
        content: '', // empty content
        wordCount: 0,
        needsRewritePrompt: 0,
        personaCharacterId: null,
        configPresetId: null,
        created: now,
        modified: now
      });

      // Call getHistoryStatus
      await storage.getHistoryStatus(storyId);

      // Should not create history for empty content
      const historyCount = storage.stmts.countHistory.get(storyId);
      expect(historyCount.count).toBe(0);
    });
  });

  describe('undoStoryContent edge cases', () => {
    it('should return null when story has no history', async () => {
      // Create a story with no content (no history will be created)
      const storyId = uuidv4();
      const now = new Date().toISOString();

      storage.stmts.insertStory.run({
        id: storyId,
        title: 'Test Story',
        description: 'Description',
        content: '',
        wordCount: 0,
        needsRewritePrompt: 0,
        personaCharacterId: null,
        configPresetId: null,
        created: now,
        modified: now
      });

      const result = await storage.undoStoryContent(storyId);
      expect(result).toBeNull();
    });

    it('should return null when already at oldest history entry', async () => {
      // Create a story and add one history entry
      const storyId = uuidv4();
      const now = new Date().toISOString();

      storage.stmts.insertStory.run({
        id: storyId,
        title: 'Test Story',
        description: 'Description',
        content: 'Initial content',
        wordCount: 2,
        needsRewritePrompt: 0,
        personaCharacterId: null,
        configPresetId: null,
        created: now,
        modified: now
      });

      // Initialize history
      await storage.getHistoryStatus(storyId);

      // Try to undo - should return null since we're at the oldest entry
      const result = await storage.undoStoryContent(storyId);
      expect(result).toBeNull();
    });
  });

  describe('redoStoryContent edge cases', () => {
    it('should return null when story has no history', async () => {
      // Create a story with no content
      const storyId = uuidv4();
      const now = new Date().toISOString();

      storage.stmts.insertStory.run({
        id: storyId,
        title: 'Test Story',
        description: 'Description',
        content: '',
        wordCount: 0,
        needsRewritePrompt: 0,
        personaCharacterId: null,
        configPresetId: null,
        created: now,
        modified: now
      });

      const result = await storage.redoStoryContent(storyId);
      expect(result).toBeNull();
    });

    it('should return null when no redo history exists', async () => {
      // Create a story and add content
      const storyId = uuidv4();
      const now = new Date().toISOString();

      storage.stmts.insertStory.run({
        id: storyId,
        title: 'Test Story',
        description: 'Description',
        content: 'Some content',
        wordCount: 2,
        needsRewritePrompt: 0,
        personaCharacterId: null,
        configPresetId: null,
        created: now,
        modified: now
      });

      // Initialize history
      await storage.getHistoryStatus(storyId);

      // Try to redo without any prior undo
      const result = await storage.redoStoryContent(storyId);
      expect(result).toBeNull();
    });
  });
});
