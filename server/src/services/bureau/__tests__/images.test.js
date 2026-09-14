import { describe, it, expect, vi, afterEach } from 'vitest';
import { imageStream, labelImages } from '../images.js';
import { ImagePreserver } from '../../image-preserver.js';

const PIER = '![June at the pier](/api/assets/lorebooks/lb-1/pier.webp)';

function preserved(text) {
  const imagePreserver = new ImagePreserver();
  imagePreserver.preserve(text, 'lore');
  return imagePreserver;
}

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

describe('imageStream', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an image as soon as its marker is finished', () => {
    const shown = imageStream(preserved(`June's photos: ${PIER}`));

    expect(shown.push('She held up [WG_IM')).toBe('She held up ');
    expect(shown.push('AGE_0')).toBe('');
    expect(shown.push('] and smiled.')).toBe(`${PIER} and smiled.`);
    expect(shown.finish()).toBe('');
  });

  it('lets a bracket through once it turns out not to start a marker', () => {
    const shown = imageStream(preserved(PIER));

    expect(shown.push('She said [')).toBe('She said ');
    expect(shown.push('quietly] no.')).toBe('[quietly] no.');
    expect(shown.push(' [WG')).toBe(' ');
    expect(shown.finish()).toBe('[WG');
  });

  it('shows what restoring the whole passage gives, however it arrives', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const imagePreserver = preserved(`${PIER} ![gull](gull.png)`);
    const passage = 'A [WG_IMAGE_0] B [WG_IMAGE_0] C [WG_IMAGE_17] D [WG_IMAGE_1]';
    const shown = imageStream(imagePreserver);

    const text = [...passage].map((character) => shown.push(character)).join('') + shown.finish();

    expect(text).toBe(imagePreserver.restore(passage).text);
    expect(text).toBe(`A ${PIER} B  C  D ![gull](gull.png)`);
  });

  it('leaves markers alone when there are no images', () => {
    const shown = imageStream(new ImagePreserver());

    expect(shown.push('A [WG_IMAGE_0] B')).toBe('A [WG_IMAGE_0] B');
  });
});
