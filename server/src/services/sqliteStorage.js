/**
 * SQLite Storage Service
 * Handles all database operations for stories, characters, lorebooks, presets, and settings
 */

import { initializeDatabase, calculateWordCount } from './database.js';
import { computeCharacterChecksum, computeLorebookChecksum } from './checksum-service.js';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { gzipSync, gunzipSync } from 'zlib';

/**
 * How long a passage prompt can go unreferenced by the story's record before it's dropped: long
 * enough for the passage it was written for to be recorded, since a save can land mid-generation.
 */
const UNREFERENCED_PROMPT_GRACE_MS = 60 * 60 * 1000;

/**
 * Where a character version came from. original: the card as it was imported or created, kept
 * before its first change. baseline: the card as it was when its history started, for a card
 * already edited before versions were kept. archivist: suggested edits accepted from a story or
 * chat, whose `source_id` is `story:<id>` or `chat:<id>`.
 */
export const CHARACTER_VERSION_SOURCES = ['original', 'baseline', 'edit', 'restore', 'archivist'];

/** The card fields a version lists as changed, besides the portrait and everything else. */
const CHARACTER_VERSION_FIELDS = [
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'system_prompt',
  'alternate_greetings',
];

/** The library lorebook linked to a card. The checksum leaves it out, but versions keep it. */
function linkedLorebookOf(card) {
  return card?.data?.extensions?.ursceal_lorebook_id ?? null;
}

function characterVersionFromRow(row) {
  return {
    id: row.id,
    characterId: row.character_id,
    data: JSON.parse(row.data),
    imageChanged: !!row.image_changed,
    source: row.source,
    sourceId: row.source_id,
    created: row.created,
  };
}

/** The checksum of everything in a card besides CHARACTER_VERSION_FIELDS. */
function checksumOfOtherFields(card) {
  const data = { ...card.data };
  for (const field of CHARACTER_VERSION_FIELDS) delete data[field];
  return computeCharacterChecksum({ data });
}

/**
 * The fields that differ between two versions of a card: any of CHARACTER_VERSION_FIELDS,
 * 'lorebook' for its linked lorebook, 'other' when something else in the card changed, and
 * 'portrait' when the portrait was replaced.
 */
function changedCharacterFields(previousRow, row) {
  const previousCard = JSON.parse(previousRow.data);
  const card = JSON.parse(row.data);
  const before = previousCard.data ?? {};
  const after = card.data ?? {};
  const changed = CHARACTER_VERSION_FIELDS.filter(
    (field) => JSON.stringify(before[field] ?? '') !== JSON.stringify(after[field] ?? ''),
  );
  if (linkedLorebookOf(previousCard) !== linkedLorebookOf(card)) {
    changed.push('lorebook');
  }
  if (checksumOfOtherFields(previousCard) !== checksumOfOtherFields(card)) changed.push('other');
  if (row.image_changed) changed.push('portrait');
  return changed;
}

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
          onboarding_completed = @onboardingCompleted,
          experimental_chats = @experimentalChats,
          experimental_old_story_mode = @experimentalOldStoryMode
        WHERE id = 1
      `),

      // Stories
      listStories: this.db.prepare(`
        SELECT id, title, description, scenario, created, modified, persona_character_id, config_preset_id, word_count,
               continuity_id, perspective, perspective_tense, perspective_character_id
        FROM stories
        ORDER BY modified DESC
      `),
      getStory: this.db.prepare('SELECT * FROM stories WHERE id = ?'),
      insertStory: this.db.prepare(`
        INSERT INTO stories (id, title, description, content, word_count, needs_rewrite_prompt, persona_character_id, config_preset_id, created, modified)
        VALUES (@id, @title, @description, @content, @wordCount, @needsRewritePrompt, @personaCharacterId, @configPresetId, @created, @modified)
      `),
      setStoryNeedsRewritePrompt: this.db.prepare(
        'UPDATE stories SET needs_rewrite_prompt = ? WHERE id = ?',
      ),
      updateStoryAvatarWindows: this.db.prepare(
        'UPDATE stories SET avatar_windows = ? WHERE id = ?',
      ),
      updateStoryPassages: this.db.prepare('UPDATE stories SET passages = ? WHERE id = ?'),
      insertPassagePrompt: this.db.prepare(
        'INSERT INTO passage_prompts (story_id, id, system, user, created) VALUES (?, ?, ?, ?, ?)',
      ),
      getPassagePrompt: this.db.prepare(
        'SELECT system, user, created FROM passage_prompts WHERE story_id = ? AND id = ?',
      ),
      listPassagePromptIds: this.db.prepare(
        'SELECT id, created FROM passage_prompts WHERE story_id = ?',
      ),
      deletePassagePrompt: this.db.prepare(
        'DELETE FROM passage_prompts WHERE story_id = ? AND id = ?',
      ),
      copyPassagePrompts: this.db.prepare(`
        INSERT INTO passage_prompts (story_id, id, system, user, created)
        SELECT ?, id, system, user, created FROM passage_prompts WHERE story_id = ?
      `),
      updateStoryContentAndPassages: this.db.prepare(
        'UPDATE stories SET content = ?, word_count = ?, modified = ?, passages = ? WHERE id = ?',
      ),
      updateStoryMetadata: this.db.prepare(`
        UPDATE stories SET title = @title, description = @description, scenario = @scenario,
                          continuity_id = @continuityId,
                          perspective = @perspective, perspective_tense = @perspectiveTense,
                          perspective_character_id = @perspectiveCharacterId,
                          persona_character_id = @personaCharacterId,
                          config_preset_id = @configPresetId, modified = @modified
        WHERE id = @id
      `),
      updateStoryContent: this.db.prepare(
        'UPDATE stories SET content = ?, word_count = ?, modified = ? WHERE id = ?',
      ),
      deleteStory: this.db.prepare('DELETE FROM stories WHERE id = ?'),

      // Characters
      listCharacters: this.db.prepare(
        'SELECT id, name, created, modified FROM characters ORDER BY name',
      ),
      getCharacter: this.db.prepare(
        'SELECT id, name, data, created, modified FROM characters WHERE id = ?',
      ),
      getCharacterImage: this.db.prepare('SELECT image FROM characters WHERE id = ?'),
      getCharacterThumbnail: this.db.prepare('SELECT thumbnail FROM characters WHERE id = ?'),
      getCharacterThumbnailMedium: this.db.prepare(
        'SELECT thumbnail_medium FROM characters WHERE id = ?',
      ),
      getCharacterPortrait: this.db.prepare('SELECT portrait FROM characters WHERE id = ?'),
      updateCharacterThumbnails: this.db.prepare(`
        UPDATE characters
        SET thumbnail = @thumbnail, thumbnail_medium = @thumbnailMedium, portrait = @portrait
        WHERE id = @id AND image = @image
      `),
      insertCharacter: this.db.prepare(`
        INSERT INTO characters (id, name, data, image, thumbnail, thumbnail_medium, portrait,
                                created, modified, import_origin_checksum,
                                import_internal_checksum, current_checksum)
        VALUES (@id, @name, @data, @image, @thumbnail, @thumbnailMedium, @portrait, @created,
                @modified, @importOriginChecksum, @importInternalChecksum, @currentChecksum)
      `),
      updateCharacter: this.db.prepare(`
        UPDATE characters SET name = @name, data = @data, modified = @modified WHERE id = @id
      `),
      updateCharacterWithImage: this.db.prepare(`
        UPDATE characters SET name = @name, data = @data, image = @image, thumbnail = @thumbnail, thumbnail_medium = @thumbnailMedium, portrait = @portrait, modified = @modified WHERE id = @id
      `),
      updateCharacterCurrentChecksum: this.db.prepare(
        'UPDATE characters SET current_checksum = ? WHERE id = ?',
      ),
      findCharactersByOriginChecksum: this.db.prepare(
        `SELECT id, name, current_checksum, import_internal_checksum
         FROM characters WHERE import_origin_checksum = ?`,
      ),
      charactersMissingChecksum: this.db.prepare(
        'SELECT id FROM characters WHERE current_checksum IS NULL',
      ),
      listCharacterSummaries: this.db.prepare(`
        SELECT id, name, data, created,
               image IS NOT NULL AS has_image,
               thumbnail IS NOT NULL AS has_thumbnail,
               thumbnail_medium IS NOT NULL AS has_thumbnail_medium,
               portrait IS NOT NULL AS has_portrait
        FROM characters
        ORDER BY name
      `),
      deleteCharacter: this.db.prepare('DELETE FROM characters WHERE id = ?'),
      getCharacterVersionBase: this.db.prepare(
        'SELECT data, created, current_checksum, import_internal_checksum FROM characters WHERE id = ?',
      ),

      // Character versions
      listCharacterVersions: this.db.prepare(
        'SELECT * FROM character_versions WHERE character_id = ? ORDER BY id',
      ),
      getStoryTitle: this.db.prepare('SELECT title FROM stories WHERE id = ?'),
      getChatTitle: this.db.prepare('SELECT title FROM chats WHERE id = ?'),
      getCharacterVersion: this.db.prepare(
        'SELECT * FROM character_versions WHERE character_id = ? AND id = ?',
      ),
      hasCharacterVersions: this.db.prepare(
        'SELECT 1 FROM character_versions WHERE character_id = ? LIMIT 1',
      ),
      insertCharacterVersion: this.db.prepare(`
        INSERT INTO character_versions (character_id, data, checksum, image_changed, source, source_id, created)
        VALUES (@characterId, @data, @checksum, @imageChanged, @source, @sourceId, @created)
      `),
      characterExists: this.db.prepare('SELECT 1 FROM characters WHERE id = ?'),

      // Story-Character relationships
      getStoryCharacterIds: this.db.prepare(
        'SELECT character_id FROM story_characters WHERE story_id = ?',
      ),
      addStoryCharacter: this.db.prepare(
        'INSERT OR IGNORE INTO story_characters (story_id, character_id) VALUES (?, ?)',
      ),
      removeStoryCharacter: this.db.prepare(
        'DELETE FROM story_characters WHERE story_id = ? AND character_id = ?',
      ),
      getStoriesUsingCharacter: this.db.prepare(`
        SELECT s.id, s.title FROM stories s
        JOIN story_characters sc ON s.id = sc.story_id
        WHERE sc.character_id = ?
      `),
      getStoryIdsUsingCharacter: this.db.prepare(`
        SELECT story_id AS id FROM story_characters WHERE character_id = ?
        UNION SELECT id FROM stories WHERE persona_character_id = ?
      `),
      updateStoryModified: this.db.prepare('UPDATE stories SET modified = ? WHERE id = ?'),
      clearStoryPersona: this.db.prepare(
        'UPDATE stories SET persona_character_id = NULL WHERE id = ?',
      ),
      setStoryPersona: this.db.prepare(
        'UPDATE stories SET persona_character_id = ?, modified = ? WHERE id = ?',
      ),

      // Lorebooks
      listLorebooks: this.db.prepare(`
        SELECT l.id, l.name, l.description, COUNT(e.id) as entry_count
        FROM lorebooks l
        LEFT JOIN lorebook_entries e ON l.id = e.lorebook_id
        GROUP BY l.id
        ORDER BY l.name
      `),
      getLorebook: this.db.prepare('SELECT * FROM lorebooks WHERE id = ?'),
      getLorebookEntries: this.db.prepare(
        'SELECT * FROM lorebook_entries WHERE lorebook_id = ? ORDER BY display_index',
      ),
      insertLorebook: this.db.prepare(`
        INSERT INTO lorebooks (id, name, description, scan_depth, token_budget, recursive_scanning,
                               extensions, created, modified,
                               import_origin_checksum, import_internal_checksum, current_checksum)
        VALUES (@id, @name, @description, @scanDepth, @tokenBudget, @recursiveScanning,
                @extensions, @created, @modified,
                @importOriginChecksum, @importInternalChecksum, @currentChecksum)
      `),
      updateLorebook: this.db.prepare(`
        UPDATE lorebooks SET name = @name, description = @description, scan_depth = @scanDepth,
                            token_budget = @tokenBudget, recursive_scanning = @recursiveScanning,
                            extensions = @extensions, modified = @modified
        WHERE id = @id
      `),
      updateLorebookCurrentChecksum: this.db.prepare(
        'UPDATE lorebooks SET current_checksum = ? WHERE id = ?',
      ),
      findLorebooksByOriginChecksum: this.db.prepare(
        `SELECT id, name, current_checksum, import_internal_checksum
         FROM lorebooks WHERE import_origin_checksum = ?`,
      ),
      findLorebooksByCurrentChecksum: this.db.prepare(
        'SELECT id, name FROM lorebooks WHERE current_checksum = ? ORDER BY created',
      ),
      lorebookNameExists: this.db.prepare('SELECT 1 FROM lorebooks WHERE name = ?'),
      lorebooksMissingChecksum: this.db.prepare(
        'SELECT id FROM lorebooks WHERE current_checksum IS NULL',
      ),
      charactersReferencingLorebook: this.db.prepare(
        `SELECT id, name FROM characters
         WHERE json_extract(data, '$.data.extensions.ursceal_lorebook_id') = ? AND id != ?`,
      ),
      storiesReferencingLorebook: this.db.prepare(
        `SELECT s.id, s.title FROM story_lorebooks sl
         JOIN stories s ON s.id = sl.story_id
         WHERE sl.lorebook_id = ?`,
      ),
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
      deleteLorebookEntry: this.db.prepare(
        'DELETE FROM lorebook_entries WHERE id = ? AND lorebook_id = ?',
      ),
      deleteLorebookEntries: this.db.prepare('DELETE FROM lorebook_entries WHERE lorebook_id = ?'),

      // Story-Lorebook relationships
      getStoryLorebookIds: this.db.prepare(
        'SELECT lorebook_id FROM story_lorebooks WHERE story_id = ?',
      ),
      addStoryLorebook: this.db.prepare(
        'INSERT OR IGNORE INTO story_lorebooks (story_id, lorebook_id) VALUES (?, ?)',
      ),
      removeStoryLorebook: this.db.prepare(
        'DELETE FROM story_lorebooks WHERE story_id = ? AND lorebook_id = ?',
      ),

      // Presets
      listPresets: this.db.prepare(
        'SELECT id, name, provider, is_default FROM presets ORDER BY name',
      ),
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
      getHistoryPosition: this.db.prepare(
        'SELECT history_id FROM story_history_position WHERE story_id = ?',
      ),
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
      countHistory: this.db.prepare(
        'SELECT COUNT(*) as count FROM story_history WHERE story_id = ?',
      ),
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
   * Generate thumbnail from image buffer (96x96, square — for table rows / recent bar)
   */
  async generateThumbnail(imageBuffer) {
    try {
      return await sharp(imageBuffer)
        .autoOrient()
        .resize(96, 96, {
          fit: 'cover',
          position: 'top',
          withoutEnlargement: false,
        })
        .webp({ quality: 90 })
        .toBuffer();
    } catch (error) {
      console.error('Failed to generate thumbnail:', error);
      return null;
    }
  }

  /**
   * Generate medium thumbnail from image buffer (256x384, 2:3 — for picker cards)
   */
  async generateMediumThumbnail(imageBuffer) {
    try {
      return await sharp(imageBuffer)
        .autoOrient()
        .resize(256, 384, {
          fit: 'cover',
          position: 'top',
          withoutEnlargement: false,
        })
        .webp({ quality: 90 })
        .toBuffer();
    } catch (error) {
      console.error('Failed to generate medium thumbnail:', error);
      return null;
    }
  }

  /**
   * Generate a portrait from image buffer (up to 1024x1536, uncropped and never enlarged — for
   * the floating portraits beside a story, which can be resized well past the medium thumbnail)
   */
  async generatePortrait(imageBuffer) {
    try {
      return await sharp(imageBuffer)
        .autoOrient()
        .resize(1024, 1536, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 90 })
        .toBuffer();
    } catch (error) {
      console.error('Failed to generate portrait:', error);
      return null;
    }
  }

  /**
   * Every smaller copy of a character's image that's kept beside it.
   * @returns {Promise<{thumbnail: Buffer|null, thumbnailMedium: Buffer|null, portrait: Buffer|null}>}
   */
  async generateImageSizes(imageBuffer) {
    const [thumbnail, thumbnailMedium, portrait] = await Promise.all([
      this.generateThumbnail(imageBuffer),
      this.generateMediumThumbnail(imageBuffer),
      this.generatePortrait(imageBuffer),
    ]);
    return { thumbnail, thumbnailMedium, portrait };
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
      onboardingCompleted: !!row.onboarding_completed,
      experimentalChats: !!row.experimental_chats,
      experimentalOldStoryMode: !!row.experimental_old_story_mode,
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
      onboardingCompleted: settings.onboardingCompleted ? 1 : 0,
      experimentalChats: settings.experimentalChats ? 1 : 0,
      experimentalOldStoryMode: settings.experimentalOldStoryMode ? 1 : 0,
    });
    return settings;
  }

  // ==================== Story Operations ====================

  async listStories() {
    const rows = this.stmts.listStories.all();
    return rows.map((row) => {
      // Get character IDs for this story
      const characterRows = this.stmts.getStoryCharacterIds.all(row.id);
      const characterIds = characterRows.map((r) => r.character_id);

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        scenario: row.scenario || '',
        continuityId: row.continuity_id ?? null,
        perspective: row.perspective ?? null,
        perspectiveTense: row.perspective_tense ?? null,
        perspectiveCharacterId: row.perspective_character_id ?? null,
        created: row.created,
        modified: row.modified,
        characterIds,
        personaCharacterId: row.persona_character_id,
        configPresetId: row.config_preset_id,
        wordCount: row.word_count || 0,
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
    const characterIds = characterRows.map((r) => r.character_id);

    // Get lorebook IDs for this story
    const lorebookRows = this.stmts.getStoryLorebookIds.all(storyId);
    const lorebookIds = lorebookRows.map((r) => r.lorebook_id);

    // Get characters info
    const characters = characterIds.map((id) => ({ id }));

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      scenario: row.scenario || '',
      continuityId: row.continuity_id ?? null,
      perspective: row.perspective ?? null,
      perspectiveTense: row.perspective_tense ?? null,
      perspectiveCharacterId: row.perspective_character_id ?? null,
      content: row.content || '',
      created: row.created,
      modified: row.modified,
      characterIds,
      personaCharacterId: row.persona_character_id,
      lorebookIds,
      configPresetId: row.config_preset_id,
      characters,
      needsRewritePrompt: !!row.needs_rewrite_prompt,
      avatarWindows: JSON.parse(row.avatar_windows || '[]'),
      passages: JSON.parse(row.passages || '[]'),
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
      modified: now,
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
      needsRewritePrompt: !!needsRewritePrompt,
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
      scenario: updates.scenario !== undefined ? updates.scenario : existing.scenario || '',
      continuityId:
        updates.continuityId !== undefined ? updates.continuityId : existing.continuity_id,
      perspective: updates.perspective !== undefined ? updates.perspective : existing.perspective,
      perspectiveTense:
        updates.perspectiveTense !== undefined
          ? updates.perspectiveTense
          : existing.perspective_tense,
      perspectiveCharacterId:
        updates.perspectiveCharacterId !== undefined
          ? updates.perspectiveCharacterId
          : existing.perspective_character_id,
      personaCharacterId:
        updates.personaCharacterId !== undefined
          ? updates.personaCharacterId
          : existing.persona_character_id,
      configPresetId:
        updates.configPresetId !== undefined ? updates.configPresetId : existing.config_preset_id,
      modified,
    });

    return {
      ...updates,
      id: storyId,
      modified,
    };
  }

  /**
   * Save a story's content. `options.passages`, when given, is Enhanced Story Mode's record of the
   * story's passages (where each came from, and the reasoning behind it), saved in the same write
   * so the two never disagree.
   */
  async updateStoryContent(storyId, content, options = {}) {
    const existing = this.stmts.getStory.get(storyId);
    if (!existing) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const changed = existing.content !== content;
    const passages = options.passages ? JSON.stringify(options.passages) : null;

    if (changed) {
      const modified = new Date().toISOString();
      const wordCount = calculateWordCount(content);

      // Save to history unless this is an undo/redo operation
      if (!options.skipHistory) {
        await this.saveToHistory(storyId, content, wordCount);
      }

      if (passages) {
        this.stmts.updateStoryContentAndPassages.run(
          content,
          wordCount,
          modified,
          passages,
          storyId,
        );
        this.prunePassagePrompts(storyId, options.passages);
      } else {
        this.stmts.updateStoryContent.run(content, wordCount, modified, storyId);
      }
      return { success: true, modified, changed };
    }

    if (passages) {
      this.stmts.updateStoryPassages.run(passages, storyId);
      this.prunePassagePrompts(storyId, options.passages);
    }
    return { success: true, modified: existing.modified, changed };
  }

  /**
   * Keep the prompt a passage was written from, for Enhanced Story Mode's record to name.
   * @returns {string} The prompt's id.
   */
  savePassagePrompt(storyId, { system, user }) {
    const id = uuidv4();
    this.stmts.insertPassagePrompt.run(
      storyId,
      id,
      gzipSync(system ?? ''),
      gzipSync(user ?? ''),
      new Date().toISOString(),
    );
    return id;
  }

  /** The prompt a passage was written from, or null if it isn't kept. */
  getPassagePrompt(storyId, promptId) {
    const row = this.stmts.getPassagePrompt.get(storyId, promptId);
    if (!row) return null;
    return {
      id: promptId,
      system: gunzipSync(row.system).toString('utf8'),
      user: gunzipSync(row.user).toString('utf8'),
      created: row.created,
    };
  }

  /** Drop the prompts no passage in the record names, once they're past their grace period. */
  prunePassagePrompts(storyId, passages) {
    const named = new Set(passages.map((passage) => passage.promptId).filter(Boolean));
    const cutoff = new Date(Date.now() - UNREFERENCED_PROMPT_GRACE_MS).toISOString();
    for (const { id, created } of this.stmts.listPassagePromptIds.all(storyId)) {
      if (!named.has(id) && created < cutoff) {
        this.stmts.deletePassagePrompt.run(storyId, id);
      }
    }
  }

  async deleteStory(storyId) {
    const existing = this.stmts.getStory.get(storyId);
    if (!existing) {
      throw new Error(`Story not found: ${storyId}`);
    }

    this.stmts.deleteStory.run(storyId);
    return { success: true };
  }

  /**
   * Copy a story with its characters, lorebooks, Continuity, perspective and preset.
   *
   * @param {string} storyId
   * @param {Object} [options]
   * @param {boolean} [options.blank] - Start the copy as a new story instead: no content,
   *   scenario, passages or avatar windows, titled "(New)" rather than "(Copy)".
   */
  async duplicateStory(storyId, { blank = false } = {}) {
    const existing = this.stmts.getStory.get(storyId);
    if (!existing) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const newId = uuidv4();
    const now = new Date().toISOString();

    const newTitle = `${existing.title} ${blank ? '(New)' : '(Copy)'}`;

    // Use transaction to ensure atomicity
    const transaction = this.db.transaction(() => {
      // Insert new story with copied data
      this.stmts.insertStory.run({
        id: newId,
        title: newTitle,
        description: existing.description || '',
        content: blank ? '' : existing.content || '',
        wordCount: blank ? 0 : existing.word_count || 0,
        needsRewritePrompt: blank ? 0 : existing.needs_rewrite_prompt || 0,
        personaCharacterId: existing.persona_character_id,
        configPresetId: existing.config_preset_id,
        created: now,
        modified: now,
      });

      // Copy scenario and Continuity if present
      const scenario = blank ? '' : existing.scenario || '';
      if (scenario || existing.continuity_id) {
        this.db
          .prepare('UPDATE stories SET scenario = ?, continuity_id = ? WHERE id = ?')
          .run(scenario, existing.continuity_id ?? null, newId);
      }

      // Copy the narrative perspective
      this.db
        .prepare(
          'UPDATE stories SET perspective = ?, perspective_tense = ?, perspective_character_id = ? WHERE id = ?',
        )
        .run(
          existing.perspective ?? null,
          existing.perspective_tense ?? null,
          existing.perspective_character_id ?? null,
          newId,
        );

      // Copy avatar windows if present
      if (existing.avatar_windows && !blank) {
        this.stmts.updateStoryAvatarWindows.run(existing.avatar_windows, newId);
      }

      // Copy the record of how each passage was written
      if (existing.passages && !blank) {
        this.stmts.updateStoryPassages.run(existing.passages, newId);
        this.stmts.copyPassagePrompts.run(newId, storyId);
      }

      // Copy character associations
      const characterRows = this.stmts.getStoryCharacterIds.all(storyId);
      for (const row of characterRows) {
        this.stmts.addStoryCharacter.run(newId, row.character_id);
      }

      // Copy lorebook associations
      const lorebookRows = this.stmts.getStoryLorebookIds.all(storyId);
      for (const row of lorebookRows) {
        this.stmts.addStoryLorebook.run(newId, row.lorebook_id);
      }
    });

    transaction();

    // Return the new story
    return this.getStory(newId);
  }

  // ==================== Character Operations ====================

  /**
   * Every character with the fields list views need, in one query.
   *
   * The image columns are tested with `IS NOT NULL` rather than fetched and
   * null-checked, so a list of characters never pulls full-resolution card PNGs
   * into memory just to decide whether a URL exists.
   *
   * @returns {Array<Object>} One summary per character, sorted by stored name.
   */
  listCharacterSummaries() {
    return this.stmts.listCharacterSummaries.all().map((row) => {
      const summary = {
        id: row.id,
        name: row.name || 'Unknown',
        description: '',
        tags: [],
        lorebookId: null,
        created: row.created,
        hasImage: !!row.has_image,
        hasThumbnail: !!row.has_thumbnail,
        hasThumbnailMedium: !!row.has_thumbnail_medium,
        hasPortrait: !!row.has_portrait,
        failed: false,
      };

      try {
        const card = JSON.parse(row.data);
        summary.name = card.data?.name || summary.name;
        summary.description = card.data?.description || '';
        summary.tags = card.data?.tags || card.tags || [];
        summary.lorebookId = card.data?.extensions?.ursceal_lorebook_id || null;
        summary.created = card.metadata?.created || row.created;
      } catch (error) {
        console.error(`Failed to parse character ${row.id}:`, error.message);
        summary.failed = true;
      }

      return summary;
    });
  }

  async listAllCharacters() {
    const rows = this.stmts.listCharacters.all();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      created: row.created,
      modified: row.modified,
    }));
  }

  async listStoryCharacters(storyId) {
    const rows = this.stmts.getStoryCharacterIds.all(storyId);
    return rows.map((row) => ({ id: row.character_id }));
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

  /**
   * Save a character, deriving `current_checksum` from the data being written.
   *
   * Checksum bookkeeping lives here rather than in the routes so it can't drift
   * from what is actually stored: every write recomputes `current_checksum`, and
   * the import baselines are written once at insert and never touched again.
   *
   * @param {string} characterId
   * @param {Object} characterData - Full V2 card.
   * @param {Buffer|null} imageBuffer
   * @param {Object} [options]
   * @param {string|null} [options.originChecksum] - Checksum of the source content
   *   before local image URLs were rewritten. Only meaningful on import; ignored
   *   when updating an existing character.
   * @param {'edit'|'restore'|'archivist'} [options.source] - Why an existing character changed.
   *   Each change is kept as a version, and the first also keeps the card as it was.
   * @param {string|null} [options.sourceId] - The version restored, or the story or chat the
   *   Archivist read.
   */
  async saveCharacter(characterId, characterData, imageBuffer = null, options = {}) {
    const existing = this.stmts.characterExists.get(characterId);
    const now = new Date().toISOString();

    // Ensure metadata
    if (!characterData.metadata) {
      characterData.metadata = {};
    }

    const name = characterData.data?.name || 'Untitled';
    const dataJson = JSON.stringify(characterData);
    const currentChecksum = computeCharacterChecksum(characterData);

    if (existing) {
      // Update existing character
      const sizes = imageBuffer ? await this.generateImageSizes(imageBuffer) : null;

      this.db.transaction(() => {
        const previous = this.stmts.getCharacterVersionBase.get(characterId);
        if (!previous) return;
        const previousCard = JSON.parse(previous.data);
        const previousChecksum = computeCharacterChecksum(previousCard);
        const changed =
          imageBuffer !== null ||
          previousChecksum !== currentChecksum ||
          linkedLorebookOf(previousCard) !== linkedLorebookOf(characterData);

        // The first change also keeps the card as it was, so it can be restored.
        if (changed && !this.stmts.hasCharacterVersions.get(characterId)) {
          const untouched = previousChecksum === previous.import_internal_checksum;
          this.stmts.insertCharacterVersion.run({
            characterId,
            data: previous.data,
            checksum: previousChecksum,
            imageChanged: 0,
            source: untouched ? 'original' : 'baseline',
            sourceId: null,
            created: untouched ? previous.created : now,
          });
        }

        if (imageBuffer) {
          this.stmts.updateCharacterWithImage.run({
            id: characterId,
            name,
            data: dataJson,
            image: imageBuffer,
            ...sizes,
            modified: now,
          });
        } else {
          this.stmts.updateCharacter.run({
            id: characterId,
            name,
            data: dataJson,
            modified: now,
          });
        }
        // `import_origin_checksum` and `import_internal_checksum` are import-time
        // baselines: leaving them alone is what makes "edited since import"
        // (current !== internal) mean anything.
        this.stmts.updateCharacterCurrentChecksum.run(currentChecksum, characterId);

        if (changed) {
          this.stmts.insertCharacterVersion.run({
            characterId,
            data: dataJson,
            checksum: currentChecksum,
            imageChanged: imageBuffer ? 1 : 0,
            source: options.source ?? 'edit',
            sourceId: options.sourceId ?? null,
            created: now,
          });
        }
      })();
    } else {
      // Insert new character
      const sizes = imageBuffer
        ? await this.generateImageSizes(imageBuffer)
        : { thumbnail: null, thumbnailMedium: null, portrait: null };

      this.stmts.insertCharacter.run({
        id: characterId,
        name,
        data: dataJson,
        image: imageBuffer,
        ...sizes,
        created: now,
        modified: now,
        importOriginChecksum: options.originChecksum ?? null,
        importInternalChecksum: currentChecksum,
        currentChecksum,
      });
    }

    return { id: characterId };
  }

  /**
   * A character's versions, oldest first, each with the fields it changed from the one before
   * (see changedCharacterFields). The first is the card as it was before anything changed, and
   * there are none until something does. An Archivist version also carries the title of the
   * story or chat it came from as `sourceTitle`.
   */
  listCharacterVersions(characterId) {
    let previous = null;
    return this.stmts.listCharacterVersions.all(characterId).map((row) => {
      const version = characterVersionFromRow(row);
      version.changed = previous ? changedCharacterFields(previous, row) : [];
      if (version.source === 'archivist') {
        version.sourceTitle = this.archivistSourceTitle(version.sourceId);
      }
      previous = row;
      return version;
    });
  }

  /** The title of the story or chat an Archivist version came from, or null once it's deleted. */
  archivistSourceTitle(sourceId) {
    const [kind, id] = String(sourceId ?? '').split(/:(.*)/s);
    const statement = { story: this.stmts.getStoryTitle, chat: this.stmts.getChatTitle }[kind];
    return statement?.get(id)?.title ?? null;
  }

  /**
   * Whether a character's card has changed since it was imported or created. The portrait
   * doesn't count.
   * @returns {boolean|null|undefined} null when it can't be told, for a character imported
   *   before checksums were kept; undefined when the character doesn't exist.
   */
  characterEditedSinceImport(characterId) {
    const row = this.stmts.getCharacterVersionBase.get(characterId);
    if (!row) return undefined;
    if (!row.import_internal_checksum) return null;
    return row.current_checksum !== row.import_internal_checksum;
  }

  /** One version of a character, or null if it doesn't exist. */
  getCharacterVersion(characterId, versionId) {
    const row = this.stmts.getCharacterVersion.get(characterId, versionId);
    return row ? characterVersionFromRow(row) : null;
  }

  /**
   * Put a character's card back as it was at an earlier version, kept as a new version. The
   * portrait stays as it is.
   * @returns {Promise<Object|null>} The restored card, or null if the version doesn't exist.
   */
  async restoreCharacterVersion(characterId, versionId) {
    const version = this.getCharacterVersion(characterId, versionId);
    if (!version) return null;
    await this.saveCharacter(characterId, version.data, null, {
      source: 'restore',
      sourceId: String(versionId),
    });
    return this.getCharacter(characterId);
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

  async getCharacterThumbnailMedium(characterId) {
    const row = this.stmts.getCharacterThumbnailMedium.get(characterId);
    return row?.thumbnail_medium || null;
  }

  async hasCharacterThumbnailMedium(characterId) {
    const row = this.stmts.getCharacterThumbnailMedium.get(characterId);
    return !!row?.thumbnail_medium;
  }

  async getCharacterPortrait(characterId) {
    const row = this.stmts.getCharacterPortrait.get(characterId);
    return row?.portrait || null;
  }

  async hasCharacterPortrait(characterId) {
    const row = this.stmts.getCharacterPortrait.get(characterId);
    return !!row?.portrait;
  }

  /**
   * Store the smaller copies rendered from `image`, unless the character's image has been
   * replaced since, which brings its own.
   * @returns {Promise<boolean>} Whether they were stored
   */
  async setCharacterThumbnails(characterId, image, { thumbnail, thumbnailMedium, portrait }) {
    const result = this.stmts.updateCharacterThumbnails.run({
      id: characterId,
      image,
      thumbnail,
      thumbnailMedium,
      portrait,
    });
    return result.changes > 0;
  }

  async deleteCharacter(characterId) {
    this.stmts.deleteCharacter.run(characterId);
    return { success: true };
  }

  /**
   * Delete a character and the stories it's in, all or nothing, so a failure
   * part way through never leaves some stories gone and the character still there.
   *
   * The stories are re-read inside the transaction: if the character is now in
   * one that isn't in `confirmedStoryIds`, nothing is deleted.
   *
   * @returns {string[]|null} the deleted story ids, or null if refused
   */
  async deleteCharacterWithStories(characterId, confirmedStoryIds) {
    const confirmed = new Set(confirmedStoryIds);
    return this.db.transaction(() => {
      const storyIds = this.stmts.getStoryIdsUsingCharacter
        .all(characterId, characterId)
        .map((r) => r.id);
      if (storyIds.some((id) => !confirmed.has(id))) return null;

      for (const storyId of storyIds) this.stmts.deleteStory.run(storyId);
      this.stmts.deleteCharacter.run(characterId);
      return storyIds;
    })();
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
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      entryCount: row.entry_count,
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
          entryCount: entries.length,
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
      entries: entries.map((e) => ({
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
        extensions: JSON.parse(e.extensions || '{}'),
      })),
    };
  }

  /**
   * Save a lorebook, deriving `current_checksum` from the data being written.
   * Same ownership rule as saveCharacter: storage computes the current checksum,
   * the import baselines are written once at insert.
   *
   * @param {string} lorebookId
   * @param {Object} lorebookData
   * @param {Object} [options]
   * @param {string|null} [options.originChecksum] - Checksum of the source content
   *   before local image URLs were rewritten. Ignored when updating.
   */
  async saveLorebook(lorebookId, lorebookData, options = {}) {
    const existing = this.stmts.lorebookExists.get(lorebookId);
    const now = new Date().toISOString();
    const currentChecksum = computeLorebookChecksum(lorebookData);

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
          modified: now,
        });

        this.stmts.updateLorebookCurrentChecksum.run(currentChecksum, lorebookId);

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
          modified: now,
          importOriginChecksum: options.originChecksum ?? null,
          importInternalChecksum: currentChecksum,
          currentChecksum,
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
            extensions: JSON.stringify(entry.extensions || {}),
          });
        }
      }
    });

    transaction();
    return { id: lorebookId };
  }

  // ==================== Checksums & Duplicate Detection ====================

  /**
   * Characters imported from source content with this checksum.
   * @returns {Array<{id: string, name: string, current_checksum: string, import_internal_checksum: string}>}
   */
  findCharactersByOriginChecksum(checksum) {
    return this.stmts.findCharactersByOriginChecksum.all(checksum);
  }

  /** Lorebooks imported from source content with this checksum. */
  findLorebooksByOriginChecksum(checksum) {
    return this.stmts.findLorebooksByOriginChecksum.all(checksum);
  }

  /**
   * Oldest lorebook whose current content matches this checksum, if any.
   * @returns {{id: string, name: string}|null}
   */
  findLorebookByContentChecksum(checksum) {
    return this.stmts.findLorebooksByCurrentChecksum.all(checksum)[0] ?? null;
  }

  /**
   * A lorebook we already hold that is the same book as an incoming import.
   *
   * `contentChecksum` is taken from the source before image caching rewrites any
   * URLs, so it is matched against `import_origin_checksum` first — that column
   * holds the same pre-rewrite value, which is what lets two characters carrying
   * the same illustrated world book agree. An edited copy does not count: the
   * user should be able to import a clean one alongside it.
   *
   * Falling back to stored content catches lorebooks with no origin checksum —
   * anything predating schema v9, plus books with no external images, where the
   * two checksums are identical anyway.
   *
   * @returns {{id: string, name: string}|null}
   */
  findExistingLorebookForImport(contentChecksum) {
    const fromSameSource = this.findLorebooksByOriginChecksum(contentChecksum).find(
      (match) => match.current_checksum === match.import_internal_checksum,
    );

    return fromSameSource ?? this.findLorebookByContentChecksum(contentChecksum);
  }

  /**
   * Everything still pointing at a lorebook. Both halves matter before offering
   * to delete one: characters link a lorebook through
   * `extensions.ursceal_lorebook_id`, but stories attach lorebooks directly in
   * `story_lorebooks` (and stories.js auto-attaches a character's lorebook when
   * the character joins a story), so a lorebook with no characters left can
   * still be in active use.
   *
   * @param {string} lorebookId
   * @param {string} [excludeCharacterId] - Character being deleted, ignored in the count.
   * @returns {{characters: Array, stories: Array}}
   */
  getLorebookReferences(lorebookId, excludeCharacterId = '') {
    return {
      characters: this.stmts.charactersReferencingLorebook.all(lorebookId, excludeCharacterId),
      stories: this.stmts.storiesReferencingLorebook.all(lorebookId),
    };
  }

  /**
   * Append `(2)`, `(3)`, ... until the lorebook name is free.
   *
   * Only lorebooks get this treatment. A character's name is its `{{char}}`
   * macro and goes straight into the prompt, so renaming an imported card would
   * change what the model writes; lorebook names are library labels only.
   */
  resolveUniqueLorebookName(baseName) {
    const name = baseName || 'Untitled Lorebook';
    if (!this.stmts.lorebookNameExists.get(name)) return name;

    for (let suffix = 2; ; suffix++) {
      const candidate = `${name} (${suffix})`;
      if (!this.stmts.lorebookNameExists.get(candidate)) return candidate;
    }
  }

  /**
   * Fill in `current_checksum` for rows that predate schema v9.
   *
   * Deliberately recomputes from the stored entity rather than from anything
   * import-time, so backfilled checksums are identical to what a fresh import of
   * the same content produces — otherwise existing installs, the ones that
   * actually have duplicate lorebooks, would never match on import.
   *
   * `import_origin_checksum` stays NULL: we no longer have the pre-rewrite
   * source, and guessing would create false duplicate matches.
   *
   * @returns {{characters: number, lorebooks: number}}
   */
  async backfillChecksums() {
    let characters = 0;
    let lorebooks = 0;

    for (const { id } of this.stmts.charactersMissingChecksum.all()) {
      try {
        const row = this.stmts.getCharacter.get(id);
        this.stmts.updateCharacterCurrentChecksum.run(
          computeCharacterChecksum(JSON.parse(row.data)),
          id,
        );
        characters++;
      } catch (error) {
        console.error(`Failed to backfill checksum for character ${id}:`, error.message);
      }
    }

    for (const { id } of this.stmts.lorebooksMissingChecksum.all()) {
      try {
        const lorebook = await this.getLorebook(id);
        this.stmts.updateLorebookCurrentChecksum.run(computeLorebookChecksum(lorebook), id);
        lorebooks++;
      } catch (error) {
        console.error(`Failed to backfill checksum for lorebook ${id}:`, error.message);
      }
    }

    if (characters || lorebooks) {
      console.log(`Backfilled checksums: ${characters} character(s), ${lorebooks} lorebook(s)`);
    }
    return { characters, lorebooks };
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
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      provider: row.provider,
      isDefault: !!row.is_default,
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
      isDefault: !!row.is_default,
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
      isDefault: presetData.isDefault ? 1 : 0,
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
    const settings = (await this.getSettings()) || {};
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
      canRedo: afterCount.count > 0,
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
      this.stmts.updateStoryContent.run(
        previousEntry.content,
        previousEntry.word_count,
        modified,
        storyId,
      );
    });
    transaction();

    // Get updated status
    const status = await this.getHistoryStatus(storyId);

    return {
      content: previousEntry.content,
      wordCount: previousEntry.word_count,
      modified,
      ...status,
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
      ...status,
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
