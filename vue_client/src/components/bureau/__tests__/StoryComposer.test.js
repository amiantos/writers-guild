import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import StoryComposer from '../StoryComposer.vue';

const CAST = [
  { id: 'cast-mara', name: 'Mara' },
  { id: 'cast-theo', name: 'Theo' },
];

function buttonNamed(wrapper, name) {
  return wrapper.findAll('button').find((button) => button.text().includes(name));
}

describe('StoryComposer', () => {
  it('writes the trimmed text with the chosen focus, then clears the box', async () => {
    const wrapper = mount(StoryComposer, { props: { cast: CAST } });

    await wrapper.find('textarea').setValue('  Theo knocked.  ');
    await wrapper.find('select').setValue('cast-mara');
    await buttonNamed(wrapper, 'Write').trigger('click');

    expect(wrapper.emitted('generate')).toEqual([
      [{ action: 'write', text: 'Theo knocked.', leadCastId: 'cast-mara' }],
    ]);
    expect(wrapper.find('textarea').element.value).toBe('');
  });

  it('needs text to write or direct, but not to continue', async () => {
    const wrapper = mount(StoryComposer, { props: { cast: CAST } });

    expect(buttonNamed(wrapper, 'Write').attributes('disabled')).toBeDefined();
    expect(buttonNamed(wrapper, 'Direct').attributes('disabled')).toBeDefined();

    await buttonNamed(wrapper, 'Continue').trigger('click');
    expect(wrapper.emitted('generate')).toEqual([
      [{ action: 'continue', text: '', leadCastId: null }],
    ]);
  });

  it('sends a direction', async () => {
    const wrapper = mount(StoryComposer, { props: { cast: CAST } });

    await wrapper.find('textarea').setValue('She suggests the night market');
    await buttonNamed(wrapper, 'Direct').trigger('click');

    expect(wrapper.emitted('generate')[0][0]).toMatchObject({
      action: 'direct',
      text: 'She suggests the night market',
    });
  });

  it('writes on Ctrl+Enter', async () => {
    const wrapper = mount(StoryComposer, { props: { cast: CAST } });

    await wrapper.find('textarea').setValue('Theo waved.');
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });

    expect(wrapper.emitted('generate')[0][0]).toMatchObject({
      action: 'write',
      text: 'Theo waved.',
    });
  });

  it('offers Stop while generating', async () => {
    const wrapper = mount(StoryComposer, { props: { cast: CAST, generating: true } });

    expect(buttonNamed(wrapper, 'Continue')).toBeUndefined();
    await buttonNamed(wrapper, 'Stop').trigger('click');

    expect(wrapper.emitted('stop')).toHaveLength(1);
  });

  it('warns and disables generation without an API key', () => {
    const wrapper = mount(StoryComposer, { props: { cast: CAST, hasApiKey: false } });

    expect(wrapper.text()).toContain('no API key');
    expect(buttonNamed(wrapper, 'Continue').attributes('disabled')).toBeDefined();
  });

  it('puts text back when asked', async () => {
    const wrapper = mount(StoryComposer, { props: { cast: CAST } });

    wrapper.vm.restore('Theo knocked.');
    await wrapper.vm.$nextTick();

    expect(wrapper.find('textarea').element.value).toBe('Theo knocked.');
  });

  it('resets the focus when that character leaves the story', async () => {
    const wrapper = mount(StoryComposer, { props: { cast: CAST } });
    await wrapper.find('select').setValue('cast-theo');

    await wrapper.setProps({ cast: [CAST[0]] });
    await buttonNamed(wrapper, 'Continue').trigger('click');

    expect(wrapper.emitted('generate')[0][0].leadCastId).toBeNull();
  });
});
