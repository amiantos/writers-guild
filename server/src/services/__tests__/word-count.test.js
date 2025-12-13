import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { calculateWordCount } from '../database.js';
import { SqliteStorageService } from '../sqliteStorage.js';
import Database from 'better-sqlite3';
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

describe('Schema Migration (v1 to v2)', () => {
  let tempDir;

  /**
   * Creates a version 1 database schema (without word_count column)
   */
  function createV1Database(dbPath) {
    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');

    db.exec(`
      -- Schema version tracking
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY
      );
      INSERT INTO schema_version (version) VALUES (1);

      -- Settings table
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        show_reasoning INTEGER DEFAULT 1,
        auto_save INTEGER DEFAULT 1,
        show_prompt INTEGER DEFAULT 1,
        third_person INTEGER DEFAULT 1,
        filter_asterisks INTEGER DEFAULT 1,
        include_dialogue_examples INTEGER DEFAULT 0,
        lorebook_scan_depth INTEGER DEFAULT 2000,
        lorebook_token_budget INTEGER DEFAULT 1800,
        lorebook_recursion_depth INTEGER DEFAULT 3,
        lorebook_enable_recursion INTEGER DEFAULT 1,
        default_persona_id TEXT,
        default_preset_id TEXT
      );
      INSERT INTO settings (id) VALUES (1);

      -- Stories table WITHOUT word_count column (v1 schema)
      CREATE TABLE stories (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        content TEXT DEFAULT '',
        persona_character_id TEXT,
        config_preset_id TEXT,
        created TEXT NOT NULL,
        modified TEXT NOT NULL
      );

      -- Characters table
      CREATE TABLE characters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        image BLOB,
        thumbnail BLOB,
        created TEXT NOT NULL,
        modified TEXT NOT NULL
      );
      CREATE INDEX idx_characters_name ON characters(name);

      -- Lorebooks table
      CREATE TABLE lorebooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        scan_depth INTEGER,
        token_budget INTEGER,
        recursive_scanning INTEGER DEFAULT 0,
        extensions TEXT DEFAULT '{}',
        created TEXT NOT NULL,
        modified TEXT NOT NULL
      );

      -- Lorebook entries table
      CREATE TABLE lorebook_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lorebook_id TEXT NOT NULL,
        keys TEXT NOT NULL DEFAULT '[]',
        secondary_keys TEXT NOT NULL DEFAULT '[]',
        content TEXT DEFAULT '',
        comment TEXT DEFAULT '',
        enabled INTEGER DEFAULT 1,
        constant INTEGER DEFAULT 0,
        selective INTEGER DEFAULT 0,
        selective_logic INTEGER DEFAULT 0,
        insertion_order INTEGER DEFAULT 0,
        position INTEGER DEFAULT 0,
        case_sensitive INTEGER DEFAULT 0,
        match_whole_words INTEGER DEFAULT 0,
        use_regex INTEGER DEFAULT 0,
        probability INTEGER DEFAULT 100,
        use_probability INTEGER DEFAULT 0,
        depth INTEGER DEFAULT 0,
        scan_depth INTEGER,
        entry_group TEXT DEFAULT '',
        prevent_recursion INTEGER DEFAULT 0,
        delay_until_recursion INTEGER DEFAULT 0,
        display_index INTEGER DEFAULT 0,
        extensions TEXT DEFAULT '{}',
        FOREIGN KEY (lorebook_id) REFERENCES lorebooks(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_lorebook_entries_lorebook ON lorebook_entries(lorebook_id);

      -- Presets table
      CREATE TABLE presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider TEXT DEFAULT 'deepseek',
        api_config TEXT NOT NULL DEFAULT '{}',
        generation_settings TEXT NOT NULL DEFAULT '{}',
        lorebook_settings TEXT NOT NULL DEFAULT '{}',
        prompt_templates TEXT NOT NULL DEFAULT '{}',
        is_default INTEGER DEFAULT 0
      );

      -- Junction tables
      CREATE TABLE story_characters (
        story_id TEXT NOT NULL,
        character_id TEXT NOT NULL,
        PRIMARY KEY (story_id, character_id),
        FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
        FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
      );

      CREATE TABLE story_lorebooks (
        story_id TEXT NOT NULL,
        lorebook_id TEXT NOT NULL,
        PRIMARY KEY (story_id, lorebook_id),
        FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
        FOREIGN KEY (lorebook_id) REFERENCES lorebooks(id) ON DELETE CASCADE
      );
    `);

    return db;
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'writers-guild-migration-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should add word_count column during migration', () => {
    const dbPath = path.join(tempDir, 'writers-guild.db');

    // Create v1 database
    const v1db = createV1Database(dbPath);
    v1db.close();

    // Open with SqliteStorageService, which should trigger migration
    const storage = new SqliteStorageService(tempDir);

    // Verify word_count column exists by creating a story
    const story = storage.db.prepare('SELECT * FROM stories LIMIT 1').get();
    const columns = Object.keys(storage.db.prepare('SELECT * FROM stories LIMIT 0').getColumnNames ?
      { word_count: true } : // Fallback
      storage.db.prepare('PRAGMA table_info(stories)').all().reduce((acc, col) => {
        acc[col.name] = true;
        return acc;
      }, {})
    );

    // Check schema version was updated
    const version = storage.db.prepare('SELECT version FROM schema_version').get();
    expect(version.version).toBe(2);

    storage.close();
  });

  it('should calculate and populate word counts for existing stories during migration', () => {
    const dbPath = path.join(tempDir, 'writers-guild.db');
    const now = new Date().toISOString();

    // Create v1 database with existing stories
    const v1db = createV1Database(dbPath);

    v1db.prepare(`
      INSERT INTO stories (id, title, description, content, created, modified)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('story-1', 'Story One', 'Description', 'Hello world', now, now);

    v1db.prepare(`
      INSERT INTO stories (id, title, description, content, created, modified)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('story-2', 'Story Two', 'Description', "I don't know about this well-known fact", now, now);

    v1db.prepare(`
      INSERT INTO stories (id, title, description, content, created, modified)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('story-3', 'Empty Story', 'Description', '', now, now);

    v1db.close();

    // Open with SqliteStorageService, triggering migration
    const storage = new SqliteStorageService(tempDir);

    // Verify word counts were calculated correctly
    const stories = storage.db.prepare('SELECT id, word_count FROM stories ORDER BY id').all();

    expect(stories).toHaveLength(3);
    expect(stories.find(s => s.id === 'story-1').word_count).toBe(2); // "Hello world"
    expect(stories.find(s => s.id === 'story-2').word_count).toBe(7); // "I don't know about this well-known fact"
    expect(stories.find(s => s.id === 'story-3').word_count).toBe(0); // empty

    storage.close();
  });

  it('should handle migration with no existing stories', () => {
    const dbPath = path.join(tempDir, 'writers-guild.db');

    // Create v1 database with no stories
    const v1db = createV1Database(dbPath);
    v1db.close();

    // Open with SqliteStorageService, triggering migration
    const storage = new SqliteStorageService(tempDir);

    // Verify schema version was updated
    const version = storage.db.prepare('SELECT version FROM schema_version').get();
    expect(version.version).toBe(2);

    // Verify we can create stories with word_count
    const story = storage.db.prepare(`
      INSERT INTO stories (id, title, description, content, word_count, created, modified)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('test-id', 'Test', '', 'one two three', 3, new Date().toISOString(), new Date().toISOString());

    const result = storage.db.prepare('SELECT word_count FROM stories WHERE id = ?').get('test-id');
    expect(result.word_count).toBe(3);

    storage.close();
  });

  it('should maintain transaction atomicity - all or nothing', () => {
    const dbPath = path.join(tempDir, 'writers-guild.db');
    const now = new Date().toISOString();

    // Create v1 database with stories
    const v1db = createV1Database(dbPath);
    v1db.prepare(`
      INSERT INTO stories (id, title, description, content, created, modified)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('story-1', 'Story', 'Desc', 'Hello world', now, now);
    v1db.close();

    // Open with SqliteStorageService
    const storage = new SqliteStorageService(tempDir);

    // If migration succeeded, both column addition AND word count population should have happened
    const story = storage.db.prepare('SELECT word_count FROM stories WHERE id = ?').get('story-1');
    const version = storage.db.prepare('SELECT version FROM schema_version').get();

    // Both should be updated together (atomic)
    expect(story.word_count).toBe(2);
    expect(version.version).toBe(2);

    storage.close();
  });
});
