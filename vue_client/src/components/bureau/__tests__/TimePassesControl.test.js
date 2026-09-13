import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import TimePassesControl from '../TimePassesControl.vue';
import { bureausAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({ bureausAPI: { passTime: vi.fn() } }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('../../../composables/useToast', () => ({ useToast: () => toast }));

const ModalStub = {
  props: ['title', 'maxWidth'],
  emits: ['close'],
  template: '<div class="modal"><h2>{{ title }}</h2><slot /><slot name="footer" /></div>',
};

const BUREAU = { id: 'b1', timezone: 'UTC', bureauTime: '2026-09-12T22:15:00.000Z' };

function mountControl() {
  return mount(TimePassesControl, {
    props: { bureau: BUREAU },
    global: { stubs: { Modal: ModalStub } },
  });
}

function button(wrapper, label) {
  return wrapper.findAll('button').find((candidate) => candidate.text().includes(label));
}

describe('TimePassesControl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('moves Bureau time by a quick pick and hands back the Bureau', async () => {
    const moved = { ...BUREAU, bureauTime: '2026-09-13T08:00:00.000Z' };
    bureausAPI.passTime.mockResolvedValue({ bureau: moved });
    const wrapper = mountControl();

    expect(wrapper.find('.modal').exists()).toBe(false);
    await button(wrapper, 'Time passes').trigger('click');
    expect(wrapper.findAll('.step-button').map((step) => step.text())).toEqual([
      'An hour later',
      'Later that day',
      'The next morning',
      'A few days later',
      'A week later',
    ]);
    await button(wrapper, 'The next morning').trigger('click');
    await flushPromises();

    expect(bureausAPI.passTime).toHaveBeenCalledWith('b1', { step: 'morning' });
    expect(wrapper.emitted('updated')).toEqual([[moved]]);
    expect(wrapper.find('.modal').exists()).toBe(false);
    expect(toast.success).toHaveBeenCalled();
  });

  it('moves to a picked time only when it is later than Bureau time', async () => {
    bureausAPI.passTime.mockResolvedValue({ bureau: BUREAU });
    const wrapper = mountControl();
    await button(wrapper, 'Time passes').trigger('click');
    const field = wrapper.find('#time-passes-to');
    const move = () => button(wrapper, 'Move to this time');

    expect(move().attributes('disabled')).toBeDefined();
    await field.setValue('2026-09-01T12:00');
    expect(move().attributes('disabled')).toBeDefined();
    await field.setValue('2026-09-20T12:00');
    expect(move().attributes('disabled')).toBeUndefined();
    await move().trigger('click');
    await flushPromises();

    expect(bureausAPI.passTime).toHaveBeenCalledWith('b1', {
      to: new Date('2026-09-20T12:00').toISOString(),
    });
  });

  it("keeps the dialog open and says why when time can't move", async () => {
    bureausAPI.passTime.mockRejectedValue(new Error("Bureau time can't go past the year 9999"));
    const wrapper = mountControl();

    await button(wrapper, 'Time passes').trigger('click');
    await button(wrapper, 'A week later').trigger('click');
    await flushPromises();

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('past the year 9999'));
    expect(wrapper.emitted('updated')).toBeUndefined();
    expect(wrapper.find('.modal').exists()).toBe(true);
  });
});
