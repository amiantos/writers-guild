import { describe, it, expect } from 'vitest';
import {
  COVER_COLORS,
  castColor,
  continuityColor,
  coverColor,
  hashString,
} from '../../../../shared/cover-colors.js';

// WCAG relative luminance of a #rrggbb color
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('cover colors', () => {
  it('hashes the same text to the same number', () => {
    expect(hashString('Saltmarsh Cycle')).toBe(hashString('Saltmarsh Cycle'));
    expect(hashString('Saltmarsh Cycle')).not.toBe(hashString('The Meridian'));
    expect(hashString('')).toBeGreaterThanOrEqual(0);
  });

  it('picks a palette color, ignoring case and surrounding spaces', () => {
    expect(COVER_COLORS).toContain(coverColor('anything'));
    expect(continuityColor('Saltmarsh Cycle')).toBe(continuityColor('  saltmarsh cycle '));
  });

  it('spreads names across the palette', () => {
    const names = Array.from({ length: 200 }, (_, i) => `Continuity ${i}`);
    expect(new Set(names.map(continuityColor)).size).toBe(COVER_COLORS.length);
  });

  it('colors a cast the same in any order, and a castless story by its id', () => {
    expect(castColor(['b', 'a'], 's1')).toBe(castColor(['a', 'b'], 's2'));
    expect(castColor([], 's1')).toBe(coverColor('story:s1'));
    expect(castColor(undefined, 's1')).toBe(coverColor('story:s1'));
  });

  it('keeps the cards’ light text readable on every color', () => {
    for (const color of COVER_COLORS) {
      expect(contrast(color, '#f6efe6')).toBeGreaterThanOrEqual(7);
    }
  });
});
