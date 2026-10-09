/**
 * Tests for Safe Fetch
 *
 * Uses the real undici (unmocked here, unlike every other suite) so the
 * connection guard is exercised against a real local server.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import dns from 'dns';
import http from 'http';
import { isBlockedAddress, guardedLookup, safeFetch, readBodyWithLimit } from '../safe-fetch.js';

vi.unmock('undici');

/** Stub dns.lookup to answer every query with the given addresses. */
function stubDns(addresses) {
  return vi.spyOn(dns, 'lookup').mockImplementation((_hostname, _options, callback) => {
    callback(null, addresses);
  });
}

/** guardedLookup as a promise: resolves with the callback's arguments. */
function lookup(hostname, options) {
  return new Promise((resolve, reject) => {
    guardedLookup(hostname, options, (err, ...result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

describe('isBlockedAddress', () => {
  const blocked = [
    ['loopback', '127.0.0.1'],
    ['"this" network', '0.0.0.0'],
    ['RFC1918 10/8', '10.1.2.3'],
    ['RFC1918 172.16/12', '172.31.255.255'],
    ['RFC1918 192.168/16', '192.168.0.1'],
    ['cloud metadata', '169.254.169.254'],
    ['CGNAT', '100.100.0.1'],
    ['benchmarking', '198.18.0.1'],
    ['multicast', '239.1.1.1'],
    ['broadcast', '255.255.255.255'],
    ['IPv6 unspecified', '::'],
    ['IPv6 loopback', '::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 unique local', 'fd12:3456::1'],
    ['IPv6 multicast', 'ff02::1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped loopback, hex form', '::ffff:7f00:1'],
    ['IPv4-compatible loopback', '::127.0.0.1'],
    ['NAT64 of RFC1918', '64:ff9b::a00:1'],
    ['NAT64 of cloud metadata', '64:ff9b::a9fe:a9fe'],
    ['6to4 of loopback', '2002:7f00:1::1'],
    ['6to4 of RFC1918', '2002:c0a8:101::1'],
    ['not an IP', 'example.com'],
  ];

  for (const [label, ip] of blocked) {
    it(`blocks ${label} (${ip})`, () => {
      expect(isBlockedAddress(ip)).toBe(true);
    });
  }

  const allowed = [
    ['public IPv4', '93.184.216.34'],
    ['just outside 172.16/12', '172.32.0.1'],
    ['just outside CGNAT', '100.128.0.1'],
    ['public IPv6', '2606:2800:220:1:248:1893:25c8:1946'],
    ['IPv4-mapped public', '::ffff:93.184.216.34'],
    ['NAT64 of public', '64:ff9b::5db8:d822'],
    ['6to4 of public', '2002:5db8:d822::1'],
  ];

  for (const [label, ip] of allowed) {
    it(`allows ${label} (${ip})`, () => {
      expect(isBlockedAddress(ip)).toBe(false);
    });
  }
});

describe('guardedLookup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes public addresses through when all addresses are asked for', async () => {
    const addresses = [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ];
    stubDns(addresses);

    expect(await lookup('public.example', { all: true })).toEqual([addresses]);
  });

  it('returns a single address and family when one address is asked for', async () => {
    stubDns([{ address: '93.184.216.34', family: 4 }]);

    expect(await lookup('public.example', {})).toEqual(['93.184.216.34', 4]);
  });

  it('refuses a host where any address is private', async () => {
    stubDns([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);

    await expect(lookup('mixed.example', { all: true })).rejects.toMatchObject({
      code: 'EBLOCKEDADDRESS',
    });
  });

  it('refuses a host with no addresses', async () => {
    stubDns([]);

    await expect(lookup('empty.example', {})).rejects.toMatchObject({
      code: 'EBLOCKEDADDRESS',
    });
  });

  it('passes resolution errors through', async () => {
    const notFound = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    vi.spyOn(dns, 'lookup').mockImplementation((_hostname, _options, callback) => {
      callback(notFound);
    });

    await expect(lookup('nope.invalid', {})).rejects.toBe(notFound);
  });
});

describe('safeFetch (real connections)', () => {
  let server;
  let port;
  let requests = 0;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      requests++;
      res.end('internal secret');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  afterEach(() => {
    requests = 0;
    vi.restoreAllMocks();
  });

  // DNS rebinding: whatever a hostname resolves to when the socket connects is
  // what gets checked, so a host that answered "public" to some earlier lookup
  // still cannot connect inward.
  it('refuses a hostname that resolves to loopback at connect time', async () => {
    const lookupSpy = stubDns([{ address: '127.0.0.1', family: 4 }]);

    await expect(safeFetch(`http://rebind.example:${port}/`)).rejects.toMatchObject({
      code: 'EBLOCKEDADDRESS',
    });
    expect(lookupSpy).toHaveBeenCalled();
    expect(requests).toBe(0);
  });

  it('refuses a literal loopback address without resolving it', async () => {
    const lookupSpy = vi.spyOn(dns, 'lookup');

    await expect(safeFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow('non-public address');
    expect(lookupSpy).not.toHaveBeenCalled();
    expect(requests).toBe(0);
  });

  it('refuses a literal IPv6 loopback address', async () => {
    await expect(safeFetch(`http://[::1]:${port}/`)).rejects.toThrow('non-public address');
  });

  it('refuses non-HTTP URLs', async () => {
    await expect(safeFetch('file:///etc/passwd')).rejects.toThrow('non-HTTP');
  });

  it('refuses malformed URLs', async () => {
    await expect(safeFetch('not a url')).rejects.toThrow('Malformed URL');
  });
});

describe('readBodyWithLimit', () => {
  it('reads a body within the limit', async () => {
    const body = await readBodyWithLimit(new Response('hello'), 5);
    expect(body.toString()).toBe('hello');
  });

  it('refuses a body that streams past the limit', async () => {
    await expect(readBodyWithLimit(new Response('hello!'), 5)).rejects.toThrow(
      'Response larger than 5 bytes',
    );
  });

  it('refuses up front when Content-Length is over the limit', async () => {
    const response = new Response('hi', { headers: { 'content-length': '1000' } });
    await expect(readBodyWithLimit(response, 5)).rejects.toThrow('Response larger than 5 bytes');
  });

  it('returns an empty buffer for a response with no body', async () => {
    const body = await readBodyWithLimit(new Response(null, { status: 204 }), 5);
    expect(body.length).toBe(0);
  });
});
