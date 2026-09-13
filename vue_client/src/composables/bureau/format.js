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
    `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

// The years Bureau time can show. A datetime-local field allows more.
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

/**
 * A datetime-local input value (browser's zone) as an ISO time, or null if empty, invalid, or
 * outside the years 1 to 9999.
 */
export function fromDatetimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const years = [date.getFullYear(), date.getUTCFullYear()];
  return years.every((year) => year >= MIN_YEAR && year <= MAX_YEAR) ? date.toISOString() : null;
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
