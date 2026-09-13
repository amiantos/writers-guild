import { describe, it, expect } from 'vitest';
import { followScroll } from '../followScroll';

describe('followScroll', () => {
  const view = { clientHeight: 500, anchorTop: 1000, margin: 16 };

  it('follows the new text down while the start of the passage is still on screen', () => {
    expect(followScroll({ ...view, scrollTop: 600, scrollHeight: 1300 })).toEqual({
      scrollTop: 800,
      following: true,
    });
  });

  it('stops with the start of the passage at the top once the text runs past the fold', () => {
    expect(followScroll({ ...view, scrollTop: 800, scrollHeight: 2400 })).toEqual({
      scrollTop: 984,
      following: false,
    });
  });

  it('never scrolls back up', () => {
    expect(followScroll({ ...view, scrollTop: 1200, scrollHeight: 2400 })).toEqual({
      scrollTop: 1200,
      following: false,
    });
  });
});
