import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PassageBlock from '../PassageBlock.vue';

function mountBlock(text) {
  return mount(PassageBlock, {
    props: { block: { key: 'b1', text, record: { source: 'greeting' } } },
  });
}

describe('PassageBlock hidden notes', () => {
  it('offers no toggle when the passage has no notes', () => {
    const wrapper = mountBlock('Just prose.');
    expect(wrapper.find('[aria-pressed]').exists()).toBe(false);
  });

  it('hides notes until the toggle shows them, and hides them again', async () => {
    const wrapper = mountBlock('Welcome, traveler.\n\n<!-- Keep {{user}} guessing -->');
    const toggle = wrapper.find('[aria-pressed]');

    expect(wrapper.find('.prose').text()).toBe('Welcome, traveler.');
    expect(toggle.attributes('aria-pressed')).toBe('false');
    expect(toggle.find('i').classes()).toContain('fa-eye-slash');

    await toggle.trigger('click');
    expect(wrapper.find('.hidden-note').text()).toBe('Keep {{user}} guessing');
    expect(toggle.attributes('aria-pressed')).toBe('true');
    expect(toggle.find('i').classes()).toContain('fa-eye');

    await toggle.trigger('click');
    expect(wrapper.find('.hidden-note').exists()).toBe(false);
  });

  it('says so when a passage is nothing but notes', () => {
    const wrapper = mountBlock('<!-- Only for the model -->');
    expect(wrapper.find('.notes-only').exists()).toBe(true);
  });

  it('edits the raw text, notes and all', async () => {
    const text = 'Hello.<!-- secret -->';
    const wrapper = mountBlock(text);
    await wrapper.find('button[title="Edit"]').trigger('click');
    expect(wrapper.find('textarea').element.value).toBe(text);
  });
});
