/**
 * Passages for Enhanced Story Mode
 *
 * A story's content stays one piece of text, exactly as story mode writes and sends it. Enhanced
 * Story Mode keeps a record beside it of the passages it knows: each one's text, where it came
 * from, and the reasoning behind it. These helpers find those passages in the content, split the
 * rest into paragraphs, and edit the content one passage at a time.
 *
 * The record is matched to the content by text, so it survives edits made in the plain editor and
 * undo and redo: a passage that no longer appears is just not shown, and shows again if it comes
 * back.
 */

/** Stale records kept for a passage undo or redo could bring back. */
export const STALE_PASSAGES_KEPT = 50;

/** Blank lines separate paragraphs, as in the rendered story. */
const PARAGRAPH_BREAK_RE = /\n[ \t]*\n\s*/g;

const isBlank = (char) => char === ' ' || char === '\t';
const isSpace = (char) => char === undefined || /\s/.test(char);

/**
 * How well a match sits in the content: 2 when it's lines of its own, 1 when it's words of its own,
 * 0 when it runs into the text around it.
 */
function fit(content, start, end) {
  let before = start - 1;
  while (isBlank(content[before])) before--;
  let after = end;
  while (isBlank(content[after])) after++;
  if ((content[before] ?? '\n') === '\n' && (content[after] ?? '\n') === '\n') return 2;
  return isSpace(content[start - 1]) && isSpace(content[end]) ? 1 : 0;
}

export function newPassageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `passage-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Where the best unclaimed occurrence of `text` is: the first that stands on lines of its own if
 * there is one, so a short passage isn't found inside a longer paragraph.
 */
function findUnclaimed(content, text, claimed) {
  let best = -1;
  let bestFit = -1;
  for (let at = content.indexOf(text); at !== -1; at = content.indexOf(text, at + 1)) {
    const end = at + text.length;
    if (claimed.some((range) => at < range.end && end > range.start)) continue;
    const score = fit(content, at, end);
    if (score === 2) return at;
    if (score > bestFit) {
      best = at;
      bestFit = score;
    }
  }
  return best;
}

/**
 * Place each record in the content: earlier records claim their text first.
 * @returns {{ start: number, end: number, record: Object }[]} Sorted by where they start.
 */
function placeRecords(content, records) {
  const placed = [];
  for (const record of records) {
    const text = record?.text?.trim();
    if (!text) continue;
    const start = findUnclaimed(content, text, placed);
    if (start !== -1) placed.push({ start, end: start + text.length, record });
  }
  return placed.toSorted((a, b) => a.start - b.start);
}

/** The paragraphs of content.slice(from, to), as trimmed ranges. */
function paragraphRanges(content, from, to) {
  const ranges = [];
  const slice = content.slice(from, to);
  let pieceStart = 0;
  const pushPiece = (pieceEnd) => {
    const piece = slice.slice(pieceStart, pieceEnd);
    const leading = piece.length - piece.trimStart().length;
    const text = piece.trim();
    if (text) {
      const start = from + pieceStart + leading;
      ranges.push({ start, end: start + text.length });
    }
  };
  for (const match of slice.matchAll(PARAGRAPH_BREAK_RE)) {
    pushPiece(match.index);
    pieceStart = match.index + match[0].length;
  }
  pushPiece(slice.length);
  return ranges;
}

/**
 * The story as blocks to show: the recorded passages found in it, and a block for each paragraph
 * of anything else, such as text written in the plain editor or before the record was kept.
 *
 * @param {string} content
 * @param {Object[]} records - The story's passages, oldest first.
 * @returns {{ key: string, start: number, end: number, text: string, record: Object|null }[]}
 */
export function splitPassages(content, records = []) {
  if (!content) return [];
  const blocks = [];
  const pushUntracked = (from, to) => {
    for (const { start, end } of paragraphRanges(content, from, to)) {
      blocks.push({
        key: `at-${start}`,
        start,
        end,
        text: content.slice(start, end),
        record: null,
      });
    }
  };

  let cursor = 0;
  for (const { start, end, record } of placeRecords(content, records)) {
    pushUntracked(cursor, start);
    blocks.push({ key: record.id, start, end, text: content.slice(start, end), record });
    cursor = end;
  }
  pushUntracked(cursor, content.length);
  return blocks;
}

/**
 * The records to keep: every one found in the content, and the latest few that aren't, for undo.
 */
export function pruneRecords(records, content, keepStale = STALE_PASSAGES_KEPT) {
  const found = new Set(placeRecords(content, records).map(({ record }) => record));
  const stale = records.filter((record) => !found.has(record));
  const keptStale = new Set(keepStale > 0 ? stale.slice(-keepStale) : []);
  return records.filter((record) => found.has(record) || keptStale.has(record));
}

/** The content with a block's text replaced. */
export function replaceBlock(content, block, text) {
  return content.slice(0, block.start) + text.trim() + content.slice(block.end);
}

/**
 * The content without a block. What separated it from the text before it now separates that text
 * from the text after it, and the story keeps story mode's two trailing line breaks.
 */
export function removeBlock(content, block) {
  const head = content.slice(0, block.start);
  const tail = content.slice(block.end);
  const before = head.trimEnd();
  const after = tail.trimStart();
  if (!before) return after;
  if (!after) return `${before}\n\n`;
  const separator = head.slice(before.length) || tail.slice(0, tail.length - after.length);
  return before + separator + after;
}

/** The content with text added as a paragraph at the end, as the preview's input bar adds it. */
export function appendText(content, text) {
  const before = content.replace(/\s+$/, '');
  return `${before ? `${before}\n\n` : ''}${text.trim()}\n\n`;
}
