/**
 * Images
 *
 * Cards, lorebooks, and chapters can carry images, as in story mode (see "Images" in
 * docs/bureau-design.md). The Writer is the only role that puts images in a passage: it sees each
 * one as a [WG_IMAGE_n] marker from ImagePreserver, and a marker it writes comes back as the
 * image. Every other role only reads images, so they reach it as short labels, never as the long
 * cached asset URLs a model can't use.
 */

import {
  HTML_IMAGE_RE,
  MARKDOWN_IMAGE_RE,
  WG_PLACEHOLDER_RE,
} from '../../../../shared/regex-patterns.js';

const HTML_ALT_RE = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

// The start of a marker at the very end of the text, which the model may still be writing.
const PARTIAL_MARKER_RE = /\[(?:W(?:G(?:_(?:I(?:M(?:A(?:G(?:E(?:_\d*)?)?)?)?)?)?)?)?)?$/;

function label(alt) {
  const description = (alt ?? '').replace(/\s+/g, ' ').trim();
  return description ? `[image: ${description}]` : '[image]';
}

/**
 * Text with each image swapped for a label: "[image: the harbor at dawn]" from its alt text, or
 * "[image]".
 * @param {string} text
 * @returns {string}
 */
export function labelImages(text) {
  if (!text) return text;
  return text
    .replace(MARKDOWN_IMAGE_RE, (_match, alt) => label(alt))
    .replace(HTML_IMAGE_RE, (tag) => {
      const alt = HTML_ALT_RE.exec(tag);
      return label(alt?.[1] ?? alt?.[2]);
    });
}

/**
 * Shows images in a passage while it streams, as soon as the model finishes writing each marker.
 * A marker still being written at the end of the text so far is held back until it's finished or
 * turns out not to be a marker. What's shown matches restoring the whole passage at the end: an
 * image shows at its first marker only, and a marker that was never issued shows as nothing.
 *
 * @param {import('../image-preserver.js').ImagePreserver} imagePreserver - With the prompt's
 *   images already preserved.
 * @returns {{ push: (text: string) => string, finish: () => string }} push takes streamed text and
 *   returns the text to show next; finish returns whatever was still held back.
 */
export function imageStream(imagePreserver) {
  const originals = new Map(
    imagePreserver.saved.map((image) => [image.placeholder, image.original]),
  );
  let written = '';
  let shownLength = 0;

  const showThrough = (text) => {
    const used = new Set();
    // With nothing preserved, ImagePreserver leaves markers alone, so this does too.
    const shown =
      originals.size === 0
        ? text
        : text.replace(WG_PLACEHOLDER_RE, (marker) => {
            if (!originals.has(marker) || used.has(marker)) return '';
            used.add(marker);
            return originals.get(marker);
          });
    const next = shown.slice(shownLength);
    shownLength = shown.length;
    return next;
  };

  return {
    push(text) {
      written += text;
      const partial = PARTIAL_MARKER_RE.exec(written);
      return showThrough(partial ? written.slice(0, partial.index) : written);
    },
    finish() {
      return showThrough(written);
    },
  };
}
