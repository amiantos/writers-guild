import { describe, it, expect, afterEach, vi } from 'vitest';
import DOMPurify from 'dompurify';
import { hasHiddenNotes, proseToHtml, renderProse, stripHiddenNotes } from '../renderProse.js';

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

describe('hidden notes', () => {
  it('finds notes, closed or still streaming in', () => {
    expect(hasHiddenNotes('Hi <!-- stay in character -->')).toBe(true);
    expect(hasHiddenNotes('Hi <!-- stay in')).toBe(true);
    expect(hasHiddenNotes('Hi there')).toBe(false);
    expect(hasHiddenNotes('')).toBe(false);
  });

  it('strips a note inside a line', () => {
    expect(stripHiddenNotes('She waved.<!-- {{char}} is wary --> Then she left.')).toBe(
      'She waved. Then she left.',
    );
  });

  it('strips a note on its own line along with the line', () => {
    expect(stripHiddenNotes('Line one\n<!-- note -->\nLine two')).toBe('Line one\nLine two');
    expect(stripHiddenNotes('First\n\n<!-- a\nlong\n\nnote -->\n\nSecond')).toBe('First\n\nSecond');
    expect(stripHiddenNotes('<!-- opening note -->\n\nOnce upon a time')).toBe('Once upon a time');
  });

  it('strips an unclosed note to the end, as one still streaming in', () => {
    expect(stripHiddenNotes('The door opened.\n\n<!-- she should')).toBe('The door opened.');
  });

  it('leaves text without notes alone', () => {
    expect(stripHiddenNotes('Keep\n\n\nthis')).toBe('Keep\n\n\nthis');
  });

  it('leaves notes out of the prose by default', () => {
    expect(proseToHtml('Hello.\n\n<!-- never break character -->\n\nGoodbye.')).toBe(
      '<p>Hello.</p><p>Goodbye.</p>',
    );
    expect(proseToHtml('<!-- only a note -->')).toBe('');
  });

  it('shows notes as plain text, set apart, when asked', () => {
    expect(proseToHtml('Hello.<!-- <b>never</b>\nbreak -->', { showHiddenNotes: true })).toBe(
      '<p>Hello.<span class="hidden-note">&lt;b&gt;never&lt;/b&gt;<br>break</span></p>',
    );
  });

  it('keeps images inside a note as text', () => {
    expect(
      proseToHtml('<!-- ![map](https://example.com/map.png) -->', { showHiddenNotes: true }),
    ).toBe('<p><span class="hidden-note">![map](https://example.com/map.png)</span></p>');
    expect(proseToHtml('<!-- <img src="https://example.com/a.png"> -->')).toBe('');
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
