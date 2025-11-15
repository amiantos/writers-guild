import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LorebookActivator } from '../lorebook-activator.js';

describe('LorebookActivator', () => {
  let activator;
  let lorebook;

  beforeEach(() => {
    activator = new LorebookActivator({
      lorebookScanDepth: 2000,
      lorebookTokenBudget: 1800,
      lorebookRecursionDepth: 3,
      lorebookEnableRecursion: true
    });

    lorebook = {
      name: 'Test Lorebook',
      entries: []
    };
  });

  describe('Basic Activation', () => {
    it('should activate entry when keyword is found', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon'],
          content: 'Dragons are magical creatures',
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'The dragon flew overhead');
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Dragons are magical creatures');
    });

    it('should not activate when keyword is not found', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon'],
          content: 'Dragons are magical',
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'The cat slept peacefully');
      expect(result).toHaveLength(0);
    });

    it('should activate when any keyword matches', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon', 'wyvern', 'serpent'],
          content: 'Flying creatures',
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'A wyvern appeared');
      expect(result).toHaveLength(1);
    });

    it('should not activate disabled entries', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: false,
          keys: ['dragon'],
          content: 'Dragons exist',
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'The dragon appeared');
      expect(result).toHaveLength(0);
    });

    it('should return empty array for null lorebooks', () => {
      const result = activator.activate(null, 'any content');
      expect(result).toEqual([]);
    });

    it('should return empty array for empty lorebook array', () => {
      const result = activator.activate([], 'any content');
      expect(result).toEqual([]);
    });
  });

  describe('Case Sensitivity', () => {
    it('should match case-insensitively by default', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['Dragon'],
          content: 'Dragon info',
          caseSensitive: false,
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'A dragon and a DRAGON');
      expect(result).toHaveLength(1);
    });

    it('should match case-sensitively when enabled', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['Dragon'],
          content: 'Dragon info',
          caseSensitive: true,
          insertionOrder: 100
        }
      ];

      const result1 = activator.activate([lorebook], 'A Dragon appeared');
      expect(result1).toHaveLength(1);

      const result2 = activator.activate([lorebook], 'A dragon appeared');
      expect(result2).toHaveLength(0);
    });
  });

  describe('Whole Word Matching', () => {
    it('should match whole words only when enabled', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['cat'],
          content: 'Cat info',
          matchWholeWords: true,
          caseSensitive: false,
          insertionOrder: 100
        }
      ];

      const result1 = activator.activate([lorebook], 'The cat sat');
      expect(result1).toHaveLength(1);

      const result2 = activator.activate([lorebook], 'The category is empty');
      expect(result2).toHaveLength(0);
    });

    it('should match substrings when whole word matching disabled', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['cat'],
          content: 'Cat info',
          matchWholeWords: false,
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'The category is empty');
      expect(result).toHaveLength(1);
    });
  });

  describe('Regex Matching', () => {
    it('should support regex patterns', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['/dr[ao]gon/i'],
          content: 'Dragon variants',
          useRegex: true,
          insertionOrder: 100
        }
      ];

      const result1 = activator.activate([lorebook], 'A dragon appeared');
      expect(result1).toHaveLength(1);

      const result2 = activator.activate([lorebook], 'A drogon appeared');
      expect(result2).toHaveLength(1);
    });

    it('should support regex without delimiters', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['d\\w+n'],
          content: 'Pattern match',
          useRegex: true,
          caseSensitive: false,
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'A dragon in a dungeon');
      expect(result).toHaveLength(1);
    });

    it('should handle regex errors gracefully', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['/(invalid/'], // Invalid regex
          content: 'Content',
          useRegex: true,
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'Any content');
      expect(result).toHaveLength(0);
    });
  });

  describe('Constant Entries', () => {
    it('should always activate constant entries', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          constant: true,
          content: 'Always active info',
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'Any content without keywords');
      expect(result).toHaveLength(1);
    });

    it('should respect probability for constant entries', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          constant: true,
          useProbability: true,
          probability: 0, // 0% chance
          content: 'Never active',
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'Any content');
      expect(result).toHaveLength(0);
    });
  });

  describe('Selective Logic', () => {
    it('should support AND_ANY logic (primary + at least one secondary)', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon'],
          selective: true,
          selectiveLogic: 0, // AND_ANY
          secondaryKeys: ['fire', 'ice'],
          content: 'Dragon with element',
          insertionOrder: 100
        }
      ];

      const result1 = activator.activate([lorebook], 'A dragon with fire breath');
      expect(result1).toHaveLength(1);

      const result2 = activator.activate([lorebook], 'A dragon appeared');
      expect(result2).toHaveLength(0);
    });

    it('should support NOT_ANY logic (primary but NO secondary)', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon'],
          selective: true,
          selectiveLogic: 1, // NOT_ANY
          secondaryKeys: ['fire', 'ice'],
          content: 'Plain dragon',
          insertionOrder: 100
        }
      ];

      const result1 = activator.activate([lorebook], 'A dragon appeared');
      expect(result1).toHaveLength(1);

      const result2 = activator.activate([lorebook], 'A dragon with fire');
      expect(result2).toHaveLength(0);
    });

    it('should support AND_ALL logic (primary + all secondaries)', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon'],
          selective: true,
          selectiveLogic: 3, // AND_ALL
          secondaryKeys: ['fire', 'wings'],
          content: 'Complete dragon',
          insertionOrder: 100
        }
      ];

      const result1 = activator.activate([lorebook], 'A dragon with fire and wings');
      expect(result1).toHaveLength(1);

      const result2 = activator.activate([lorebook], 'A dragon with fire');
      expect(result2).toHaveLength(0);
    });

    it('should support NOT_ALL logic (primary but NOT all secondaries)', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon'],
          selective: true,
          selectiveLogic: 2, // NOT_ALL
          secondaryKeys: ['fire', 'wings'],
          content: 'Incomplete dragon',
          insertionOrder: 100
        }
      ];

      const result1 = activator.activate([lorebook], 'A dragon with fire');
      expect(result1).toHaveLength(1);

      const result2 = activator.activate([lorebook], 'A dragon with fire and wings');
      expect(result2).toHaveLength(0);
    });
  });

  describe('Insertion Order & Sorting', () => {
    it('should sort by insertion order', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon'],
          content: 'High priority',
          insertionOrder: 500
        },
        {
          id: '2',
          enabled: true,
          keys: ['dragon'],
          content: 'Low priority',
          insertionOrder: 100
        },
        {
          id: '3',
          enabled: true,
          keys: ['dragon'],
          content: 'Medium priority',
          insertionOrder: 300
        }
      ];

      const result = activator.activate([lorebook], 'A dragon');
      expect(result[0].content).toBe('Low priority');
      expect(result[1].content).toBe('Medium priority');
      expect(result[2].content).toBe('High priority');
    });
  });

  describe('Token Budget', () => {
    it('should limit entries by token budget', () => {
      const smallBudgetActivator = new LorebookActivator({
        lorebookTokenBudget: 10 // Very small budget
      });

      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          constant: true,
          content: 'x'.repeat(40), // ~10 tokens
          insertionOrder: 100
        },
        {
          id: '2',
          enabled: true,
          constant: true,
          content: 'y'.repeat(40), // ~10 tokens (would exceed budget)
          insertionOrder: 200
        }
      ];

      const result = smallBudgetActivator.activate([lorebook], 'content');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should include entries until budget is exceeded', () => {
      const limitedActivator = new LorebookActivator({
        lorebookTokenBudget: 50
      });

      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          constant: true,
          content: 'a'.repeat(40), // ~10 tokens
          insertionOrder: 100
        },
        {
          id: '2',
          enabled: true,
          constant: true,
          content: 'b'.repeat(80), // ~20 tokens
          insertionOrder: 200
        },
        {
          id: '3',
          enabled: true,
          constant: true,
          content: 'c'.repeat(120), // ~30 tokens (would exceed)
          insertionOrder: 300
        }
      ];

      const result = limitedActivator.activate([lorebook], 'content');
      expect(result).toHaveLength(2);
    });
  });

  describe('Recursion', () => {
    it('should recursively activate entries based on activated content', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon'],
          content: 'Dragons breathe fire',
          insertionOrder: 100
        },
        {
          id: '2',
          enabled: true,
          keys: ['fire'],
          content: 'Fire is hot',
          insertionOrder: 200
        }
      ];

      const result = activator.activate([lorebook], 'A dragon appeared');
      expect(result).toHaveLength(2);
      expect(result.some(e => e.id === '1')).toBe(true);
      expect(result.some(e => e.id === '2')).toBe(true);
    });

    it('should respect recursion depth limit', () => {
      const limitedActivator = new LorebookActivator({
        lorebookRecursionDepth: 1
      });

      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['one'],
          content: 'Content with two',
          insertionOrder: 100
        },
        {
          id: '2',
          enabled: true,
          keys: ['two'],
          content: 'Content with three',
          insertionOrder: 200
        },
        {
          id: '3',
          enabled: true,
          keys: ['three'],
          content: 'Final content',
          insertionOrder: 300
        }
      ];

      const result = limitedActivator.activate([lorebook], 'one');
      // Should activate 1 and 2, but not 3 (depth exceeded)
      expect(result).toHaveLength(2);
    });

    it('should not recurse when recursion disabled', () => {
      const noRecursionActivator = new LorebookActivator({
        lorebookEnableRecursion: false
      });

      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon'],
          content: 'Dragons breathe fire',
          insertionOrder: 100
        },
        {
          id: '2',
          enabled: true,
          keys: ['fire'],
          content: 'Fire info',
          insertionOrder: 200
        }
      ];

      const result = noRecursionActivator.activate([lorebook], 'A dragon');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should respect preventRecursion flag', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon'],
          content: 'Dragons breathe fire',
          preventRecursion: true,
          insertionOrder: 100
        },
        {
          id: '2',
          enabled: true,
          keys: ['fire'],
          content: 'Fire info',
          insertionOrder: 200
        }
      ];

      const result = activator.activate([lorebook], 'A dragon');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should delay entries until recursion when specified', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon'],
          content: 'Dragons breathe fire',
          insertionOrder: 100
        },
        {
          id: '2',
          enabled: true,
          keys: ['fire'],
          delayUntilRecursion: true,
          content: 'Fire (delayed)',
          insertionOrder: 200
        }
      ];

      const result = activator.activate([lorebook], 'A dragon with fire');
      // Entry 2 should not activate from initial scan even though "fire" is in scan content
      // It should only activate during recursion
      expect(result).toHaveLength(2);
    });
  });

  describe('Scan Depth', () => {
    it('should limit scan to configured depth', () => {
      const shallowActivator = new LorebookActivator({
        lorebookScanDepth: 10 // Very small, ~40 chars
      });

      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['keyword'],
          content: 'Found',
          insertionOrder: 100
        }
      ];

      // Create content longer than scan depth with keyword at the end
      const longContent = 'x'.repeat(100) + ' keyword';
      const result = shallowActivator.activate([lorebook], longContent);

      // Should find it because we scan from the end
      expect(result).toHaveLength(1);
    });
  });

  describe('Multiple Lorebooks', () => {
    it('should combine entries from multiple lorebooks', () => {
      const lorebook1 = {
        name: 'Lorebook 1',
        entries: [
          {
            id: '1',
            enabled: true,
            keys: ['dragon'],
            content: 'From lorebook 1',
            insertionOrder: 100
          }
        ]
      };

      const lorebook2 = {
        name: 'Lorebook 2',
        entries: [
          {
            id: '2',
            enabled: true,
            keys: ['dragon'],
            content: 'From lorebook 2',
            insertionOrder: 200
          }
        ]
      };

      const result = activator.activate([lorebook1, lorebook2], 'A dragon');
      expect(result).toHaveLength(2);
    });
  });

  describe('Helper Functions', () => {
    it('should escape regex special characters', () => {
      const escaped = activator._escapeRegex('test.*+?^${}()|[]\\');
      expect(escaped).toBe('test\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    });

    it('should format entries for prompt', () => {
      const entries = [
        {
          comment: 'Entry 1',
          content: 'Content 1'
        },
        {
          content: 'Content 2'
        }
      ];

      const result = activator.formatForPrompt(entries);
      expect(result).toContain('<!-- Entry 1 -->');
      expect(result).toContain('Content 1');
      expect(result).toContain('Content 2');
    });

    it('should return empty string for empty entries in formatForPrompt', () => {
      const result = activator.formatForPrompt([]);
      expect(result).toBe('');
    });
  });

  describe('Edge Cases', () => {
    it('should handle entries without keys', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: [],
          content: 'No keys',
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'Any content');
      expect(result).toHaveLength(0);
    });

    it('should handle empty key strings', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: [''],
          content: 'Empty key',
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'Any content');
      expect(result).toHaveLength(0);
    });

    it('should not activate same entry twice', () => {
      lorebook.entries = [
        {
          id: '1',
          enabled: true,
          keys: ['dragon'],
          content: 'Dragon info mentioning dragon again',
          insertionOrder: 100
        }
      ];

      const result = activator.activate([lorebook], 'A dragon');
      expect(result).toHaveLength(1);
    });
  });
});
