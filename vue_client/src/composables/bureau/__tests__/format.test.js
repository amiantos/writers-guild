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
  const iso = '2026-06-03T21:15:00.000Z';

  it("reads and writes a time on the Bureau's clock, whatever the browser's zone", () => {
    expect(toDatetimeLocal(iso, 'America/Los_Angeles')).toBe('2026-06-03T14:15');
    expect(toDatetimeLocal(iso, 'Europe/London')).toBe('2026-06-03T22:15');
    expect(fromDatetimeLocal('2026-06-03T14:15', 'America/Los_Angeles')).toBe(iso);
    expect(fromDatetimeLocal('2026-06-03T22:15', 'Europe/London')).toBe(iso);
  });

  it('follows daylight saving on that clock', () => {
    // Daylight saving ends in Los Angeles early on November 1, 2026.
    expect(fromDatetimeLocal('2026-10-30T08:00', 'America/Los_Angeles')).toBe(
      '2026-10-30T15:00:00.000Z',
    );
    expect(fromDatetimeLocal('2026-11-02T08:00', 'America/Los_Angeles')).toBe(
      '2026-11-02T16:00:00.000Z',
    );
    expect(toDatetimeLocal('2026-11-02T16:00:00.000Z', 'America/Los_Angeles')).toBe(
      '2026-11-02T08:00',
    );
  });

  it("uses the browser's zone when the Bureau has none or one it doesn't know", () => {
    const local = toDatetimeLocal(iso);

    expect(fromDatetimeLocal(local)).toBe(iso);
    expect(toDatetimeLocal(iso, null)).toBe(local);
    expect(toDatetimeLocal(iso, 'Atlantis/Central')).toBe(local);
    expect(fromDatetimeLocal(local, 'Atlantis/Central')).toBe(iso);
  });

  it('handles empty and invalid values', () => {
    expect(toDatetimeLocal('')).toBe('');
    expect(toDatetimeLocal('soon')).toBe('');
    expect(fromDatetimeLocal('')).toBeNull();
    expect(fromDatetimeLocal('soon')).toBeNull();
    expect(fromDatetimeLocal('2026-02-30T10:00', 'UTC')).toBeNull();
  });

  it('keeps the 1300s and years below 100 as they are', () => {
    expect(fromDatetimeLocal('1350-06-01T20:00', 'UTC')).toBe('1350-06-01T20:00:00.000Z');
    expect(toDatetimeLocal('1350-06-01T20:00:00.000Z', 'UTC')).toBe('1350-06-01T20:00');
    expect(
      toDatetimeLocal(fromDatetimeLocal('1350-06-01T20:00', 'Europe/London'), 'Europe/London'),
    ).toBe('1350-06-01T20:00');
    expect(fromDatetimeLocal('0050-01-01T09:05', 'UTC')).toBe('0050-01-01T09:05:00.000Z');
    expect(toDatetimeLocal('0050-01-01T09:05:00.000Z', 'UTC')).toBe('0050-01-01T09:05');
    expect(
      toDatetimeLocal(
        fromDatetimeLocal('0050-01-01T09:05', 'America/Los_Angeles'),
        'America/Los_Angeles',
      ),
    ).toBe('0050-01-01T09:05');
  });

  it('turns down moments outside the years 1 to 9999 in UTC, as the server does', () => {
    expect(fromDatetimeLocal('0000-06-01T12:00', 'UTC')).toBeNull();
    expect(fromDatetimeLocal('10000-06-01T12:00', 'UTC')).toBeNull();
    expect(fromDatetimeLocal('9999-06-01T12:00', 'UTC')).toBe('9999-06-01T12:00:00.000Z');
    // Midnight starting the year 1 in Tokyo was still the year before in UTC.
    expect(fromDatetimeLocal('0001-01-01T00:00', 'Asia/Tokyo')).toBeNull();
    expect(toDatetimeLocal('0001-01-01T03:00:00.000Z', 'America/Los_Angeles')).toBe('');
  });

  it("keeps the fields' limits inside that range on any clock", () => {
    for (const timeZone of ['Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      expect(fromDatetimeLocal('0001-01-02T00:00', timeZone)).not.toBeNull();
      expect(fromDatetimeLocal('9999-12-30T23:59', timeZone)).not.toBeNull();
    }
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
