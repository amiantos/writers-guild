import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ConfirmDialog from '../ConfirmDialog.vue';

describe('ConfirmDialog', () => {
  describe('Rendering', () => {
    it('should render with required props', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Are you sure?'
        }
      });

      expect(wrapper.text()).toContain('Are you sure?');
    });

    it('should display custom message', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Delete this item?'
        }
      });

      expect(wrapper.find('.confirm-message').text()).toBe('Delete this item?');
    });

    it('should display default button texts', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      const buttons = wrapper.findAll('button');
      expect(buttons[0].text()).toBe('Cancel');
      expect(buttons[1].text()).toBe('Confirm');
    });

    it('should display custom confirm text', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test',
          confirmText: 'Delete'
        }
      });

      const confirmButton = wrapper.findAll('button')[1];
      expect(confirmButton.text()).toBe('Delete');
    });

    it('should display custom cancel text', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test',
          cancelText: 'Keep'
        }
      });

      const cancelButton = wrapper.findAll('button')[0];
      expect(cancelButton.text()).toBe('Keep');
    });
  });

  describe('Variants', () => {
    it('should default to default variant', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      expect(wrapper.find('.confirm-dialog').classes()).toContain('confirm-default');
    });

    it('should apply danger variant styling', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test',
          variant: 'danger'
        }
      });

      expect(wrapper.find('.confirm-dialog').classes()).toContain('confirm-danger');
    });

    it('should apply warning variant styling', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test',
          variant: 'warning'
        }
      });

      expect(wrapper.find('.confirm-dialog').classes()).toContain('confirm-warning');
    });

    it('should show correct icon for default variant', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test',
          variant: 'default'
        }
      });

      expect(wrapper.find('.fa-circle-question').exists()).toBe(true);
    });

    it('should show correct icon for danger variant', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test',
          variant: 'danger'
        }
      });

      expect(wrapper.find('.fa-trash-can').exists()).toBe(true);
    });

    it('should show correct icon for warning variant', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test',
          variant: 'warning'
        }
      });

      expect(wrapper.find('.fa-triangle-exclamation').exists()).toBe(true);
    });
  });

  describe('Button Styling', () => {
    it('should apply primary class to confirm button in default variant', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test',
          variant: 'default'
        }
      });

      const confirmButton = wrapper.findAll('button')[1];
      expect(confirmButton.classes()).toContain('btn-primary');
    });

    it('should apply danger class to confirm button in danger variant', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test',
          variant: 'danger'
        }
      });

      const confirmButton = wrapper.findAll('button')[1];
      expect(confirmButton.classes()).toContain('btn-danger');
    });

    it('should apply warning class to confirm button in warning variant', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test',
          variant: 'warning'
        }
      });

      const confirmButton = wrapper.findAll('button')[1];
      expect(confirmButton.classes()).toContain('btn-warning');
    });

    it('should always apply secondary class to cancel button', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      const cancelButton = wrapper.findAll('button')[0];
      expect(cancelButton.classes()).toContain('btn-secondary');
    });
  });

  describe('Events', () => {
    it('should emit confirm event when confirm button clicked', async () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      const confirmButton = wrapper.findAll('button')[1];
      await confirmButton.trigger('click');

      expect(wrapper.emitted('confirm')).toBeTruthy();
      expect(wrapper.emitted('confirm')).toHaveLength(1);
    });

    it('should emit cancel event when cancel button clicked', async () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      const cancelButton = wrapper.findAll('button')[0];
      await cancelButton.trigger('click');

      expect(wrapper.emitted('cancel')).toBeTruthy();
      expect(wrapper.emitted('cancel')).toHaveLength(1);
    });

    it('should not emit cancel when confirm is clicked', async () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      const confirmButton = wrapper.findAll('button')[1];
      await confirmButton.trigger('click');

      expect(wrapper.emitted('cancel')).toBeFalsy();
    });

    it('should not emit confirm when cancel is clicked', async () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      const cancelButton = wrapper.findAll('button')[0];
      await cancelButton.trigger('click');

      expect(wrapper.emitted('confirm')).toBeFalsy();
    });
  });

  describe('Structure', () => {
    it('should have overlay wrapper', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      expect(wrapper.find('.confirm-overlay').exists()).toBe(true);
    });

    it('should have dialog container', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      expect(wrapper.find('.confirm-dialog').exists()).toBe(true);
    });

    it('should have icon section', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      expect(wrapper.find('.confirm-icon').exists()).toBe(true);
    });

    it('should have message section', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      expect(wrapper.find('.confirm-message').exists()).toBe(true);
    });

    it('should have actions section', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      expect(wrapper.find('.confirm-actions').exists()).toBe(true);
    });

    it('should have exactly two buttons', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: 'Test'
        }
      });

      expect(wrapper.findAll('button')).toHaveLength(2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message', () => {
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: ''
        }
      });

      expect(wrapper.find('.confirm-message').text()).toBe('');
    });

    it('should handle very long messages', () => {
      const longMessage = 'a'.repeat(500);
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: longMessage
        }
      });

      expect(wrapper.find('.confirm-message').text()).toBe(longMessage);
    });

    it('should handle special characters in message', () => {
      const specialMessage = 'Delete "file.txt"? This can\'t be undone!';
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: specialMessage
        }
      });

      expect(wrapper.find('.confirm-message').text()).toBe(specialMessage);
    });

    it('should handle newlines in message', () => {
      const multilineMessage = 'Line 1\nLine 2\nLine 3';
      const wrapper = mount(ConfirmDialog, {
        props: {
          message: multilineMessage
        }
      });

      expect(wrapper.find('.confirm-message').text()).toBe(multilineMessage);
    });
  });

  describe('Props Validation', () => {
    it('should accept valid variant values', () => {
      const validVariants = ['default', 'danger', 'warning'];

      validVariants.forEach(variant => {
        const wrapper = mount(ConfirmDialog, {
          props: {
            message: 'Test',
            variant
          }
        });

        expect(wrapper.exists()).toBe(true);
      });
    });
  });

  describe('Multiple Instances', () => {
    it('should render independently with different props', () => {
      const wrapper1 = mount(ConfirmDialog, {
        props: {
          message: 'First dialog',
          variant: 'danger'
        }
      });

      const wrapper2 = mount(ConfirmDialog, {
        props: {
          message: 'Second dialog',
          variant: 'warning'
        }
      });

      expect(wrapper1.find('.confirm-message').text()).toBe('First dialog');
      expect(wrapper2.find('.confirm-message').text()).toBe('Second dialog');
      expect(wrapper1.find('.confirm-dialog').classes()).toContain('confirm-danger');
      expect(wrapper2.find('.confirm-dialog').classes()).toContain('confirm-warning');
    });
  });
});
