/**
 * Image Cacher Service
 *
 * Scans character card text fields for external image URLs (Markdown and HTML),
 * downloads them, stores them locally via AssetManager with content-hash filenames,
 * and rewrites the card data to reference the local paths.
 *
 * Used during character import/create/update to build a local gallery.
 */

import crypto from 'crypto';
import sharp from 'sharp';
import { AssetManager } from './asset-manager.js';
import { safeFetch, readBodyWithLimit } from './safe-fetch.js';
import { MARKDOWN_IMAGE_RE, HTML_IMAGE_RE } from '../../../shared/regex-patterns.js';
import { IMAGE_MIME_TYPES_MAP, mimeTypeToExt } from '../../../shared/mime-types.js';

// ── Configuration ─────────────────────────────────────────────────────

const DOWNLOAD_TIMEOUT_MS = 15_000; // 15 s per image
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_CONCURRENT_DOWNLOADS = 3;
const MAX_REDIRECTS = 3;

/**
 * Card fields that are cached.
 *
 * Deliberately excludes creator_notes, system_prompt and
 * post_history_instructions: creator_notes in particular is where CHUB puts
 * page furniture (banners, dividers, creator self-promo), and none of these
 * reach the model, so caching their images is pure storage cost.
 */
const CACHEABLE_CARD_FIELDS = [
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
];

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hex digest of a buffer.
 */
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Extract all image URLs (Markdown and HTML) from a single text string.
 * Returns a Set of unique URLs.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
function extractImageUrls(text) {
  const urls = new Set();

  if (!text || typeof text !== 'string') return urls;

  // Markdown: ![alt](url)
  let m;
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  while ((m = MARKDOWN_IMAGE_RE.exec(text)) !== null) {
    if (isHttpUrl(m[2])) urls.add(m[2]); // capture group 2 is the URL
  }

  // HTML: <img src="..." ...>
  HTML_IMAGE_RE.lastIndex = 0;
  while ((m = HTML_IMAGE_RE.exec(text)) !== null) {
    const tag = m[0];
    // Extract src attribute
    const srcMatch = tag.match(/src\s*=\s*["']([^"']+)["']/i);
    // Cards frequently contain placeholder src values ("URL", "image.png",
    // data: URIs). Filtering here keeps the "found N images" count honest.
    if (srcMatch && isHttpUrl(srcMatch[1])) {
      urls.add(srcMatch[1]);
    }
  }

  return urls;
}

/**
 * Collect all image URLs from every text field of a character card.
 *
 * @param {object} cardData  — normalized V2 card data (has .data sub-object)
 * @returns {Set<string>}
 */
function collectAllImageUrls(cardData) {
  const data = cardData?.data;
  if (!data) return new Set();

  const fields = [
    ...CACHEABLE_CARD_FIELDS.map((f) => data[f]),
    ...(Array.isArray(data.alternate_greetings) ? data.alternate_greetings : []),
  ];

  const all = new Set();
  for (const field of fields) {
    for (const url of extractImageUrls(field)) {
      all.add(url);
    }
  }
  return all;
}

/**
 * Collect all image URLs from a lorebook's entry content fields.
 *
 * @param {object} lorebookData  — lorebook with .entries[].content fields
 * @returns {Set<string>}
 */
function collectLorebookImageUrls(lorebookData) {
  if (!lorebookData?.entries || !Array.isArray(lorebookData.entries)) {
    return new Set();
  }

  const all = new Set();

  // Scan entry content and comment fields
  for (const entry of lorebookData.entries) {
    if (entry.content) {
      for (const url of extractImageUrls(entry.content)) {
        all.add(url);
      }
    }
    if (entry.comment) {
      for (const url of extractImageUrls(entry.comment)) {
        all.add(url);
      }
    }
  }

  // Also scan lorebook description
  if (lorebookData.description) {
    for (const url of extractImageUrls(lorebookData.description)) {
      all.add(url);
    }
  }

  return all;
}

/**
 * Cheap, quiet check that a string is an http(s) URL with a hostname.
 * Used at extraction time to filter out placeholder src values.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
  } catch {
    return false;
  }
}

/**
 * Download a single image from a URL.
 *
 * Card URLs are untrusted, so this goes through safeFetch, which refuses
 * private and internal addresses on every redirect hop.
 *
 * @param {string} url
 * @returns {Promise<{ buffer: Buffer, mimeType: string } | null>}
 *   Returns null if the URL is refused, the download fails, or the content
 *   is not a valid image.
 */
async function downloadImage(url) {
  try {
    const response = await safeFetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      maxRedirects: MAX_REDIRECTS,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; WritersGuild/2.0)',
        Accept: 'image/*',
      },
    });

    if (!response.ok) {
      console.warn(`[ImageCacher] Download failed (${response.status}): ${url}`);
      await response.body?.cancel();
      return null;
    }

    // Validate Content-Type
    const contentType = response.headers.get('content-type') || '';
    const mimeType = contentType.split(';')[0].trim().toLowerCase();

    if (!IMAGE_MIME_TYPES_MAP[mimeType]) {
      console.warn(`[ImageCacher] Skipping non-image Content-Type "${mimeType}": ${url}`);
      await response.body?.cancel();
      return null;
    }

    const buffer = await readBodyWithLimit(response, MAX_IMAGE_SIZE_BYTES);
    return { buffer, mimeType };
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      console.warn(`[ImageCacher] Timeout downloading: ${url}`);
    } else {
      console.warn(`[ImageCacher] Error downloading ${url}: ${err.message}`);
    }
    return null;
  }
}

// ── Internal: generic caching pipeline ────────────────────────────────

/**
 * Internal: download, convert, and store images for any entity.
 *
 * @param {string}   entityId
 * @param {Set<string>} urls      — image URLs to cache
 * @param {string}   dataRoot
 * @param {string}   entityType   — 'characters' or 'lorebooks'
 * @param {string}   [label]      — human-readable label for log messages
 * @param {object}   [options]
 * @param {number}   [options.concurrency]
 * @param {(event: {phase: string, total?: number, completed?: number, url?: string, ok?: boolean, cached?: boolean}) => void} [options.onProgress]
 *   Called as work proceeds so callers can stream progress. Never throws into
 *   the pipeline — a failing reporter must not fail an import.
 * @returns {Promise<Map<string, string>>}
 */
async function cacheImageSet(entityId, urls, dataRoot, entityType, label, options = {}) {
  const assetManager = new AssetManager(dataRoot, entityType);
  const concurrency = options.concurrency ?? MAX_CONCURRENT_DOWNLOADS;

  // A broken progress reporter must never take an import down with it.
  // Every event carries the entity it belongs to, so a single import that
  // caches a character AND its embedded lorebook can be labelled per stage.
  const report = (event) => {
    if (!options.onProgress) return;
    try {
      options.onProgress({ entityType, label: label || entityId, ...event });
    } catch (err) {
      console.warn(`[ImageCacher] progress reporter threw: ${err.message}`);
    }
  };

  if (urls.size === 0) {
    report({ phase: 'none', total: 0, completed: 0 });
    return new Map();
  }

  console.log(
    `[ImageCacher] Found ${urls.size} external image(s) in ${entityType.slice(0, -1)} "${label || entityId}"`,
  );

  const meta = await assetManager.readMetadata(entityId);
  const cachedUrls = new Set(meta.images.map((i) => i.originalUrl));
  const newEntries = [];
  const urlArray = [...urls];
  const imageMap = new Map();

  let completed = 0;
  let failed = 0;
  report({ phase: 'start', total: urlArray.length, completed: 0 });

  for (let i = 0; i < urlArray.length; i += concurrency) {
    const batch = urlArray.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (url) => {
        if (cachedUrls.has(url)) {
          const existing = meta.images.find((img) => img.originalUrl === url);
          if (existing) {
            imageMap.set(url, `/api/assets/${entityType}/${entityId}/${existing.filename}`);
          }
          report({
            phase: 'image',
            completed: ++completed,
            total: urlArray.length,
            url,
            ok: true,
            alreadyCached: true,
          });
          return;
        }

        const result = await downloadImage(url);
        if (!result) {
          console.warn(`[ImageCacher] Could not cache image: ${url}`);
          failed++;
          report({
            phase: 'image',
            completed: ++completed,
            total: urlArray.length,
            url,
            ok: false,
          });
          return;
        }

        const { buffer, mimeType } = result;

        let finalBuffer = buffer;
        let finalMimeType = mimeType;
        if (['image/jpeg', 'image/jpg', 'image/png', 'image/gif'].includes(mimeType)) {
          try {
            finalBuffer = await sharp(buffer).webp({ animated: true }).toBuffer();
            finalMimeType = 'image/webp';
          } catch (err) {
            console.warn(`[ImageCacher] WebP conversion failed for ${url}: ${err.message}`);
          }
        }

        const hash = sha256(finalBuffer);
        const ext = mimeTypeToExt(finalMimeType);
        const filename = `${hash}.${ext}`;
        const localPath = `/api/assets/${entityType}/${entityId}/${filename}`;

        await assetManager.writeFileOnly(entityId, filename, finalBuffer);
        newEntries.push({ originalUrl: url, hash, filename, mimeType: finalMimeType });
        imageMap.set(url, localPath);
        report({
          phase: 'image',
          completed: ++completed,
          total: urlArray.length,
          url,
          ok: true,
          alreadyCached: false,
        });
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[ImageCacher] Unexpected error in download batch:', result.reason);
        // The per-image report never ran for a thrown batch entry.
        failed++;
        report({ phase: 'image', completed: ++completed, total: urlArray.length, ok: false });
      }
    }
  }

  if (newEntries.length > 0) {
    const allImages = [...meta.images, ...newEntries];
    await assetManager.writeMetadata(entityId, { images: allImages });
  }

  console.log(
    `[ImageCacher] Cached ${imageMap.size}/${urls.size} image(s) for ${entityType.slice(0, -1)} "${label || entityId}"`,
  );
  // cachedCount, not `cached` — per-image events use alreadyCached as a
  // boolean, and reusing one key for both a flag and a count invites
  // `if (event.cached)` bugs where a count of 0 reads as false.
  report({ phase: 'done', total: urlArray.length, completed, cachedCount: imageMap.size, failed });
  return imageMap;
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Download all external images referenced in a character card, store them
 * locally via AssetManager, and return a mapping of original URL → local path.
 *
 * Only downloads images that are not already cached (by checking metadata).
 * Does NOT modify cardData — call rewriteCharacterImageUrls() separately.
 *
 * @param {string}   characterId
 * @param {object}   cardData   — normalized V2 card data
 * @param {string}   dataRoot   — resolved data root path
 * @param {object}   [options]
 * @param {number}   [options.concurrency]  — max parallel downloads (default 3)
 * @returns {Promise<Map<string, string>>}
 *   Map where key = original URL, value = local path (e.g. "/api/assets/characters/{id}/{hash}.jpg")
 */
export async function cacheCharacterImages(characterId, cardData, dataRoot, options = {}) {
  const urls = collectAllImageUrls(cardData);
  const label = cardData.data?.name || characterId;
  return cacheImageSet(characterId, urls, dataRoot, 'characters', label, options);
}

/**
 * Download all external images referenced in a lorebook's entry content,
 * store them locally, and return a mapping of original URL → local path.
 *
 * Mirrors cacheCharacterImages: does NOT modify lorebookData and does NOT
 * save — call rewriteLorebookImageUrls() and persist separately, so both
 * entity types follow the same cache → rewrite → save order.
 *
 * @param {string}   lorebookId
 * @param {object}   lorebookData  — lorebook with .entries[].content fields
 * @param {string}   dataRoot
 * @param {object}   [options]
 * @param {number}   [options.concurrency]
 * @returns {Promise<Map<string, string>>}
 *   Map where key = original URL, value = local path (e.g. "/api/assets/lorebooks/{id}/{hash}.webp")
 */
export async function cacheLorebookImages(lorebookId, lorebookData, dataRoot, options = {}) {
  const urls = collectLorebookImageUrls(lorebookData);
  const label = lorebookData?.name || lorebookId;
  return cacheImageSet(lorebookId, urls, dataRoot, 'lorebooks', label, options);
}

/**
 * Cache a lorebook's external images and rewrite its URLs in place.
 *
 * Non-fatal: an import must still succeed if image caching fails, in which
 * case the original external URLs are left untouched. Callers must persist
 * lorebookData AFTER calling this, so the rewritten URLs are what gets saved.
 *
 * @param {string} lorebookId
 * @param {object} lorebookData — mutated in place
 * @param {string} dataRoot
 * @returns {Promise<number>} number of image URLs rewritten
 */
export async function cacheAndRewriteLorebookImages(
  lorebookId,
  lorebookData,
  dataRoot,
  onProgress,
) {
  try {
    const imageMap = await cacheLorebookImages(lorebookId, lorebookData, dataRoot, { onProgress });
    if (imageMap.size > 0) {
      rewriteLorebookImageUrls(lorebookData, imageMap);
      console.log(`[ImageCacher] Rewrote ${imageMap.size} image URL(s) in lorebook ${lorebookId}`);
    }
    return imageMap.size;
  } catch (error) {
    console.error(`[ImageCacher] Failed to cache images for lorebook ${lorebookId}:`, error);
    return 0;
  }
}

// One compiled pattern per imageMap. Rewriting runs over every card field and
// every lorebook entry, so building the regex per field meant hundreds of
// compilations and full-text scans for a single import.
const replacementPatterns = new WeakMap();

function patternFor(imageMap) {
  let cached = replacementPatterns.get(imageMap);
  if (cached) return cached;

  // Longest first: one URL can be a prefix of another (a.png vs a.png?v=2).
  // Regex alternation matches leftmost-first, so listing the longer URL first
  // makes it win instead of the shorter one truncating it.
  const ordered = [...imageMap.keys()].toSorted((a, b) => b.length - a.length);
  const escaped = ordered.map((url) => url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  cached = new RegExp(escaped.join('|'), 'g');
  replacementPatterns.set(imageMap, cached);
  return cached;
}

function replaceUrls(text, imageMap) {
  if (!text || typeof text !== 'string') return text;
  if (imageMap.size === 0) return text;

  // Single pass: each match is looked up directly rather than re-scanning the
  // text once per known URL.
  return text.replace(patternFor(imageMap), (match) => imageMap.get(match) ?? match);
}

/**
 * Rewrite all image URLs in the card data text fields using the provided map.
 *
 * @param {object}              cardData   — normalized V2 card data (mutated in place)
 * @param {Map<string, string>} imageMap   — original URL → local path
 * @returns {object}  — the same cardData object (mutated), for chaining
 */
export function rewriteCharacterImageUrls(cardData, imageMap) {
  if (!imageMap || imageMap.size === 0) return cardData;
  if (!cardData?.data) return cardData;

  const data = cardData.data;

  // Apply to all text fields
  for (const field of CACHEABLE_CARD_FIELDS) {
    if (data[field] !== undefined) {
      data[field] = replaceUrls(data[field], imageMap);
    }
  }

  // Alternate greetings (array of strings)
  if (Array.isArray(data.alternate_greetings)) {
    data.alternate_greetings = data.alternate_greetings.map((g) => replaceUrls(g, imageMap));
  }

  return cardData;
}

/**
 * Collect all image URLs from a card's text fields (utility, used externally).
 *
 * @param {object} cardData
 * @returns {Set<string>}
 */
export function extractCardImageUrls(cardData) {
  return collectAllImageUrls(cardData);
}

/**
 * Collect all image URLs from a lorebook's entry content (utility, used externally).
 *
 * @param {object} lorebookData
 * @returns {Set<string>}
 */
export function extractLorebookImageUrls(lorebookData) {
  return collectLorebookImageUrls(lorebookData);
}

/**
 * Rewrite all image URLs in a lorebook's entry content using the provided map.
 *
 * @param {object}              lorebookData  — lorebook with .entries[].content (mutated in place)
 * @param {Map<string, string>} imageMap      — original URL → local path
 * @returns {object}  — the same lorebookData object (mutated), for chaining
 */
export function rewriteLorebookImageUrls(lorebookData, imageMap) {
  if (!imageMap || imageMap.size === 0) return lorebookData;
  if (!lorebookData?.entries || !Array.isArray(lorebookData.entries)) return lorebookData;

  // Rewrite in each entry's content and comment
  for (const entry of lorebookData.entries) {
    if (entry.content) {
      entry.content = replaceUrls(entry.content, imageMap);
    }
    if (entry.comment) {
      entry.comment = replaceUrls(entry.comment, imageMap);
    }
  }

  // Also rewrite in lorebook description
  if (lorebookData.description) {
    lorebookData.description = replaceUrls(lorebookData.description, imageMap);
  }

  return lorebookData;
}
