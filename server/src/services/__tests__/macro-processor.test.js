import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MacroProcessor } from '../macro-processor.js';

describe('MacroProcessor', () => {
  let processor;

  beforeEach(() => {
    processor = new MacroProcessor({
      userName: 'Alice',
      charName: 'Bob'
    });
  });

  describe('Context Macros', () => {
    it('should replace {{user}} with user name', () => {
      const result = processor.processContextMacros('Hello {{user}}!');
      expect(result).toBe('Hello Alice!');
    });

    it('should replace {{user}} case-insensitively', () => {
      const result = processor.processContextMacros('Hello {{USER}} and {{User}}!');
      expect(result).toBe('Hello Alice and Alice!');
    });

    it('should replace {{char}} with character name', () => {
      const result = processor.processContextMacros('{{char}} says hello');
      expect(result).toBe('Bob says hello');
    });

    it('should replace {{character}} with character name', () => {
      const result = processor.processContextMacros('{{character}} is happy');
      expect(result).toBe('Bob is happy');
    });

    it('should replace multiple context macros', () => {
      const result = processor.processContextMacros('{{user}} meets {{char}}');
      expect(result).toBe('Alice meets Bob');
    });

    it('should use default values when context is not provided', () => {
      const defaultProcessor = new MacroProcessor();
      const result = defaultProcessor.processContextMacros('{{user}} and {{char}}');
      expect(result).toBe('User and Character');
    });
  });

  describe('Selection Macros - Random', () => {
    it('should replace {{random:...}} with one of the options', () => {
      const text = '{{random:apple,banana,cherry}}';
      const result = processor.processSelectionMacros(text);
      expect(['apple', 'banana', 'cherry']).toContain(result);
    });

    it('should handle {{random::...}} with double colon separator', () => {
      const text = '{{random::apple::banana::cherry}}';
      const result = processor.processSelectionMacros(text);
      expect(['apple', 'banana', 'cherry']).toContain(result);
    });

    it('should trim whitespace from options', () => {
      const text = '{{random: apple , banana , cherry }}';
      const result = processor.processSelectionMacros(text);
      expect(['apple', 'banana', 'cherry']).toContain(result);
    });

    it('should return original text if no options provided', () => {
      const text = '{{random:}}';
      const result = processor.processSelectionMacros(text);
      expect(result).toBe(text);
    });

    it('should work case-insensitively', () => {
      const text = '{{RANDOM:yes,no}}';
      const result = processor.processSelectionMacros(text);
      expect(['yes', 'no']).toContain(result);
    });
  });

  describe('Selection Macros - Pick', () => {
    it('should replace {{pick:...}} with stable selection', () => {
      const text = '{{pick:apple,banana,cherry}}';
      const result1 = processor.processSelectionMacros(text);
      const result2 = processor.processSelectionMacros(text);

      // Same input should give same output (stable)
      expect(result1).toBe(result2);
      expect(['apple', 'banana', 'cherry']).toContain(result1);
    });

    it('should handle {{pick::...}} with double colon separator', () => {
      const text = '{{pick::apple::banana::cherry}}';
      const result = processor.processSelectionMacros(text);
      expect(['apple', 'banana', 'cherry']).toContain(result);
    });

    it('should provide stable results for same input', () => {
      const text = '{{pick:red,green,blue}}';
      const results = [];
      for (let i = 0; i < 10; i++) {
        results.push(processor.processSelectionMacros(text));
      }

      // All results should be the same
      expect(new Set(results).size).toBe(1);
    });
  });

  describe('Dice Roll Macros', () => {
    it('should replace {{roll:d6}} with number between 1-6', () => {
      const text = '{{roll:d6}}';
      const result = processor.processDiceRolls(text);
      const num = parseInt(result);
      expect(num).toBeGreaterThanOrEqual(1);
      expect(num).toBeLessThanOrEqual(6);
    });

    it('should replace {{roll:2d6}} with sum of 2 dice', () => {
      const text = '{{roll:2d6}}';
      const result = processor.processDiceRolls(text);
      const num = parseInt(result);
      expect(num).toBeGreaterThanOrEqual(2);
      expect(num).toBeLessThanOrEqual(12);
    });

    it('should handle modifiers {{roll:2d6+3}}', () => {
      const text = '{{roll:2d6+3}}';
      const result = processor.processDiceRolls(text);
      const num = parseInt(result);
      expect(num).toBeGreaterThanOrEqual(5);  // min: 2+3
      expect(num).toBeLessThanOrEqual(15);    // max: 12+3
    });

    it('should handle negative modifiers {{roll:2d6-2}}', () => {
      const text = '{{roll:2d6-2}}';
      const result = processor.processDiceRolls(text);
      const num = parseInt(result);
      expect(num).toBeGreaterThanOrEqual(0);  // min: 2-2
      expect(num).toBeLessThanOrEqual(10);    // max: 12-2
    });

    it('should handle d20 rolls', () => {
      const text = '{{roll:d20}}';
      const result = processor.processDiceRolls(text);
      const num = parseInt(result);
      expect(num).toBeGreaterThanOrEqual(1);
      expect(num).toBeLessThanOrEqual(20);
    });

    it('should reject invalid dice counts (>100)', () => {
      const text = '{{roll:101d6}}';
      const result = processor.processDiceRolls(text);
      expect(result).toBe(text); // Should return original
    });

    it('should reject invalid dice sizes (0 or negative)', () => {
      const text = '{{roll:2d0}}';
      const result = processor.processDiceRolls(text);
      expect(result).toBe(text); // Should return original
    });
  });

  describe('Helper Functions', () => {
    it('should split by comma correctly', () => {
      const result = processor.splitByComma('apple,banana,cherry');
      expect(result).toEqual(['apple', 'banana', 'cherry']);
    });

    it('should handle escaped commas', () => {
      const result = processor.splitByComma('hello\\, world,foo,bar');
      expect(result).toEqual(['hello, world', 'foo', 'bar']);
    });

    it('should handle empty string', () => {
      const result = processor.splitByComma('');
      expect(result).toEqual([]);
    });

    it('should produce consistent hash for same string', () => {
      const hash1 = processor.simpleHash('test');
      const hash2 = processor.simpleHash('test');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different strings', () => {
      const hash1 = processor.simpleHash('test1');
      const hash2 = processor.simpleHash('test2');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Full Integration - process()', () => {
    it('should process all macro types in one pass', () => {
      const text = 'Hello {{user}}! {{char}} rolled {{roll:d6}}.';
      const result = processor.process(text);

      expect(result).toContain('Hello Alice!');
      expect(result).toContain('Bob rolled');

      // Extract the dice roll result
      const match = result.match(/Bob rolled (\d+)/);
      expect(match).toBeTruthy();
      const roll = parseInt(match[1]);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
    });

    it('should handle multiple macro types', () => {
      const text = '{{user}} chooses {{random:red,blue}} and rolls {{roll:d20}}';
      const result = processor.process(text);

      expect(result).toContain('Alice chooses');
      expect(['red', 'blue'].some(color => result.includes(color))).toBe(true);
    });

    it('should return original text if no macros present', () => {
      const text = 'Just plain text';
      const result = processor.process(text);
      expect(result).toBe(text);
    });

    it('should handle null/undefined input', () => {
      expect(processor.process(null)).toBe(null);
      expect(processor.process(undefined)).toBe(undefined);
      expect(processor.process('')).toBe('');
    });

    it('should process macros in correct order', () => {
      // Context macros should be processed first, then selection macros
      const text = '{{pick:{{user}},{{char}}}}'; // Not nested, but sequential
      const result = processor.process(text);

      // After first pass (context): {{pick:Alice,Bob}}
      // After second pass (selection): either 'Alice' or 'Bob'
      expect(['Alice', 'Bob']).toContain(result);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty context', () => {
      const emptyProcessor = new MacroProcessor({});
      const result = emptyProcessor.process('{{user}} and {{char}}');
      expect(result).toBe('User and Character');
    });

    it('should handle malformed macros gracefully', () => {
      const text = '{{invalid';
      const result = processor.process(text);
      expect(result).toBe(text);
    });

    it('should handle multiple macros in single line', () => {
      const text = '{{user}} {{char}} {{user}} {{char}}';
      const result = processor.process(text);
      expect(result).toBe('Alice Bob Alice Bob');
    });

    it('should handle macros with special characters in options', () => {
      const text = '{{random:hello!,world?,test.}}';
      const result = processor.processSelectionMacros(text);
      expect(['hello!', 'world?', 'test.']).toContain(result);
    });

    it('should handle single option in random', () => {
      const text = '{{random:only}}';
      const result = processor.processSelectionMacros(text);
      expect(result).toBe('only');
    });
  });
});
