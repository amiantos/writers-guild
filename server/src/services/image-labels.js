/**
 * Image Labels
 *
 * Cards, lorebooks, and messages can carry images. A prompt that only reads them gets each one as a
 * short label, never as the long cached asset URL a model can't use.
 */

import { HTML_IMAGE_RE, MARKDOWN_IMAGE_RE } from '../../../shared/regex-patterns.js';

const HTML_ALT_RE = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

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
