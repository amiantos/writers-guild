import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installAuthFetch, linkURL } from '../authApi.js';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('installAuthFetch', () => {
  let nativeFetch;
  let onSignInRequired;

  beforeEach(() => {
    nativeFetch = vi.fn(async () => jsonResponse(200, {}));
    vi.stubGlobal('fetch', nativeFetch);
    window.fetch = nativeFetch;
    onSignInRequired = vi.fn();
    installAuthFetch(onSignInRequired);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks requests to the API as the app’s, keeping their own headers', async () => {
    await window.fetch('/api/stories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const headers = nativeFetch.mock.calls[0][1].headers;
    expect(headers.get('X-Requested-With')).toBe('WritersGuild');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('leaves requests elsewhere alone', async () => {
    await window.fetch('https://example.com/api/thing');

    expect(nativeFetch.mock.calls[0][1].headers).toBeUndefined();
  });

  it('goes to sign in when the session has ended', async () => {
    nativeFetch.mockResolvedValueOnce(
      jsonResponse(401, { error: 'Sign in required', signInRequired: true }),
    );

    const response = await window.fetch('/api/stories');

    expect(onSignInRequired).toHaveBeenCalledTimes(1);
    // The caller still gets the response to read
    expect((await response.json()).signInRequired).toBe(true);
  });

  it('leaves other refusals, like a wrong password, to the caller', async () => {
    nativeFetch.mockResolvedValueOnce(jsonResponse(401, { error: 'Wrong username or password' }));

    await window.fetch('/api/auth/login', { method: 'POST' });

    expect(onSignInRequired).not.toHaveBeenCalled();
  });
});

describe('linkURL', () => {
  it('makes a link the server gives into one to send', () => {
    expect(linkURL('/invite/abc')).toBe(`${window.location.origin}/invite/abc`);
  });
});
