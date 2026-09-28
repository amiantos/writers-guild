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
