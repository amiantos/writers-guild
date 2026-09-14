import { describe, it, expect } from 'vitest';
import { createRequestTimeout, formatTimeout } from '../request-timeout.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createRequestTimeout', () => {
  it('aborts its signal when time runs out, and says it timed out', async () => {
    const timeout = createRequestTimeout(10);

    await new Promise((resolve) => timeout.signal.addEventListener('abort', resolve));

    expect(timeout.timedOut).toBe(true);
  });

  it('pushes the deadline back on each reset', async () => {
    const timeout = createRequestTimeout(100);

    for (let step = 0; step < 10; step++) {
      await wait(20);
      timeout.reset();
    }

    expect(timeout.signal.aborted).toBe(false);
    timeout.clear();
  });

  it("follows the caller's signal without calling it a timeout", () => {
    const controller = new AbortController();
    const timeout = createRequestTimeout(1000, controller.signal);

    controller.abort();

    expect(timeout.signal.aborted).toBe(true);
    expect(timeout.timedOut).toBe(false);
    timeout.clear();
  });

  it('never fires once cleared', async () => {
    const timeout = createRequestTimeout(10);

    timeout.clear();
    await wait(30);

    expect(timeout.signal.aborted).toBe(false);
  });
});

describe('formatTimeout', () => {
  it('reads in seconds under a minute, and in minutes from there', () => {
    expect(formatTimeout(1000)).toBe('1 second');
    expect(formatTimeout(30_000)).toBe('30 seconds');
    expect(formatTimeout(60_000)).toBe('1 minute');
    expect(formatTimeout(5 * 60_000)).toBe('5 minutes');
  });
});
