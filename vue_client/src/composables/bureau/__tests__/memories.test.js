import { describe, it, expect } from 'vitest';
import { describeArchive } from '../memories';

describe('describeArchive', () => {
  it('says what was learned and updated', () => {
    expect(describeArchive({ passes: 1, added: 3, superseded: 1 })).toBe(
      'Committed to memory: 3 things learned, 1 updated',
    );
    expect(describeArchive({ passes: 2, added: 1, superseded: 0 })).toBe(
      'Committed to memory: 1 thing learned',
    );
    expect(describeArchive({ passes: 1, added: 2, superseded: 0, held: 1 })).toBe(
      'Committed to memory: 2 things learned, 1 held for you to check',
    );
    expect(describeArchive({ passes: 1, added: 1, superseded: 0, held: 0, facts: 2 })).toBe(
      'Committed to memory: 1 thing learned, 2 facts proposed',
    );
  });

  it('says when there was nothing to read', () => {
    expect(describeArchive(null)).toBe('Nothing new to commit to memory');
    expect(describeArchive({ passes: 0, added: 0, superseded: 0 })).toBe(
      'Nothing new to commit to memory',
    );
  });
});
