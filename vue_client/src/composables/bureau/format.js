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

/** An ISO time as a value for <input type="datetime-local">, in the browser's zone. */
export function toDatetimeLocal(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** A datetime-local input value (browser's zone) as an ISO time, or null if empty or invalid. */
export function fromDatetimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WALL_CLOCK_FIELDS = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  hourCycle: 'h23',
};

/**
 * A moment's date and time of day in a time zone (the browser's when unset or
 * unknown), as milliseconds on a UTC clock.
 */
function wallClock(date, timeZone) {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      ...WALL_CLOCK_FIELDS,
      timeZone: timeZone || undefined,
    });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', WALL_CLOCK_FIELDS);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, Number(part.value)]),
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
 * The Bureau's present: the real time of day, on the date its whole-day offset
 * away in its time zone, counting calendar days. Mirrors bureauPresent in the
 * server's bureau-time.js, so both agree on the date.
 */
export function bureauPresent(bureau, now = new Date()) {
  const days = bureau?.presentOffsetDays ?? 0;
  if (!days) return new Date(now.getTime());
  const target = wallClock(now, bureau.timezone) + days * DAY_MS;
  // Find the moment showing that wall clock; the second pass settles a daylight saving change.
  let moment = target;
  for (let pass = 0; pass < 2; pass += 1) {
    moment += target - wallClock(new Date(moment), bureau.timezone);
  }
  return new Date(moment);
}

/**
 * The value for <input type="date"> (YYYY-MM-DD) showing a Bureau's present: today
 * in the Bureau's time zone, moved by its whole-day offset.
 */
export function presentDateValue(bureau, now = new Date()) {
  const clock = wallClock(now, bureau?.timezone);
  const date = new Date(clock + (bureau?.presentOffsetDays ?? 0) * DAY_MS);
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  return `${year}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Whole days from today, in a time zone (the browser's when unset), to a date
 * input value, or null if it isn't one.
 */
export function offsetDaysTo(dateValue, now = new Date(), timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue ?? '');
  if (!match) return null;
  const clock = new Date(wallClock(now, timeZone));
  const today = Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate());
  // Date.UTC reads years 0-99 as 1900-1999, so set the full year on its own.
  const target = new Date(0).setUTCFullYear(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Math.round((target - today) / DAY_MS);
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
