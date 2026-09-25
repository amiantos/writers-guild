import { describe, it, expect } from 'vitest';
import {
  splitPassages,
  pruneRecords,
  replaceBlock,
  removeBlock,
  appendText,
  paragraphsOf,
} from '../storyPassages.js';

const record = (id, text, extra = {}) => ({ id, text, source: 'generated', ...extra });

describe('splitPassages', () => {
  it('shows nothing for an empty story', () => {
    expect(splitPassages('', [])).toEqual([]);
  });

  it('splits a story with no record into its paragraphs', () => {
    const content = 'First line.\nStill first.\n\n  Second.\n \n\nThird.\n\n';
    const blocks = splitPassages(content, []);
    expect(blocks.map((block) => block.text)).toEqual([
      'First line.\nStill first.',
      'Second.',
      'Third.',
    ]);
    for (const block of blocks) {
      expect(content.slice(block.start, block.end)).toBe(block.text);
      expect(block.record).toBeNull();
    }
  });

  it('keeps a recorded passage whole, with paragraphs around it on their own', () => {
    const passage = 'The door opened.\n\nShe stepped in.';
    const content = `Opening.\n\n${passage}\n\nTyped in the editor.\n\n`;
    const blocks = splitPassages(content, [record('p1', passage)]);

    expect(blocks.map((block) => block.text)).toEqual([
      'Opening.',
      passage,
      'Typed in the editor.',
    ]);
    expect(blocks[1].record.id).toBe('p1');
    expect(blocks[1].key).toBe('p1');
  });

  it('places passages by where they are, not by the order they were recorded', () => {
    const content = 'Alpha.\n\nBeta.\n\nGamma.\n\n';
    const blocks = splitPassages(content, [record('g', 'Gamma.'), record('a', 'Alpha.')]);
    expect(blocks.map((block) => block.record?.id ?? null)).toEqual(['a', null, 'g']);
  });

  it("doesn't show a passage that is no longer in the story", () => {
    const blocks = splitPassages('Alpha.\n\n', [record('gone', 'Edited away.')]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].record).toBeNull();
  });

  it('gives two recorded passages with the same text a place each', () => {
    const content = 'Yes.\n\nNo.\n\nYes.\n\n';
    const blocks = splitPassages(content, [record('one', 'Yes.'), record('two', 'Yes.')]);
    expect(blocks.map((block) => block.record?.id ?? null)).toEqual(['one', null, 'two']);
  });

  it('prefers a whole paragraph over the same words inside another', () => {
    const content = 'He said yes. Then left.\n\nyes.\n\n';
    const blocks = splitPassages(content, [record('p', 'yes.')]);
    expect(blocks.map((block) => block.text)).toEqual(['He said yes. Then left.', 'yes.']);
    expect(blocks[1].record.id).toBe('p');
  });
});

describe('pruneRecords', () => {
  it('keeps what is in the story, and only the latest records that are not', () => {
    const records = [
      record('old', 'Long gone.'),
      record('here', 'Here.'),
      record('recent', 'Undone.'),
    ];
    expect(pruneRecords(records, 'Here.\n\n', 1).map((item) => item.id)).toEqual([
      'here',
      'recent',
    ]);
    expect(pruneRecords(records, 'Here.\n\n', 0).map((item) => item.id)).toEqual(['here']);
  });
});

describe('editing blocks', () => {
  const content = 'Alpha.\n\nBeta.\n\nGamma.\n\n';
  const blocks = splitPassages(content, []);

  it('replaces one block, leaving everything around it alone', () => {
    expect(replaceBlock(content, blocks[1], '  Beta, again.\n')).toBe(
      'Alpha.\n\nBeta, again.\n\nGamma.\n\n',
    );
  });

  it('removes a block from the middle, the start, or the end', () => {
    expect(removeBlock(content, blocks[1])).toBe('Alpha.\n\nGamma.\n\n');
    expect(removeBlock(content, blocks[0])).toBe('Beta.\n\nGamma.\n\n');
    expect(removeBlock(content, blocks[2])).toBe('Alpha.\n\nBeta.\n\n');
    expect(removeBlock('Only.\n\n', splitPassages('Only.\n\n')[0])).toBe('');
  });

  it('keeps a passage that ran on from the text before it running on', () => {
    const joined = 'She waited. The bus came.\n\n';
    const [, bus] = splitPassages(joined, [record('bus', 'The bus came.')]);
    expect(removeBlock(joined, bus)).toBe('She waited.\n\n');
    const withTail = 'She waited.The bus came. Later.';
    const [, middle] = splitPassages(withTail, [record('bus', 'The bus came.')]);
    expect(removeBlock(withTail, middle)).toBe('She waited. Later.');
  });
});

describe('appendText', () => {
  it('adds a paragraph at the end, as the preview input does', () => {
    expect(appendText('Alpha.\n\n\n', ' Beta. ')).toBe('Alpha.\n\nBeta.\n\n');
    expect(appendText('', 'Beta.')).toBe('Beta.\n\n');
  });
});

describe('paragraphsOf', () => {
  it('splits text into trimmed paragraphs', () => {
    expect(paragraphsOf('  One.\n\nTwo.\nStill two.\n\n\n')).toEqual(['One.', 'Two.\nStill two.']);
  });
});
