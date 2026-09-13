import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import BureauIntroModal from '../BureauIntroModal.vue';

const ModalStub = {
  props: ['title', 'maxWidth'],
  template: '<div><h2>{{ title }}</h2><slot /><slot name="footer" /></div>',
};

describe('BureauIntroModal', () => {
  it('explains what a Bureau is and what things are called, then closes', async () => {
    const wrapper = mount(BureauIntroModal, { global: { stubs: { Modal: ModalStub } } });

    expect(wrapper.find('h2').text()).toBe('Welcome to Bureau');
    expect(wrapper.findAll('dt').map((term) => term.text())).toEqual(
      expect.arrayContaining(['Cast', 'Seams', 'Memories', 'Messages', 'Bureau time', 'Drafts']),
    );
    expect(wrapper.text()).toContain("reader's character");

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Got it')
      .trigger('click');
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
