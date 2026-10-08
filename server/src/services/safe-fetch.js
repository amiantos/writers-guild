/**
 * Safe Fetch
 *
 * fetch() for URLs that come from untrusted input — character cards,
 * lorebooks, CHUB metadata, import-by-URL. Writers Guild is typically
 * self-hosted on a home or private network, so none of these may make the
 * server reach internal services or cloud metadata endpoints.
 *
 * The address check runs inside the socket's own DNS lookup, so the address
 * that is checked is the address that gets connected to. Resolving first and
 * fetching afterwards would resolve twice, and a hostname with a short TTL
 * can answer the two lookups differently (DNS rebinding).
 */

import dns from 'dns';
import net from 'net';
import { Agent, fetch } from 'undici';

const DEFAULT_MAX_REDIRECTS = 3;

// ── Address policy ────────────────────────────────────────────────────

const IPV4_BLOCKED = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // RFC1918
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local + cloud metadata
  ['172.16.0.0', 12], // RFC1918
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // RFC1918
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 3], // multicast, reserved, broadcast
];

const IPV6_BLOCKED = [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['64:ff9b:1::', 48], // local-use NAT64
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
];

const blockList = new net.BlockList();

for (const [address, prefix] of IPV4_BLOCKED) {
  blockList.addSubnet(address, prefix, 'ipv4');

  // NAT64 and 6to4 carry an IPv4 address inside an IPv6 one, so block the
  // IPv6 forms of each private range too. (IPv4-mapped ::ffff:a.b.c.d needs
  // nothing extra: BlockList checks it against the IPv4 rules itself.)
  const [a, b, c, d] = address.split('.').map(Number);
  const hi = ((a << 8) | b).toString(16);
  const lo = ((c << 8) | d).toString(16);
  blockList.addSubnet(`64:ff9b::${hi}:${lo}`, 96 + prefix, 'ipv6');
  blockList.addSubnet(`2002:${hi}:${lo}::`, 16 + prefix, 'ipv6');
}

for (const [address, prefix] of IPV6_BLOCKED) {
  blockList.addSubnet(address, prefix, 'ipv6');
}

/**
 * True if an IP address is one we must never connect to. Anything that is not
 * a valid IP address is blocked.
 *
 * @param {string} ip
 * @returns {boolean}
 */
export function isBlockedAddress(ip) {
  const family = net.isIP(ip);
  if (family === 0) return true;
  return blockList.check(ip, family === 6 ? 'ipv6' : 'ipv4');
}

// ── Connection guard ──────────────────────────────────────────────────

/**
 * A `lookup` for net/tls.connect that refuses hostnames resolving to any
 * blocked address. Node calls it with `all: true` when it races IPv4 and IPv6
 * (autoSelectFamily, on by default), so both callback shapes are honoured.
 */
export function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);

    const blocked = addresses.find(({ address }) => isBlockedAddress(address));
    if (!addresses.length || blocked) {
      const error = new Error(
        `Refusing to connect to ${hostname}: resolves to non-public address ${blocked?.address ?? '(none)'}`,
      );
      error.code = 'EBLOCKEDADDRESS';
      return callback(error);
    }

    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

// Hostname lookups never reach this for IP literals — net.connect skips
// `lookup` entirely for those — so safeFetch checks literals itself.
const guardedAgent = new Agent({ connect: { lookup: guardedLookup } });

/**
 * Validate a URL before each hop: http(s), and not a literal blocked address.
 * Hostnames are checked at connect time by guardedLookup.
 *
 * @param {string} url
 * @returns {URL}
 */
function assertFetchableUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Malformed URL: ${url}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refusing non-HTTP URL: ${url}`);
  }

  // IPv6 literals keep their brackets in URL.hostname.
  const host = parsed.hostname.replace(/^\[(.*)\]$/, '$1');
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new Error(`Refusing to connect to non-public address ${host}`);
  }

  return parsed;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * fetch() an untrusted URL. Refuses non-HTTP URLs and any connection to a
 * private, loopback, link-local or otherwise non-public address, on every
 * redirect hop.
 *
 * Resolves with the final non-redirect Response, whatever its status — check
 * `response.ok` as with fetch. Rejects if the URL is refused, a redirect is
 * malformed, there are too many redirects, or the request fails.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {Record<string, string>} [options.headers]
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.maxRedirects]
 * @returns {Promise<Response>}
 */
export async function safeFetch(url, options = {}) {
  const { headers, signal, maxRedirects = DEFAULT_MAX_REDIRECTS } = options;
  let currentUrl = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    assertFetchableUrl(currentUrl);

    let response;
    try {
      response = await fetch(currentUrl, {
        dispatcher: guardedAgent,
        redirect: 'manual',
        headers,
        signal,
      });
    } catch (err) {
      // undici reports connection failures as TypeError('fetch failed') with
      // the useful error, including a refused address, as its cause.
      if (err.name === 'TypeError' && err.cause instanceof Error) {
        throw err.cause;
      }
      throw err;
    }

    if (!(response.status >= 300 && response.status < 400)) {
      return response;
    }

    // Redirects are followed by hand so that every hop is re-validated.
    await response.body?.cancel();
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`Redirect with no Location header from ${currentUrl}`);
    }
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error(`Too many redirects fetching ${url}`);
}

/**
 * Read a response body into a Buffer, refusing to buffer more than maxBytes.
 *
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
export async function readBodyWithLimit(response, maxBytes) {
  const tooLarge = () => new Error(`Response larger than ${maxBytes} bytes`);

  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) {
    await response.body?.cancel();
    throw tooLarge();
  }

  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}
