import { describe, it, expect } from 'vitest';
import { formatDateTime } from '../formatDateTime.js';

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
