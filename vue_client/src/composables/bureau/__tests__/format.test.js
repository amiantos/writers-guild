import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  bureauPresent,
  formatDateTime,
  formatDuration,
  formatUsage,
  fromDatetimeLocal,
  offsetDaysTo,
  presentDateValue,
  rememberChoice,
  rememberedChoice,
  toDatetimeLocal,
} from '../format.js';

describe("the Bureau's present", () => {
  const now = new Date(2026, 8, 12, 22, 15);

  it('turns a day offset into a date and back', () => {
    expect(presentDateValue({ presentOffsetDays: 0 }, now)).toBe('2026-09-12');
    expect(presentDateValue({ presentOffsetDays: -11000 }, now)).toBe('1996-07-31');
    expect(offsetDaysTo('1996-07-31', now)).toBe(-11000);
    expect(offsetDaysTo('2026-09-15', now)).toBe(3);
    expect(offsetDaysTo('', now)).toBeNull();
    // Years below 100 stay themselves instead of becoming 19xx.
    const ancient = offsetDaysTo('0002-09-12', now);
    expect(ancient).toBeLessThan(offsetDaysTo('1902-09-12', now));
    expect(presentDateValue({ presentOffsetDays: ancient }, now)).toBe('0002-09-12');
  });

  it('keeps the time of day', () => {
    const present = bureauPresent({ presentOffsetDays: 3 }, now);

    expect(present.getHours()).toBe(22);
    expect(present.getDate()).toBe(15);
  });

  it("counts calendar days in the Bureau's time zone", () => {
    // 00:30 PDT on September 12; January 15, 1996 is in PST.
    const early = new Date('2026-09-12T07:30:00Z');
    const days = offsetDaysTo('1996-01-15', early, 'America/Los_Angeles');
    const bureau = { presentOffsetDays: days, timezone: 'America/Los_Angeles' };

    expect(bureauPresent(bureau, early).toISOString()).toBe('1996-01-15T08:30:00.000Z');
    expect(presentDateValue(bureau, early)).toBe('1996-01-15');
    const tokyo = { presentOffsetDays: 0, timezone: 'Asia/Tokyo' };
    expect(presentDateValue(tokyo, new Date('2026-09-12T20:00:00Z'))).toBe('2026-09-13');
  });
});

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
    expect(rememberedChoice('choice', ['present', 'custom'], 'present')).toBe('present');

    rememberChoice('choice', 'custom');
    expect(rememberedChoice('choice', ['present', 'custom'], 'present')).toBe('custom');

    rememberChoice('choice', 'retired-option');
    expect(rememberedChoice('choice', ['present', 'custom'], 'present')).toBe('present');
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
    expect(rememberedChoice('choice', ['present', 'custom'], 'present')).toBe('present');
  });
});
