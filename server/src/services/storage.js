/**
 * Storage Service
 * Handles filesystem operations for stories, characters, personas, and settings
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export class StorageService {
  constructor(dataRoot) {
    this.dataRoot = dataRoot;
    this.storiesDir = path.join(dataRoot, 'stories');
    this.charactersDir = path.join(dataRoot, 'characters');
    this.lorebooksDir = path.join(dataRoot, 'lorebooks');
    this.settingsFile = path.join(dataRoot, 'settings.json');

    this.initializeStorage();
  }

  /**
   * Initialize storage directories
   */
  async initializeStorage() {
    try {
      await fs.mkdir(this.storiesDir, { recursive: true });
      await fs.mkdir(this.charactersDir, { recursive: true });
      await fs.mkdir(this.lorebooksDir, { recursive: true });

      // Create default settings if not exists
      if (!fsSync.existsSync(this.settingsFile)) {
        await this.writeJSON(this.settingsFile, {
          apiKey: '',
          maxTokens: 4000,
          temperature: 1.5,
          showReasoning: false,
          autoSave: true,
          showPrompt: false,
          thirdPerson: true,
          filterAsterisks: true,
          // Lorebook settings
          lorebookScanDepth: 2000,     // Tokens to scan (approx 8000 chars)
          lorebookTokenBudget: 1800,   // Max tokens for lorebook content
          lorebookRecursionDepth: 3,   // Max recursive activation depth
          lorebookEnableRecursion: true
        });
      }

      console.log('Storage initialized successfully');
    } catch (error) {
      console.error('Failed to initialize storage:', error);
      throw error;
    }
  }

  // ==================== Helper Methods ====================

  /**
   * Read JSON file
   */
  async readJSON(filePath) {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  }

  /**
   * Write JSON file
   */
  async writeJSON(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Check if file exists
   */
  async exists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // ==================== Story Operations ====================

  /**
   * List all stories
   */
  async listStories() {
    const dirs = await fs.readdir(this.storiesDir);
    const stories = [];

    for (const dir of dirs) {
      const storyPath = path.join(this.storiesDir, dir);
      const metadataPath = path.join(storyPath, 'metadata.json');

      if (await this.exists(metadataPath)) {
        const metadata = await this.readJSON(metadataPath);
        stories.push(metadata);
      }
    }

    // Sort by modified date, newest first
    stories.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    return stories;
  }

  /**
   * Get story by ID
   */
  async getStory(storyId) {
    const storyPath = path.join(this.storiesDir, storyId);
    const metadataPath = path.join(storyPath, 'metadata.json');
    const contentPath = path.join(storyPath, 'content.txt');

    if (!await this.exists(metadataPath)) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const metadata = await this.readJSON(metadataPath);

    // Read content if it exists
    let content = '';
    if (await this.exists(contentPath)) {
      content = await fs.readFile(contentPath, 'utf8');
    }

    // Get characters for this story
    const characters = await this.listStoryCharacters(storyId);

    return {
      ...metadata,
      content,
      characters
    };
  }

  /**
   * Create new story
   */
  async createStory(title, description = '') {
    const storyId = uuidv4();
    const storyPath = path.join(this.storiesDir, storyId);
    const now = new Date().toISOString();

    // Create story directory
    await fs.mkdir(storyPath, { recursive: true });

    // Create metadata
    const metadata = {
      id: storyId,
      title,
      description,
      created: now,
      modified: now,
      characterIds: [],        // Array of character IDs (references to global library)
      personaCharacterId: null, // Optional: use a character as persona for this story
      lorebookIds: []          // Array of lorebook IDs (references to global library)
    };

    await this.writeJSON(path.join(storyPath, 'metadata.json'), metadata);

    // Create empty content file
    await fs.writeFile(path.join(storyPath, 'content.txt'), '', 'utf8');

    return metadata;
  }

  /**
   * Update story metadata
   */
  async updateStoryMetadata(storyId, updates) {
    const storyPath = path.join(this.storiesDir, storyId);
    const metadataPath = path.join(storyPath, 'metadata.json');

    if (!await this.exists(metadataPath)) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const metadata = await this.readJSON(metadataPath);
    const updated = {
      ...metadata,
      ...updates,
      id: storyId, // Prevent ID from being changed
      modified: new Date().toISOString()
    };

    await this.writeJSON(metadataPath, updated);
    return updated;
  }

  /**
   * Update story content
   */
  async updateStoryContent(storyId, content) {
    const storyPath = path.join(this.storiesDir, storyId);
    const contentPath = path.join(storyPath, 'content.txt');
    const metadataPath = path.join(storyPath, 'metadata.json');

    if (!await this.exists(metadataPath)) {
      throw new Error(`Story not found: ${storyId}`);
    }

    // Write content
    await fs.writeFile(contentPath, content, 'utf8');

    // Update modified timestamp
    const metadata = await this.readJSON(metadataPath);
    metadata.modified = new Date().toISOString();
    await this.writeJSON(metadataPath, metadata);

    return { success: true, modified: metadata.modified };
  }

  /**
   * Delete story
   */
  async deleteStory(storyId) {
    const storyPath = path.join(this.storiesDir, storyId);

    if (!await this.exists(storyPath)) {
      throw new Error(`Story not found: ${storyId}`);
    }

    await fs.rm(storyPath, { recursive: true, force: true });
    return { success: true };
  }

  // ==================== Character Operations (Global Library) ====================

  /**
   * Get character data file path
   */
  getCharacterDataPath(characterId) {
    return path.join(this.charactersDir, `${characterId}.json`);
  }

  /**
   * Get character image file path
   */
  getCharacterImagePath(characterId) {
    return path.join(this.charactersDir, `${characterId}-image.png`);
  }

  /**
   * List all characters in global library
   */
  async listAllCharacters() {
    if (!await this.exists(this.charactersDir)) {
      return [];
    }

    const files = await fs.readdir(this.charactersDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    return jsonFiles.map(filename => ({
      id: path.parse(filename).name
    }));
  }

  /**
   * List characters for a specific story
   */
  async listStoryCharacters(storyId) {
    const metadataPath = path.join(this.storiesDir, storyId, 'metadata.json');

    if (!await this.exists(metadataPath)) {
      return [];
    }

    const metadata = await this.readJSON(metadataPath);
    const characterIds = metadata.characterIds || [];

    // Return character IDs that exist in global library
    const characters = [];
    for (const charId of characterIds) {
      const charPath = this.getCharacterDataPath(charId);
      if (await this.exists(charPath)) {
        characters.push({ id: charId });
      }
    }

    return characters;
  }

  /**
   * Save character data to global library
   */
  async saveCharacter(characterId, characterData, imageBuffer = null) {
    const dataPath = this.getCharacterDataPath(characterId);
    await this.writeJSON(dataPath, characterData);

    // Save image if provided
    if (imageBuffer) {
      const imagePath = this.getCharacterImagePath(characterId);
      await fs.writeFile(imagePath, imageBuffer);
    }

    return { id: characterId };
  }

  /**
   * Get character data from global library
   */
  async getCharacter(characterId) {
    const dataPath = this.getCharacterDataPath(characterId);

    if (!await this.exists(dataPath)) {
      throw new Error(`Character not found: ${characterId}`);
    }

    return await this.readJSON(dataPath);
  }

  /**
   * Get character image buffer (if exists)
   */
  async getCharacterImage(characterId) {
    const imagePath = this.getCharacterImagePath(characterId);

    if (!await this.exists(imagePath)) {
      return null;
    }

    return await fs.readFile(imagePath);
  }

  /**
   * Check if character has image
   */
  async hasCharacterImage(characterId) {
    const imagePath = this.getCharacterImagePath(characterId);
    return await this.exists(imagePath);
  }

  /**
   * Delete character from global library
   */
  async deleteCharacter(characterId) {
    const dataPath = this.getCharacterDataPath(characterId);
    const imagePath = this.getCharacterImagePath(characterId);

    // Delete data file
    if (await this.exists(dataPath)) {
      await fs.unlink(dataPath);
    }

    // Delete image if exists
    if (await this.exists(imagePath)) {
      await fs.unlink(imagePath);
    }

    // Note: This doesn't remove from stories - caller should check if in use
    return { success: true };
  }

  /**
   * Add character to story (create reference)
   */
  async addCharacterToStory(storyId, characterId) {
    const metadataPath = path.join(this.storiesDir, storyId, 'metadata.json');

    if (!await this.exists(metadataPath)) {
      throw new Error(`Story not found: ${storyId}`);
    }

    // Verify character exists in global library
    const characterPath = this.getCharacterDataPath(characterId);
    if (!await this.exists(characterPath)) {
      throw new Error(`Character not found: ${characterId}`);
    }

    // Add to story's character list
    const metadata = await this.readJSON(metadataPath);
    if (!metadata.characterIds.includes(characterId)) {
      metadata.characterIds.push(characterId);
      metadata.modified = new Date().toISOString();
      await this.writeJSON(metadataPath, metadata);
    }

    return { success: true };
  }

  /**
   * Remove character from story (remove reference, don't delete)
   */
  async removeCharacterFromStory(storyId, characterId) {
    const metadataPath = path.join(this.storiesDir, storyId, 'metadata.json');

    if (!await this.exists(metadataPath)) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const metadata = await this.readJSON(metadataPath);
    metadata.characterIds = metadata.characterIds.filter(id => id !== characterId);

    // If this character was the persona, clear that too
    if (metadata.personaCharacterId === characterId) {
      metadata.personaCharacterId = null;
    }

    metadata.modified = new Date().toISOString();
    await this.writeJSON(metadataPath, metadata);

    return { success: true };
  }

  /**
   * Set character as persona for story
   */
  async setStoryPersona(storyId, characterId) {
    const metadataPath = path.join(this.storiesDir, storyId, 'metadata.json');

    if (!await this.exists(metadataPath)) {
      throw new Error(`Story not found: ${storyId}`);
    }

    // Verify character exists (can be null to unset)
    if (characterId) {
      const characterPath = this.getCharacterDataPath(characterId);
      if (!await this.exists(characterPath)) {
        throw new Error(`Character not found: ${characterId}`);
      }
    }

    const metadata = await this.readJSON(metadataPath);
    metadata.personaCharacterId = characterId;
    metadata.modified = new Date().toISOString();
    await this.writeJSON(metadataPath, metadata);

    return { success: true };
  }

  // ==================== Lorebook Operations (Global Library) ====================

  /**
   * Get lorebook file path
   */
  getLorebookPath(lorebookId) {
    return path.join(this.lorebooksDir, `${lorebookId}.json`);
  }

  /**
   * List all lorebooks in global library
   */
  async listAllLorebooks() {
    if (!await this.exists(this.lorebooksDir)) {
      return [];
    }

    const files = await fs.readdir(this.lorebooksDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const lorebooks = [];
    for (const filename of jsonFiles) {
      const lorebookId = path.parse(filename).name;
      const lorebookPath = this.getLorebookPath(lorebookId);

      try {
        const data = await this.readJSON(lorebookPath);
        lorebooks.push({
          id: lorebookId,
          name: data.name || 'Untitled',
          description: data.description || '',
          entryCount: data.entries ? data.entries.length : 0
        });
      } catch (error) {
        console.error(`Failed to read lorebook ${lorebookId}:`, error);
      }
    }

    return lorebooks;
  }

  /**
   * List lorebooks for a specific story
   */
  async listStoryLorebooks(storyId) {
    const metadataPath = path.join(this.storiesDir, storyId, 'metadata.json');

    if (!await this.exists(metadataPath)) {
      return [];
    }

    const metadata = await this.readJSON(metadataPath);
    const lorebookIds = metadata.lorebookIds || [];

    // Return lorebooks that exist in global library
    const lorebooks = [];
    for (const lorebookId of lorebookIds) {
      const lorebookPath = this.getLorebookPath(lorebookId);
      if (await this.exists(lorebookPath)) {
        try {
          const data = await this.readJSON(lorebookPath);
          lorebooks.push({
            id: lorebookId,
            name: data.name || 'Untitled',
            description: data.description || '',
            entryCount: data.entries ? data.entries.length : 0
          });
        } catch (error) {
          console.error(`Failed to read lorebook ${lorebookId}:`, error);
        }
      }
    }

    return lorebooks;
  }

  /**
   * Save lorebook data to global library
   */
  async saveLorebook(lorebookId, lorebookData) {
    const lorebookPath = this.getLorebookPath(lorebookId);
    await this.writeJSON(lorebookPath, lorebookData);
    return { id: lorebookId };
  }

  /**
   * Get lorebook data from global library
   */
  async getLorebook(lorebookId) {
    const lorebookPath = this.getLorebookPath(lorebookId);

    if (!await this.exists(lorebookPath)) {
      throw new Error(`Lorebook not found: ${lorebookId}`);
    }

    return await this.readJSON(lorebookPath);
  }

  /**
   * Delete lorebook from global library
   */
  async deleteLorebook(lorebookId) {
    const lorebookPath = this.getLorebookPath(lorebookId);

    if (await this.exists(lorebookPath)) {
      await fs.unlink(lorebookPath);
    }

    // Note: This doesn't remove from stories - caller should check if in use
    return { success: true };
  }

  /**
   * Add lorebook to story (create reference)
   */
  async addLorebookToStory(storyId, lorebookId) {
    const metadataPath = path.join(this.storiesDir, storyId, 'metadata.json');

    if (!await this.exists(metadataPath)) {
      throw new Error(`Story not found: ${storyId}`);
    }

    // Verify lorebook exists in global library
    const lorebookPath = this.getLorebookPath(lorebookId);
    if (!await this.exists(lorebookPath)) {
      throw new Error(`Lorebook not found: ${lorebookId}`);
    }

    // Add to story's lorebook list
    const metadata = await this.readJSON(metadataPath);

    // Initialize lorebookIds if it doesn't exist (for backwards compatibility)
    if (!metadata.lorebookIds) {
      metadata.lorebookIds = [];
    }

    if (!metadata.lorebookIds.includes(lorebookId)) {
      metadata.lorebookIds.push(lorebookId);
      metadata.modified = new Date().toISOString();
      await this.writeJSON(metadataPath, metadata);
    }

    return { success: true };
  }

  /**
   * Remove lorebook from story (remove reference, don't delete)
   */
  async removeLorebookFromStory(storyId, lorebookId) {
    const metadataPath = path.join(this.storiesDir, storyId, 'metadata.json');

    if (!await this.exists(metadataPath)) {
      throw new Error(`Story not found: ${storyId}`);
    }

    const metadata = await this.readJSON(metadataPath);

    if (metadata.lorebookIds) {
      metadata.lorebookIds = metadata.lorebookIds.filter(id => id !== lorebookId);
      metadata.modified = new Date().toISOString();
      await this.writeJSON(metadataPath, metadata);
    }

    return { success: true };
  }

  // ==================== Settings Operations ====================

  /**
   * Get settings
   */
  async getSettings() {
    if (!await this.exists(this.settingsFile)) {
      return null;
    }

    return await this.readJSON(this.settingsFile);
  }

  /**
   * Save settings
   */
  async saveSettings(settings) {
    await this.writeJSON(this.settingsFile, settings);
    return settings;
  }
}
