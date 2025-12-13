import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { calculateWordCount } from '../database.js';
import { SqliteStorageService } from '../sqliteStorage.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('calculateWordCount', () => {
  describe('Basic Word Counting', () => {
    it('should count simple words', () => {
      expect(calculateWordCount('hello world')).toBe(2);
    });

    it('should count a single word', () => {
      expect(calculateWordCount('hello')).toBe(1);
    });

    it('should count words in a sentence', () => {
      expect(calculateWordCount('The quick brown fox jumps over the lazy dog')).toBe(9);
    });

    it('should handle multiple spaces between words', () => {
      expect(calculateWordCount('hello    world')).toBe(2);
    });

    it('should handle leading and trailing spaces', () => {
      expect(calculateWordCount('  hello world  ')).toBe(2);
    });

    it('should handle newlines', () => {
      expect(calculateWordCount('hello\nworld')).toBe(2);
    });

    it('should handle tabs', () => {
      expect(calculateWordCount('hello\tworld')).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should return 0 for empty string', () => {
      expect(calculateWordCount('')).toBe(0);
    });

    it('should return 0 for null', () => {
      expect(calculateWordCount(null)).toBe(0);
    });

    it('should return 0 for undefined', () => {
      expect(calculateWordCount(undefined)).toBe(0);
    });

    it('should return 0 for non-string values', () => {
      expect(calculateWordCount(123)).toBe(0);
      expect(calculateWordCount({})).toBe(0);
      expect(calculateWordCount([])).toBe(0);
    });

    it('should return 0 for whitespace-only string', () => {
      expect(calculateWordCount('   \n\t  ')).toBe(0);
    });
  });

  describe('Contractions', () => {
    it('should count contractions as single words', () => {
      expect(calculateWordCount("don't")).toBe(1);
      expect(calculateWordCount("it's")).toBe(1);
      expect(calculateWordCount("I'm")).toBe(1);
      expect(calculateWordCount("you're")).toBe(1);
      expect(calculateWordCount("they've")).toBe(1);
    });

    it('should count contractions in sentences correctly', () => {
      expect(calculateWordCount("I don't know what you're talking about")).toBe(7);
    });
  });

  describe('Hyphenated Words', () => {
    it('should count hyphenated words as single words', () => {
      expect(calculateWordCount('well-known')).toBe(1);
      expect(calculateWordCount('state-of-the-art')).toBe(1);
      expect(calculateWordCount('self-aware')).toBe(1);
    });

    it('should count hyphenated words in sentences correctly', () => {
      expect(calculateWordCount('The well-known author wrote a best-selling book')).toBe(7);
    });
  });

  describe('Punctuation', () => {
    it('should not count standalone punctuation as words', () => {
      expect(calculateWordCount('hello, world!')).toBe(2);
      expect(calculateWordCount('hello... world?')).toBe(2);
    });

    it('should handle sentences with various punctuation', () => {
      expect(calculateWordCount('Hello, world! How are you?')).toBe(5);
    });

    it('should handle quoted text', () => {
      expect(calculateWordCount('"Hello," she said.')).toBe(3);
    });
  });

  describe('Numbers', () => {
    it('should count numbers as words', () => {
      expect(calculateWordCount('I have 42 apples')).toBe(4);
    });

    it('should count alphanumeric strings as words', () => {
      expect(calculateWordCount('Model T2000')).toBe(2);
    });
  });

  describe('Mixed Content', () => {
    it('should handle typical story content', () => {
      const content = `"I don't believe it," she said, her well-known temper flaring.
        "It's impossible!" He wasn't convinced, but the state-of-the-art evidence was clear.`;
      // Words: I, don't, believe, it, she, said, her, well-known, temper, flaring,
      //        It's, impossible, He, wasn't, convinced, but, the, state-of-the-art, evidence, was, clear
      expect(calculateWordCount(content)).toBe(21);
    });
  });
});

describe('SqliteStorageService Word Count Integration', () => {
  let storage;
  let tempDir;

  beforeEach(() => {
    // Create a temporary directory for the test database
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'writers-guild-test-'));
    storage = new SqliteStorageService(tempDir);
  });

  afterEach(() => {
    // Close the database and clean up
    storage.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Story Creation', () => {
    it('should initialize word_count to 0 for new stories', async () => {
      const story = await storage.createStory('Test Story', 'A test description');

      expect(story.wordCount).toBe(0);

      // Verify it's also stored in the database
      const stories = await storage.listStories();
      const created = stories.find(s => s.id === story.id);
      expect(created.wordCount).toBe(0);
    });
  });

  describe('Story Content Updates', () => {
    it('should calculate and save word_count when content is updated', async () => {
      const story = await storage.createStory('Test Story', 'Description');

      await storage.updateStoryContent(story.id, 'Hello world');

      const stories = await storage.listStories();
      const updated = stories.find(s => s.id === story.id);
      expect(updated.wordCount).toBe(2);
    });

    it('should update word_count when content changes', async () => {
      const story = await storage.createStory('Test Story', 'Description');

      await storage.updateStoryContent(story.id, 'One two three');
      let stories = await storage.listStories();
      expect(stories.find(s => s.id === story.id).wordCount).toBe(3);

      await storage.updateStoryContent(story.id, 'One two three four five');
      stories = await storage.listStories();
      expect(stories.find(s => s.id === story.id).wordCount).toBe(5);
    });

    it('should not update when content is unchanged', async () => {
      const story = await storage.createStory('Test Story', 'Description');

      const result1 = await storage.updateStoryContent(story.id, 'Hello world');
      expect(result1.changed).toBe(true);

      const result2 = await storage.updateStoryContent(story.id, 'Hello world');
      expect(result2.changed).toBe(false);
    });

    it('should correctly count contractions and hyphenated words', async () => {
      const story = await storage.createStory('Test Story', 'Description');

      await storage.updateStoryContent(story.id, "I don't know about this well-known fact");

      const stories = await storage.listStories();
      const updated = stories.find(s => s.id === story.id);
      // Words: I, don't, know, about, this, well-known, fact = 7
      expect(updated.wordCount).toBe(7);
    });

    it('should handle empty content', async () => {
      const story = await storage.createStory('Test Story', 'Description');

      await storage.updateStoryContent(story.id, 'Some initial content');
      await storage.updateStoryContent(story.id, '');

      const stories = await storage.listStories();
      const updated = stories.find(s => s.id === story.id);
      expect(updated.wordCount).toBe(0);
    });

    it('should handle large content', async () => {
      const story = await storage.createStory('Test Story', 'Description');

      // Generate content with exactly 1000 words
      const words = Array(1000).fill('word').join(' ');
      await storage.updateStoryContent(story.id, words);

      const stories = await storage.listStories();
      const updated = stories.find(s => s.id === story.id);
      expect(updated.wordCount).toBe(1000);
    });
  });
});
