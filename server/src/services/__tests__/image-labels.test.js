import { describe, it, expect } from 'vitest';
import { labelImages } from '../image-labels.js';

const PIER = '![June at the pier](/api/assets/lorebooks/lb-1/pier.webp)';

describe('labelImages', () => {
  it('swaps markdown and html images for labels from their alt text', () => {
    const text = [
      `June waved. ${PIER}`,
      `<img src="/api/assets/characters/c1/smile.webp" alt='June,\n smiling'>`,
      '![](https://example.com/a.png) <img src="b.png">',
    ].join('\n');

    expect(labelImages(text)).toBe(
      'June waved. [image: June at the pier]\n[image: June, smiling]\n[image] [image]',
    );
  });

  it('leaves text without images alone', () => {
    expect(labelImages('She said [quietly] no.')).toBe('She said [quietly] no.');
    expect(labelImages('')).toBe('');
  });
});
