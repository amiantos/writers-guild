/**
 * Bureau Settings
 *
 * Per-Bureau generation settings, stored as JSON on the Bureau. Stored values
 * are merged over the defaults when read, so adding a setting never needs a
 * migration.
 */

import { REASONING_EFFORTS } from './deepseek-client.js';

export const DEFAULT_SETTINGS = Object.freeze({
  // The DeepSeek preset story mode is written with in practice: the prompts are story mode's, so the
  // settings match too. (The DeepSeek preset story mode creates starts at 1.0 and 4000 tokens.)
  writer: Object.freeze({
    thinking: false,
    reasoningEffort: 'high',
    temperature: 0.5,
    maxTokens: 8000,
  }),
  memory: Object.freeze({
    // Archive settled turns after each generated turn, not only on demand and at the end.
    autoArchive: true,
    // Characters of knowledge per character in the Writer prompt; the rest waits for recall.
    knowledgeCharacters: 4000,
    // Summaries of earlier chapters in prompts: the Writer's, and for one character, the ones they
    // were in.
    recentChapters: 5,
    // When Bureau time jumps forward, give the characters involved an account of the gap.
    offscreenLife: true,
  }),
  correspondence: Object.freeze({
    // How messages read. Empty uses the default: short first-person texts.
    style: '',
    thinking: false,
    reasoningEffort: 'low',
    // For the reply itself; thinking mode gets more room for reasoning on top.
    maxTokens: 1000,
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

const MEMORY_RULES = {
  autoArchive: (value) => typeof value === 'boolean' || 'must be true or false',
  offscreenLife: (value) => typeof value === 'boolean' || 'must be true or false',
  knowledgeCharacters: (value) =>
    (Number.isInteger(value) && value >= 0 && value <= 40000) ||
    'must be a whole number from 0 to 40000',
  recentChapters: (value) =>
    (Number.isInteger(value) && value >= 0 && value <= 20) || 'must be a whole number from 0 to 20',
};

const isBoolean = (value) => typeof value === 'boolean' || 'must be true or false';

const CORRESPONDENCE_RULES = {
  style: (value) =>
    (typeof value === 'string' && value.length <= 4000) || 'must be text of up to 4000 characters',
  thinking: isBoolean,
  reasoningEffort: WRITER_RULES.reasoningEffort,
  maxTokens: (value) =>
    (Number.isInteger(value) && value >= 100 && value <= 8000) ||
    'must be a whole number from 100 to 8000',
};

const RULES = {
  writer: WRITER_RULES,
  memory: MEMORY_RULES,
  correspondence: CORRESPONDENCE_RULES,
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Stored settings merged over the defaults. Stored settings that are no longer settings are left
 * out, so saving the settings back doesn't send them.
 * @param {Object} [stored]
 * @returns {{ writer: Object, memory: Object, correspondence: Object }}
 */
export function resolveSettings(stored = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_SETTINGS).map(([group, defaults]) => [
      group,
      Object.fromEntries(
        Object.entries(defaults).map(([key, value]) => [key, stored[group]?.[key] ?? value]),
      ),
    ]),
  );
}

/**
 * Apply a partial update to stored settings.
 *
 * @param {Object} stored - The Bureau's stored settings (not the resolved ones,
 *   so defaults stay defaults).
 * @param {Object} update - For example { writer: { thinking: true } } or
 *   { memory: { autoArchive: false } }.
 * @returns {Object} The settings to store.
 * @throws {BureauSettingsError} For unknown groups or keys, or invalid values.
 */
export function applySettingsUpdate(stored, update) {
  if (!isPlainObject(update)) {
    throw new BureauSettingsError('settings must be an object');
  }

  const next = { ...stored };
  for (const [group, values] of Object.entries(update)) {
    const rules = RULES[group];
    if (!rules) {
      throw new BureauSettingsError(`Unknown settings group: ${group}`);
    }
    if (!isPlainObject(values)) {
      throw new BureauSettingsError(`settings.${group} must be an object`);
    }

    const merged = { ...stored[group] };
    for (const [key, value] of Object.entries(values)) {
      const rule = rules[key];
      if (!rule) {
        throw new BureauSettingsError(`Unknown ${group} setting: ${key}`);
      }
      const verdict = rule(value);
      if (verdict !== true) {
        throw new BureauSettingsError(`${group}.${key} ${verdict}`);
      }
      merged[key] = value;
    }
    next[group] = merged;
  }
  return next;
}
