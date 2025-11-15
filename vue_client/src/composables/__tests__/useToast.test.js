import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useToast } from '../useToast.js';

describe('useToast', () => {
  let toastInstance;

  beforeEach(() => {
    vi.useFakeTimers();
    toastInstance = useToast();
    toastInstance.clear(); // Clear any existing toasts
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial State', () => {
    it('should start with no toasts', () => {
      expect(toastInstance.toasts.value).toHaveLength(0);
    });

    it('should expose toasts as an array', () => {
      expect(Array.isArray(toastInstance.toasts.value)).toBe(true);
    });
  });

  describe('show() method', () => {
    it('should add a toast to the list', () => {
      toastInstance.show('Test message', 'success');
      expect(toastInstance.toasts.value).toHaveLength(1);
    });

    it('should create toast with correct properties', () => {
      toastInstance.show('Test message', 'success', 3000);
      const toast = toastInstance.toasts.value[0];

      expect(toast.message).toBe('Test message');
      expect(toast.type).toBe('success');
      expect(toast.duration).toBe(3000);
      expect(toast.id).toBeDefined();
      expect(toast.createdAt).toBeDefined();
    });

    it('should use default type when not provided', () => {
      toastInstance.show('Test');
      expect(toastInstance.toasts.value[0].type).toBe('success');
    });

    it('should use default duration when not provided', () => {
      toastInstance.show('Test');
      expect(toastInstance.toasts.value[0].duration).toBe(3000);
    });

    it('should return unique IDs for each toast', () => {
      const id1 = toastInstance.show('Toast 1');
      const id2 = toastInstance.show('Toast 2');
      const id3 = toastInstance.show('Toast 3');

      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('should auto-dismiss after duration', () => {
      toastInstance.show('Test', 'success', 3000);
      expect(toastInstance.toasts.value).toHaveLength(1);

      vi.advanceTimersByTime(3000);
      expect(toastInstance.toasts.value).toHaveLength(0);
    });

    it('should not auto-dismiss when duration is 0', () => {
      toastInstance.show('Test', 'success', 0);
      expect(toastInstance.toasts.value).toHaveLength(1);

      vi.advanceTimersByTime(10000);
      expect(toastInstance.toasts.value).toHaveLength(1);
    });

    it('should handle multiple toasts with different durations', () => {
      toastInstance.show('Toast 1', 'success', 1000);
      toastInstance.show('Toast 2', 'success', 2000);
      toastInstance.show('Toast 3', 'success', 3000);

      expect(toastInstance.toasts.value).toHaveLength(3);

      vi.advanceTimersByTime(1000);
      expect(toastInstance.toasts.value).toHaveLength(2);

      vi.advanceTimersByTime(1000);
      expect(toastInstance.toasts.value).toHaveLength(1);

      vi.advanceTimersByTime(1000);
      expect(toastInstance.toasts.value).toHaveLength(0);
    });
  });

  describe('Convenience methods', () => {
    it('success() should create success toast', () => {
      toastInstance.success('Success!');
      const toast = toastInstance.toasts.value[0];

      expect(toast.message).toBe('Success!');
      expect(toast.type).toBe('success');
      expect(toast.duration).toBe(3000);
    });

    it('error() should create error toast', () => {
      toastInstance.error('Error!');
      const toast = toastInstance.toasts.value[0];

      expect(toast.message).toBe('Error!');
      expect(toast.type).toBe('error');
      expect(toast.duration).toBe(5000);
    });

    it('info() should create info toast', () => {
      toastInstance.info('Info');
      const toast = toastInstance.toasts.value[0];

      expect(toast.message).toBe('Info');
      expect(toast.type).toBe('info');
      expect(toast.duration).toBe(3000);
    });

    it('warning() should create warning toast', () => {
      toastInstance.warning('Warning');
      const toast = toastInstance.toasts.value[0];

      expect(toast.message).toBe('Warning');
      expect(toast.type).toBe('warning');
      expect(toast.duration).toBe(4000);
    });

    it('should allow custom duration for convenience methods', () => {
      toastInstance.success('Test', 1000);
      expect(toastInstance.toasts.value[0].duration).toBe(1000);

      toastInstance.error('Test', 2000);
      expect(toastInstance.toasts.value[1].duration).toBe(2000);
    });

    it('should return toast ID from convenience methods', () => {
      const id = toastInstance.success('Test');
      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThanOrEqual(0);
    });
  });

  describe('remove() method', () => {
    it('should remove toast by ID', () => {
      const id1 = toastInstance.show('Toast 1', 'success', 0);
      const id2 = toastInstance.show('Toast 2', 'success', 0);
      const id3 = toastInstance.show('Toast 3', 'success', 0);

      expect(toastInstance.toasts.value).toHaveLength(3);

      toastInstance.remove(id2);
      expect(toastInstance.toasts.value).toHaveLength(2);
      expect(toastInstance.toasts.value.find(t => t.id === id1)).toBeDefined();
      expect(toastInstance.toasts.value.find(t => t.id === id2)).toBeUndefined();
      expect(toastInstance.toasts.value.find(t => t.id === id3)).toBeDefined();
    });

    it('should handle removing non-existent toast', () => {
      toastInstance.show('Toast', 'success', 0);
      expect(() => toastInstance.remove(999)).not.toThrow();
      expect(toastInstance.toasts.value).toHaveLength(1);
    });

    it('should handle removing from empty list', () => {
      expect(() => toastInstance.remove(1)).not.toThrow();
      expect(toastInstance.toasts.value).toHaveLength(0);
    });

    it('should allow manual removal before auto-dismiss', () => {
      const id = toastInstance.show('Test', 'success', 5000);
      expect(toastInstance.toasts.value).toHaveLength(1);

      toastInstance.remove(id);
      expect(toastInstance.toasts.value).toHaveLength(0);

      // Auto-dismiss timer should not cause issues
      vi.advanceTimersByTime(5000);
      expect(toastInstance.toasts.value).toHaveLength(0);
    });
  });

  describe('clear() method', () => {
    it('should remove all toasts', () => {
      toastInstance.show('Toast 1', 'success', 0);
      toastInstance.show('Toast 2', 'error', 0);
      toastInstance.show('Toast 3', 'info', 0);

      expect(toastInstance.toasts.value).toHaveLength(3);

      toastInstance.clear();
      expect(toastInstance.toasts.value).toHaveLength(0);
    });

    it('should work on empty toast list', () => {
      expect(() => toastInstance.clear()).not.toThrow();
      expect(toastInstance.toasts.value).toHaveLength(0);
    });

    it('should clear toasts even with pending auto-dismiss', () => {
      toastInstance.show('Toast 1', 'success', 5000);
      toastInstance.show('Toast 2', 'success', 5000);

      toastInstance.clear();
      expect(toastInstance.toasts.value).toHaveLength(0);

      // Auto-dismiss timers should not cause issues
      vi.advanceTimersByTime(5000);
      expect(toastInstance.toasts.value).toHaveLength(0);
    });
  });

  describe('Toast types', () => {
    it('should support all toast types', () => {
      toastInstance.show('Success', 'success', 0);
      toastInstance.show('Error', 'error', 0);
      toastInstance.show('Info', 'info', 0);
      toastInstance.show('Warning', 'warning', 0);

      expect(toastInstance.toasts.value).toHaveLength(4);
      expect(toastInstance.toasts.value[0].type).toBe('success');
      expect(toastInstance.toasts.value[1].type).toBe('error');
      expect(toastInstance.toasts.value[2].type).toBe('info');
      expect(toastInstance.toasts.value[3].type).toBe('warning');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty message', () => {
      toastInstance.show('', 'success');
      expect(toastInstance.toasts.value[0].message).toBe('');
    });

    it('should handle very long messages', () => {
      const longMessage = 'a'.repeat(1000);
      toastInstance.show(longMessage, 'success');
      expect(toastInstance.toasts.value[0].message).toBe(longMessage);
    });

    it('should handle special characters in message', () => {
      const specialMessage = 'Error: "file.txt" can\'t be found!';
      toastInstance.show(specialMessage, 'error');
      expect(toastInstance.toasts.value[0].message).toBe(specialMessage);
    });

    it('should handle very short durations', () => {
      toastInstance.show('Test', 'success', 1);
      expect(toastInstance.toasts.value).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(toastInstance.toasts.value).toHaveLength(0);
    });

    it('should handle very long durations', () => {
      toastInstance.show('Test', 'success', 1000000);
      expect(toastInstance.toasts.value).toHaveLength(1);

      vi.advanceTimersByTime(999999);
      expect(toastInstance.toasts.value).toHaveLength(1);

      vi.advanceTimersByTime(1);
      expect(toastInstance.toasts.value).toHaveLength(0);
    });

    it('should handle negative duration as non-dismissing', () => {
      toastInstance.show('Test', 'success', -1);
      expect(toastInstance.toasts.value).toHaveLength(1);

      vi.advanceTimersByTime(10000);
      expect(toastInstance.toasts.value).toHaveLength(1);
    });
  });

  describe('Multiple instances', () => {
    it('should share toast state across instances', () => {
      const instance1 = useToast();
      const instance2 = useToast();

      instance1.show('From instance 1', 'success', 0);
      expect(instance2.toasts.value).toHaveLength(1);

      instance2.show('From instance 2', 'error', 0);
      expect(instance1.toasts.value).toHaveLength(2);
    });

    it('should allow any instance to remove toasts', () => {
      const instance1 = useToast();
      const instance2 = useToast();

      const id = instance1.show('Test', 'success', 0);
      instance2.remove(id);

      expect(instance1.toasts.value).toHaveLength(0);
    });
  });

  describe('createdAt timestamp', () => {
    it('should set createdAt timestamp', () => {
      const before = Date.now();
      toastInstance.show('Test', 'success');
      const after = Date.now();

      const toast = toastInstance.toasts.value[0];
      expect(toast.createdAt).toBeGreaterThanOrEqual(before);
      expect(toast.createdAt).toBeLessThanOrEqual(after);
    });

    it('should have different timestamps for sequential toasts', () => {
      toastInstance.show('Test 1', 'success', 0);
      vi.advanceTimersByTime(10);
      toastInstance.show('Test 2', 'success', 0);

      const toast1 = toastInstance.toasts.value[0];
      const toast2 = toastInstance.toasts.value[1];
      expect(toast2.createdAt).toBeGreaterThanOrEqual(toast1.createdAt);
    });
  });
});
