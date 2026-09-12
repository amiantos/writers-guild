/**
 * Prose Rendering for Bureau Turns
 *
 * Ported from StoryEditor.vue's preview renderer, so story mode stays
 * untouched: paragraphs, line breaks, and inline images, sanitized with
 * DOMPurify before it reaches v-html.
 */

import DOMPurify from 'dompurify';
import { HTML_IMAGE_RE, MARKDOWN_IMAGE_RE } from '../../../../shared/regex-patterns.js';

/**
 * A turn's prose as HTML, before sanitizing.
 * @param {string} text
 * @returns {string}
 */
export function proseToHtml(text) {
  if (!text) return '';

  // 1. Set <img> tags aside before escaping, so they survive it.
  const savedImages = [];
  HTML_IMAGE_RE.lastIndex = 0;
  let html = text.replace(HTML_IMAGE_RE, (match) => {
    const marker = ` IMG_MARKER_${savedImages.length} `;
    savedImages.push({
      marker,
      tag: match.replace('<img', '<img loading="lazy" class="story-image"'),
    });
    return marker;
  });

  // 2. Escape everything else.
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // 3. Markdown images: ![alt](url)
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  html = html.replace(
    MARKDOWN_IMAGE_RE,
    '<img src="$2" alt="$1" class="story-image" loading="lazy">',
  );

  // 4. Blank lines separate paragraphs; single newlines are line breaks.
  html = `<p>${html.replace(/\n{2,}/g, '</p><p>')}</p>`.replace(/\n/g, '<br>');
  html = html.replace(/<p><\/p>/g, '');

  // 5. Put the <img> tags back.
  for (const { marker, tag } of savedImages) {
    html = html.replace(marker, () => tag);
  }

  return html;
}

/**
 * A turn's prose as sanitized HTML, safe for v-html. DOMPurify strips anything
 * unsafe that got through, such as event handlers and javascript: URLs.
 * @param {string} text
 * @returns {string}
 */
export function renderProse(text) {
  if (!text) return '';
  return DOMPurify.sanitize(proseToHtml(text));
}
