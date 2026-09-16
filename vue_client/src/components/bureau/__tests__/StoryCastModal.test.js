import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import StoryCastModal from '../StoryCastModal.vue';
import { bureauStoriesAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({
  bureauStoriesAPI: { update: vi.fn() },
  bureausAPI: {
    addCast: vi.fn(),
    generateCharacter: vi.fn(),
    addDraft: vi.fn(),
    promoteCast: vi.fn(),
  },
}));

const ModalStub = {
  props: ['title', 'maxWidth'],
  template: '<div><slot /><slot name="footer" /></div>',
};

const AddCastStub = { name: 'AddCastModal', template: '<div />' };
const GenerateStub = { name: 'GenerateCharacterModal', template: '<div />' };

function button(wrapper, label) {
  return wrapper.findAll('button').find((candidate) => candidate.text().trim() === label);
}

function mountModal(props = {}) {
  return mount(StoryCastModal, {
    props: {
      bureauId: 'b1',
      story: { id: 's1', castIds: ['c1'] },
      cast: [
        { id: 'c1', name: 'Mara' },
        { id: 'c2', name: 'Theo', isPersona: true },
      ],
      hasApiKey: true,
      ...props,
    },
    global: {
      stubs: { Modal: ModalStub, AddCastModal: AddCastStub, GenerateCharacterModal: GenerateStub },
    },
  });
}

describe('StoryCastModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves who is in the chapter', async () => {
    bureauStoriesAPI.update.mockResolvedValue({ story: { id: 's1', castIds: ['c1', 'c2'] } });
    const wrapper = mountModal();

    await wrapper.findAll('input[type="checkbox"]')[1].setValue(true);
    await button(wrapper, 'Save').trigger('click');
    await flushPromises();

    expect(bureauStoriesAPI.update).toHaveBeenCalledWith('b1', 's1', { castIds: ['c1', 'c2'] });
    expect(wrapper.emitted('updated')[0][0]).toEqual({ id: 's1', castIds: ['c1', 'c2'] });
  });

  it('ticks a character generated here into the chapter, ready to save', async () => {
    const wrapper = mountModal();

    await button(wrapper, 'Generate a character').trigger('click');
    wrapper
      .findComponent(GenerateStub)
      .vm.$emit('added', { castMember: { id: 'c3', name: 'Tomas' } });
    await flushPromises();

    // The parent reloads the Bureau's cast, and the generator is done once its card is added.
    expect(wrapper.emitted('cast-added')[0][0]).toEqual({ id: 'c3', name: 'Tomas' });
    expect(wrapper.findComponent(GenerateStub).exists()).toBe(false);

    bureauStoriesAPI.update.mockResolvedValue({ story: { id: 's1', castIds: ['c1', 'c3'] } });
    await button(wrapper, 'Save').trigger('click');
    await flushPromises();

    expect(bureauStoriesAPI.update).toHaveBeenCalledWith('b1', 's1', { castIds: ['c1', 'c3'] });
  });

  it('keeps the library open for adding several', async () => {
    const wrapper = mountModal();

    await button(wrapper, 'Add from library').trigger('click');
    wrapper
      .findComponent(AddCastStub)
      .vm.$emit('added', { castMember: { id: 'c4', name: 'Ines' } });
    await flushPromises();

    expect(wrapper.findComponent(AddCastStub).exists()).toBe(true);
    expect(wrapper.emitted('cast-added')[0][0]).toEqual({ id: 'c4', name: 'Ines' });
  });

  it('needs an API key to generate, and offers nothing to add once a chapter has ended', () => {
    const noKey = mountModal({ hasApiKey: false });
    expect(button(noKey, 'Generate a character').attributes('disabled')).toBeDefined();

    const ended = mountModal({ readonly: true });
    expect(button(ended, 'Add from library')).toBeUndefined();
    expect(button(ended, 'Generate a character')).toBeUndefined();
  });
});
