import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import GenerateCharacterModal from '../GenerateCharacterModal.vue';
import { bureausAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({
  bureausAPI: { generateCharacter: vi.fn(), addDraft: vi.fn(), promoteCast: vi.fn() },
}));

const ModalStub = {
  props: ['title', 'maxWidth'],
  template: '<div><slot /><slot name="footer" /></div>',
};

const CARD = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Ines Varga',
    description: 'Runs the harbor pub.',
    personality: 'Nosy.',
    scenario: '',
    first_mes: 'Ines waved.',
    extensions: { bureau_appearance: { hair: 'grey braid' } },
  },
};

function button(wrapper, label) {
  return wrapper.findAll('button').find((candidate) => candidate.text().trim() === label);
}

async function generated() {
  const wrapper = mount(GenerateCharacterModal, {
    props: { bureauId: 'b1' },
    global: { stubs: { Modal: ModalStub } },
  });
  await wrapper.find('#generate-idea').setValue('A harbor pub owner');
  await button(wrapper, 'Generate').trigger('click');
  await flushPromises();
  return wrapper;
}

describe('GenerateCharacterModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bureausAPI.generateCharacter.mockImplementation(async () => ({ card: structuredClone(CARD) }));
    bureausAPI.addDraft.mockImplementation(async (_bureauId, card) => ({
      castMember: { id: 'c9', name: card.data.name, isDraft: true },
    }));
    bureausAPI.promoteCast.mockResolvedValue({
      castMember: { id: 'c9', name: 'Ines', isDraft: false },
    });
  });

  it('generates a card, lets it be edited, and adds it as a draft', async () => {
    const wrapper = await generated();

    expect(bureausAPI.generateCharacter).toHaveBeenCalledWith('b1', 'A harbor pub owner');
    expect(wrapper.find('#appearance-hair').element.value).toBe('grey braid');
    await wrapper.find('#generated-name').setValue('  Ines ');
    await button(wrapper, 'Add to cast').trigger('click');
    await flushPromises();

    expect(bureausAPI.addDraft.mock.calls[0][1].data.name).toBe('Ines');
    expect(bureausAPI.promoteCast).not.toHaveBeenCalled();
    expect(wrapper.emitted('added')[0][0]).toEqual({
      castMember: { id: 'c9', name: 'Ines', isDraft: true },
      savedToLibrary: false,
    });
  });

  it('saves the new character to the library too when asked', async () => {
    const wrapper = await generated();

    await button(wrapper, 'Add and save to library').trigger('click');
    await flushPromises();

    expect(bureausAPI.promoteCast).toHaveBeenCalledWith('b1', 'c9');
    expect(wrapper.emitted('added')[0][0]).toMatchObject({ savedToLibrary: true });
  });

  it('closes with the draft kept when saving to the library fails', async () => {
    bureausAPI.promoteCast.mockRejectedValue(new Error('Disk full'));
    const wrapper = await generated();

    await button(wrapper, 'Add and save to library').trigger('click');
    await flushPromises();

    expect(bureausAPI.addDraft).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('added')[0][0]).toEqual({
      castMember: { id: 'c9', name: 'Ines Varga', isDraft: true },
      savedToLibrary: false,
      libraryError: 'Disk full',
    });
  });

  it("won't add a character without a name", async () => {
    const wrapper = await generated();

    await wrapper.find('#generated-name').setValue(' ');

    expect(button(wrapper, 'Add to cast').attributes('disabled')).toBeDefined();
  });
});
