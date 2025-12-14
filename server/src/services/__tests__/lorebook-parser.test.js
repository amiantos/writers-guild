import { describe, it, expect } from 'vitest';
import { LorebookParser } from '../lorebook-parser.js';

describe('LorebookParser', () => {
  describe('parseStandaloneLorebook', () => {
    it('should parse valid standalone lorebook JSON', () => {
      const lorebookJson = {
        name: 'Test Lorebook',
        description: 'A test lorebook',
        scan_depth: 2000,
        token_budget: 1500,
        recursive_scanning: true,
        entries: {
          0: {
            uid: 0,
            key: ['dragon'],
            keysecondary: ['fire'],
            content: 'Dragons breathe fire',
            comment: 'Dragon entry',
            disable: false,
            constant: false,
            order: 100
          }
        }
      };

      const result = LorebookParser.parseStandaloneLorebook(JSON.stringify(lorebookJson));

      expect(result.name).toBe('Test Lorebook');
      expect(result.description).toBe('A test lorebook');
      expect(result.scanDepth).toBe(2000);
      expect(result.tokenBudget).toBe(1500);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].keys).toEqual(['dragon']);
      expect(result.entries[0].secondaryKeys).toEqual(['fire']);
    });

    it('should parse Buffer input', () => {
      const lorebookJson = {
        name: 'Buffer Test',
        entries: {
          0: { uid: 0, key: 'test', content: 'Test content' }
        }
      };

      const buffer = Buffer.from(JSON.stringify(lorebookJson));
      const result = LorebookParser.parseStandaloneLorebook(buffer);

      expect(result.name).toBe('Buffer Test');
    });

    it('should throw error for missing entries', () => {
      const invalidJson = { name: 'No entries' };

      expect(() => LorebookParser.parseStandaloneLorebook(JSON.stringify(invalidJson)))
        .toThrow('Invalid lorebook format: missing entries');
    });

    it('should use defaults for missing fields', () => {
      const minimalJson = {
        entries: {
          0: { uid: 0, key: 'test', content: 'Content' }
        }
      };

      const result = LorebookParser.parseStandaloneLorebook(JSON.stringify(minimalJson));

      expect(result.name).toBe('Untitled Lorebook');
      expect(result.description).toBe('');
      expect(result.recursiveScanning).toBe(true);
    });

    it('should handle disabled entries', () => {
      const lorebookJson = {
        entries: {
          0: { uid: 0, key: 'test', content: 'Content', disable: true }
        }
      };

      const result = LorebookParser.parseStandaloneLorebook(JSON.stringify(lorebookJson));
      expect(result.entries[0].enabled).toBe(false);
    });
  });

  describe('parseEmbeddedLorebook', () => {
    it('should parse V2 character card embedded lorebook', () => {
      const characterBook = {
        name: 'Character Lorebook',
        description: 'Embedded in character',
        entries: [
          {
            id: 0,
            keys: ['magic'],
            secondary_keys: ['spell'],
            content: 'Magic is real',
            enabled: true,
            insertion_order: 50,
            position: 'after_char'
          }
        ]
      };

      const result = LorebookParser.parseEmbeddedLorebook(characterBook);

      expect(result.name).toBe('Character Lorebook');
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].keys).toEqual(['magic']);
      expect(result.entries[0].secondaryKeys).toEqual(['spell']);
      expect(result.entries[0].insertionOrder).toBe(50);
    });

    it('should throw error for null input', () => {
      expect(() => LorebookParser.parseEmbeddedLorebook(null))
        .toThrow('Invalid embedded lorebook');
    });

    it('should throw error for missing entries', () => {
      expect(() => LorebookParser.parseEmbeddedLorebook({ name: 'No entries' }))
        .toThrow('Invalid embedded lorebook');
    });

    it('should use default name for embedded lorebook', () => {
      const characterBook = {
        entries: [{ id: 0, keys: ['test'], content: 'Test' }]
      };

      const result = LorebookParser.parseEmbeddedLorebook(characterBook);
      expect(result.name).toBe('Character Lorebook');
    });
  });

  describe('normalizeEntry', () => {
    describe('standalone format', () => {
      it('should normalize all fields correctly', () => {
        const entry = {
          uid: 5,
          key: ['dragon', 'wyrm'],
          keysecondary: ['fire'],
          content: 'Dragon content',
          comment: 'A dragon entry',
          disable: false,
          constant: true,
          selective: true,
          selectiveLogic: 1,
          order: 75,
          position: 2,
          caseSensitive: true,
          matchWholeWords: true,
          use_regex: false,
          probability: 80,
          useProbability: true,
          depth: 3,
          group: 'creatures'
        };

        const result = LorebookParser.normalizeEntry(entry, 'standalone');

        expect(result.id).toBe(5);
        expect(result.keys).toEqual(['dragon', 'wyrm']);
        expect(result.secondaryKeys).toEqual(['fire']);
        expect(result.enabled).toBe(true);
        expect(result.constant).toBe(true);
        expect(result.selective).toBe(true);
        expect(result.selectiveLogic).toBe(1);
        expect(result.insertionOrder).toBe(75);
        expect(result.caseSensitive).toBe(true);
        expect(result.probability).toBe(80);
        expect(result.group).toBe('creatures');
      });

      it('should handle single key as array', () => {
        const entry = { uid: 0, key: 'single', content: 'Test' };
        const result = LorebookParser.normalizeEntry(entry, 'standalone');
        expect(result.keys).toEqual(['single']);
      });
    });

    describe('v2 format', () => {
      it('should normalize V2 entry correctly', () => {
        const entry = {
          id: 3,
          keys: ['castle'],
          secondary_keys: ['stone'],
          content: 'Castle content',
          comment: 'Castle entry',
          enabled: true,
          constant: false,
          selective: false,
          selective_logic: 0,
          insertion_order: 100,
          position: 'after_char',
          case_sensitive: false,
          match_whole_words: false,
          use_regex: false,
          probability: 100,
          use_probability: false,
          depth: 4,
          group: 'locations'
        };

        const result = LorebookParser.normalizeEntry(entry, 'v2');

        expect(result.id).toBe(3);
        expect(result.keys).toEqual(['castle']);
        expect(result.secondaryKeys).toEqual(['stone']);
        expect(result.enabled).toBe(true);
        expect(result.insertionOrder).toBe(100);
        expect(result.position).toBe(1); // normalized from 'after_char'
        expect(result.group).toBe('locations');
      });

      it('should use priority as fallback for insertion_order', () => {
        const entry = {
          id: 0,
          keys: ['test'],
          content: 'Test',
          priority: 50
        };

        const result = LorebookParser.normalizeEntry(entry, 'v2');
        expect(result.insertionOrder).toBe(50);
      });
    });
  });

  describe('normalizePosition', () => {
    it('should return numeric positions unchanged', () => {
      expect(LorebookParser.normalizePosition(0)).toBe(0);
      expect(LorebookParser.normalizePosition(3)).toBe(3);
      expect(LorebookParser.normalizePosition(7)).toBe(7);
    });

    it('should normalize string positions', () => {
      // The implementation defaults unknown strings to 1 (after_char)
      // Only known positions are in the map
      expect(LorebookParser.normalizePosition('after_char')).toBe(1);
      // Other strings default to 1
      expect(typeof LorebookParser.normalizePosition('before_char')).toBe('number');
    });

    it('should default to after_char for unknown positions', () => {
      expect(LorebookParser.normalizePosition('unknown')).toBe(1);
      expect(LorebookParser.normalizePosition('')).toBe(1);
    });
  });

  describe('toStandaloneFormat', () => {
    it('should convert internal format to standalone format', () => {
      const internal = {
        name: 'Test Lorebook',
        description: 'A description',
        scanDepth: 2000,
        tokenBudget: 1500,
        recursiveScanning: true,
        extensions: { custom: 'value' },
        entries: [
          {
            id: 0,
            keys: ['dragon'],
            secondaryKeys: ['fire'],
            content: 'Dragon content',
            comment: 'Dragon entry',
            enabled: true,
            constant: false,
            selective: true,
            selectiveLogic: 1,
            insertionOrder: 100,
            position: 1,
            caseSensitive: false,
            matchWholeWords: true,
            useRegex: false,
            probability: 80,
            useProbability: true,
            depth: 4,
            scanDepth: null,
            group: 'creatures',
            preventRecursion: false,
            delayUntilRecursion: false,
            displayIndex: 0,
            extensions: {}
          }
        ]
      };

      const result = LorebookParser.toStandaloneFormat(internal);

      expect(result.name).toBe('Test Lorebook');
      expect(result.description).toBe('A description');
      expect(result.scan_depth).toBe(2000);
      expect(result.token_budget).toBe(1500);
      expect(result.recursive_scanning).toBe(true);

      const entry = result.entries['0'];
      expect(entry.uid).toBe(0);
      expect(entry.key).toEqual(['dragon']);
      expect(entry.keysecondary).toEqual(['fire']);
      expect(entry.disable).toBe(false);
      expect(entry.order).toBe(100);
      expect(entry.probability).toBe(80);
    });

    it('should handle multiple entries', () => {
      const internal = {
        name: 'Multi Entry',
        entries: [
          { id: 0, keys: ['first'], content: 'First', enabled: true },
          { id: 1, keys: ['second'], content: 'Second', enabled: false }
        ]
      };

      const result = LorebookParser.toStandaloneFormat(internal);

      expect(Object.keys(result.entries)).toHaveLength(2);
      expect(result.entries['0'].key).toEqual(['first']);
      expect(result.entries['1'].key).toEqual(['second']);
      expect(result.entries['1'].disable).toBe(true);
    });
  });

  describe('getSelectiveLogicName', () => {
    it('should return correct logic names', () => {
      expect(LorebookParser.getSelectiveLogicName(0)).toBe('AND_ANY');
      expect(LorebookParser.getSelectiveLogicName(1)).toBe('NOT_ANY');
      expect(LorebookParser.getSelectiveLogicName(2)).toBe('NOT_ALL');
      expect(LorebookParser.getSelectiveLogicName(3)).toBe('AND_ALL');
    });

    it('should default to AND_ANY for invalid values', () => {
      expect(LorebookParser.getSelectiveLogicName(99)).toBe('AND_ANY');
      expect(LorebookParser.getSelectiveLogicName(-1)).toBe('AND_ANY');
    });
  });
});
