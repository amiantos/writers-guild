import { describe, it, expect, beforeEach } from 'vitest';
import { useConfirm } from '../useConfirm.js';

describe('useConfirm', () => {
  let confirmInstance;

  beforeEach(() => {
    // Get a fresh instance for each test
    confirmInstance = useConfirm();
    // Reset state
    confirmInstance.isVisible.value = false;
  });

  describe('Initial State', () => {
    it('should start with dialog hidden', () => {
      expect(confirmInstance.isVisible.value).toBe(false);
    });

    it('should have default config values', () => {
      const config = confirmInstance.config.value;
      expect(config.confirmText).toBe('Confirm');
      expect(config.cancelText).toBe('Cancel');
      expect(config.variant).toBe('default');
    });
  });

  describe('confirm() method', () => {
    it('should show dialog when confirm is called', () => {
      confirmInstance.confirm({ message: 'Test message' });
      expect(confirmInstance.isVisible.value).toBe(true);
    });

    it('should set message in config', () => {
      confirmInstance.confirm({ message: 'Delete this item?' });
      expect(confirmInstance.config.value.message).toBe('Delete this item?');
    });

    it('should use default confirmText when not provided', () => {
      confirmInstance.confirm({ message: 'Test' });
      expect(confirmInstance.config.value.confirmText).toBe('Confirm');
    });

    it('should use custom confirmText when provided', () => {
      confirmInstance.confirm({
        message: 'Test',
        confirmText: 'Delete'
      });
      expect(confirmInstance.config.value.confirmText).toBe('Delete');
    });

    it('should use default cancelText when not provided', () => {
      confirmInstance.confirm({ message: 'Test' });
      expect(confirmInstance.config.value.cancelText).toBe('Cancel');
    });

    it('should use custom cancelText when provided', () => {
      confirmInstance.confirm({
        message: 'Test',
        cancelText: 'Keep'
      });
      expect(confirmInstance.config.value.cancelText).toBe('Keep');
    });

    it('should use default variant when not provided', () => {
      confirmInstance.confirm({ message: 'Test' });
      expect(confirmInstance.config.value.variant).toBe('default');
    });

    it('should use custom variant when provided', () => {
      confirmInstance.confirm({
        message: 'Test',
        variant: 'danger'
      });
      expect(confirmInstance.config.value.variant).toBe('danger');
    });

    it('should return a Promise', () => {
      const result = confirmInstance.confirm({ message: 'Test' });
      expect(result).toBeInstanceOf(Promise);
    });

    it('should handle empty message', () => {
      confirmInstance.confirm({ message: '' });
      expect(confirmInstance.config.value.message).toBe('');
      expect(confirmInstance.isVisible.value).toBe(true);
    });

    it('should handle missing message option', () => {
      confirmInstance.confirm({});
      expect(confirmInstance.config.value.message).toBe('');
    });
  });

  describe('handleConfirm() method', () => {
    it('should hide dialog when confirmed', () => {
      confirmInstance.confirm({ message: 'Test' });
      confirmInstance.handleConfirm();
      expect(confirmInstance.isVisible.value).toBe(false);
    });

    it('should resolve promise with true when confirmed', async () => {
      const promise = confirmInstance.confirm({ message: 'Test' });
      confirmInstance.handleConfirm();
      const result = await promise;
      expect(result).toBe(true);
    });

    it('should not throw when called without active confirmation', () => {
      expect(() => confirmInstance.handleConfirm()).not.toThrow();
    });
  });

  describe('handleCancel() method', () => {
    it('should hide dialog when cancelled', () => {
      confirmInstance.confirm({ message: 'Test' });
      confirmInstance.handleCancel();
      expect(confirmInstance.isVisible.value).toBe(false);
    });

    it('should resolve promise with false when cancelled', async () => {
      const promise = confirmInstance.confirm({ message: 'Test' });
      confirmInstance.handleCancel();
      const result = await promise;
      expect(result).toBe(false);
    });

    it('should not throw when called without active confirmation', () => {
      expect(() => confirmInstance.handleCancel()).not.toThrow();
    });
  });

  describe('Multiple confirmations', () => {
    it('should handle sequential confirmations', async () => {
      const promise1 = confirmInstance.confirm({ message: 'First' });
      confirmInstance.handleConfirm();
      const result1 = await promise1;
      expect(result1).toBe(true);

      const promise2 = confirmInstance.confirm({ message: 'Second' });
      confirmInstance.handleCancel();
      const result2 = await promise2;
      expect(result2).toBe(false);
    });

    it('should update config for each confirmation', () => {
      confirmInstance.confirm({ message: 'First', variant: 'danger' });
      expect(confirmInstance.config.value.message).toBe('First');
      expect(confirmInstance.config.value.variant).toBe('danger');

      confirmInstance.confirm({ message: 'Second', variant: 'warning' });
      expect(confirmInstance.config.value.message).toBe('Second');
      expect(confirmInstance.config.value.variant).toBe('warning');
    });
  });

  describe('Variant types', () => {
    it('should support danger variant', () => {
      confirmInstance.confirm({
        message: 'Delete?',
        variant: 'danger'
      });
      expect(confirmInstance.config.value.variant).toBe('danger');
    });

    it('should support warning variant', () => {
      confirmInstance.confirm({
        message: 'Warning!',
        variant: 'warning'
      });
      expect(confirmInstance.config.value.variant).toBe('warning');
    });

    it('should support default variant', () => {
      confirmInstance.confirm({
        message: 'Confirm?',
        variant: 'default'
      });
      expect(confirmInstance.config.value.variant).toBe('default');
    });
  });

  describe('Reactive state', () => {
    it('should expose isVisible as reactive ref', () => {
      expect(confirmInstance.isVisible.value).toBeDefined();
      confirmInstance.isVisible.value = true;
      expect(confirmInstance.isVisible.value).toBe(true);
    });

    it('should expose config as reactive ref', () => {
      expect(confirmInstance.config.value).toBeDefined();
      expect(typeof confirmInstance.config.value).toBe('object');
    });
  });

  describe('Edge cases', () => {
    it('should handle confirmation with all custom options', async () => {
      const promise = confirmInstance.confirm({
        message: 'Custom message',
        confirmText: 'Yes',
        cancelText: 'No',
        variant: 'danger'
      });

      expect(confirmInstance.config.value.message).toBe('Custom message');
      expect(confirmInstance.config.value.confirmText).toBe('Yes');
      expect(confirmInstance.config.value.cancelText).toBe('No');
      expect(confirmInstance.config.value.variant).toBe('danger');

      confirmInstance.handleConfirm();
      const result = await promise;
      expect(result).toBe(true);
    });

    it('should handle very long messages', () => {
      const longMessage = 'a'.repeat(1000);
      confirmInstance.confirm({ message: longMessage });
      expect(confirmInstance.config.value.message).toBe(longMessage);
    });

    it('should handle special characters in message', () => {
      const specialMessage = 'Delete "item"? This can\'t be undone!';
      confirmInstance.confirm({ message: specialMessage });
      expect(confirmInstance.config.value.message).toBe(specialMessage);
    });
  });
});
