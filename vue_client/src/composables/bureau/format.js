/**
 * Formatting Helpers for Bureau Views
 */

/** The browser's IANA time zone, when it can tell. */
export function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * A readable date and time, such as "Tue, Oct 27, 2026, 12:30 AM".
 * @param {string|Date} value
 * @param {string} [timeZone] - Defaults to the browser's zone.
 */
export function formatDateTime(value, timeZone) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const options = {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  try {
    return date.toLocaleString(undefined, { ...options, timeZone: timeZone || undefined });
  } catch {
    // An unknown stored time zone: show the browser's local time instead.
    return date.toLocaleString(undefined, options);
  }
}

/** A short date, such as "Oct 27, 2026", in the browser's zone. */
export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function pad(number) {
  return String(number).padStart(2, '0');
}

// The years Bureau time can show. A datetime-local field allows more.
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

const CLOCK_PARTS = {
  era: 'short',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
};

/** Reads a time zone's clock: the given zone, or the browser's when it's missing or unknown. */
function clockOf(timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', { ...CLOCK_PARTS, timeZone: timeZone || undefined });
  } catch {
    return new Intl.DateTimeFormat('en-US', CLOCK_PARTS);
  }
}

/** Milliseconds for a date and time on a UTC clock. Unlike Date.UTC, years 0-99 stay themselves. */
function utcTime(year, month, day, hour, minute, second) {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/** What a clock (from clockOf) shows at a moment, as milliseconds on a UTC clock. */
function wallClock(moment, clock) {
  const date = new Date(moment);
  const parts = Object.fromEntries(
    clock.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const wall = utcTime(
    // 1 BC is the year 0, 2 BC the year -1, and so on.
    parts.era === 'BC' ? 1 - year : year,
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return wall + date.getUTCMilliseconds();
}

/** The moment a clock shows a wall-clock time (as from wallClock). */
function momentAt(wall, clock) {
  // The second pass settles a daylight saving change.
  let moment = wall;
  for (let pass = 0; pass < 2; pass += 1) {
    moment += wall - wallClock(moment, clock);
  }
  return moment;
}

/**
 * An ISO time as a value for <input type="datetime-local">, on a time zone's clock.
 * @param {string|Date} value
 * @param {string|null} [timeZone] - The Bureau's; the browser's when unset or unknown.
 * @returns {string} Empty when the time is missing or invalid, or outside the years 1 to 9999 on
 *   that clock.
 */
export function toDatetimeLocal(value, timeZone) {
  const moment = value ? new Date(value).getTime() : NaN;
  if (Number.isNaN(moment)) return '';
  const wall = new Date(wallClock(moment, clockOf(timeZone)));
  const year = wall.getUTCFullYear();
  if (year < MIN_YEAR || year > MAX_YEAR) return '';
  return (
    `${String(year).padStart(4, '0')}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}` +
    `T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}`
  );
}

const DATETIME_LOCAL = /^(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/**
 * A datetime-local input value, read on a time zone's clock, as an ISO time.
 * @param {string} value
 * @param {string|null} [timeZone] - The Bureau's; the browser's when unset or unknown.
 * @returns {string|null} Null when empty or invalid, or when the moment falls outside the years 1
 *   to 9999 in UTC, which the server turns down.
 */
export function fromDatetimeLocal(value, timeZone) {
  const match = typeof value === 'string' ? DATETIME_LOCAL.exec(value) : null;
  if (!match) return null;
  const fields = match.slice(1).map((part) => Number(part ?? 0));
  const [year, month, day, hour, minute, second] = fields;
  const wall = utcTime(year, month - 1, day, hour, minute, second);
  const date = new Date(wall);
  const read = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ];
  // Not a real date and time, such as February 30.
  if (read.some((field, index) => field !== fields[index])) return null;

  const moment = new Date(momentAt(wall, clockOf(timeZone)));
  const utcYear = moment.getUTCFullYear();
  return utcYear >= MIN_YEAR && utcYear <= MAX_YEAR ? moment.toISOString() : null;
}

/** A duration such as "850ms" or "2.4s". */
export function formatDuration(ms) {
  if (ms === null || ms === undefined) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Token usage, such as "1,204 in (512 cached) · 310 out". */
export function formatUsage(usage) {
  if (!usage) return '';
  const cached = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;
  const cachedText = cached ? ` (${formatCount(cached)} cached)` : '';
  return `${formatCount(usage.prompt_tokens)} in${cachedText} · ${formatCount(usage.completion_tokens)} out`;
}

function formatCount(number) {
  return (number ?? 0).toLocaleString('en-US');
}

/** Read a remembered choice from localStorage, falling back when absent or unavailable. */
export function rememberedChoice(key, allowed, fallback) {
  try {
    const value = localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function rememberChoice(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing or storage disabled; the default is fine next time.
  }
}
