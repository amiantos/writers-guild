/**
 * Prose Rendering for Passages
 *
 * Ported from StoryEditor.vue's preview renderer, so story mode stays
 * untouched: paragraphs, line breaks, and inline images, sanitized with
 * DOMPurify before it reaches v-html.
 */

import DOMPurify from 'dompurify';
import {
  HTML_COMMENT_RE,
  HTML_IMAGE_RE,
  MARKDOWN_IMAGE_RE,
} from '../../../shared/regex-patterns.js';

// Stands in for a removed note while the lines it stood on are tidied up.
const NOTE_MARK = '';

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Whether the text has hidden notes: HTML comments, which a character card uses for instructions
 * only the model should read.
 * @param {string} text
 * @returns {boolean}
 */
export function hasHiddenNotes(text) {
  return Boolean(text?.includes('<!--'));
}

/**
 * The text without its hidden notes. A note on a line of its own goes with its line, so no gap is
 * left where it stood.
 * @param {string} text
 * @returns {string}
 */
export function stripHiddenNotes(text) {
  if (!hasHiddenNotes(text)) return text;
  return text
    .replace(HTML_COMMENT_RE, NOTE_MARK)
    .replace(new RegExp(`^[ \\t]*${NOTE_MARK}[ \\t${NOTE_MARK}]*(?:\\n|$)`, 'gm'), '')
    .replaceAll(NOTE_MARK, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

/**
 * A turn's prose as HTML, before sanitizing.
 * @param {string} text
 * @param {{ showHiddenNotes?: boolean }} [options] - Show hidden notes, set apart from the prose,
 *   rather than leaving them out.
 * @returns {string}
 */
export function proseToHtml(text, { showHiddenNotes = false } = {}) {
  if (!text) return '';

  // 0. Leave hidden notes out, or set them aside to show apart from the prose.
  const savedNotes = [];
  let html = showHiddenNotes
    ? text.replace(HTML_COMMENT_RE, (match) => {
        const marker = ` NOTE_MARKER_${savedNotes.length} `;
        savedNotes.push({ marker, note: match.replace(/^<!--|-->$/g, '').trim() });
        return marker;
      })
    : stripHiddenNotes(text);

  // 1. Set <img> tags aside before escaping, so they survive it.
  const savedImages = [];
  HTML_IMAGE_RE.lastIndex = 0;
  html = html.replace(HTML_IMAGE_RE, (match) => {
    const marker = ` IMG_MARKER_${savedImages.length} `;
    savedImages.push({
      marker,
      tag: match.replace('<img', '<img loading="lazy" class="story-image"'),
    });
    return marker;
  });

  // 2. Escape everything else.
  html = escapeHtml(html);

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

  // 6. Put the notes back, as plain text.
  for (const { marker, note } of savedNotes) {
    const span = `<span class="hidden-note">${escapeHtml(note).replace(/\n/g, '<br>')}</span>`;
    html = html.replace(marker, () => span);
  }

  return html;
}

/**
 * A turn's prose as sanitized HTML, safe for v-html. DOMPurify strips anything
 * unsafe that got through, such as event handlers and javascript: URLs.
 * @param {string} text
 * @param {{ showHiddenNotes?: boolean }} [options]
 * @returns {string}
 */
export function renderProse(text, options) {
  if (!text) return '';
  return DOMPurify.sanitize(proseToHtml(text, options));
}
