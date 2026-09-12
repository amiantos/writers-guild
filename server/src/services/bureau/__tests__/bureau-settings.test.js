import { describe, it, expect } from 'vitest';
import {
  BureauSettingsError,
  DEFAULT_SETTINGS,
  applySettingsUpdate,
  resolveSettings,
} from '../bureau-settings.js';

describe('resolveSettings', () => {
  it('fills in defaults for anything not stored', () => {
    expect(resolveSettings({})).toEqual({ writer: { ...DEFAULT_SETTINGS.writer } });
    expect(resolveSettings({ writer: { thinking: true } }).writer).toEqual({
      ...DEFAULT_SETTINGS.writer,
      thinking: true,
    });
  });
});

describe('applySettingsUpdate', () => {
  it('merges a partial update into what is stored', () => {
    const stored = { writer: { temperature: 1.3 } };

    expect(applySettingsUpdate(stored, { writer: { thinking: true } })).toEqual({
      writer: { temperature: 1.3, thinking: true },
    });
    expect(stored).toEqual({ writer: { temperature: 1.3 } });
  });

  it('stores only what was changed, so defaults stay defaults', () => {
    expect(applySettingsUpdate({}, { writer: { maxTokens: 6000 } })).toEqual({
      writer: { maxTokens: 6000 },
    });
  });

  it.each([
    [{ writer: { thinking: 'yes' } }, /writer.thinking must be true or false/],
    [{ writer: { reasoningEffort: 'medium' } }, /writer.reasoningEffort must be one of/],
    [{ writer: { temperature: 2.5 } }, /writer.temperature must be a number from 0 to 2/],
    [{ writer: { maxTokens: 100 } }, /writer.maxTokens must be a whole number/],
    [{ writer: { maxTokens: 4000.5 } }, /writer.maxTokens must be a whole number/],
    [{ writer: { mood: 'sunny' } }, /Unknown writer setting: mood/],
    [{ director: {} }, /Unknown settings group: director/],
    [{ writer: [] }, /settings.writer must be an object/],
    [null, /settings must be an object/],
  ])('rejects %j', (update, message) => {
    expect(() => applySettingsUpdate({}, update)).toThrow(BureauSettingsError);
    expect(() => applySettingsUpdate({}, update)).toThrow(message);
  });
});
