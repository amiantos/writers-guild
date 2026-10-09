/**
 * Tests for Image Cacher Service
 *
 * Tests URL extraction from card fields, URL rewriting, and
 * the caching pipeline with mocked network and filesystem calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  cacheCharacterImages,
  cacheLorebookImages,
  cacheAndRewriteLorebookImages,
  rewriteCharacterImageUrls,
  rewriteLorebookImageUrls,
  extractCardImageUrls,
  extractLorebookImageUrls,
} from '../image-cacher.js';
import { AssetManager } from '../asset-manager.js';

// ── Helpers ───────────────────────────────────────────────────────────

function makeCard(fields = {}) {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: 'Test',
      description: '',
      personality: '',
      scenario: '',
      first_mes: '',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      ...fields,
    },
  };
}

/** A minimal successful PNG response shaped like the fetch Response we use. */
function makePngResponse() {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'image/png' },
    body: {
      getReader() {
        let sent = false;
        return {
          read() {
            if (sent) return Promise.resolve({ done: true });
            sent = true;
            return Promise.resolve({ done: false, value: new Uint8Array(png) });
          },
          cancel() {},
        };
      },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('extractCardImageUrls', () => {
  it('returns empty set for card with no images', () => {
    const card = makeCard({ description: 'plain text' });
    expect([...extractCardImageUrls(card)]).toEqual([]);
  });

  it('extracts markdown image URLs', () => {
    const card = makeCard({ description: '![alt](https://example.com/img.png)' });
    const urls = extractCardImageUrls(card);
    expect([...urls]).toEqual(['https://example.com/img.png']);
  });

  it('extracts HTML img src URLs', () => {
    const card = makeCard({ personality: '<img src="https://host.com/avatar.jpg">' });
    const urls = extractCardImageUrls(card);
    expect([...urls]).toEqual(['https://host.com/avatar.jpg']);
  });

  it('extracts from the cacheable text fields', () => {
    const card = makeCard({
      description: '![a](https://a.com/1.png)',
      personality: '![b](https://b.com/2.png)',
      scenario: '<img src="https://c.com/3.jpg">',
      first_mes: '![d](https://d.com/4.png)',
      mes_example: '![e](https://e.com/5.png)',
      alternate_greetings: ['![i](https://i.com/9.png)', '<img src="https://j.com/10.jpg">'],
    });
    const urls = extractCardImageUrls(card);
    expect(urls.size).toBe(7);
  });

  it('ignores metadata fields that never reach the model', () => {
    // creator_notes is where CHUB keeps page furniture (banners, promo art).
    // Caching it would download a creator's page decoration for every user.
    const card = makeCard({
      description: '![a](https://a.com/1.png)',
      creator_notes: '![f](https://f.com/6.png)',
      system_prompt: '![g](https://g.com/7.png)',
      post_history_instructions: '![h](https://h.com/8.png)',
    });
    const urls = extractCardImageUrls(card);
    expect(urls.size).toBe(1);
    expect([...urls]).toEqual(['https://a.com/1.png']);
  });

  it('ignores placeholder src values that are not real URLs', () => {
    const card = makeCard({
      description: '<img src="URL"> <img src="image.png"> <img src="data:image/png;base64,AAAA">',
      first_mes: '![real](https://real.com/pic.png)',
    });
    const urls = extractCardImageUrls(card);
    expect(urls.size).toBe(1);
    expect([...urls]).toEqual(['https://real.com/pic.png']);
  });

  it('deduplicates identical URLs across fields', () => {
    const card = makeCard({
      description: '![a](https://x.com/img.png)',
      personality: '![b](https://x.com/img.png)',
    });
    const urls = extractCardImageUrls(card);
    expect(urls.size).toBe(1);
  });

  it('handles null/undefined fields gracefully', () => {
    const card = makeCard({ description: undefined, personality: null });
    const urls = extractCardImageUrls(card);
    expect(urls.size).toBe(0);
  });
});

describe('rewriteCharacterImageUrls', () => {
  it('returns cardData unchanged when imageMap is empty', () => {
    const card = makeCard({ description: '![a](https://x.com/img.png)' });
    const result = rewriteCharacterImageUrls(card, new Map());
    expect(result.data.description).toBe('![a](https://x.com/img.png)');
  });

  it('rewrites markdown image URLs', () => {
    const card = makeCard({ description: '![portrait](https://ex.com/pic.jpg)' });
    const map = new Map([['https://ex.com/pic.jpg', '/api/assets/characters/abc/def.jpg']]);
    rewriteCharacterImageUrls(card, map);
    expect(card.data.description).toBe('![portrait](/api/assets/characters/abc/def.jpg)');
  });

  it('rewrites HTML img src URLs', () => {
    const card = makeCard({ personality: '<img src="https://ex.com/ava.png">' });
    const map = new Map([['https://ex.com/ava.png', '/api/assets/characters/xyz/aaa.png']]);
    rewriteCharacterImageUrls(card, map);
    expect(card.data.personality).toBe('<img src="/api/assets/characters/xyz/aaa.png">');
  });

  it('rewrites the same URL everywhere', () => {
    const card = makeCard({
      description: '![a](https://ex.com/img.png)',
      personality: '![b](https://ex.com/img.png)',
    });
    const map = new Map([['https://ex.com/img.png', '/api/assets/abc/img.png']]);
    rewriteCharacterImageUrls(card, map);
    expect(card.data.description).toContain('/api/assets/abc/img.png');
    expect(card.data.personality).toContain('/api/assets/abc/img.png');
  });

  it('rewrites URLs in alternate greetings', () => {
    const card = makeCard({
      alternate_greetings: ['Hello ![img](https://ex.com/greet1.png)'],
    });
    const map = new Map([['https://ex.com/greet1.png', '/api/assets/abc/g1.png']]);
    rewriteCharacterImageUrls(card, map);
    expect(card.data.alternate_greetings[0]).toContain('/api/assets/abc/g1.png');
  });

  it('handles URLs with special regex characters', () => {
    const card = makeCard({ description: '![a](https://ex.com/pic+(1).jpg)' });
    const map = new Map([['https://ex.com/pic+(1).jpg', '/api/assets/abc/pic.jpg']]);
    rewriteCharacterImageUrls(card, map);
    expect(card.data.description).toBe('![a](/api/assets/abc/pic.jpg)');
  });

  it('returns early when cardData has no data sub-object', () => {
    const card = { spec: 'v2' };
    const result = rewriteCharacterImageUrls(card, new Map([['x', 'y']]));
    expect(result).toBe(card);
  });
});

describe('extractLorebookImageUrls', () => {
  function makeLorebook(entries = [], description = '') {
    return {
      name: 'Test Lorebook',
      description,
      entries,
    };
  }

  it('returns empty set for lorebook with no images', () => {
    const lorebook = makeLorebook([{ content: 'plain text' }]);
    expect([...extractLorebookImageUrls(lorebook)]).toEqual([]);
  });

  it('extracts markdown image URLs from entry content', () => {
    const lorebook = makeLorebook([{ content: '![dragon](https://ex.com/dragon.png)' }]);
    const urls = extractLorebookImageUrls(lorebook);
    expect([...urls]).toEqual(['https://ex.com/dragon.png']);
  });

  it('extracts HTML img src URLs from entry content', () => {
    const lorebook = makeLorebook([{ content: '<img src="https://host.com/creature.jpg">' }]);
    const urls = extractLorebookImageUrls(lorebook);
    expect([...urls]).toEqual(['https://host.com/creature.jpg']);
  });

  it('extracts URLs from entry comment fields', () => {
    const lorebook = makeLorebook([
      {
        content: 'just text',
        comment: 'see ![map](https://ex.com/map.png)',
      },
    ]);
    const urls = extractLorebookImageUrls(lorebook);
    expect([...urls]).toEqual(['https://ex.com/map.png']);
  });

  it('extracts URLs from lorebook description', () => {
    const lorebook = makeLorebook([], 'Cover image: ![cover](https://ex.com/cover.jpg)');
    const urls = extractLorebookImageUrls(lorebook);
    expect([...urls]).toEqual(['https://ex.com/cover.jpg']);
  });

  it('extracts from multiple entries and deduplicates', () => {
    const lorebook = makeLorebook([
      { content: '![a](https://ex.com/img.png)' },
      { content: '![b](https://ex.com/img.png)' },
      { content: '![c](https://ex.com/other.png)' },
    ]);
    const urls = extractLorebookImageUrls(lorebook);
    expect(urls.size).toBe(2);
  });

  it('handles lorebook with no entries', () => {
    const lorebook = makeLorebook([]);
    expect([...extractLorebookImageUrls(lorebook)]).toEqual([]);
  });

  it('handles null/undefined lorebook gracefully', () => {
    expect([...extractLorebookImageUrls(null)]).toEqual([]);
    expect([...extractLorebookImageUrls(undefined)]).toEqual([]);
  });
});

describe('rewriteLorebookImageUrls', () => {
  function makeLorebook(entries = [], description = '') {
    return {
      name: 'Test Lorebook',
      description,
      entries,
    };
  }

  it('returns lorebookData unchanged when imageMap is empty', () => {
    const lorebook = makeLorebook([{ content: '![a](https://x.com/img.png)' }]);
    const result = rewriteLorebookImageUrls(lorebook, new Map());
    expect(result.entries[0].content).toBe('![a](https://x.com/img.png)');
  });

  it('rewrites URLs in entry content', () => {
    const lorebook = makeLorebook([{ content: '![dragon](https://ex.com/dragon.png)' }]);
    const map = new Map([['https://ex.com/dragon.png', '/api/assets/lorebooks/abc/def.webp']]);
    rewriteLorebookImageUrls(lorebook, map);
    expect(lorebook.entries[0].content).toBe('![dragon](/api/assets/lorebooks/abc/def.webp)');
  });

  it('rewrites URLs in entry comment', () => {
    const lorebook = makeLorebook([
      {
        content: 'plain',
        comment: 'see ![map](https://ex.com/map.png)',
      },
    ]);
    const map = new Map([['https://ex.com/map.png', '/api/assets/lorebooks/x/y.webp']]);
    rewriteLorebookImageUrls(lorebook, map);
    expect(lorebook.entries[0].comment).toContain('/api/assets/lorebooks/x/y.webp');
  });

  it('rewrites URLs in lorebook description', () => {
    const lorebook = makeLorebook([{ content: 'text' }], 'Cover: ![c](https://ex.com/cover.jpg)');
    const map = new Map([['https://ex.com/cover.jpg', '/api/assets/lorebooks/z/cover.webp']]);
    rewriteLorebookImageUrls(lorebook, map);
    expect(lorebook.description).toContain('/api/assets/lorebooks/z/cover.webp');
  });

  it('returns early when lorebookData has no entries', () => {
    const lorebook = { name: 'Empty' };
    const result = rewriteLorebookImageUrls(lorebook, new Map([['x', 'y']]));
    expect(result).toBe(lorebook);
  });
});

describe('cacheLorebookImages (mocked fetch + fs)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(AssetManager.prototype, 'readMetadata').mockResolvedValue({ images: [] });
    vi.spyOn(AssetManager.prototype, 'ensureDir').mockResolvedValue('/fake/dir');
    vi.spyOn(AssetManager.prototype, 'writeFileOnly').mockResolvedValue(undefined);
    vi.spyOn(AssetManager.prototype, 'writeMetadata').mockResolvedValue(undefined);
    vi.spyOn(AssetManager.prototype, 'assetPath').mockReturnValue('/fake/file.png');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns an empty map when lorebook has no images', async () => {
    const lorebook = { name: 'Empty', entries: [{ content: 'no images' }] };
    const result = await cacheLorebookImages('lb-1', lorebook, '/fake/data');
    expect(result.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloads and caches images from entry content', async () => {
    const pngBuffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      body: {
        getReader() {
          let done = false;
          return {
            read() {
              if (done) return Promise.resolve({ done: true });
              done = true;
              return Promise.resolve({ done: false, value: new Uint8Array(pngBuffer) });
            },
            cancel() {},
          };
        },
      },
    });

    const lorebook = {
      name: 'Test Lorebook',
      entries: [{ content: '![dragon](https://remote.com/dragon.png)' }],
    };
    const result = await cacheLorebookImages('lb-1', lorebook, '/fake/data');

    expect(result.size).toBe(1);
    const localUrl = result.get('https://remote.com/dragon.png');
    expect(localUrl).toMatch(/^\/api\/assets\/lorebooks\/lb-1\/[a-f0-9]+\.png$/);
    expect(fetch).toHaveBeenCalledTimes(1);
    // Mirrors cacheCharacterImages: caching alone does not mutate the data.
    expect(lorebook.entries[0].content).toBe('![dragon](https://remote.com/dragon.png)');
  });

  it('skips already-cached images', async () => {
    vi.spyOn(AssetManager.prototype, 'readMetadata').mockResolvedValue({
      images: [{ originalUrl: 'https://remote.com/dragon.png', hash: 'abc', filename: 'abc.png' }],
    });

    const lorebook = {
      name: 'Cached Lorebook',
      entries: [{ content: '![x](https://remote.com/dragon.png)' }],
    };
    const result = await cacheLorebookImages('lb-1', lorebook, '/fake/data');
    expect(result.size).toBe(1);
    expect(result.get('https://remote.com/dragon.png')).toBe('/api/assets/lorebooks/lb-1/abc.png');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not fail on download errors', async () => {
    fetch.mockRejectedValue(new Error('Network error'));
    const lorebook = {
      name: 'Fail Lorebook',
      entries: [{ content: '![x](https://remote.com/pic.png)' }],
    };
    const result = await cacheLorebookImages('lb-1', lorebook, '/fake/data');
    expect(result.size).toBe(0);
  });
});

// Hostnames are checked at connect time inside safe-fetch's guarded lookup,
// which these tests replace by stubbing fetch — see safe-fetch.test.js for
// those. What is testable here is what the cacher refuses before connecting.
describe('SSRF protection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(AssetManager.prototype, 'readMetadata').mockResolvedValue({ images: [] });
    vi.spyOn(AssetManager.prototype, 'writeFileOnly').mockResolvedValue(undefined);
    vi.spyOn(AssetManager.prototype, 'writeMetadata').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Character cards are untrusted and WG is usually self-hosted on a private
  // network, so an imported card must never make the server reach inward.
  const blocked = [
    ['loopback', 'http://127.0.0.1/pic.png'],
    ['RFC1918 10/8', 'http://10.0.0.5/pic.png'],
    ['RFC1918 192.168/16', 'http://192.168.1.1/pic.png'],
    ['RFC1918 172.16/12', 'http://172.20.10.1/pic.png'],
    ['cloud metadata', 'http://169.254.169.254/pic.png'],
    ['CGNAT', 'http://100.64.0.1/pic.png'],
    ['numeric loopback', 'http://2130706433/pic.png'],
    ['IPv6 loopback', 'http://[::1]/pic.png'],
    ['IPv6 unique local', 'http://[fd00::1]/pic.png'],
    ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/pic.png'],
  ];

  for (const [label, url] of blocked) {
    it(`refuses a literal ${label} address`, async () => {
      const card = makeCard({ description: `![x](${url})` });
      const result = await cacheCharacterImages('c-1', card, '/fake/data');

      expect(result.size).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    });
  }

  it('fetches a public host', async () => {
    fetch.mockResolvedValue(makePngResponse());

    const card = makeCard({ description: '![x](https://public.example/pic.png)' });
    const result = await cacheCharacterImages('c-1', card, '/fake/data');

    expect(result.size).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('re-validates redirect targets, blocking a public host that redirects inward', async () => {
    fetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }),
    );

    const card = makeCard({ description: '![x](https://public.example/pic.png)' });
    const result = await cacheCharacterImages('c-1', card, '/fake/data');

    expect(result.size).toBe(0);
    // The redirect was followed but the second hop was never fetched.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('caches nothing when the connection guard refuses the host', async () => {
    const refused = new Error('Refusing to connect to internal.example');
    refused.code = 'EBLOCKEDADDRESS';
    fetch.mockRejectedValue(new TypeError('fetch failed', { cause: refused }));

    const card = makeCard({ description: '![x](https://internal.example/pic.png)' });
    const result = await cacheCharacterImages('c-1', card, '/fake/data');

    expect(result.size).toBe(0);
  });
});

describe('cacheAndRewriteLorebookImages', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(AssetManager.prototype, 'readMetadata').mockResolvedValue({
      images: [{ originalUrl: 'https://remote.com/dragon.png', hash: 'abc', filename: 'abc.png' }],
    });
    vi.spyOn(AssetManager.prototype, 'writeMetadata').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('rewrites URLs in place and reports how many were rewritten', async () => {
    const lorebook = {
      name: 'Rewrite Me',
      entries: [{ content: '![x](https://remote.com/dragon.png)' }],
    };

    const count = await cacheAndRewriteLorebookImages('lb-1', lorebook, '/fake/data');

    expect(count).toBe(1);
    expect(lorebook.entries[0].content).toBe('![x](/api/assets/lorebooks/lb-1/abc.png)');
  });

  it('is non-fatal when caching throws, leaving data untouched', async () => {
    vi.spyOn(AssetManager.prototype, 'readMetadata').mockRejectedValue(new Error('disk on fire'));
    const lorebook = {
      name: 'Boom',
      entries: [{ content: '![x](https://remote.com/dragon.png)' }],
    };

    const count = await cacheAndRewriteLorebookImages('lb-1', lorebook, '/fake/data');

    expect(count).toBe(0);
    expect(lorebook.entries[0].content).toBe('![x](https://remote.com/dragon.png)');
  });
});

describe('cacheCharacterImages (mocked fetch + fs)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(AssetManager.prototype, 'readMetadata').mockResolvedValue({ images: [] });
    vi.spyOn(AssetManager.prototype, 'ensureDir').mockResolvedValue('/fake/dir');
    vi.spyOn(AssetManager.prototype, 'writeFileOnly').mockResolvedValue(undefined);
    vi.spyOn(AssetManager.prototype, 'writeMetadata').mockResolvedValue(undefined);
    vi.spyOn(AssetManager.prototype, 'assetPath').mockReturnValue('/fake/file.png');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns empty map when card has no images', async () => {
    const card = makeCard({ description: 'no images' });
    const result = await cacheCharacterImages('char-1', card, '/fake/data');
    expect(result.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('downloads and caches a single markdown image', async () => {
    const pngBuffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/png' },
      body: {
        getReader() {
          let done = false;
          return {
            read() {
              if (done) return Promise.resolve({ done: true });
              done = true;
              return Promise.resolve({
                done: false,
                value: new Uint8Array(pngBuffer),
              });
            },
            cancel() {},
          };
        },
      },
    });

    const card = makeCard({ description: '![x](https://remote.com/pic.png)' });
    const result = await cacheCharacterImages('char-1', card, '/fake/data');

    expect(result.size).toBe(1);
    const localUrl = result.get('https://remote.com/pic.png');
    expect(localUrl).toMatch(/^\/api\/assets\/characters\/char-1\/[a-f0-9]+\.png$/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(AssetManager.prototype.writeMetadata).toHaveBeenCalledTimes(1);
  });

  it('skips already-cached images', async () => {
    vi.spyOn(AssetManager.prototype, 'readMetadata').mockResolvedValue({
      images: [{ originalUrl: 'https://remote.com/pic.png', hash: 'abc', filename: 'abc.png' }],
    });

    const card = makeCard({ description: '![x](https://remote.com/pic.png)' });
    const result = await cacheCharacterImages('char-1', card, '/fake/data');

    expect(result.size).toBe(1);
    expect(result.get('https://remote.com/pic.png')).toBe('/api/assets/characters/char-1/abc.png');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not fail on download errors', async () => {
    fetch.mockRejectedValue(new Error('Network error'));
    const card = makeCard({ description: '![x](https://remote.com/pic.png)' });
    const result = await cacheCharacterImages('char-1', card, '/fake/data');
    expect(result.size).toBe(0);
  });

  it('handles non-image Content-Type gracefully', async () => {
    fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      body: {
        getReader() {
          let done = false;
          return {
            read() {
              if (done) return Promise.resolve({ done: true });
              done = true;
              return Promise.resolve({ done: false, value: new Uint8Array(Buffer.from('x')) });
            },
            cancel() {},
          };
        },
      },
    });
    const card = makeCard({ description: '![x](https://remote.com/not-img)' });
    const result = await cacheCharacterImages('char-1', card, '/fake/data');
    expect(result.size).toBe(0);
  });

  it('rejects non-HTTP URLs', async () => {
    const card = makeCard({ description: '![x](ftp://example.com/img.png)' });
    const result = await cacheCharacterImages('char-1', card, '/fake/data');
    expect(result.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects malformed URLs', async () => {
    const card = makeCard({ description: '![x](not a url)' });
    const result = await cacheCharacterImages('char-1', card, '/fake/data');
    expect(result.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects empty or null URLs', async () => {
    const card = makeCard({ description: '![](  )' });
    const result = await cacheCharacterImages('char-1', card, '/fake/data');
    expect(result.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('AssetManager (interface)', () => {
  it('provides all expected methods', () => {
    expect(typeof AssetManager.prototype.ensureDir).toBe('function');
    expect(typeof AssetManager.prototype.writeAsset).toBe('function');
    expect(typeof AssetManager.prototype.readAsset).toBe('function');
    expect(typeof AssetManager.prototype.deleteDir).toBe('function');
    expect(typeof AssetManager.prototype.readMetadata).toBe('function');
    expect(typeof AssetManager.prototype.writeMetadata).toBe('function');
  });
});
