import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatDateTime,
  formatDuration,
  formatUsage,
  fromDatetimeLocal,
  rememberChoice,
  rememberedChoice,
  toDatetimeLocal,
} from '../format.js';

describe('formatDateTime', () => {
  it('formats in the given time zone', () => {
    const text = formatDateTime('2026-10-27T07:30:00Z', 'America/Los_Angeles');

    expect(text).toContain('Oct');
    expect(text).toContain('27');
    expect(text).toContain('12:30');
  });

  it('falls back to local time for an unknown time zone, and is empty for bad input', () => {
    expect(formatDateTime('2026-10-27T07:30:00Z', 'Atlantis/Central')).toContain('2026');
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('not a date')).toBe('');
  });
});

describe('datetime-local conversion', () => {
  it('round-trips through the browser time zone', () => {
    const iso = '2026-06-03T21:15:00.000Z';

    expect(fromDatetimeLocal(toDatetimeLocal(iso))).toBe(iso);
  });

  it('handles empty and invalid values', () => {
    expect(toDatetimeLocal('')).toBe('');
    expect(fromDatetimeLocal('')).toBeNull();
    expect(fromDatetimeLocal('soon')).toBeNull();
  });

  it('keeps years below 1000 and in the 1300s as they are', () => {
    const ancient = new Date(2026, 0, 1, 9, 5);
    ancient.setFullYear(50);

    expect(toDatetimeLocal(new Date(1350, 5, 1, 20, 0))).toBe('1350-06-01T20:00');
    expect(toDatetimeLocal(ancient)).toBe('0050-01-01T09:05');
    expect(fromDatetimeLocal('0050-01-01T09:05')).toBe(ancient.toISOString());
    expect(new Date(fromDatetimeLocal('1350-06-01T20:00')).getFullYear()).toBe(1350);
  });

  it('turns down years outside 1 to 9999', () => {
    expect(fromDatetimeLocal('0000-06-01T12:00')).toBeNull();
    expect(fromDatetimeLocal('10000-06-01T12:00')).toBeNull();
    expect(fromDatetimeLocal('9999-06-01T12:00')).not.toBeNull();
  });
});

describe('formatDuration', () => {
  it('uses milliseconds under a second and seconds above', () => {
    expect(formatDuration(850)).toBe('850ms');
    expect(formatDuration(2430)).toBe('2.4s');
    expect(formatDuration(null)).toBe('');
  });
});

describe('formatUsage', () => {
  it('shows input, cached, and output tokens', () => {
    expect(
      formatUsage({ prompt_tokens: 1204, prompt_cache_hit_tokens: 512, completion_tokens: 310 }),
    ).toBe('1,204 in (512 cached) · 310 out');
    expect(formatUsage({ prompt_tokens: 40, completion_tokens: 8 })).toBe('40 in · 8 out');
    expect(formatUsage(null)).toBe('');
  });
});

describe('remembered choices', () => {
  beforeEach(() => {
    // Node's own localStorage global needs a backing file; use an in-memory one.
    const items = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => (items.has(key) ? items.get(key) : null),
      setItem: (key, value) => items.set(key, String(value)),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a remembered choice only when it is allowed', () => {
    expect(rememberedChoice('choice', ['bureau', 'custom'], 'bureau')).toBe('bureau');

    rememberChoice('choice', 'custom');
    expect(rememberedChoice('choice', ['bureau', 'custom'], 'bureau')).toBe('custom');

    rememberChoice('choice', 'retired-option');
    expect(rememberedChoice('choice', ['bureau', 'custom'], 'bureau')).toBe('bureau');
  });

  it('falls back when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('storage disabled');
      },
      setItem: () => {
        throw new Error('storage disabled');
      },
    });

    expect(() => rememberChoice('choice', 'custom')).not.toThrow();
    expect(rememberedChoice('choice', ['bureau', 'custom'], 'bureau')).toBe('bureau');
  });
});
