import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const { mockGeneratorAPI } = vi.hoisted(() => ({
  mockGeneratorAPI: { generate: vi.fn(), save: vi.fn() },
}));

vi.mock('../../services/api', () => ({ characterGeneratorAPI: mockGeneratorAPI }));

vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import CharacterGeneratorModal from '../CharacterGeneratorModal.vue';

const CARD = {
  spec: 'chara_card_v2',
  data: {
    name: 'Ines Varga',
    description: 'Runs the harbor pub.',
    personality: 'Nosy.',
    scenario: '',
    first_mes: 'Ines slid a glass down the bar.',
    mes_example: '',
    extensions: { bureau_appearance: { hair: 'grey braid' } },
  },
};

function mountModal() {
  return mount(CharacterGeneratorModal, {
    props: {
      presets: [{ id: 'p1', name: 'DeepSeek' }],
      lorebooks: [{ id: 'l1', name: 'Saltmere' }],
    },
  });
}

function button(wrapper, label) {
  return wrapper.findAll('button').find((b) => b.text().includes(label));
}

describe('CharacterGeneratorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates with the chosen preset and world, then saves the edited card', async () => {
    mockGeneratorAPI.generate.mockResolvedValue({ card: structuredClone(CARD) });
    mockGeneratorAPI.save.mockResolvedValue({ id: 'c1', name: 'Ines' });
    const wrapper = mountModal();

    await wrapper.find('#generator-idea').setValue(' A harbor pub owner ');
    await wrapper.find('#generator-preset').setValue('p1');
    await wrapper.find('#generator-lorebook').setValue('l1');
    await button(wrapper, 'Generate').trigger('click');
    await flushPromises();

    expect(mockGeneratorAPI.generate).toHaveBeenCalledWith(
      { idea: 'A harbor pub owner', name: '', presetId: 'p1', lorebookId: 'l1' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(wrapper.find('#generated-description').element.value).toBe('Runs the harbor pub.');

    await wrapper.find('#generated-name').setValue('Ines');
    await button(wrapper, 'Save to library').trigger('click');
    await flushPromises();

    expect(mockGeneratorAPI.save.mock.calls[0][0].data.name).toBe('Ines');
    expect(wrapper.emitted('created')[0][0]).toEqual({ id: 'c1', name: 'Ines' });
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it("uses the default preset and no world unless they're picked", async () => {
    mockGeneratorAPI.generate.mockResolvedValue({ card: structuredClone(CARD) });
    const wrapper = mountModal();

    expect(button(wrapper, 'Generate').attributes('disabled')).toBeDefined();
    await wrapper.find('#generator-idea').setValue('Someone');
    await button(wrapper, 'Generate').trigger('click');
    await flushPromises();

    expect(mockGeneratorAPI.generate.mock.calls[0][0]).toEqual({
      idea: 'Someone',
      name: '',
      presetId: undefined,
      lorebookId: undefined,
    });
  });

  it('stops a generation still running when it closes', async () => {
    let signal;
    mockGeneratorAPI.generate.mockImplementation((_params, options) => {
      signal = options.signal;
      return new Promise(() => {});
    });
    const wrapper = mountModal();
    await wrapper.find('#generator-idea').setValue('Someone');
    await button(wrapper, 'Generate').trigger('click');

    wrapper.unmount();
    expect(signal.aborted).toBe(true);
  });
});
