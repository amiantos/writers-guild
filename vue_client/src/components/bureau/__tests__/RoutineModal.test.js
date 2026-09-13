import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import RoutineModal from '../RoutineModal.vue';
import { bureausAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({ bureausAPI: { updateCast: vi.fn() } }));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ error: vi.fn() }),
}));

const ModalStub = {
  props: ['title', 'maxWidth'],
  template: '<div><h2>{{ title }}</h2><slot /><slot name="footer" /></div>',
};

describe('RoutineModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("edits a cast member's routine and saves it", async () => {
    const member = { id: 'c1', name: 'Mara', routine: { text: 'Nights at the light.' } };
    bureausAPI.updateCast.mockResolvedValue({ castMember: { ...member, routine: { text: 'x' } } });
    const wrapper = mount(RoutineModal, {
      props: { bureauId: 'b1', member },
      global: { stubs: { Modal: ModalStub } },
    });

    expect(wrapper.find('h2').text()).toBe("Mara's routine");
    expect(wrapper.find('#routine-text').element.value).toBe('Nights at the light.');
    await wrapper.find('#routine-text').setValue('  Nights at the light, pub on Fridays.  ');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Save routine'))
      .trigger('click');
    await flushPromises();

    expect(bureausAPI.updateCast).toHaveBeenCalledWith('b1', 'c1', {
      routine: 'Nights at the light, pub on Fridays.',
    });
    expect(wrapper.emitted('saved')).toHaveLength(1);
  });
});
