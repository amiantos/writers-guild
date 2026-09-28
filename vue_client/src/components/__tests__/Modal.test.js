import { describe, it, expect } from 'vitest';
import { h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import Modal from '../Modal.vue';

function mountModal({ props = {}, body = () => h('p', 'Body') } = {}) {
  return mount(Modal, { props: { title: 'Profile', ...props }, slots: { default: body } });
}

async function clickOutside(wrapper) {
  const overlay = wrapper.find('.modal-overlay');
  await overlay.trigger('mousedown');
  await overlay.trigger('click');
}

async function type(field, text) {
  await field.trigger('focusin');
  await field.setValue(text);
}

describe('Modal', () => {
  it('closes when clicked outside', async () => {
    const wrapper = mountModal();
    await clickOutside(wrapper);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('stays open when a press starts inside it and lets go outside, as when selecting text', async () => {
    const wrapper = mountModal();
    await wrapper.find('.modal-content').trigger('mousedown');
    await wrapper.find('.modal-overlay').trigger('click');
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('stays open when clicked outside while a field holds typed text, but the close button closes it', async () => {
    const wrapper = mountModal({ body: () => h('textarea') });
    await type(wrapper.find('textarea'), 'She moved in last spring.');

    await clickOutside(wrapper);
    expect(wrapper.emitted('close')).toBeUndefined();

    await wrapper.find('.close-btn').trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('closes when clicked outside once the typed text is back to what the field held', async () => {
    const wrapper = mountModal({ body: () => h('textarea', { value: 'Keeps the light.' }) });
    const field = wrapper.find('textarea');
    await type(field, 'Keeps the light, mostly.');
    await clickOutside(wrapper);
    expect(wrapper.emitted('close')).toBeUndefined();

    await field.setValue('Keeps the light.');
    await clickOutside(wrapper);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('closes when clicked outside once the editor with typed text is gone, as after saving', async () => {
    const editing = ref(true);
    const wrapper = mountModal({
      body: () => (editing.value ? h('textarea') : h('p', 'Saved')),
    });
    await type(wrapper.find('textarea'), 'A new line.');
    await clickOutside(wrapper);
    expect(wrapper.emitted('close')).toBeUndefined();

    editing.value = false;
    await nextTick();
    await clickOutside(wrapper);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it("doesn't count a search box or a checkbox as typed text", async () => {
    const wrapper = mountModal({
      body: () => [h('input', { type: 'search' }), h('input', { type: 'checkbox' })],
    });
    await type(wrapper.find('input[type="search"]'), 'Mara');
    await wrapper.find('input[type="checkbox"]').setValue(true);

    await clickOutside(wrapper);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('never closes from a click outside when closeOnOverlayClick is off', async () => {
    const wrapper = mountModal({ props: { closeOnOverlayClick: false } });
    await clickOutside(wrapper);
    expect(wrapper.emitted('close')).toBeUndefined();
  });
});
