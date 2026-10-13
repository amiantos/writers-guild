/**
 * Sign-in throttle
 *
 * Slows down guessing passwords: after too many failed sign ins from one address, to one account
 * or for a link, more are refused until the window passes. Kept in memory, so a restart clears it.
 */

export const MAX_FAILURES = 10;
export const WINDOW_MS = 15 * 60 * 1000;

export class SignInThrottle {
  constructor({ maxFailures = MAX_FAILURES, windowMs = WINDOW_MS } = {}) {
    this.maxFailures = maxFailures;
    this.windowMs = windowMs;
    this.failures = new Map();
  }

  current(key) {
    const entry = this.failures.get(key);
    if (entry && Date.now() - entry.since > this.windowMs) {
      this.failures.delete(key);
      return null;
    }
    return entry ?? null;
  }

  /** Whether another try is refused. */
  blocked(key) {
    return (this.current(key)?.count ?? 0) >= this.maxFailures;
  }

  fail(key) {
    const entry = this.current(key) ?? { count: 0, since: Date.now() };
    entry.count++;
    this.failures.set(key, entry);
  }

  succeed(key) {
    this.failures.delete(key);
  }
}
