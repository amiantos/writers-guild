/**
 * Bureau Time
 *
 * Each Bureau has one clock (see "Bureau time" in docs/bureau-design.md). Only the
 * reader moves it: by letting time pass, by setting it, or when a story starts or
 * ends. Messages happen at the current Bureau time. Prompts get the exact time,
 * described here: the reader set it on purpose, and a loose time of day only leads
 * the model to make up a clock time of its own.
 */

export class BureauTimeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BureauTimeError';
  }
}

export const START_TIME_CHOICES = ['bureau', 'custom'];
export const END_TIME_CHOICES = ['unchanged', 'custom'];

// The years a Bureau's clock can show: what date fields and ISO dates handle.
export const MIN_YEAR = 1;
export const MAX_YEAR = 9999;

// How "Time passes" can move the clock: an hour, later that day, the next morning, a few days,
// or a week.
export const TIME_STEPS = ['hour', 'later', 'morning', 'days', 'week'];
const MORNING_HOUR = 8;

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

/** The year in Intl date parts that include the era, counting 1 BC as 0, 2 BC as -1, and so on. */
function yearOf(parts) {
  const year = Number(parts.year);
  return parts.era === 'BC' ? 1 - year : year;
}

/** A moment on a time zone's clock, as Intl date parts: weekday, month, day, year, era, and time. */
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
    era: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  });
  return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
}

/**
 * A moment exactly, for prompts, such as "12:10 AM on Monday, September 13, 2027".
 *
 * @param {Date|string} value
 * @param {Object} [options]
 * @param {string} [options.timeZone] - IANA zone; defaults to the server's.
 * @returns {string} Years before 1 AD end in "BC".
 */
export function describeExactTime(value, { timeZone } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BureauTimeError(`Not a valid time: ${value}`);
  }
  const { weekday, month, day, year, era, hour, minute, dayPeriod } = zonedParts(date, timeZone);
  return `${hour}:${minute} ${dayPeriod} on ${weekday}, ${month} ${day}, ${era === 'BC' ? `${year} BC` : year}`;
}

/**
 * describeExactTime in a Bureau's time zone. A stored zone this server doesn't know
 * falls back to the server's.
 * @param {Date|string} value
 * @param {string|null} timeZone - The Bureau's timezone.
 * @returns {string}
 */
export function describeBureauTime(value, timeZone) {
  try {
    return describeExactTime(value, { timeZone: timeZone ?? undefined });
  } catch (error) {
    if (!(error instanceof BureauTimeError) || !timeZone) throw error;
    return describeExactTime(value);
  }
}

// Turns that are part of a chapter's text, as opposed to directions for the Writer.
const CHAPTER_TEXT_KINDS = ['prose', 'scene_break', 'time_passes'];

/**
 * Where a chapter stands in time after some of its turns: when time last passed in the chapter
 * (a time_passes turn), or when the chapter began.
 *
 * @param {{ startTime: string }} story
 * @param {Array<Object>} turns - The chapter's turns in order, up to the point in question.
 * @returns {{ time: string, passed: boolean, justPassed: boolean }} passed says time has passed
 *   in the chapter; justPassed, that nothing has been written since.
 */
export function chapterTime(story, turns) {
  const text = turns.filter((turn) => CHAPTER_TEXT_KINDS.includes(turn.kind));
  const passing = text.findLast((turn) => turn.kind === 'time_passes');
  return {
    time: passing?.bureauTime ?? story.startTime,
    passed: Boolean(passing),
    justPassed: text.at(-1)?.kind === 'time_passes',
  };
}

/**
 * How time passing reads in the chapter text the Writer and Archivist see, after a
 * scene break.
 * @param {string} bureauTime - The time it passed to (ISO).
 * @param {string|null} timeZone - The Bureau's.
 */
export function describeTimePassing(bureauTime, timeZone) {
  return `[Time passes. It's now exactly ${describeBureauTime(bureauTime, timeZone)}.]`;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
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

/** Milliseconds for a date and time on a UTC clock. Unlike Date.UTC, years 0-99 stay themselves. */
function utcTime(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, second, millisecond);
  return date.getTime();
}

/** A moment's date and time of day in a time zone, as milliseconds on a UTC clock. */
function wallClock(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      era: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return utcTime(
    yearOf(parts),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    date.getUTCMilliseconds(),
  );
}

/** The moment a time zone's clock shows a wall-clock time (as from wallClock). */
function momentAt(wall, timeZone) {
  // The second pass settles a daylight saving change.
  let moment = wall;
  for (let pass = 0; pass < 2; pass += 1) {
    moment += wall - wallClock(new Date(moment), timeZone);
  }
  return moment;
}

/**
 * A Bureau time from a request: a date and time in the years MIN_YEAR to MAX_YEAR.
 * @param {unknown} value - An ISO date and time.
 * @param {string} [field] - The field to name in the error.
 * @returns {string} ISO timestamp.
 * @throws {BureauTimeError}
 */
export function parseBureauTime(value, field = 'time') {
  const date = typeof value === 'string' ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    throw new BureauTimeError(`${field} must be a valid date and time`);
  }
  const year = date.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new BureauTimeError(`${field} must be in the years ${MIN_YEAR} to ${MAX_YEAR}`);
  }
  return date.toISOString();
}

/**
 * Bureau time after "Time passes". Days and mornings count on the Bureau's clock, so a daylight
 * saving change doesn't move the hour.
 *
 * @param {string} bureauTime - The Bureau's current time (ISO).
 * @param {'hour'|'later'|'morning'|'days'|'week'} step - An hour later, four hours later, the
 *   next morning at 8:00, three days later, or a week later.
 * @param {string|null} [timeZone] - The Bureau's; the server's when unset or unknown.
 * @returns {string} ISO timestamp.
 * @throws {BureauTimeError} For an unknown step, or a time past MAX_YEAR.
 */
export function advanceBureauTime(bureauTime, step, timeZone) {
  const from = timestampOf(bureauTime);
  if (!Number.isFinite(from)) {
    throw new BureauTimeError(`Not a valid time: ${bureauTime}`);
  }
  const zone = isValidTimeZone(timeZone) ? timeZone : undefined;
  const wall = () => wallClock(new Date(from), zone);

  let to;
  switch (step) {
    case 'hour':
      to = from + HOUR_MS;
      break;
    case 'later':
      to = from + 4 * HOUR_MS;
      break;
    case 'morning': {
      const today = new Date(wall());
      to = momentAt(
        utcTime(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, MORNING_HOUR),
        zone,
      );
      break;
    }
    case 'days':
      to = momentAt(wall() + 3 * DAY_MS, zone);
      break;
    case 'week':
      to = momentAt(wall() + 7 * DAY_MS, zone);
      break;
    default:
      throw new BureauTimeError(`step must be one of: ${TIME_STEPS.join(', ')}`);
  }

  const date = new Date(to);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() > MAX_YEAR) {
    throw new BureauTimeError(`Bureau time can't go past the year ${MAX_YEAR}`);
  }
  return date.toISOString();
}

/**
 * Where "Time passes" moves a clock: by a step, or to a time. Whether that time may be earlier is
 * for the caller to decide.
 *
 * @param {string} from - The time it passes from (ISO).
 * @param {Object} move
 * @param {unknown} [move.step] - One of TIME_STEPS (see advanceBureauTime).
 * @param {unknown} [move.to] - An ISO time.
 * @param {string|null} [timeZone] - The Bureau's.
 * @returns {string} ISO timestamp.
 * @throws {BureauTimeError} Unless exactly one of step and to is valid.
 */
export function passTime(from, { step, to } = {}, timeZone) {
  if (step !== undefined && to === undefined) {
    if (!TIME_STEPS.includes(step)) {
      throw new BureauTimeError(`step must be one of: ${TIME_STEPS.join(', ')}`);
    }
    return advanceBureauTime(from, step, timeZone);
  }
  if (to !== undefined && step === undefined) {
    return parseBureauTime(to, 'to');
  }
  throw new BureauTimeError('Send either step or to');
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
 * The year to give prompts as setting ("The year is 1996." or "The year is 44 BC."), so the
 * Writer avoids anachronisms: when a moment falls in a year other than the real one. Null
 * otherwise.
 * @param {{ timezone?: string|null }} bureau
 * @param {Date|string} value
 * @param {Date} [now] - Real time.
 * @returns {string|null}
 */
export function settingYear(bureau, value, now = new Date()) {
  const time = timestampOf(value);
  if (!Number.isFinite(time)) return null;
  const timeZone = isValidTimeZone(bureau.timezone) ? bureau.timezone : undefined;
  const parts = zonedParts(new Date(time), timeZone);
  if (yearOf(parts) === yearOf(zonedParts(now, timeZone))) return null;
  return parts.era === 'BC' ? `${parts.year} BC` : parts.year;
}

/**
 * The start time for a new story, from the choice made in the start dialog.
 *
 * @param {Object} params
 * @param {'bureau'|'custom'} params.choice
 * @param {string} params.bureauTime - The Bureau's current time (ISO).
 * @param {string} [params.customTime] - ISO time, for 'custom'.
 * @returns {string} ISO timestamp.
 */
export function resolveStoryStartTime({ choice, bureauTime, customTime }) {
  switch (choice) {
    case 'bureau':
      return bureauTime;
    case 'custom':
      return parseBureauTime(customTime, 'customTime');
    default:
      throw new BureauTimeError(`Start time must be one of: ${START_TIME_CHOICES.join(', ')}`);
  }
}

/**
 * Bureau time after a story ends, from the choice made in the end dialog.
 *
 * @param {Object} params
 * @param {'unchanged'|'custom'} params.choice
 * @param {string} params.bureauTime - The Bureau's current time (ISO).
 * @param {string} [params.customTime] - ISO time, for 'custom'.
 * @returns {string} ISO timestamp.
 */
export function resolveStoryEndTime({ choice, bureauTime, customTime }) {
  switch (choice) {
    case 'unchanged':
      return bureauTime;
    case 'custom':
      return parseBureauTime(customTime, 'customTime');
    default:
      throw new BureauTimeError(`End time must be one of: ${END_TIME_CHOICES.join(', ')}`);
  }
}
