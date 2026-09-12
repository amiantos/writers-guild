/**
 * Bureau Settings
 *
 * Per-Bureau generation settings, stored as JSON on the Bureau. Stored values
 * are merged over the defaults when read, so adding a setting never needs a
 * migration.
 */

import { REASONING_EFFORTS } from './deepseek-client.js';

export const DEFAULT_SETTINGS = Object.freeze({
  writer: Object.freeze({
    thinking: false,
    reasoningEffort: 'high',
    temperature: 1,
    maxTokens: 4000,
  }),
});

export class BureauSettingsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BureauSettingsError';
  }
}

// Each rule returns true, or a description of what the value must be.
const WRITER_RULES = {
  thinking: (value) => typeof value === 'boolean' || 'must be true or false',
  reasoningEffort: (value) =>
    REASONING_EFFORTS.includes(value) || `must be one of: ${REASONING_EFFORTS.join(', ')}`,
  temperature: (value) =>
    (typeof value === 'number' && value >= 0 && value <= 2) || 'must be a number from 0 to 2',
  maxTokens: (value) =>
    (Number.isInteger(value) && value >= 256 && value <= 32000) ||
    'must be a whole number from 256 to 32000',
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Stored settings merged over the defaults.
 * @param {Object} [stored]
 * @returns {{ writer: Object }}
 */
export function resolveSettings(stored = {}) {
  return { writer: { ...DEFAULT_SETTINGS.writer, ...stored.writer } };
}

/**
 * Apply a partial update to stored settings.
 *
 * @param {Object} stored - The Bureau's stored settings (not the resolved ones,
 *   so defaults stay defaults).
 * @param {Object} update - For example { writer: { thinking: true } }.
 * @returns {Object} The settings to store.
 * @throws {BureauSettingsError} For unknown groups or keys, or invalid values.
 */
export function applySettingsUpdate(stored, update) {
  if (!isPlainObject(update)) {
    throw new BureauSettingsError('settings must be an object');
  }

  const next = { ...stored };
  for (const [group, values] of Object.entries(update)) {
    if (group !== 'writer') {
      throw new BureauSettingsError(`Unknown settings group: ${group}`);
    }
    if (!isPlainObject(values)) {
      throw new BureauSettingsError('settings.writer must be an object');
    }

    const writer = { ...stored.writer };
    for (const [key, value] of Object.entries(values)) {
      const rule = WRITER_RULES[key];
      if (!rule) {
        throw new BureauSettingsError(`Unknown writer setting: ${key}`);
      }
      const verdict = rule(value);
      if (verdict !== true) {
        throw new BureauSettingsError(`writer.${key} ${verdict}`);
      }
      writer[key] = value;
    }
    next.writer = writer;
  }
  return next;
}
