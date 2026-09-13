import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TimePassesPicker from '../TimePassesPicker.vue';

const ModalStub = {
  props: ['title', 'maxWidth'],
  emits: ['close'],
  template: '<div class="modal"><h2>{{ title }}</h2><slot /><slot name="footer" /></div>',
};

// A chapter's time, later than Bureau time was when the chapter began.
const FROM = '2026-10-28T08:00:00.000Z';

function mountPicker(props = {}) {
  return mount(TimePassesPicker, {
    props: { from: FROM, timeZone: 'America/Los_Angeles', ...props },
    global: { stubs: { Modal: ModalStub } },
  });
}

function button(wrapper, label) {
  return wrapper.findAll('button').find((candidate) => candidate.text().includes(label));
}

describe('TimePassesPicker', () => {
  it('passes time by a step', async () => {
    const wrapper = mountPicker({ intro: "The chapter's time is early." });

    expect(wrapper.text()).toContain("The chapter's time is early.");
    await button(wrapper, 'A few days later').trigger('click');

    expect(wrapper.emitted('pass')).toEqual([[{ step: 'days' }]]);
  });

  it("starts the picker at the time it passes from, on the Bureau's clock, and moves only later", async () => {
    const wrapper = mountPicker();
    const field = wrapper.find('#time-passes-to');
    const move = () => button(wrapper, 'Move to this time');

    // 08:00 UTC is 1:00 AM in Los Angeles.
    expect(field.element.value).toBe('2026-10-28T01:00');
    expect(move().attributes('disabled')).toBeDefined();
    await field.setValue('2026-10-28T00:30');
    expect(move().attributes('disabled')).toBeDefined();
    await field.setValue('2026-10-28T09:15');
    await move().trigger('click');

    expect(wrapper.emitted('pass')).toEqual([[{ to: '2026-10-28T16:15:00.000Z' }]]);
  });

  it('holds off while time is passing, and closes on Cancel', async () => {
    const wrapper = mountPicker({ passing: true });

    expect(button(wrapper, 'An hour later').attributes('disabled')).toBeDefined();
    await button(wrapper, 'Cancel').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});
