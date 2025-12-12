import { describe, it, expect } from 'vitest';
import { calculateWordCount } from '../database.js';

describe('calculateWordCount', () => {
  describe('Basic Word Counting', () => {
    it('should count simple words', () => {
      expect(calculateWordCount('hello world')).toBe(2);
    });

    it('should count a single word', () => {
      expect(calculateWordCount('hello')).toBe(1);
    });

    it('should count words in a sentence', () => {
      expect(calculateWordCount('The quick brown fox jumps over the lazy dog')).toBe(9);
    });

    it('should handle multiple spaces between words', () => {
      expect(calculateWordCount('hello    world')).toBe(2);
    });

    it('should handle leading and trailing spaces', () => {
      expect(calculateWordCount('  hello world  ')).toBe(2);
    });

    it('should handle newlines', () => {
      expect(calculateWordCount('hello\nworld')).toBe(2);
    });

    it('should handle tabs', () => {
      expect(calculateWordCount('hello\tworld')).toBe(2);
    });
  });

  describe('Edge Cases', () => {
    it('should return 0 for empty string', () => {
      expect(calculateWordCount('')).toBe(0);
    });

    it('should return 0 for null', () => {
      expect(calculateWordCount(null)).toBe(0);
    });

    it('should return 0 for undefined', () => {
      expect(calculateWordCount(undefined)).toBe(0);
    });

    it('should return 0 for non-string values', () => {
      expect(calculateWordCount(123)).toBe(0);
      expect(calculateWordCount({})).toBe(0);
      expect(calculateWordCount([])).toBe(0);
    });

    it('should return 0 for whitespace-only string', () => {
      expect(calculateWordCount('   \n\t  ')).toBe(0);
    });
  });

  describe('Contractions', () => {
    it('should count contractions as single words', () => {
      expect(calculateWordCount("don't")).toBe(1);
      expect(calculateWordCount("it's")).toBe(1);
      expect(calculateWordCount("I'm")).toBe(1);
      expect(calculateWordCount("you're")).toBe(1);
      expect(calculateWordCount("they've")).toBe(1);
    });

    it('should count contractions in sentences correctly', () => {
      expect(calculateWordCount("I don't know what you're talking about")).toBe(7);
    });

    it('should handle curly apostrophes in contractions', () => {
      expect(calculateWordCount("don't")).toBe(1);
      expect(calculateWordCount("it's")).toBe(1);
    });
  });

  describe('Hyphenated Words', () => {
    it('should count hyphenated words as single words', () => {
      expect(calculateWordCount('well-known')).toBe(1);
      expect(calculateWordCount('state-of-the-art')).toBe(1);
      expect(calculateWordCount('self-aware')).toBe(1);
    });

    it('should count hyphenated words in sentences correctly', () => {
      expect(calculateWordCount('The well-known author wrote a best-selling book')).toBe(7);
    });
  });

  describe('Punctuation', () => {
    it('should not count standalone punctuation as words', () => {
      expect(calculateWordCount('hello, world!')).toBe(2);
      expect(calculateWordCount('hello... world?')).toBe(2);
    });

    it('should handle sentences with various punctuation', () => {
      expect(calculateWordCount('Hello, world! How are you?')).toBe(5);
    });

    it('should handle quoted text', () => {
      expect(calculateWordCount('"Hello," she said.')).toBe(3);
    });
  });

  describe('Numbers', () => {
    it('should count numbers as words', () => {
      expect(calculateWordCount('I have 42 apples')).toBe(4);
    });

    it('should count alphanumeric strings as words', () => {
      expect(calculateWordCount('Model T2000')).toBe(2);
    });
  });

  describe('Mixed Content', () => {
    it('should handle typical story content', () => {
      const content = `"I don't believe it," she said, her well-known temper flaring.
        "It's impossible!" He wasn't convinced, but the state-of-the-art evidence was clear.`;
      // Words: I, don't, believe, it, she, said, her, well-known, temper, flaring,
      //        It's, impossible, He, wasn't, convinced, but, the, state-of-the-art, evidence, was, clear
      expect(calculateWordCount(content)).toBe(21);
    });
  });
});
