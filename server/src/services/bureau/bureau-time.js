/**
 * Bureau Time
 *
 * Each Bureau has one clock (see "Bureau time" in docs/bureau-design.md).
 * Stories ask what time they start and end; correspondence always moves the
 * clock to the present. Prompts never get exact timestamps, only the loose
 * descriptions built here, so models don't fixate on the clock.
 */

export class BureauTimeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BureauTimeError';
  }
}

export const START_TIME_CHOICES = ['present', 'bureau', 'custom'];
export const END_TIME_CHOICES = ['present', 'custom', 'unchanged'];

// Start hour of each part of the day, in order.
const DAY_PARTS = [
  [0, 'a little past midnight'],
  [1, 'the middle of the night'],
  [4, 'the hours before dawn'],
  [6, 'early morning'],
  [9, 'mid-morning'],
  [11, 'late morning'],
  [12, 'around midday'],
  [13, 'early afternoon'],
  [15, 'late afternoon'],
  [17, 'early evening'],
  [19, 'evening'],
  [21, 'late evening'],
  [23, 'nearly midnight'],
];

/**
 * @param {string|null|undefined} timeZone
 * @returns {boolean}
 */
export function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== 'string') return false;
  try {
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

/**
 * @param {number} hour - 0 to 23.
 * @returns {string} A loose part of the day, e.g. "late evening".
 */
export function describeDayPart(hour) {
  let label = DAY_PARTS[0][1];
  for (const [start, name] of DAY_PARTS) {
    if (hour >= start) label = name;
  }
  return label;
}

function zonedParts(date, timeZone) {
  if (timeZone !== undefined && !isValidTimeZone(timeZone)) {
    throw new BureauTimeError(`Unknown time zone: ${timeZone}`);
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    weekday: parts.weekday,
    month: parts.month,
    day: Number(parts.day),
    year: Number(parts.year),
    hour: Number(parts.hour),
  };
}

function describeMonthPart(day, month) {
  if (day <= 10) return `early ${month}`;
  if (day <= 20) return `mid-${month}`;
  return `late ${month}`;
}

/**
 * A loose description of a moment for scene-setting, such as
 * "a Tuesday, a little past midnight, late October".
 *
 * @param {Date|string} value
 * @param {Object} [options]
 * @param {string} [options.timeZone] - IANA zone; defaults to the server's.
 * @param {boolean} [options.includeYear] - For Bureaus set in another era.
 * @returns {string}
 */
export function describeTime(value, { timeZone, includeYear = false } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BureauTimeError(`Not a valid time: ${value}`);
  }
  const { weekday, month, day, year, hour } = zonedParts(date, timeZone);
  const monthPart = describeMonthPart(day, month);
  return `a ${weekday}, ${describeDayPart(hour)}, ${monthPart}${includeYear ? ` ${year}` : ''}`;
}

/**
 * describeTime in a Bureau's time zone. A stored zone this server doesn't know
 * falls back to the server's.
 * @param {Date|string} value
 * @param {string|null} timeZone - The Bureau's timezone.
 * @returns {string}
 */
export function describeBureauTime(value, timeZone) {
  try {
    return describeTime(value, { timeZone: timeZone ?? undefined });
  } catch (error) {
    if (!(error instanceof BureauTimeError) || !timeZone) throw error;
    return describeTime(value);
  }
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// About two centuries either way.
export const MAX_PRESENT_OFFSET_DAYS = 73_000;
// Shorter gaps between messages aren't worth mentioning in a prompt.
export const NOTABLE_GAP_HOURS = 3;

// The longest gap, in hours, each loose description covers, in order.
const GAPS = [
  [12, 'a few hours'],
  [36, 'about a day'],
  [6 * 24, 'a few days'],
  [11 * 24, 'about a week'],
  [25 * 24, 'a few weeks'],
  [45 * 24, 'about a month'],
  [300 * 24, 'a few months'],
  [548 * 24, 'about a year'],
];

function timestampOf(value) {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/** A moment's date and time of day in a time zone, as milliseconds on a UTC clock. */
function wallClock(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, Number(part.value)]),
  );
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    date.getUTCMilliseconds(),
  );
}

/**
 * A Bureau's present: the real time of day, on the date the Bureau's whole-day
 * offset away in its time zone. The offset counts calendar days, not 24-hour
 * blocks, so a daylight saving change between the two dates moves neither the
 * hour nor the date. The client's bureauPresent (composables/bureau/format.js)
 * does the same.
 * @param {{ presentOffsetDays?: number, timezone?: string|null }} bureau
 * @param {Date} [now]
 * @returns {Date}
 */
export function bureauPresent(bureau, now = new Date()) {
  const days = bureau.presentOffsetDays ?? 0;
  if (!days) return new Date(now.getTime());
  const timeZone = isValidTimeZone(bureau.timezone) ? bureau.timezone : undefined;
  const target = wallClock(now, timeZone) + days * DAY_MS;
  // Find the moment showing that wall clock; the second pass settles a daylight saving change.
  let moment = target;
  for (let pass = 0; pass < 2; pass += 1) {
    moment += target - wallClock(new Date(moment), timeZone);
  }
  return new Date(moment);
}

/**
 * How long it's been between two moments, loosely, or null when it's too short
 * to matter (or either time can't be read).
 * @param {Date|string} from
 * @param {Date|string} to
 * @returns {string|null} For example "a few days".
 */
export function describeGap(from, to) {
  const hours = (timestampOf(to) - timestampOf(from)) / HOUR_MS;
  if (!Number.isFinite(hours) || hours < NOTABLE_GAP_HOURS) return null;
  return GAPS.find(([limit]) => hours < limit)?.[1] ?? 'more than a year';
}

/**
 * The year to give prompts as setting ("The year is 1996."), so the Writer
 * avoids anachronisms: when the Bureau's present is moved, or a moment falls in
 * a year other than the real one. Null otherwise.
 * @param {{ presentOffsetDays?: number, timezone?: string|null }} bureau
 * @param {Date|string} value
 * @param {Date} [now]
 * @returns {number|null}
 */
export function settingYear(bureau, value, now = new Date()) {
  const time = timestampOf(value);
  if (!Number.isFinite(time)) return null;
  const timeZone = isValidTimeZone(bureau.timezone) ? bureau.timezone : undefined;
  const { year } = zonedParts(new Date(time), timeZone);
  return bureau.presentOffsetDays || year !== zonedParts(now, timeZone).year ? year : null;
}

function parseCustomTime(customTime) {
  const date = typeof customTime === 'string' ? new Date(customTime) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new BureauTimeError('customTime must be a valid date and time');
  }
  return date.toISOString();
}

/**
 * The start time for a new story, from the choice made in the start dialog.
 *
 * @param {Object} params
 * @param {'present'|'bureau'|'custom'} params.choice
 * @param {string} params.bureauTime - The Bureau's current time (ISO).
 * @param {Date} params.present - The Bureau's present.
 * @param {string} [params.customTime] - ISO time, for 'custom'.
 * @returns {string} ISO timestamp.
 */
export function resolveStoryStartTime({ choice, bureauTime, present, customTime }) {
  switch (choice) {
    case 'present':
      return present.toISOString();
    case 'bureau':
      return bureauTime;
    case 'custom':
      return parseCustomTime(customTime);
    default:
      throw new BureauTimeError(`Start time must be one of: ${START_TIME_CHOICES.join(', ')}`);
  }
}

/**
 * Bureau time after a story ends, from the choice made in the end dialog.
 *
 * @param {Object} params
 * @param {'present'|'custom'|'unchanged'} params.choice
 * @param {string} params.bureauTime - The Bureau's current time (ISO).
 * @param {Date} params.present - The Bureau's present.
 * @param {string} [params.customTime] - ISO time, for 'custom'.
 * @returns {string} ISO timestamp.
 */
export function resolveStoryEndTime({ choice, bureauTime, present, customTime }) {
  switch (choice) {
    case 'present':
      return present.toISOString();
    case 'custom':
      return parseCustomTime(customTime);
    case 'unchanged':
      return bureauTime;
    default:
      throw new BureauTimeError(`End time must be one of: ${END_TIME_CHOICES.join(', ')}`);
  }
}
