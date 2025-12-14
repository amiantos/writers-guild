/**
 * SQLite Storage Service
 * Handles all database operations for stories, characters, lorebooks, presets, and settings
 */

import { initializeDatabase, calculateWordCount } from './database.js';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';

export class SqliteStorageService {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.db = initializeDatabase(dataRoot);
    this.prepareStatements();
  }

  /**
   * Prepare commonly used SQL statements for performance
   */
  prepareStatements() {
    // Settings statements
    this.stmts = {
      // Settings
      getSettings: this.db.prepare('SELECT * FROM settings WHERE id = 1'),
      updateSettings: this.db.prepare(`
        UPDATE settings SET
          show_reasoning = @showReasoning,
          auto_save = @autoSave,
          show_prompt = @showPrompt,
          third_person = @thirdPerson,
          filter_asterisks = @filterAsterisks,
          include_dialogue_examples = @includeDialogueExamples,
          lorebook_scan_depth = @lorebookScanDepth,
          lorebook_token_budget = @lorebookTokenBudget,
          lorebook_recursion_depth = @lorebookRecursionDepth,
          lorebook_enable_recursion = @lorebookEnableRecursion,
          default_persona_id = @defaultPersonaId,
          default_preset_id = @defaultPresetId,
          onboarding_completed = @onboardingCompleted
        WHERE id = 1
      `),

      // Stories
      listStories: this.db.prepare(`
        SELECT id, title, description, created, modified, persona_character_id, config_preset_id, word_count
        FROM stories
        ORDER BY modified DESC
      `),
      getStory: this.db.prepare('SELECT * FROM stories WHERE id = ?'),
      insertStory: this.db.prepare(`
        INSERT INTO stories (id, title, description, content, word_count, needs_rewrite_prompt, persona_character_id, config_preset_id, created, modified)
        VALUES (@id, @title, @description, @content, @wordCount, @needsRewritePrompt, @personaCharacterId, @configPresetId, @created, @modified)
      `),
      setStoryNeedsRewritePrompt: this.db.prepare('UPDATE stories SET needs_rewrite_prompt = ? WHERE id = ?'),
      updateStoryAvatarWindows: this.db.prepare('UPDATE stories SET avatar_windows = ? WHERE id = ?'),
      updateStoryMetadata: this.db.prepare(`
        UPDATE stories SET title = @title, description = @description, persona_character_id = @personaCharacterId,
                          config_preset_id = @configPresetId, modified = @modified
        WHERE id = @id
      `),
      updateStoryContent: this.db.prepare('UPDATE stories SET content = ?, word_count = ?, modified = ? WHERE id = ?'),
      deleteStory: this.db.prepare('DELETE FROM stories WHERE id = ?'),

      // Characters
      listCharacters: this.db.prepare('SELECT id, name, created, modified FROM characters ORDER BY name'),
      getCharacter: this.db.prepare('SELECT id, name, data, created, modified FROM characters WHERE id = ?'),
      getCharacterImage: this.db.prepare('SELECT image FROM characters WHERE id = ?'),
      getCharacterThumbnail: this.db.prepare('SELECT thumbnail FROM characters WHERE id = ?'),
      insertCharacter: this.db.prepare(`
        INSERT INTO characters (id, name, data, image, thumbnail, created, modified)
        VALUES (@id, @name, @data, @image, @thumbnail, @created, @modified)
      `),
      updateCharacter: this.db.prepare(`
        UPDATE characters SET name = @name, data = @data, modified = @modified WHERE id = @id
      `),
      updateCharacterWithImage: this.db.prepare(`
        UPDATE characters SET name = @name, data = @data, image = @image, thumbnail = @thumbnail, modified = @modified WHERE id = @id
      `),
      deleteCharacter: this.db.prepare('DELETE FROM characters WHERE id = ?'),
      characterExists: this.db.prepare('SELECT 1 FROM characters WHERE id = ?'),

      // Story-Character relationships
      getStoryCharacterIds: this.db.prepare('SELECT character_id FROM story_characters WHERE story_id = ?'),
      addStoryCharacter: this.db.prepare('INSERT OR IGNORE INTO story_characters (story_id, character_id) VALUES (?, ?)'),
      removeStoryCharacter: this.db.prepare('DELETE FROM story_characters WHERE story_id = ? AND character_id = ?'),
      getStoriesUsingCharacter: this.db.prepare(`
        SELECT s.id, s.title FROM stories s
        JOIN story_characters sc ON s.id = sc.story_id
        WHERE sc.character_id = ?
      `),
      updateStoryModified: this.db.prepare('UPDATE stories SET modified = ? WHERE id = ?'),
      clearStoryPersona: this.db.prepare('UPDATE stories SET persona_character_id = NULL WHERE id = ?'),
      setStoryPersona: this.db.prepare('UPDATE stories SET persona_character_id = ?, modified = ? WHERE id = ?'),

      // Lorebooks
      listLorebooks: this.db.prepare(`
        SELECT l.id, l.name, l.description, COUNT(e.id) as entry_count
        FROM lorebooks l
        LEFT JOIN lorebook_entries e ON l.id = e.lorebook_id
        GROUP BY l.id
        ORDER BY l.name
      `),
      getLorebook: this.db.prepare('SELECT * FROM lorebooks WHERE id = ?'),
      getLorebookEntries: this.db.prepare('SELECT * FROM lorebook_entries WHERE lorebook_id = ? ORDER BY display_index'),
      insertLorebook: this.db.prepare(`
        INSERT INTO lorebooks (id, name, description, scan_depth, token_budget, recursive_scanning, extensions, created, modified)
        VALUES (@id, @name, @description, @scanDepth, @tokenBudget, @recursiveScanning, @extensions, @created, @modified)
      `),
      updateLorebook: this.db.prepare(`
        UPDATE lorebooks SET name = @name, description = @description, scan_depth = @scanDepth,
                            token_budget = @tokenBudget, recursive_scanning = @recursiveScanning,
                            extensions = @extensions, modified = @modified
        WHERE id = @id
      `),
      deleteLorebook: this.db.prepare('DELETE FROM lorebooks WHERE id = ?'),
      lorebookExists: this.db.prepare('SELECT 1 FROM lorebooks WHERE id = ?'),

      // Lorebook entries
      insertLorebookEntry: this.db.prepare(`
        INSERT INTO lorebook_entries (
          lorebook_id, keys, secondary_keys, content, comment, enabled, constant, selective,
          selective_logic, insertion_order, position, case_sensitive, match_whole_words,
          use_regex, probability, use_probability, depth, scan_depth, entry_group,
          prevent_recursion, delay_until_recursion, display_index, extensions
        ) VALUES (
          @lorebookId, @keys, @secondaryKeys, @content, @comment, @enabled, @constant, @selective,
          @selectiveLogic, @insertionOrder, @position, @caseSensitive, @matchWholeWords,
          @useRegex, @probability, @useProbability, @depth, @scanDepth, @group,
          @preventRecursion, @delayUntilRecursion, @displayIndex, @extensions
        )
      `),
      updateLorebookEntry: this.db.prepare(`
        UPDATE lorebook_entries SET
          keys = @keys, secondary_keys = @secondaryKeys, content = @content, comment = @comment,
          enabled = @enabled, constant = @constant, selective = @selective,
          selective_logic = @selectiveLogic, insertion_order = @insertionOrder, position = @position,
          case_sensitive = @caseSensitive, match_whole_words = @matchWholeWords,
          use_regex = @useRegex, probability = @probability, use_probability = @useProbability,
          depth = @depth, scan_depth = @scanDepth, entry_group = @group,
          prevent_recursion = @preventRecursion, delay_until_recursion = @delayUntilRecursion,
          display_index = @displayIndex, extensions = @extensions
        WHERE id = @id AND lorebook_id = @lorebookId
      `),
      deleteLorebookEntry: this.db.prepare('DELETE FROM lorebook_entries WHERE id = ? AND lorebook_id = ?'),
      deleteLorebookEntries: this.db.prepare('DELETE FROM lorebook_entries WHERE lorebook_id = ?'),

      // Story-Lorebook relationships
      getStoryLorebookIds: this.db.prepare('SELECT lorebook_id FROM story_lorebooks WHERE story_id = ?'),
      addStoryLorebook: this.db.prepare('INSERT OR IGNORE INTO story_lorebooks (story_id, lorebook_id) VALUES (?, ?)'),
      removeStoryLorebook: this.db.prepare('DELETE FROM story_lorebooks WHERE story_id = ? AND lorebook_id = ?'),

      // Presets
      listPresets: this.db.prepare('SELECT id, name, provider, is_default FROM presets ORDER BY name'),
      getPreset: this.db.prepare('SELECT * FROM presets WHERE id = ?'),
      insertPreset: this.db.prepare(`
        INSERT INTO presets (id, name, provider, api_config, generation_settings, lorebook_settings, prompt_templates, is_default)
        VALUES (@id, @name, @provider, @apiConfig, @generationSettings, @lorebookSettings, @promptTemplates, @isDefault)
      `),
      updatePreset: this.db.prepare(`
        UPDATE presets SET name = @name, provider = @provider, api_config = @apiConfig,
                          generation_settings = @generationSettings, lorebook_settings = @lorebookSettings,
                          prompt_templates = @promptTemplates, is_default = @isDefault
        WHERE id = @id
      `),
      deletePreset: this.db.prepare('DELETE FROM presets WHERE id = ?'),
      presetExists: this.db.prepare('SELECT 1 FROM presets WHERE id = ?'),

      // Story History (undo/redo)
      insertHistory: this.db.prepare(`
        INSERT INTO story_history (story_id, content, word_count, created)
        VALUES (?, ?, ?, ?)
      `),
      getHistoryPosition: this.db.prepare('SELECT history_id FROM story_history_position WHERE story_id = ?'),
      setHistoryPosition: this.db.prepare(`
        INSERT INTO story_history_position (story_id, history_id) VALUES (?, ?)
        ON CONFLICT(story_id) DO UPDATE SET history_id = excluded.history_id
      `),
      getHistoryBefore: this.db.prepare(`
        SELECT * FROM story_history
        WHERE story_id = ? AND id < ?
        ORDER BY id DESC LIMIT 1
      `),
      getHistoryAfter: this.db.prepare(`
        SELECT * FROM story_history
        WHERE story_id = ? AND id > ?
        ORDER BY id ASC LIMIT 1
      `),
      getLatestHistory: this.db.prepare(`
        SELECT * FROM story_history
        WHERE story_id = ?
        ORDER BY id DESC LIMIT 1
      `),
      getHistoryEntry: this.db.prepare(`
        SELECT * FROM story_history WHERE id = ?
      `),
      countHistoryBefore: this.db.prepare(`
        SELECT COUNT(*) as count FROM story_history
        WHERE story_id = ? AND id < ?
      `),
      countHistoryAfter: this.db.prepare(`
        SELECT COUNT(*) as count FROM story_history
        WHERE story_id = ? AND id > ?
      `),
      deleteHistoryAfter: this.db.prepare(`
        DELETE FROM story_history
        WHERE story_id = ? AND id > ?
      `),
      pruneOldHistory: this.db.prepare(`
        DELETE FROM story_history
        WHERE story_id = ? AND id NOT IN (
          SELECT id FROM story_history
          WHERE story_id = ?
          ORDER BY id DESC
          LIMIT ?
        )
      `),
      countHistory: this.db.prepare('SELECT COUNT(*) as count FROM story_history WHERE story_id = ?'),
    };
  }

  // ==================== Helper Methods ====================

  /**
   * Initialize storage (no-op for SQLite, schema is created in constructor)
   */
  async initializeStorage() {
    // SQLite database and schema are initialized in constructor
    // This method exists for compatibility with file-based storage API
  }

  /**
   * Generate thumbnail from image buffer
   */
  async generateThumbnail(imageBuffer) {
    try {
      return await sharp(imageBuffer)
        .resize(96, 96, {
          fit: 'cover',
          position: 'top',
          withoutEnlargement: false
        })
        .png({ quality: 90 })
        .toBuffer();
    } catch (error) {
      console.error('Failed to generate thumbnail:', error);
      return null;
    }
  }

  // ==================== Settings Operations ====================

  async getSettings() {
    const row = this.stmts.getSettings.get();
    if (!row) return null;

    return {
      showReasoning: !!row.show_reasoning,
      autoSave: !!row.auto_save,
      showPrompt: !!row.show_prompt,
      thirdPerson: !!row.third_person,
      filterAsterisks: !!row.filter_asterisks,
      includeDialogueExamples: !!row.include_dialogue_examples,
      lorebookScanDepth: row.lorebook_scan_depth,
      lorebookTokenBudget: row.lorebook_token_budget,
      lorebookRecursionDepth: row.lorebook_recursion_depth,
      lorebookEnableRecursion: !!row.lorebook_enable_recursion,
      defaultPersonaId: row.default_persona_id,
      defaultPresetId: row.default_preset_id,
      onboardingCompleted: !!row.onboarding_completed
    };
  }

  async saveSettings(settings) {
    this.stmts.updateSettings.run({
      showReasoning: settings.showReasoning ? 1 : 0,
      autoSave: settings.autoSave ? 1 : 0,
      showPrompt: settings.showPrompt ? 1 : 0,
      thirdPerson: settings.thirdPerson ? 1 : 0,
      filterAsterisks: settings.filterAsterisks ? 1 : 0,
      includeDialogueExamples: settings.includeDialogueExamples ? 1 : 0,
      lorebookScanDepth: settings.lorebookScanDepth ?? 2000,
      lorebookTokenBudget: settings.lorebookTokenBudget ?? 1800,
      lorebookRecursionDepth: settings.lorebookRecursionDepth ?? 3,
      lorebookEnableRecursion: settings.lorebookEnableRecursion ? 1 : 0,
      defaultPersonaId: settings.defaultPersonaId || null,
      defaultPresetId: settings.defaultPresetId || null,
      onboardingCompleted: settings.onboardingCompleted ? 1 : 0
    });
    return settings;
  }

  // ==================== Story Operations ====================

  async listStories() {
    const rows = this.stmts.listStories.all();
    return rows.map(row => {
      // Get character IDs for this story
      const characterRows = this.stmts.getStoryCharacterIds.all(row.id);
      const characterIds = characterRows.map(r => r.character_id);

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        created: row.created,
        modified: row.modified,
        characterIds,
        personaCharacterId: row.persona_character_id,
        configPresetId: row.config_preset_id,
        wordCount: row.word_count || 0
      };
    });
  }

  async getStory(storyId) {
    const row = this.stmts.getStory.get(storyId);
    if (!row) {
      throw new Error(`Story not found: ${storyId}`);
    }

    // Get character IDs for this story
    const characterRows = this.stmts.getStoryCharacterIds.all(storyId);
    const characterIds = characterRows.map(r => r.character_id);

    // Get lorebook IDs for this story
    const lorebookRows = this.stmts.getStoryLorebookIds.all(storyId);
    const lorebookIds = lorebookRows.map(r => r.lorebook_id);

    // Get characters info
    const characters = characterIds.map(id => ({ id }));

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      content: row.content || '',
      created: row.created,
      modified: row.modified,
      characterIds,
      personaCharacterId: row.persona_character_id,
      lorebookIds,
      configPresetId: row.config_preset_id,
      characters,
      needsRewritePrompt: !!row.needs_rewrite_prompt,
      avatarWindows: JSON.parse(row.avatar_windows || '[]')
    };
  }

  async createStory(title, description = '', options = {}) {
    const storyId = uuidv4();
    const now = new Date().toISOString();
    const needsRewritePrompt = options.needsRewritePrompt ? 1 : 0;

    this.stmts.insertStory.run({
      id: storyId,
      title,
      description,
      content: '',
      wordCount: 0,
      needsRewritePrompt,
      personaCharacterId: null,
      configPresetId: null,
      created: now,
      modified: now
    });

    return {
      id: storyId,
      title,
      description,
      created: now,
      modified: now,
      characterIds: [],
      personaCharacterId: null,
      lorebookIds: [],
      configPresetId: null,
      wordCount: 0,
      needsRewritePrompt: !!needsRewritePrompt
    };
  }

  async setStoryNeedsRewritePrompt(storyId, value) {
    const existing = this.stmts.getStory.get(storyId);
    if (!existing) {
      throw new Error(`Story not found: ${storyId}`);
    }
    this.stmts.setStoryNeedsRewritePrompt.run(value ? 1 : 0, storyId);
    return { success: true };
  }

  async updateStoryAvatarWindows(storyId, avatarWindows) {
    const existing = this.stmts.getStory.get(storyId);
    if (!existing) {
      throw new Error(`Story not found: ${storyId}`);
    }
    this.stmts.updateStoryAvatarWindows.run(JSON.stringify(avatarWindows), storyId);
    return { success: true, avatarWindows };
  }

  async updateStoryMetadata(storyId, updates) {
    const existing = this.stmts.getStory.get(storyId);
    if (!existing) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const modified = new Date().toISOString();

    this.stmts.updateStoryMetadata.run({
      id: storyId,
      title: updates.title ?? existing.title,
      description: updates.description ?? existing.description,
      personaCharacterId: updates.personaCharacterId !== undefined ? updates.personaCharacterId : existing.persona_character_id,
      configPresetId: updates.configPresetId !== undefined ? updates.configPresetId : existing.config_preset_id,
      modified
    });

    return {
      ...updates,
      id: storyId,
      modified
    };
  }

  async updateStoryContent(storyId, content, options = {}) {
    const existing = this.stmts.getStory.get(storyId);
    if (!existing) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const changed = existing.content !== content;

    if (changed) {
      const modified = new Date().toISOString();
      const wordCount = calculateWordCount(content);

      // Save to history unless this is an undo/redo operation
      if (!options.skipHistory) {
        await this.saveToHistory(storyId, content, wordCount);
      }

      this.stmts.updateStoryContent.run(content, wordCount, modified, storyId);
      return { success: true, modified, changed };
    }

    return { success: true, modified: existing.modified, changed };
  }

  async deleteStory(storyId) {
    const existing = this.stmts.getStory.get(storyId);
    if (!existing) {
      throw new Error(`Story not found: ${storyId}`);
    }

    this.stmts.deleteStory.run(storyId);
    return { success: true };
  }

  // ==================== Character Operations ====================

  async listAllCharacters() {
    const rows = this.stmts.listCharacters.all();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      created: row.created,
      modified: row.modified
    }));
  }

  async listStoryCharacters(storyId) {
    const rows = this.stmts.getStoryCharacterIds.all(storyId);
    return rows.map(row => ({ id: row.character_id }));
  }

  async getCharacter(characterId) {
    const row = this.stmts.getCharacter.get(characterId);
    if (!row) {
      throw new Error(`Character not found: ${characterId}`);
    }

    const data = JSON.parse(row.data);
    // Ensure metadata is set
    if (!data.metadata) {
      data.metadata = {};
    }
    data.metadata.created = row.created;
    data.metadata.modified = row.modified;

    return data;
  }

  async saveCharacter(characterId, characterData, imageBuffer = null) {
    const existing = this.stmts.characterExists.get(characterId);
    const now = new Date().toISOString();

    // Ensure metadata
    if (!characterData.metadata) {
      characterData.metadata = {};
    }

    const name = characterData.data?.name || 'Untitled';
    const dataJson = JSON.stringify(characterData);

    if (existing) {
      // Update existing character
      if (imageBuffer) {
        const thumbnail = await this.generateThumbnail(imageBuffer);
        this.stmts.updateCharacterWithImage.run({
          id: characterId,
          name,
          data: dataJson,
          image: imageBuffer,
          thumbnail,
          modified: now
        });
      } else {
        this.stmts.updateCharacter.run({
          id: characterId,
          name,
          data: dataJson,
          modified: now
        });
      }
    } else {
      // Insert new character
      let thumbnail = null;
      if (imageBuffer) {
        thumbnail = await this.generateThumbnail(imageBuffer);
      }

      this.stmts.insertCharacter.run({
        id: characterId,
        name,
        data: dataJson,
        image: imageBuffer,
        thumbnail,
        created: now,
        modified: now
      });
    }

    return { id: characterId };
  }

  async getCharacterImage(characterId) {
    const row = this.stmts.getCharacterImage.get(characterId);
    return row?.image || null;
  }

  async hasCharacterImage(characterId) {
    const row = this.stmts.getCharacterImage.get(characterId);
    return !!row?.image;
  }

  async getCharacterThumbnail(characterId) {
    const row = this.stmts.getCharacterThumbnail.get(characterId);
    return row?.thumbnail || null;
  }

  async hasCharacterThumbnail(characterId) {
    const row = this.stmts.getCharacterThumbnail.get(characterId);
    return !!row?.thumbnail;
  }

  async deleteCharacter(characterId) {
    this.stmts.deleteCharacter.run(characterId);
    return { success: true };
  }

  async addCharacterToStory(storyId, characterId) {
    const storyExists = this.stmts.getStory.get(storyId);
    if (!storyExists) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const characterExists = this.stmts.characterExists.get(characterId);
    if (!characterExists) {
      throw new Error(`Character not found: ${characterId}`);
    }

    this.stmts.addStoryCharacter.run(storyId, characterId);

    // Update story modified timestamp
    const modified = new Date().toISOString();
    this.stmts.updateStoryModified.run(modified, storyId);

    return { success: true };
  }

  async removeCharacterFromStory(storyId, characterId) {
    const story = this.stmts.getStory.get(storyId);
    if (!story) {
      throw new Error(`Story not found: ${storyId}`);
    }

    this.stmts.removeStoryCharacter.run(storyId, characterId);

    // If this character was the persona, clear it
    if (story.persona_character_id === characterId) {
      this.stmts.clearStoryPersona.run(storyId);
    }

    // Update story modified timestamp
    const modified = new Date().toISOString();
    this.stmts.updateStoryModified.run(modified, storyId);

    return { success: true };
  }

  async setStoryPersona(storyId, characterId) {
    const story = this.stmts.getStory.get(storyId);
    if (!story) {
      throw new Error(`Story not found: ${storyId}`);
    }

    if (characterId) {
      const characterExists = this.stmts.characterExists.get(characterId);
      if (!characterExists) {
        throw new Error(`Character not found: ${characterId}`);
      }
    }

    const modified = new Date().toISOString();
    this.stmts.setStoryPersona.run(characterId, modified, storyId);

    return { success: true };
  }

  async getStoriesUsingCharacter(characterId) {
    return this.stmts.getStoriesUsingCharacter.all(characterId);
  }

  // ==================== Lorebook Operations ====================

  async listAllLorebooks() {
    const rows = this.stmts.listLorebooks.all();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      entryCount: row.entry_count
    }));
  }

  async listStoryLorebooks(storyId) {
    const rows = this.stmts.getStoryLorebookIds.all(storyId);
    const lorebooks = [];

    for (const row of rows) {
      const lorebook = this.stmts.getLorebook.get(row.lorebook_id);
      if (lorebook) {
        const entries = this.stmts.getLorebookEntries.all(row.lorebook_id);
        lorebooks.push({
          id: lorebook.id,
          name: lorebook.name,
          description: lorebook.description,
          entryCount: entries.length
        });
      }
    }

    return lorebooks;
  }

  async getLorebook(lorebookId) {
    const row = this.stmts.getLorebook.get(lorebookId);
    if (!row) {
      throw new Error(`Lorebook not found: ${lorebookId}`);
    }

    const entries = this.stmts.getLorebookEntries.all(lorebookId);

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      scanDepth: row.scan_depth,
      tokenBudget: row.token_budget,
      recursiveScanning: !!row.recursive_scanning,
      extensions: JSON.parse(row.extensions || '{}'),
      entries: entries.map(e => ({
        id: e.id,
        keys: JSON.parse(e.keys || '[]'),
        secondaryKeys: JSON.parse(e.secondary_keys || '[]'),
        content: e.content,
        comment: e.comment,
        enabled: !!e.enabled,
        constant: !!e.constant,
        selective: !!e.selective,
        selectiveLogic: e.selective_logic,
        insertionOrder: e.insertion_order,
        position: e.position,
        caseSensitive: !!e.case_sensitive,
        matchWholeWords: !!e.match_whole_words,
        useRegex: !!e.use_regex,
        probability: e.probability,
        useProbability: !!e.use_probability,
        depth: e.depth,
        scanDepth: e.scan_depth,
        group: e.entry_group,
        preventRecursion: !!e.prevent_recursion,
        delayUntilRecursion: !!e.delay_until_recursion,
        displayIndex: e.display_index,
        extensions: JSON.parse(e.extensions || '{}')
      }))
    };
  }

  async saveLorebook(lorebookId, lorebookData) {
    const existing = this.stmts.lorebookExists.get(lorebookId);
    const now = new Date().toISOString();

    const transaction = this.db.transaction(() => {
      if (existing) {
        // Update lorebook
        this.stmts.updateLorebook.run({
          id: lorebookId,
          name: lorebookData.name || 'Untitled',
          description: lorebookData.description || '',
          scanDepth: lorebookData.scanDepth ?? null,
          tokenBudget: lorebookData.tokenBudget ?? null,
          recursiveScanning: lorebookData.recursiveScanning ? 1 : 0,
          extensions: JSON.stringify(lorebookData.extensions || {}),
          modified: now
        });

        // Delete existing entries and re-insert
        this.stmts.deleteLorebookEntries.run(lorebookId);
      } else {
        // Insert new lorebook
        this.stmts.insertLorebook.run({
          id: lorebookId,
          name: lorebookData.name || 'Untitled',
          description: lorebookData.description || '',
          scanDepth: lorebookData.scanDepth ?? null,
          tokenBudget: lorebookData.tokenBudget ?? null,
          recursiveScanning: lorebookData.recursiveScanning ? 1 : 0,
          extensions: JSON.stringify(lorebookData.extensions || {}),
          created: now,
          modified: now
        });
      }

      // Insert entries
      if (lorebookData.entries && lorebookData.entries.length > 0) {
        for (const entry of lorebookData.entries) {
          this.stmts.insertLorebookEntry.run({
            lorebookId,
            keys: JSON.stringify(entry.keys || []),
            secondaryKeys: JSON.stringify(entry.secondaryKeys || []),
            content: entry.content || '',
            comment: entry.comment || '',
            enabled: entry.enabled ? 1 : 0,
            constant: entry.constant ? 1 : 0,
            selective: entry.selective ? 1 : 0,
            selectiveLogic: entry.selectiveLogic ?? 0,
            insertionOrder: entry.insertionOrder ?? 0,
            position: entry.position ?? 0,
            caseSensitive: entry.caseSensitive ? 1 : 0,
            matchWholeWords: entry.matchWholeWords ? 1 : 0,
            useRegex: entry.useRegex ? 1 : 0,
            probability: entry.probability ?? 100,
            useProbability: entry.useProbability ? 1 : 0,
            depth: entry.depth ?? 0,
            scanDepth: entry.scanDepth ?? null,
            group: entry.group || '',
            preventRecursion: entry.preventRecursion ? 1 : 0,
            delayUntilRecursion: entry.delayUntilRecursion ? 1 : 0,
            displayIndex: entry.displayIndex ?? 0,
            extensions: JSON.stringify(entry.extensions || {})
          });
        }
      }
    });

    transaction();
    return { id: lorebookId };
  }

  async deleteLorebook(lorebookId) {
    this.stmts.deleteLorebook.run(lorebookId);
    return { success: true };
  }

  async addLorebookToStory(storyId, lorebookId) {
    const storyExists = this.stmts.getStory.get(storyId);
    if (!storyExists) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const lorebookExists = this.stmts.lorebookExists.get(lorebookId);
    if (!lorebookExists) {
      throw new Error(`Lorebook not found: ${lorebookId}`);
    }

    this.stmts.addStoryLorebook.run(storyId, lorebookId);

    // Update story modified timestamp
    const modified = new Date().toISOString();
    this.stmts.updateStoryModified.run(modified, storyId);

    return { success: true };
  }

  async removeLorebookFromStory(storyId, lorebookId) {
    const story = this.stmts.getStory.get(storyId);
    if (!story) {
      throw new Error(`Story not found: ${storyId}`);
    }

    this.stmts.removeStoryLorebook.run(storyId, lorebookId);

    // Update story modified timestamp
    const modified = new Date().toISOString();
    this.stmts.updateStoryModified.run(modified, storyId);

    return { success: true };
  }

  // ==================== Preset Operations ====================

  async listPresets() {
    const rows = this.stmts.listPresets.all();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      isDefault: !!row.is_default
    }));
  }

  async getPreset(presetId) {
    const row = this.stmts.getPreset.get(presetId);
    if (!row) {
      throw new Error(`Preset not found: ${presetId}`);
    }

    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      apiConfig: JSON.parse(row.api_config || '{}'),
      generationSettings: JSON.parse(row.generation_settings || '{}'),
      lorebookSettings: JSON.parse(row.lorebook_settings || '{}'),
      promptTemplates: JSON.parse(row.prompt_templates || '{}'),
      isDefault: !!row.is_default
    };
  }

  async savePreset(presetId, presetData) {
    const existing = this.stmts.presetExists.get(presetId);

    const data = {
      id: presetId,
      name: presetData.name || 'Untitled',
      provider: presetData.provider || 'deepseek',
      apiConfig: JSON.stringify(presetData.apiConfig || {}),
      generationSettings: JSON.stringify(presetData.generationSettings || {}),
      lorebookSettings: JSON.stringify(presetData.lorebookSettings || {}),
      promptTemplates: JSON.stringify(presetData.promptTemplates || {}),
      isDefault: presetData.isDefault ? 1 : 0
    };

    if (existing) {
      this.stmts.updatePreset.run(data);
    } else {
      this.stmts.insertPreset.run(data);
    }

    return { id: presetId };
  }

  async deletePreset(presetId) {
    this.stmts.deletePreset.run(presetId);
    return { success: true };
  }

  async getDefaultPresetId() {
    const settings = await this.getSettings();
    return settings?.defaultPresetId || null;
  }

  async setDefaultPresetId(presetId) {
    const settings = await this.getSettings() || {};
    settings.defaultPresetId = presetId;
    await this.saveSettings(settings);
    return { success: true };
  }

  // ==================== Story History (Undo/Redo) Operations ====================

  /**
   * Maximum number of history entries to keep per story
   */
  static MAX_HISTORY_ENTRIES = 50;

  /**
   * Save content to history
   * Called automatically when content changes
   */
  async saveToHistory(storyId, content, wordCount) {
    const now = new Date().toISOString();

    // Get current position
    const positionRow = this.stmts.getHistoryPosition.get(storyId);
    const currentHistoryId = positionRow?.history_id;

    // Check if content matches the entry at CURRENT position (not latest)
    // This correctly handles the case where user undos and types same content
    if (currentHistoryId) {
      const currentEntry = this.stmts.getHistoryEntry.get(currentHistoryId);
      if (currentEntry && currentEntry.content === content) {
        // Content is the same as current position, no need to save
        return;
      }
    }

    // Use transaction to ensure atomicity
    const transaction = this.db.transaction(() => {
      // If we have a current position, delete all entries after it (user made new edit after undo)
      if (currentHistoryId) {
        this.stmts.deleteHistoryAfter.run(storyId, currentHistoryId);
      }

      // Insert new history entry
      const result = this.stmts.insertHistory.run(storyId, content, wordCount, now);
      const newHistoryId = result.lastInsertRowid;

      // Update position to point to new entry
      this.stmts.setHistoryPosition.run(storyId, newHistoryId);

      // Prune old history entries if we have too many
      // Note: After undo+edit, deleteHistoryAfter has already removed the "future" branch,
      // so the remaining entries form a linear chain. We keep the most recent entries
      // (highest IDs) which are the ones reachable via undo from current position.
      const count = this.stmts.countHistory.get(storyId);
      if (count.count > SqliteStorageService.MAX_HISTORY_ENTRIES) {
        this.stmts.pruneOldHistory.run(storyId, storyId, SqliteStorageService.MAX_HISTORY_ENTRIES);
      }
    });
    transaction();
  }

  /**
   * Get the undo/redo status for a story
   * Returns whether undo and redo are available
   */
  async getHistoryStatus(storyId) {
    const existing = this.stmts.getStory.get(storyId);
    if (!existing) {
      throw new Error(`Story not found: ${storyId}`);
    }

    // Initialize history for existing stories that have content but no history
    // Only call if no history exists to avoid unnecessary overhead on every save
    const historyCount = this.stmts.countHistory.get(storyId)?.count || 0;
    if (historyCount === 0) {
      await this.ensureHistoryInitialized(storyId, existing);
    }

    const positionRow = this.stmts.getHistoryPosition.get(storyId);
    const currentHistoryId = positionRow?.history_id;

    if (!currentHistoryId) {
      // No history yet
      return { canUndo: false, canRedo: false };
    }

    // Check if there are entries before and after current position
    const beforeCount = this.stmts.countHistoryBefore.get(storyId, currentHistoryId);
    const afterCount = this.stmts.countHistoryAfter.get(storyId, currentHistoryId);

    return {
      canUndo: beforeCount.count > 0,
      canRedo: afterCount.count > 0
    };
  }

  /**
   * Ensure history is initialized for a story
   * For existing stories with content but no history, creates an initial entry
   */
  async ensureHistoryInitialized(storyId, existingStory = null) {
    const story = existingStory || this.stmts.getStory.get(storyId);
    if (!story) return;

    // Check if history exists for this story
    const historyCount = this.stmts.countHistory.get(storyId);

    // If story has content but no history, create initial entry
    if (story.content && story.content.length > 0 && historyCount.count === 0) {
      const wordCount = calculateWordCount(story.content);
      const now = new Date().toISOString();

      // Use transaction to ensure atomicity
      const transaction = this.db.transaction(() => {
        const result = this.stmts.insertHistory.run(storyId, story.content, wordCount, now);
        this.stmts.setHistoryPosition.run(storyId, result.lastInsertRowid);
      });
      transaction();
    }
  }

  /**
   * Undo to the previous history entry
   * Returns the restored content or null if nothing to undo
   */
  async undoStoryContent(storyId) {
    const existing = this.stmts.getStory.get(storyId);
    if (!existing) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const positionRow = this.stmts.getHistoryPosition.get(storyId);
    const currentHistoryId = positionRow?.history_id;

    if (!currentHistoryId) {
      return null; // No history
    }

    // Get the entry before current position
    const previousEntry = this.stmts.getHistoryBefore.get(storyId, currentHistoryId);

    if (!previousEntry) {
      return null; // Nothing to undo
    }

    const modified = new Date().toISOString();

    // Use transaction to ensure atomicity
    const transaction = this.db.transaction(() => {
      // Update position to previous entry
      this.stmts.setHistoryPosition.run(storyId, previousEntry.id);

      // Update the story content (skip history save since this is an undo)
      this.stmts.updateStoryContent.run(previousEntry.content, previousEntry.word_count, modified, storyId);
    });
    transaction();

    // Get updated status
    const status = await this.getHistoryStatus(storyId);

    return {
      content: previousEntry.content,
      wordCount: previousEntry.word_count,
      modified,
      ...status
    };
  }

  /**
   * Redo to the next history entry
   * Returns the restored content or null if nothing to redo
   */
  async redoStoryContent(storyId) {
    const existing = this.stmts.getStory.get(storyId);
    if (!existing) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const positionRow = this.stmts.getHistoryPosition.get(storyId);
    const currentHistoryId = positionRow?.history_id;

    if (!currentHistoryId) {
      return null; // No history
    }

    // Get the entry after current position
    const nextEntry = this.stmts.getHistoryAfter.get(storyId, currentHistoryId);

    if (!nextEntry) {
      return null; // Nothing to redo
    }

    const modified = new Date().toISOString();

    // Use transaction to ensure atomicity
    const transaction = this.db.transaction(() => {
      // Update position to next entry
      this.stmts.setHistoryPosition.run(storyId, nextEntry.id);

      // Update the story content (skip history save since this is a redo)
      this.stmts.updateStoryContent.run(nextEntry.content, nextEntry.word_count, modified, storyId);
    });
    transaction();

    // Get updated status
    const status = await this.getHistoryStatus(storyId);

    return {
      content: nextEntry.content,
      wordCount: nextEntry.word_count,
      modified,
      ...status
    };
  }

  // ==================== Database Management ====================

  /**
   * Close the database connection
   */
  close() {
    this.db.close();
  }
}
