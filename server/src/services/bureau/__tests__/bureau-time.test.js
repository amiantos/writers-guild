import { describe, it, expect } from 'vitest';
import {
  advanceBureauTime,
  BureauTimeError,
  describeDayPart,
  describeGap,
  describeTime,
  isValidTimeZone,
  parseBureauTime,
  resolveStoryEndTime,
  resolveStoryStartTime,
  settingYear,
  TIME_STEPS,
} from '../bureau-time.js';

describe('advanceBureauTime', () => {
  const evening = '2026-09-12T22:15:00.000Z';

  it('moves the clock an hour, later that day, a few days, or a week', () => {
    expect(TIME_STEPS).toEqual(['hour', 'later', 'morning', 'days', 'week']);
    expect(advanceBureauTime(evening, 'hour', 'UTC')).toBe('2026-09-12T23:15:00.000Z');
    expect(advanceBureauTime(evening, 'later', 'UTC')).toBe('2026-09-13T02:15:00.000Z');
    expect(advanceBureauTime(evening, 'days', 'UTC')).toBe('2026-09-15T22:15:00.000Z');
    expect(advanceBureauTime(evening, 'week', 'UTC')).toBe('2026-09-19T22:15:00.000Z');
  });

  it("moves to 8:00 the next morning in the Bureau's time zone", () => {
    // 15:15 on September 12 in Los Angeles, and already 07:15 on September 13 in Tokyo.
    expect(advanceBureauTime(evening, 'morning', 'America/Los_Angeles')).toBe(
      '2026-09-13T15:00:00.000Z',
    );
    expect(advanceBureauTime(evening, 'morning', 'Asia/Tokyo')).toBe('2026-09-13T23:00:00.000Z');
  });

  it('keeps the hour across a daylight saving change', () => {
    // Daylight saving ends in Los Angeles early on November 1, 2026.
    expect(advanceBureauTime('2026-11-01T06:30:00.000Z', 'morning', 'America/Los_Angeles')).toBe(
      '2026-11-01T16:00:00.000Z',
    );
    expect(advanceBureauTime('2026-10-30T15:00:00.000Z', 'days', 'America/Los_Angeles')).toBe(
      '2026-11-02T16:00:00.000Z',
    );
  });

  it("uses the server's time zone when the Bureau has none", () => {
    const morning = new Date(advanceBureauTime(evening, 'morning', null));

    expect(morning.getHours()).toBe(8);
    expect(morning.getMinutes()).toBe(0);
    expect(morning.getTime() - Date.parse(evening)).toBeGreaterThan(0);
    expect(morning.getTime() - Date.parse(evening)).toBeLessThan(2 * 24 * 3_600_000);
  });

  it('keeps years below 100 and the 1300s as they are', () => {
    expect(advanceBureauTime('0050-03-01T10:00:00.000Z', 'morning', 'UTC')).toBe(
      '0050-03-02T08:00:00.000Z',
    );
    expect(advanceBureauTime('0050-03-01T10:00:00.000Z', 'week', 'UTC')).toBe(
      '0050-03-08T10:00:00.000Z',
    );
    expect(advanceBureauTime('1350-06-01T20:00:00.000Z', 'morning', 'UTC')).toBe(
      '1350-06-02T08:00:00.000Z',
    );
    expect(advanceBureauTime('1350-06-01T20:00:00.000Z', 'days', 'UTC')).toBe(
      '1350-06-04T20:00:00.000Z',
    );
  });

  it('rejects an unknown step, an unreadable time, or a time past the year 9999', () => {
    expect(() => advanceBureauTime(evening, 'fortnight', 'UTC')).toThrow(/step must be one of/);
    expect(() => advanceBureauTime('soon', 'hour', 'UTC')).toThrow(BureauTimeError);
    expect(() => advanceBureauTime('9999-12-31T20:00:00.000Z', 'later', 'UTC')).toThrow(
      /past the year 9999/,
    );
  });
});

describe('parseBureauTime', () => {
  it('accepts a date and time in the years 1 to 9999', () => {
    expect(parseBureauTime('1350-06-01T12:00:00Z')).toBe('1350-06-01T12:00:00.000Z');
    expect(parseBureauTime('0001-01-01T00:00:00Z')).toBe('0001-01-01T00:00:00.000Z');
    expect(parseBureauTime('9999-12-31T23:59:00Z')).toBe('9999-12-31T23:59:00.000Z');
    expect(parseBureauTime('1996-06-03T21:00:00-07:00')).toBe('1996-06-04T04:00:00.000Z');
  });

  it('rejects missing, unreadable, and out-of-range times', () => {
    for (const value of [undefined, null, '', 'soon', 1350]) {
      expect(() => parseBureauTime(value, 'bureauTime')).toThrow(
        'bureauTime must be a valid date and time',
      );
    }
    for (const value of [
      '0000-12-31T00:00:00Z',
      '-000001-01-01T00:00:00Z',
      '+010000-01-01T00:00:00Z',
    ]) {
      expect(() => parseBureauTime(value)).toThrow(/years 1 to 9999/);
    }
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

  it('names the year of a moment in another year, however far back', () => {
    expect(settingYear({ timezone: 'UTC' }, '1996-06-01T12:00:00Z', now)).toBe(1996);
    expect(settingYear({ timezone: 'UTC' }, '1350-06-01T12:00:00Z', now)).toBe(1350);
    expect(settingYear({ timezone: 'UTC' }, '0050-03-01T12:00:00Z', now)).toBe(50);
  });

  it('leaves the year out for the real year', () => {
    expect(settingYear({ timezone: null }, now, now)).toBeNull();
    expect(settingYear({ timezone: 'UTC' }, '2026-01-02T00:00:00Z', now)).toBeNull();
    expect(settingYear({ timezone: 'UTC' }, 'not a date', now)).toBeNull();
  });
});

describe('the year 1 on a time zone clock', () => {
  // 03:00 UTC on January 1 of the year 1 was still the evening of December 31, 1 BC, in Los
  // Angeles, whose clock then ran on local mean time, 7:52:58 behind UTC.
  const start = '0001-01-01T03:00:00.000Z';

  it('lets time pass into the year 1, not a year past it', () => {
    expect(advanceBureauTime(start, 'morning', 'America/Los_Angeles')).toBe(
      '0001-01-01T15:52:58.000Z',
    );
    expect(advanceBureauTime(start, 'days', 'America/Los_Angeles')).toBe(
      '0001-01-04T03:00:00.000Z',
    );
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

  it('starts a story at Bureau time or a picked time', () => {
    expect(resolveStoryStartTime({ choice: 'bureau', bureauTime })).toBe(bureauTime);
    expect(
      resolveStoryStartTime({ choice: 'custom', bureauTime, customTime: '1350-06-03T21:00:00Z' }),
    ).toBe('1350-06-03T21:00:00.000Z');
  });

  it('ends a story leaving the clock as it is, or at a picked time', () => {
    expect(resolveStoryEndTime({ choice: 'unchanged', bureauTime })).toBe(bureauTime);
    expect(
      resolveStoryEndTime({ choice: 'custom', bureauTime, customTime: '2026-09-03T02:00:00Z' }),
    ).toBe('2026-09-03T02:00:00.000Z');
  });

  it('rejects unknown choices and unreadable or out-of-range custom times', () => {
    expect(() => resolveStoryStartTime({ choice: 'present', bureauTime })).toThrow(
      'Start time must be one of: bureau, custom',
    );
    expect(() => resolveStoryEndTime({ choice: 'present', bureauTime })).toThrow(
      'End time must be one of: unchanged, custom',
    );
    expect(() =>
      resolveStoryStartTime({ choice: 'custom', bureauTime, customTime: 'soon' }),
    ).toThrow(BureauTimeError);
    expect(() =>
      resolveStoryStartTime({
        choice: 'custom',
        bureauTime,
        customTime: '+010000-01-01T00:00:00Z',
      }),
    ).toThrow(/years 1 to 9999/);
    expect(() => resolveStoryEndTime({ choice: 'custom', bureauTime })).toThrow(BureauTimeError);
  });
});
