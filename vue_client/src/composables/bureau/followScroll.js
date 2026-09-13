/**
 * Where to scroll while a passage streams in: follow the new text down, but only until the start
 * of the passage reaches the top of the reading area. After that the rest flows below the fold, for
 * the reader to scroll to.
 *
 * @param {Object} view - Measurements of the reading area.
 * @param {number} view.scrollTop
 * @param {number} view.scrollHeight
 * @param {number} view.clientHeight
 * @param {number} view.anchorTop - Where the passage starts, from the top of the scrolled content.
 * @param {number} [view.margin] - Room to leave above the start of the passage.
 * @returns {{ scrollTop: number, following: boolean }} Where to scroll, never back up, and whether
 *   there's still room to follow.
 */
export function followScroll({ scrollTop, scrollHeight, clientHeight, anchorTop, margin = 16 }) {
  const stop = Math.max(0, anchorTop - margin);
  const bottom = Math.max(0, scrollHeight - clientHeight);
  return {
    scrollTop: Math.max(scrollTop, Math.min(bottom, stop)),
    following: bottom < stop,
  };
}
