/**
 * Migration Service
 * Handles automatic migration from old settings format to new preset system
 */

import { v4 as uuidv4 } from 'uuid';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SqliteStorageService } from './sqliteStorage.js';
import { runSqliteMigration } from './dataMigration.js';
import { getDefaultPresets, createPresetFromSettings } from './default-presets.js';
import { CharacterParser } from './character-parser.js';
import { LorebookParser } from './lorebook-parser.js';
import { PromptBuilder } from './prompt-builder.js';
import { MacroProcessor } from './macro-processor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '../../..');

/**
 * Import default character from project root
 * @param {StorageService} storage - Storage service instance
 * @returns {Promise<Object|null>} Character info or null if failed
 */
async function importDefaultCharacter(storage) {
  try {
    const defaultCharacterPath = join(PROJECT_ROOT, 'default_Seraphina.png');

    // Read the character PNG file
    const fileBuffer = await readFile(defaultCharacterPath);

    // Parse character card from PNG
    const cardData = await CharacterParser.parseCard(fileBuffer);
    const characterId = uuidv4();

    // Check for embedded lorebook
    let embeddedLorebook = null;
    let lorebookId = null;
    if (cardData.data?.character_book && cardData.data.character_book.entries && cardData.data.character_book.entries.length > 0) {
      try {
        // Parse embedded lorebook
        const lorebookData = LorebookParser.parseEmbeddedLorebook(cardData.data.character_book);

        // Give it a name based on the character
        lorebookData.name = `${cardData.data.name}'s Lorebook`;
        lorebookData.description = lorebookData.description || `Lorebook for ${cardData.data.name}`;

        // Save to global lorebook library
        lorebookId = uuidv4();
        await storage.saveLorebook(lorebookId, lorebookData);

        embeddedLorebook = {
          id: lorebookId,
          name: lorebookData.name,
          entryCount: lorebookData.entries.length
        };

        console.log(`✓ Extracted embedded lorebook from ${cardData.data.name}: ${lorebookData.entries.length} entries`);
      } catch (error) {
        console.error('Failed to parse embedded lorebook:', error);
      }
    }

    // Add lorebook association to character data
    if (!cardData.data.extensions) {
      cardData.data.extensions = {};
    }
    cardData.data.extensions.ursceal_lorebook_id = lorebookId;

    // Save character data and image
    await storage.saveCharacter(characterId, cardData, fileBuffer);

    console.log(`✓ Imported default character: ${cardData.data.name}`);

    return {
      id: characterId,
      name: cardData.data?.name || 'Unknown',
      embeddedLorebook: embeddedLorebook
    };
  } catch (error) {
    console.error('Failed to import default character:', error.message);
    return null;
  }
}

/**
 * Create a default story with the imported character
 * @param {StorageService} storage - Storage service instance
 * @param {Object} character - Imported character info
 * @returns {Promise<Object|null>} Story info or null if failed
 */
async function createDefaultStory(storage, character) {
  if (!character || !character.id) {
    return null;
  }

  try {
    const story = await storage.createStory(
      `A Story with ${character.name}`,
      `An adventure featuring ${character.name}`
    );

    // Add character to story
    await storage.addCharacterToStory(story.id, character.id);

    // Add lorebook if character has one
    if (character.embeddedLorebook && character.embeddedLorebook.id) {
      await storage.addLorebookToStory(story.id, character.embeddedLorebook.id);
      console.log(`✓ Associated lorebook with story: ${character.embeddedLorebook.name}`);
    }

    // Insert character's first message into story content
    try {
      const characterCard = await storage.getCharacter(character.id);
      if (characterCard.data?.first_mes) {
        const promptBuilder = new PromptBuilder();
        const macroProcessor = new MacroProcessor({
          userName: 'User',
          charName: characterCard.data?.name || 'Character'
        });

        let processed = characterCard.data.first_mes;
        processed = promptBuilder.replacePlaceholders(processed, characterCard, null);
        processed = macroProcessor.process(processed);

        await storage.updateStoryContent(story.id, processed);
        console.log(`✓ Added character's first message to story content`);
      }
    } catch (error) {
      console.error('Failed to process first message:', error.message);
      // Don't fail story creation if this fails
    }

    console.log(`✓ Created default story: ${story.title}`);

    return {
      id: story.id,
      title: story.title
    };
  } catch (error) {
    console.error('Failed to create default story:', error.message);
    return null;
  }
}

/**
 * Check if migration is needed
 * @param {StorageService} storage - Storage service instance
 * @returns {Promise<boolean>} True if migration needed
 */
async function needsMigration(storage) {
  try {
    // Check if presets exist
    const presets = await storage.listPresets();

    // If we have presets, migration already done
    if (presets && presets.length > 0) {
      console.log('Presets found, migration not needed');
      return false;
    }

    // Check if settings file has old API key (indicating user was using the app before)
    const settings = await storage.getSettings();
    if (settings && settings.apiKey) {
      console.log('Old settings with API key found, migration needed');
      return true;
    }

    // Fresh install - create default presets anyway
    console.log('Fresh install detected, will create default presets');
    return true;
  } catch (error) {
    console.error('Error checking migration status:', error);
    return false;
  }
}

/**
 * Generate thumbnails for all existing character images that don't have them
 * @param {StorageService} storage - Storage service instance
 * @returns {Promise<number>} Number of thumbnails generated
 */
async function generateMissingThumbnails(storage) {
  try {
    console.log('Checking for missing character thumbnails...');
    const characters = await storage.listAllCharacters();
    let generated = 0;

    for (const char of characters) {
      const hasImage = await storage.hasCharacterImage(char.id);
      const hasThumbnail = await storage.hasCharacterThumbnail(char.id);

      // If character has an image but no thumbnail, generate it
      if (hasImage && !hasThumbnail) {
        try {
          const imageBuffer = await storage.getCharacterImage(char.id);
          const thumbnailBuffer = await storage.generateThumbnail(imageBuffer);

          if (thumbnailBuffer) {
            const thumbnailPath = storage.getCharacterThumbnailPath(char.id);
            const fs = await import('fs/promises');
            await fs.writeFile(thumbnailPath, thumbnailBuffer);
            generated++;
            console.log(`✓ Generated thumbnail for character: ${char.id}`);
          }
        } catch (error) {
          console.error(`Failed to generate thumbnail for ${char.id}:`, error.message);
        }
      }
    }

    if (generated > 0) {
      console.log(`✓ Generated ${generated} missing thumbnails`);
    } else {
      console.log('All character thumbnails are up to date');
    }

    return generated;
  } catch (error) {
    console.error('Failed to generate missing thumbnails:', error);
    return 0;
  }
}

/**
 * Perform migration from old settings to preset system
 * @param {StorageService} storage - Storage service instance
 * @returns {Promise<Object>} Migration result
 */
export async function migrate(storage) {
  console.log('=== Starting Configuration Migration ===');

  try {
    // Ensure storage directories exist before migration
    await storage.initializeStorage();

    const shouldMigrate = await needsMigration(storage);

    if (!shouldMigrate) {
      return {
        success: true,
        migrated: false,
        message: 'Migration not needed'
      };
    }

    // Load existing settings
    const settings = await storage.getSettings();
    const hasExistingConfig = settings && settings.apiKey;

    // Get default preset templates
    const defaults = getDefaultPresets();
    const createdPresets = [];
    let defaultPresetId = null;

    // Create DeepSeek preset from existing settings (if user had configured it)
    if (hasExistingConfig) {
      console.log('Creating DeepSeek preset from existing settings...');
      const deepseekPresetId = uuidv4();
      const deepseekPreset = createPresetFromSettings(settings);

      await storage.savePreset(deepseekPresetId, {
        ...deepseekPreset,
        id: deepseekPresetId
      });

      createdPresets.push({
        id: deepseekPresetId,
        name: deepseekPreset.name,
        provider: deepseekPreset.provider
      });

      // Set this as default since user was already using it
      defaultPresetId = deepseekPresetId;
      await storage.setDefaultPresetId(deepseekPresetId);
      console.log(`✓ Created and set default: ${deepseekPreset.name}`);
    }

    // Create other default presets (with blank API keys)
    for (const [key, presetData] of Object.entries(defaults)) {
      // Skip DeepSeek if we already created it from settings
      if (key === 'deepseek' && hasExistingConfig) {
        continue;
      }

      const presetId = uuidv4();
      await storage.savePreset(presetId, {
        ...presetData,
        id: presetId
      });

      createdPresets.push({
        id: presetId,
        name: presetData.name,
        provider: presetData.provider
      });

      // If no default set yet and this is aihorde, set it as default (free option)
      if (!defaultPresetId && key === 'aihorde') {
        defaultPresetId = presetId;
        await storage.setDefaultPresetId(presetId);
      }

      console.log(`✓ Created preset: ${presetData.name}`);
    }

    // If still no default (shouldn't happen), set the first one
    if (!defaultPresetId && createdPresets.length > 0) {
      defaultPresetId = createdPresets[0].id;
      await storage.setDefaultPresetId(defaultPresetId);
    }

    // Import default character on fresh install
    let importedCharacter = null;
    let defaultStory = null;
    if (!hasExistingConfig) {
      console.log('Importing default character...');
      importedCharacter = await importDefaultCharacter(storage);

      // Create default story with the imported character
      if (importedCharacter) {
        console.log('Creating default story...');
        defaultStory = await createDefaultStory(storage, importedCharacter);
      }
    }

    // Generate thumbnails for any existing characters that don't have them
    const thumbnailsGenerated = await generateMissingThumbnails(storage);

    console.log('=== Migration Complete ===');
    console.log(`Created ${createdPresets.length} presets`);
    console.log(`Default preset ID: ${defaultPresetId}`);

    return {
      success: true,
      migrated: true,
      presetsCreated: createdPresets.length,
      defaultPresetId,
      presets: createdPresets,
      importedCharacter,
      defaultStory,
      thumbnailsGenerated,
      message: hasExistingConfig
        ? 'Migrated existing configuration to preset system'
        : 'Created default presets for fresh installation'
    };
  } catch (error) {
    console.error('Migration failed:', error);
    return {
      success: false,
      migrated: false,
      error: error.message,
      message: 'Migration failed'
    };
  }
}

/**
 * Run migration automatically on server start
 * @param {string} dataRoot - Data directory path
 * @returns {Promise<Object>} Migration result
 */
export async function runMigration(dataRoot) {
  // First, run SQLite migration if needed (migrates file data to database)
  try {
    const sqliteMigrationResult = await runSqliteMigration(dataRoot);
    if (sqliteMigrationResult.migrated) {
      console.log(`✓ ${sqliteMigrationResult.message}`);
      if (sqliteMigrationResult.backupDir) {
        console.log(`  Backup created at: ${sqliteMigrationResult.backupDir}`);
      }
    }
  } catch (error) {
    console.error('SQLite migration error:', error);
    // Continue with preset migration even if SQLite migration fails
  }

  // Now use SQLite storage for preset migration
  const storage = new SqliteStorageService(dataRoot);
  const migrationResult = await migrate(storage);

  return migrationResult;
}
