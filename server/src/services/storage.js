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
    this.personasDir = path.join(dataRoot, 'personas');
    this.settingsFile = path.join(dataRoot, 'settings.json');

    this.initializeStorage();
  }

  /**
   * Initialize storage directories
   */
  async initializeStorage() {
    try {
      await fs.mkdir(this.storiesDir, { recursive: true });
      await fs.mkdir(this.personasDir, { recursive: true });

      // Create default settings if not exists
      if (!fsSync.existsSync(this.settingsFile)) {
        await this.writeJSON(this.settingsFile, {
          apiKey: '',
          maxTokens: 4000,
          showReasoning: false,
          autoSave: true,
          showPrompt: false,
          thirdPerson: true,
          filterAsterisks: true
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

    // Create story directory structure
    await fs.mkdir(storyPath, { recursive: true });
    await fs.mkdir(path.join(storyPath, 'characters'), { recursive: true });

    // Create metadata
    const metadata = {
      id: storyId,
      title,
      description,
      created: now,
      modified: now,
      characterIds: []
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

  // ==================== Character Operations ====================

  /**
   * List characters for a story
   */
  async listStoryCharacters(storyId) {
    const charactersDir = path.join(this.storiesDir, storyId, 'characters');

    if (!await this.exists(charactersDir)) {
      return [];
    }

    const files = await fs.readdir(charactersDir);
    const pngFiles = files.filter(f => f.endsWith('.png'));

    return pngFiles.map(filename => ({
      id: path.parse(filename).name,
      filename,
      storyId
    }));
  }

  /**
   * Get character file path
   */
  getCharacterPath(storyId, characterId) {
    return path.join(this.storiesDir, storyId, 'characters', `${characterId}.png`);
  }

  /**
   * Save character PNG
   */
  async saveCharacter(storyId, characterId, pngBuffer) {
    const storyPath = path.join(this.storiesDir, storyId);
    const metadataPath = path.join(storyPath, 'metadata.json');

    if (!await this.exists(metadataPath)) {
      throw new Error(`Story not found: ${storyId}`);
    }

    // Save PNG file
    const characterPath = this.getCharacterPath(storyId, characterId);
    await fs.writeFile(characterPath, pngBuffer);

    // Add character ID to story metadata if not already present
    const metadata = await this.readJSON(metadataPath);
    if (!metadata.characterIds.includes(characterId)) {
      metadata.characterIds.push(characterId);
      metadata.modified = new Date().toISOString();
      await this.writeJSON(metadataPath, metadata);
    }

    return { id: characterId, storyId };
  }

  /**
   * Get character PNG buffer
   */
  async getCharacter(storyId, characterId) {
    const characterPath = this.getCharacterPath(storyId, characterId);

    if (!await this.exists(characterPath)) {
      throw new Error(`Character not found: ${characterId}`);
    }

    return await fs.readFile(characterPath);
  }

  /**
   * Delete character
   */
  async deleteCharacter(storyId, characterId) {
    const characterPath = this.getCharacterPath(storyId, characterId);
    const metadataPath = path.join(this.storiesDir, storyId, 'metadata.json');

    if (await this.exists(characterPath)) {
      await fs.unlink(characterPath);
    }

    // Remove from story metadata
    if (await this.exists(metadataPath)) {
      const metadata = await this.readJSON(metadataPath);
      metadata.characterIds = metadata.characterIds.filter(id => id !== characterId);
      metadata.modified = new Date().toISOString();
      await this.writeJSON(metadataPath, metadata);
    }

    return { success: true };
  }

  // ==================== Persona Operations ====================

  /**
   * Get current persona
   */
  async getPersona() {
    const personaPath = path.join(this.personasDir, 'default.json');

    if (!await this.exists(personaPath)) {
      return null;
    }

    return await this.readJSON(personaPath);
  }

  /**
   * Save persona
   */
  async savePersona(persona) {
    const personaPath = path.join(this.personasDir, 'default.json');
    await this.writeJSON(personaPath, persona);
    return persona;
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
