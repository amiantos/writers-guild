/**
 * Global test setup.
 *
 * Untrusted URLs (card images, import-by-URL) are fetched through
 * safe-fetch.js, which calls undici's fetch rather than the global one. Route
 * undici's fetch through globalThis.fetch so a test stubs every request the
 * same way — `vi.stubGlobal('fetch', ...)` — whichever fetch the code uses.
 *
 * safe-fetch.test.js unmocks undici to exercise the real connection guard.
 */
import { vi } from 'vitest';

vi.mock('undici', async (importOriginal) => ({
  ...(await importOriginal()),
  fetch: (...args) => globalThis.fetch(...args),
}));

/**
 * Default fetch: refuse, loudly and instantly.
 *
 * Any test that genuinely needs a response assigns its own globalThis.fetch;
 * everything else fails fast here rather than reaching the network or hanging
 * on the cacher's 15s per-image timeout.
 *
 * Image caching is non-fatal by design, so imports under test still succeed —
 * they just cache nothing, which is what those tests actually assert.
 */
globalThis.fetch = vi.fn(async (url) => {
  throw new Error(`Unmocked network request in tests: ${url}`);
});
