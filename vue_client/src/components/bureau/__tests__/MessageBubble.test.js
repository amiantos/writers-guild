import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MessageBubble from '../MessageBubble.vue';

const MESSAGE = { id: 'm1', source: 'generated', content: 'Always.', edited: false };

describe('MessageBubble', () => {
  it("shows who sent it and saves an edit only when it's changed", async () => {
    const wrapper = mount(MessageBubble, { props: { message: MESSAGE } });

    expect(wrapper.classes()).toContain('from-character');
    await wrapper.find('[title="Edit this message"]').trigger('click');
    await wrapper.find('textarea').setValue('Always.');
    await wrapper.findAll('button').at(-1).trigger('click');
    expect(wrapper.emitted('save')).toBeUndefined();

    await wrapper.find('[title="Edit this message"]').trigger('click');
    await wrapper.find('textarea').setValue('  Always, Theo.  ');
    await wrapper.findAll('button').at(-1).trigger('click');
    expect(wrapper.emitted('save')[0]).toEqual([MESSAGE, 'Always, Theo.']);
  });

  it('asks to delete, and marks edited messages', async () => {
    const message = { ...MESSAGE, source: 'user', edited: true };
    const wrapper = mount(MessageBubble, { props: { message } });

    expect(wrapper.classes()).toContain('from-reader');
    expect(wrapper.find('.bubble-edited').exists()).toBe(true);
    await wrapper.find('[title="Delete this message"]').trigger('click');
    expect(wrapper.emitted('delete')[0]).toEqual([message]);
  });
});
