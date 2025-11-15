import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import Tabs from '../Tabs.vue';

describe('Tabs', () => {
  const mockTabs = [
    { key: 'tab1', label: 'Tab 1', icon: 'fas fa-home' },
    { key: 'tab2', label: 'Tab 2', icon: 'fas fa-user' },
    { key: 'tab3', label: 'Tab 3' }
  ];

  describe('Rendering', () => {
    it('should render all tab buttons', () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      const buttons = wrapper.findAll('.tab-button');
      expect(buttons).toHaveLength(3);
    });

    it('should render tab labels correctly', () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      const buttons = wrapper.findAll('.tab-button');
      expect(buttons[0].text()).toContain('Tab 1');
      expect(buttons[1].text()).toContain('Tab 2');
      expect(buttons[2].text()).toContain('Tab 3');
    });

    it('should render icons when provided', () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      expect(wrapper.find('.fa-home').exists()).toBe(true);
      expect(wrapper.find('.fa-user').exists()).toBe(true);
    });

    it('should not render icon when not provided', () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      const tab3Button = wrapper.findAll('.tab-button')[2];
      expect(tab3Button.find('i').exists()).toBe(false);
    });

    it('should have tabs container', () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      expect(wrapper.find('.tabs-container').exists()).toBe(true);
    });

    it('should have tabs header', () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      expect(wrapper.find('.tabs-header').exists()).toBe(true);
    });

    it('should have tabs content area', () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      expect(wrapper.find('.tabs-content').exists()).toBe(true);
    });
  });

  describe('Active Tab', () => {
    it('should mark first tab as active when modelValue matches', () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      const buttons = wrapper.findAll('.tab-button');
      expect(buttons[0].classes()).toContain('active');
      expect(buttons[1].classes()).not.toContain('active');
      expect(buttons[2].classes()).not.toContain('active');
    });

    it('should mark second tab as active when modelValue matches', () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab2'
        }
      });

      const buttons = wrapper.findAll('.tab-button');
      expect(buttons[0].classes()).not.toContain('active');
      expect(buttons[1].classes()).toContain('active');
      expect(buttons[2].classes()).not.toContain('active');
    });

    it('should mark third tab as active when modelValue matches', () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab3'
        }
      });

      const buttons = wrapper.findAll('.tab-button');
      expect(buttons[0].classes()).not.toContain('active');
      expect(buttons[1].classes()).not.toContain('active');
      expect(buttons[2].classes()).toContain('active');
    });

    it('should have no active tab when modelValue does not match', () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'nonexistent'
        }
      });

      const buttons = wrapper.findAll('.tab-button');
      buttons.forEach(button => {
        expect(button.classes()).not.toContain('active');
      });
    });
  });

  describe('Tab Switching', () => {
    it('should emit update:modelValue when tab is clicked', async () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      const secondTab = wrapper.findAll('.tab-button')[1];
      await secondTab.trigger('click');

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')[0]).toEqual(['tab2']);
    });

    it('should emit correct key when different tabs are clicked', async () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      const buttons = wrapper.findAll('.tab-button');

      await buttons[0].trigger('click');
      expect(wrapper.emitted('update:modelValue')[0]).toEqual(['tab1']);

      await buttons[1].trigger('click');
      expect(wrapper.emitted('update:modelValue')[1]).toEqual(['tab2']);

      await buttons[2].trigger('click');
      expect(wrapper.emitted('update:modelValue')[2]).toEqual(['tab3']);
    });

    it('should allow clicking on active tab', async () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      const firstTab = wrapper.findAll('.tab-button')[0];
      await firstTab.trigger('click');

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle single tab', () => {
      const singleTab = [{ key: 'only', label: 'Only Tab' }];
      const wrapper = mount(Tabs, {
        props: {
          tabs: singleTab,
          modelValue: 'only'
        }
      });

      expect(wrapper.findAll('.tab-button')).toHaveLength(1);
      expect(wrapper.find('.tab-button').classes()).toContain('active');
    });

    it('should handle many tabs', () => {
      const manyTabs = Array.from({ length: 10 }, (_, i) => ({
        key: `tab${i}`,
        label: `Tab ${i}`
      }));

      const wrapper = mount(Tabs, {
        props: {
          tabs: manyTabs,
          modelValue: 'tab0'
        }
      });

      expect(wrapper.findAll('.tab-button')).toHaveLength(10);
    });

    it('should handle empty label', () => {
      const emptyLabelTabs = [
        { key: 'empty', label: '' }
      ];

      const wrapper = mount(Tabs, {
        props: {
          tabs: emptyLabelTabs,
          modelValue: 'empty'
        }
      });

      expect(wrapper.find('.tab-button').text()).toBe('');
    });

    it('should handle very long labels', () => {
      const longLabelTabs = [
        { key: 'long', label: 'a'.repeat(100) }
      ];

      const wrapper = mount(Tabs, {
        props: {
          tabs: longLabelTabs,
          modelValue: 'long'
        }
      });

      expect(wrapper.find('.tab-button').text()).toBe('a'.repeat(100));
    });

    it('should handle special characters in labels', () => {
      const specialTabs = [
        { key: 'special', label: 'Tab with "quotes" & symbols!' }
      ];

      const wrapper = mount(Tabs, {
        props: {
          tabs: specialTabs,
          modelValue: 'special'
        }
      });

      expect(wrapper.find('.tab-button').text()).toBe('Tab with "quotes" & symbols!');
    });
  });

  describe('Slots', () => {
    it('should render slot content for active tab', () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        },
        slots: {
          'tab-tab1': '<div class="test-content">Tab 1 Content</div>'
        }
      });

      expect(wrapper.find('.test-content').exists()).toBe(true);
      expect(wrapper.find('.test-content').text()).toBe('Tab 1 Content');
    });

    it('should render different slot content when modelValue changes', async () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        },
        slots: {
          'tab-tab1': '<div class="content-1">Content 1</div>',
          'tab-tab2': '<div class="content-2">Content 2</div>'
        }
      });

      expect(wrapper.find('.content-1').exists()).toBe(true);
      expect(wrapper.find('.content-2').exists()).toBe(false);

      await wrapper.setProps({ modelValue: 'tab2' });

      expect(wrapper.find('.content-1').exists()).toBe(false);
      expect(wrapper.find('.content-2').exists()).toBe(true);
    });
  });

  describe('Tab Keys', () => {
    it('should handle numeric keys', () => {
      const numericTabs = [
        { key: '1', label: 'First' },
        { key: '2', label: 'Second' }
      ];

      const wrapper = mount(Tabs, {
        props: {
          tabs: numericTabs,
          modelValue: '1'
        }
      });

      const buttons = wrapper.findAll('.tab-button');
      expect(buttons[0].classes()).toContain('active');
    });
  });

  describe('Reactivity', () => {
    it('should update active tab when modelValue changes', async () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      let buttons = wrapper.findAll('.tab-button');
      expect(buttons[0].classes()).toContain('active');

      await wrapper.setProps({ modelValue: 'tab2' });

      buttons = wrapper.findAll('.tab-button');
      expect(buttons[0].classes()).not.toContain('active');
      expect(buttons[1].classes()).toContain('active');
    });

    it('should update tabs when tabs prop changes', async () => {
      const wrapper = mount(Tabs, {
        props: {
          tabs: mockTabs,
          modelValue: 'tab1'
        }
      });

      expect(wrapper.findAll('.tab-button')).toHaveLength(3);

      const newTabs = [
        { key: 'new1', label: 'New 1' },
        { key: 'new2', label: 'New 2' }
      ];

      await wrapper.setProps({ tabs: newTabs, modelValue: 'new1' });

      expect(wrapper.findAll('.tab-button')).toHaveLength(2);
      expect(wrapper.findAll('.tab-button')[0].text()).toContain('New 1');
    });
  });
});
