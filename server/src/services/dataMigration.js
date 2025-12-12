/**
 * Data Migration Service
 * Migrates existing file-based data to SQLite database
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { SqliteStorageService } from './sqliteStorage.js';

/**
 * Check if migration from files to SQLite is needed
 */
export async function needsMigration(dataRoot) {
  const dbPath = path.join(dataRoot, 'writers-guild.db');
  const storiesDir = path.join(dataRoot, 'stories');
  const settingsFile = path.join(dataRoot, 'settings.json');

  // If database already exists, no migration needed
  if (fsSync.existsSync(dbPath)) {
    return false;
  }

  // If there's no file-based data, no migration needed
  const hasStories = fsSync.existsSync(storiesDir);
  const hasSettings = fsSync.existsSync(settingsFile);

  return hasStories || hasSettings;
}

/**
 * Migrate all data from file storage to SQLite
 */
export async function migrateToSqlite(dataRoot) {
  console.log('Starting migration from file storage to SQLite...');

  const storiesDir = path.join(dataRoot, 'stories');
  const charactersDir = path.join(dataRoot, 'characters');
  const lorebooksDir = path.join(dataRoot, 'lorebooks');
  const presetsDir = path.join(dataRoot, 'presets');
  const settingsFile = path.join(dataRoot, 'settings.json');

  // Initialize SQLite storage (this creates the database and schema)
  const sqliteStorage = new SqliteStorageService(dataRoot);

  const stats = {
    settings: false,
    stories: 0,
    characters: 0,
    lorebooks: 0,
    presets: 0,
    storyCharacterLinks: 0,
    storyLorebookLinks: 0
  };

  try {
    // 1. Migrate settings
    if (fsSync.existsSync(settingsFile)) {
      console.log('Migrating settings...');
      const settingsData = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
      await sqliteStorage.saveSettings(settingsData);
      stats.settings = true;
      console.log('  Settings migrated');
    }

    // 2. Migrate presets
    if (fsSync.existsSync(presetsDir)) {
      console.log('Migrating presets...');
      const presetFiles = await fs.readdir(presetsDir);
      for (const file of presetFiles) {
        if (file.endsWith('.json')) {
          const presetId = path.parse(file).name;
          const presetPath = path.join(presetsDir, file);
          const presetData = JSON.parse(await fs.readFile(presetPath, 'utf8'));
          await sqliteStorage.savePreset(presetId, presetData);
          stats.presets++;
          console.log(`  Preset: ${presetData.name || presetId}`);
        }
      }
    }

    // 3. Migrate characters (before stories, since stories reference them)
    if (fsSync.existsSync(charactersDir)) {
      console.log('Migrating characters...');
      const characterFiles = await fs.readdir(charactersDir);
      const jsonFiles = characterFiles.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const characterId = path.parse(file).name;
        const dataPath = path.join(charactersDir, file);
        const imagePath = path.join(charactersDir, `${characterId}-image.png`);

        const characterData = JSON.parse(await fs.readFile(dataPath, 'utf8'));

        // Read image if exists
        let imageBuffer = null;
        if (fsSync.existsSync(imagePath)) {
          imageBuffer = await fs.readFile(imagePath);
        }

        await sqliteStorage.saveCharacter(characterId, characterData, imageBuffer);
        stats.characters++;
        console.log(`  Character: ${characterData.data?.name || characterId}`);
      }
    }

    // 4. Migrate lorebooks (before stories, since stories reference them)
    if (fsSync.existsSync(lorebooksDir)) {
      console.log('Migrating lorebooks...');
      const lorebookFiles = await fs.readdir(lorebooksDir);

      for (const file of lorebookFiles) {
        if (file.endsWith('.json')) {
          const lorebookId = path.parse(file).name;
          const lorebookPath = path.join(lorebooksDir, file);
          const lorebookData = JSON.parse(await fs.readFile(lorebookPath, 'utf8'));
          await sqliteStorage.saveLorebook(lorebookId, lorebookData);
          stats.lorebooks++;
          console.log(`  Lorebook: ${lorebookData.name || lorebookId}`);
        }
      }
    }

    // 5. Migrate stories with their relationships
    if (fsSync.existsSync(storiesDir)) {
      console.log('Migrating stories...');
      const storyDirs = await fs.readdir(storiesDir);

      for (const storyId of storyDirs) {
        const storyPath = path.join(storiesDir, storyId);
        const metadataPath = path.join(storyPath, 'metadata.json');
        const contentPath = path.join(storyPath, 'content.txt');

        if (!fsSync.existsSync(metadataPath)) {
          continue;
        }

        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));

        // Read content if exists
        let content = '';
        if (fsSync.existsSync(contentPath)) {
          content = await fs.readFile(contentPath, 'utf8');
        }

        // Insert story via direct database access to include all metadata
        const db = sqliteStorage.db;
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO stories (id, title, description, content, persona_character_id, config_preset_id, created, modified)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          storyId,
          metadata.title || 'Untitled',
          metadata.description || '',
          content,
          metadata.personaCharacterId || null,
          metadata.configPresetId || null,
          metadata.created || now,
          metadata.modified || now
        );

        stats.stories++;
        console.log(`  Story: ${metadata.title || storyId}`);

        // Add character relationships
        if (metadata.characterIds && metadata.characterIds.length > 0) {
          for (const characterId of metadata.characterIds) {
            try {
              // Check if character exists before linking
              const charExists = db.prepare('SELECT 1 FROM characters WHERE id = ?').get(characterId);
              if (charExists) {
                db.prepare('INSERT OR IGNORE INTO story_characters (story_id, character_id) VALUES (?, ?)').run(storyId, characterId);
                stats.storyCharacterLinks++;
              } else {
                console.log(`    Warning: Character ${characterId} not found, skipping link`);
              }
            } catch (err) {
              console.log(`    Warning: Could not link character ${characterId}: ${err.message}`);
            }
          }
        }

        // Add lorebook relationships
        if (metadata.lorebookIds && metadata.lorebookIds.length > 0) {
          for (const lorebookId of metadata.lorebookIds) {
            try {
              // Check if lorebook exists before linking
              const lorebookExists = db.prepare('SELECT 1 FROM lorebooks WHERE id = ?').get(lorebookId);
              if (lorebookExists) {
                db.prepare('INSERT OR IGNORE INTO story_lorebooks (story_id, lorebook_id) VALUES (?, ?)').run(storyId, lorebookId);
                stats.storyLorebookLinks++;
              } else {
                console.log(`    Warning: Lorebook ${lorebookId} not found, skipping link`);
              }
            } catch (err) {
              console.log(`    Warning: Could not link lorebook ${lorebookId}: ${err.message}`);
            }
          }
        }
      }
    }

    console.log('\nMigration complete!');
    console.log(`  Settings: ${stats.settings ? 'Yes' : 'No'}`);
    console.log(`  Presets: ${stats.presets}`);
    console.log(`  Characters: ${stats.characters}`);
    console.log(`  Lorebooks: ${stats.lorebooks}`);
    console.log(`  Stories: ${stats.stories}`);
    console.log(`  Story-Character links: ${stats.storyCharacterLinks}`);
    console.log(`  Story-Lorebook links: ${stats.storyLorebookLinks}`);

    // Close the connection since we're done with migration
    sqliteStorage.close();

    return {
      success: true,
      stats
    };

  } catch (error) {
    console.error('Migration failed:', error);
    sqliteStorage.close();
    throw error;
  }
}

/**
 * Backup file-based data before migration
 */
export async function backupFileData(dataRoot) {
  const backupDir = path.join(dataRoot, `backup-${Date.now()}`);
  const itemsToBackup = ['stories', 'characters', 'lorebooks', 'presets', 'settings.json'];

  console.log(`Creating backup at: ${backupDir}`);
  await fs.mkdir(backupDir, { recursive: true });

  for (const item of itemsToBackup) {
    const sourcePath = path.join(dataRoot, item);
    const destPath = path.join(backupDir, item);

    if (fsSync.existsSync(sourcePath)) {
      const stat = await fs.stat(sourcePath);
      if (stat.isDirectory()) {
        await copyDirectory(sourcePath, destPath);
      } else {
        await fs.copyFile(sourcePath, destPath);
      }
      console.log(`  Backed up: ${item}`);
    }
  }

  return backupDir;
}

/**
 * Helper function to copy a directory recursively
 */
async function copyDirectory(source, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Run the full migration process
 */
export async function runSqliteMigration(dataRoot) {
  // Check if migration is needed
  if (!await needsMigration(dataRoot)) {
    return {
      migrated: false,
      message: 'No migration needed (database already exists or no file data found)'
    };
  }

  console.log('\n========================================');
  console.log('   SQLite Migration');
  console.log('========================================\n');

  // Create backup first
  const backupDir = await backupFileData(dataRoot);
  console.log(`\nBackup created at: ${backupDir}\n`);

  // Run migration
  const result = await migrateToSqlite(dataRoot);

  return {
    migrated: true,
    message: 'Successfully migrated file data to SQLite database',
    backupDir,
    stats: result.stats
  };
}
