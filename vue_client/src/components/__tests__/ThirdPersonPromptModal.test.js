import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import ThirdPersonPromptModal from '../ThirdPersonPromptModal.vue';
import Modal from '../Modal.vue';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    })
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

describe('ThirdPersonPromptModal', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the modal with correct title', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      expect(wrapper.findComponent(Modal).props('title')).toBe('Rewrite to Third Person?');
    });

    it('should display the prompt message', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      expect(wrapper.find('.prompt-message').text()).toBe(
        'Would you like to rewrite this text to third-person narrative style?'
      );
    });

    it('should display the description', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      expect(wrapper.find('.prompt-description').text()).toContain(
        'third-person past tense'
      );
      expect(wrapper.find('.prompt-description').text()).toContain(
        'recommended format'
      );
    });

    it('should render the checkbox with proper accessibility attributes', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const checkbox = wrapper.find('input[type="checkbox"]');
      const label = wrapper.find('label[for="dont-ask-third-person"]');

      expect(checkbox.exists()).toBe(true);
      expect(checkbox.attributes('id')).toBe('dont-ask-third-person');
      expect(label.exists()).toBe(true);
      expect(label.text()).toBe("Don't ask me again");
    });

    it('should render Skip button', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const skipButton = wrapper.findAll('button').find(b => b.text() === 'Skip');
      expect(skipButton).toBeTruthy();
      expect(skipButton.classes()).toContain('btn-secondary');
    });

    it('should render Rewrite button with icon', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const rewriteButton = wrapper.findAll('button').find(b => b.text().includes('Rewrite'));
      expect(rewriteButton).toBeTruthy();
      expect(rewriteButton.classes()).toContain('btn-primary');
      expect(rewriteButton.find('i.fa-repeat').exists()).toBe(true);
    });
  });

  describe('Checkbox State', () => {
    it('should start with checkbox unchecked', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const checkbox = wrapper.find('input[type="checkbox"]');
      expect(checkbox.element.checked).toBe(false);
    });

    it('should toggle checkbox state when clicked', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const checkbox = wrapper.find('input[type="checkbox"]');
      expect(checkbox.element.checked).toBe(false);

      await checkbox.setValue(true);
      expect(checkbox.element.checked).toBe(true);

      await checkbox.setValue(false);
      expect(checkbox.element.checked).toBe(false);
    });
  });

  describe('Events - Skip', () => {
    it('should emit skip and close events when Skip button clicked', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const skipButton = wrapper.findAll('button').find(b => b.text() === 'Skip');
      await skipButton.trigger('click');

      expect(wrapper.emitted('skip')).toBeTruthy();
      expect(wrapper.emitted('skip')).toHaveLength(1);
      expect(wrapper.emitted('close')).toBeTruthy();
      expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('should not emit rewrite event when Skip clicked', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const skipButton = wrapper.findAll('button').find(b => b.text() === 'Skip');
      await skipButton.trigger('click');

      expect(wrapper.emitted('rewrite')).toBeFalsy();
    });

    it('should not save preference when Skip clicked with checkbox unchecked', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const skipButton = wrapper.findAll('button').find(b => b.text() === 'Skip');
      await skipButton.trigger('click');

      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('should save preference when Skip clicked with checkbox checked', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const checkbox = wrapper.find('input[type="checkbox"]');
      await checkbox.setValue(true);

      const skipButton = wrapper.findAll('button').find(b => b.text() === 'Skip');
      await skipButton.trigger('click');

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'writers-guild-skip-third-person-prompt',
        'true'
      );
    });
  });

  describe('Events - Rewrite', () => {
    it('should emit rewrite and close events when Rewrite button clicked', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const rewriteButton = wrapper.findAll('button').find(b => b.text().includes('Rewrite'));
      await rewriteButton.trigger('click');

      expect(wrapper.emitted('rewrite')).toBeTruthy();
      expect(wrapper.emitted('rewrite')).toHaveLength(1);
      expect(wrapper.emitted('close')).toBeTruthy();
      expect(wrapper.emitted('close')).toHaveLength(1);
    });

    it('should not emit skip event when Rewrite clicked', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const rewriteButton = wrapper.findAll('button').find(b => b.text().includes('Rewrite'));
      await rewriteButton.trigger('click');

      expect(wrapper.emitted('skip')).toBeFalsy();
    });

    it('should not save preference when Rewrite clicked with checkbox unchecked', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const rewriteButton = wrapper.findAll('button').find(b => b.text().includes('Rewrite'));
      await rewriteButton.trigger('click');

      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('should save preference when Rewrite clicked with checkbox checked', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const checkbox = wrapper.find('input[type="checkbox"]');
      await checkbox.setValue(true);

      const rewriteButton = wrapper.findAll('button').find(b => b.text().includes('Rewrite'));
      await rewriteButton.trigger('click');

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'writers-guild-skip-third-person-prompt',
        'true'
      );
    });
  });

  describe('Events - Close via Modal', () => {
    it('should emit skip and close when modal close is triggered', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      // Trigger close from the Modal component
      await wrapper.findComponent(Modal).vm.$emit('close');

      expect(wrapper.emitted('skip')).toBeTruthy();
      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });

  describe('localStorage Interaction', () => {
    it('should use correct localStorage key', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const checkbox = wrapper.find('input[type="checkbox"]');
      await checkbox.setValue(true);

      const skipButton = wrapper.findAll('button').find(b => b.text() === 'Skip');
      await skipButton.trigger('click');

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'writers-guild-skip-third-person-prompt',
        'true'
      );
    });

    it('should only save preference once per action', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const checkbox = wrapper.find('input[type="checkbox"]');
      await checkbox.setValue(true);

      const rewriteButton = wrapper.findAll('button').find(b => b.text().includes('Rewrite'));
      await rewriteButton.trigger('click');

      expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('Structure', () => {
    it('should have prompt-content container', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      expect(wrapper.find('.prompt-content').exists()).toBe(true);
    });

    it('should have prompt-message element', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      expect(wrapper.find('.prompt-message').exists()).toBe(true);
    });

    it('should have prompt-description element', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      expect(wrapper.find('.prompt-description').exists()).toBe(true);
    });

    it('should have dont-ask-checkbox container', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      expect(wrapper.find('.dont-ask-checkbox').exists()).toBe(true);
    });

    it('should have Skip and Rewrite buttons in footer', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      // Find buttons by their text content (footer has Skip and Rewrite)
      const skipButton = wrapper.findAll('button').find(b => b.text() === 'Skip');
      const rewriteButton = wrapper.findAll('button').find(b => b.text().includes('Rewrite'));

      expect(skipButton).toBeTruthy();
      expect(rewriteButton).toBeTruthy();
    });
  });

  describe('Modal Props', () => {
    it('should pass correct max-width to Modal', () => {
      const wrapper = mount(ThirdPersonPromptModal);

      expect(wrapper.findComponent(Modal).props('maxWidth')).toBe('500px');
    });
  });

  describe('Event Order', () => {
    it('should emit events in correct order for Skip: skip then close', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const skipButton = wrapper.findAll('button').find(b => b.text() === 'Skip');
      await skipButton.trigger('click');

      const emittedEvents = Object.keys(wrapper.emitted());
      const skipIndex = emittedEvents.indexOf('skip');
      const closeIndex = emittedEvents.indexOf('close');

      expect(skipIndex).toBeLessThan(closeIndex);
    });

    it('should emit events in correct order for Rewrite: rewrite then close', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const rewriteButton = wrapper.findAll('button').find(b => b.text().includes('Rewrite'));
      await rewriteButton.trigger('click');

      const emittedEvents = Object.keys(wrapper.emitted());
      const rewriteIndex = emittedEvents.indexOf('rewrite');
      const closeIndex = emittedEvents.indexOf('close');

      expect(rewriteIndex).toBeLessThan(closeIndex);
    });
  });

  describe('Multiple Actions', () => {
    it('should handle rapid clicking without duplicate events', async () => {
      const wrapper = mount(ThirdPersonPromptModal);

      const skipButton = wrapper.findAll('button').find(b => b.text() === 'Skip');

      // Simulate rapid clicks
      await skipButton.trigger('click');
      await skipButton.trigger('click');
      await skipButton.trigger('click');

      // Each click should emit events (component doesn't prevent this)
      expect(wrapper.emitted('skip').length).toBe(3);
      expect(wrapper.emitted('close').length).toBe(3);
    });
  });
});
