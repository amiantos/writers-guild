/**
 * Migration Service
 * Handles automatic migration from old settings format to new preset system
 */

import { v4 as uuidv4 } from 'uuid';
import { StorageService } from './storage.js';
import { getDefaultPresets, createPresetFromSettings } from './default-presets.js';

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
 * Perform migration from old settings to preset system
 * @param {StorageService} storage - Storage service instance
 * @returns {Promise<Object>} Migration result
 */
export async function migrate(storage) {
  console.log('=== Starting Configuration Migration ===');

  try {
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

      // If no default set yet and this is deepseek, set it as default
      if (!defaultPresetId && key === 'deepseek') {
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

    console.log('=== Migration Complete ===');
    console.log(`Created ${createdPresets.length} presets`);
    console.log(`Default preset ID: ${defaultPresetId}`);

    return {
      success: true,
      migrated: true,
      presetsCreated: createdPresets.length,
      defaultPresetId,
      presets: createdPresets,
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
  const storage = new StorageService(dataRoot);
  return await migrate(storage);
}
