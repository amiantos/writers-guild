import { describe, it, expect, afterEach, vi } from 'vitest';
import DOMPurify from 'dompurify';
import { proseToHtml, renderProse } from '../renderProse.js';

describe('proseToHtml', () => {
  it('returns nothing for empty text', () => {
    expect(proseToHtml('')).toBe('');
    expect(proseToHtml(null)).toBe('');
  });

  it('turns blank lines into paragraphs and single newlines into line breaks', () => {
    expect(proseToHtml('First line\nsecond line\n\nNext paragraph\n\n\nLast')).toBe(
      '<p>First line<br>second line</p><p>Next paragraph</p><p>Last</p>',
    );
  });

  it('shows markup as text', () => {
    expect(proseToHtml('She wrote <b>bold</b> & "quoted"')).toBe(
      '<p>She wrote &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot;</p>',
    );
  });

  it('renders markdown images inline', () => {
    expect(proseToHtml('![Harbor map](https://example.com/map.png)')).toBe(
      '<p><img src="https://example.com/map.png" alt="Harbor map" class="story-image" loading="lazy"></p>',
    );
  });

  it('keeps html images, adding lazy loading', () => {
    expect(proseToHtml('Look: <img src="https://example.com/a.png">')).toBe(
      '<p>Look: <img loading="lazy" class="story-image" src="https://example.com/a.png"></p>',
    );
  });
});

describe('renderProse', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sanitizes the rendered html', () => {
    const sanitize = vi.spyOn(DOMPurify, 'sanitize').mockReturnValue('<p>clean</p>');

    expect(renderProse('<img src="x" onerror="alert(1)">')).toBe('<p>clean</p>');
    expect(sanitize).toHaveBeenCalledWith(proseToHtml('<img src="x" onerror="alert(1)">'));
  });

  it('returns nothing for empty text without sanitizing', () => {
    const sanitize = vi.spyOn(DOMPurify, 'sanitize');

    expect(renderProse('')).toBe('');
    expect(sanitize).not.toHaveBeenCalled();
  });
});
