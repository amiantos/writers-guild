import { describe, it, expect } from 'vitest';
import {
  BureauTimeError,
  bureauPresent,
  describeDayPart,
  describeGap,
  describeTime,
  isValidTimeZone,
  resolveStoryEndTime,
  resolveStoryStartTime,
  settingYear,
} from '../bureau-time.js';

describe('bureauPresent', () => {
  it('moves the date by whole days and keeps the time of day', () => {
    const now = new Date('2026-09-12T22:15:00Z');

    expect(bureauPresent({ presentOffsetDays: 0 }, now).toISOString()).toBe(
      '2026-09-12T22:15:00.000Z',
    );
    expect(bureauPresent({ presentOffsetDays: 3 }, now).toISOString()).toBe(
      '2026-09-15T22:15:00.000Z',
    );
    expect(bureauPresent({ presentOffsetDays: -365 }, now).toISOString()).toBe(
      '2025-09-12T22:15:00.000Z',
    );
  });
});

describe('describeGap', () => {
  const from = '2026-09-01T12:00:00Z';
  const after = (hours) => new Date(Date.parse(from) + hours * 3_600_000);

  it("says nothing about short gaps or times it can't read", () => {
    expect(describeGap(from, after(2))).toBeNull();
    expect(describeGap(from, after(-30))).toBeNull();
    expect(describeGap('not a date', after(50))).toBeNull();
  });

  it('describes longer gaps loosely', () => {
    const hours = [5, 20, 72, 192, 432, 840, 2880, 9600, 21600];

    expect(hours.map((gap) => describeGap(from, after(gap)))).toEqual([
      'a few hours',
      'about a day',
      'a few days',
      'about a week',
      'a few weeks',
      'about a month',
      'a few months',
      'about a year',
      'more than a year',
    ]);
  });
});

describe('settingYear', () => {
  const now = new Date('2026-09-12T22:15:00Z');

  it('names the year when the present is moved or a moment is in another year', () => {
    const bureau = { presentOffsetDays: -11_000, timezone: 'UTC' };

    expect(settingYear(bureau, bureauPresent(bureau, now), now)).toBe(1996);
    expect(
      settingYear({ presentOffsetDays: 0, timezone: 'UTC' }, '1996-06-01T12:00:00Z', now),
    ).toBe(1996);
  });

  it('leaves the year out for the real present', () => {
    expect(settingYear({ presentOffsetDays: 0, timezone: null }, now, now)).toBeNull();
    expect(settingYear({ presentOffsetDays: 0, timezone: 'UTC' }, 'not a date', now)).toBeNull();
  });
});

describe('describeTime', () => {
  it('describes a moment loosely, in the given time zone', () => {
    // 07:30 UTC is 00:30 on Tuesday, October 27 in Los Angeles.
    expect(describeTime('2026-10-27T07:30:00Z', { timeZone: 'America/Los_Angeles' })).toBe(
      'a Tuesday, a little past midnight, late October',
    );
  });

  it('adds the year when asked', () => {
    expect(
      describeTime('2026-10-27T07:30:00Z', { timeZone: 'America/Los_Angeles', includeYear: true }),
    ).toBe('a Tuesday, a little past midnight, late October 2026');
  });

  it('uses early, mid, and late parts of the month', () => {
    expect(describeTime(new Date('2026-06-03T09:00:00Z'), { timeZone: 'UTC' })).toBe(
      'a Wednesday, mid-morning, early June',
    );
    expect(describeTime('2026-03-15T15:00:00Z', { timeZone: 'UTC' })).toBe(
      'a Sunday, late afternoon, mid-March',
    );
  });

  it('rejects invalid times and time zones', () => {
    expect(() => describeTime('not a date', { timeZone: 'UTC' })).toThrow(BureauTimeError);
    expect(() => describeTime('2026-06-03T09:00:00Z', { timeZone: 'Not/AZone' })).toThrow(
      /Unknown time zone/,
    );
  });
});

describe('describeDayPart', () => {
  it.each([
    [0, 'a little past midnight'],
    [2, 'the middle of the night'],
    [5, 'the hours before dawn'],
    [7, 'early morning'],
    [10, 'mid-morning'],
    [11, 'late morning'],
    [12, 'around midday'],
    [14, 'early afternoon'],
    [16, 'late afternoon'],
    [18, 'early evening'],
    [20, 'evening'],
    [22, 'late evening'],
    [23, 'nearly midnight'],
  ])('hour %i is %s', (hour, label) => {
    expect(describeDayPart(hour)).toBe(label);
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects everything else', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
  });
});

describe('story start and end times', () => {
  const bureauTime = '2026-09-01T20:00:00.000Z';
  const present = new Date('2026-09-12T08:15:00.000Z');

  it('starts a story at the present, the Bureau time, or a picked time', () => {
    expect(resolveStoryStartTime({ choice: 'present', bureauTime, present })).toBe(
      '2026-09-12T08:15:00.000Z',
    );
    expect(resolveStoryStartTime({ choice: 'bureau', bureauTime, present })).toBe(bureauTime);
    expect(
      resolveStoryStartTime({
        choice: 'custom',
        bureauTime,
        present,
        customTime: '1996-06-03T21:00:00-07:00',
      }),
    ).toBe('1996-06-04T04:00:00.000Z');
  });

  it('ends a story at the present, a picked time, or without changing the clock', () => {
    expect(resolveStoryEndTime({ choice: 'present', bureauTime, present })).toBe(
      '2026-09-12T08:15:00.000Z',
    );
    expect(
      resolveStoryEndTime({
        choice: 'custom',
        bureauTime,
        present,
        customTime: '2026-09-03T02:00:00Z',
      }),
    ).toBe('2026-09-03T02:00:00.000Z');
    expect(resolveStoryEndTime({ choice: 'unchanged', bureauTime, present })).toBe(bureauTime);
  });

  it('rejects unknown choices and unreadable custom times', () => {
    expect(() => resolveStoryStartTime({ choice: 'tomorrow', bureauTime, present })).toThrow(
      /Start time must be one of/,
    );
    expect(() => resolveStoryEndTime({ choice: 'later', bureauTime, present })).toThrow(
      /End time must be one of/,
    );
    expect(() =>
      resolveStoryStartTime({ choice: 'custom', bureauTime, present, customTime: 'soon' }),
    ).toThrow(BureauTimeError);
    expect(() => resolveStoryEndTime({ choice: 'custom', bureauTime, present })).toThrow(
      BureauTimeError,
    );
  });
});
