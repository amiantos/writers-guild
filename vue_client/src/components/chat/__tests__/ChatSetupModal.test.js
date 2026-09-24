import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import ChatSetupModal from '../ChatSetupModal.vue';
import { chatsAPI } from '../../../services/chatsApi';
import { settingsAPI } from '../../../services/api';

vi.mock('../../../services/chatsApi', () => ({
  chatsAPI: { create: vi.fn(), update: vi.fn() },
}));
vi.mock('../../../services/api', () => ({ settingsAPI: { get: vi.fn() } }));
vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../composables/useDataCache', () => ({
  useDataCache: () => ({
    characters: ref([
      { id: 'layla', name: 'Layla' },
      { id: 'sam', name: 'Sam' },
      { id: 'bradley', name: 'Bradley' },
    ]),
    lorebooks: ref([{ id: 'book', name: 'Hospital Lore' }]),
    presets: ref([{ id: 'p1', name: 'Local' }]),
    loadingCharacters: ref(false),
    loadCharacters: vi.fn(async () => {}),
    loadLorebooks: vi.fn(async () => {}),
    loadPresets: vi.fn(async () => {}),
  }),
}));

function mountModal(props = {}) {
  return mount(ChatSetupModal, {
    props,
    global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
  });
}

function saveButton(wrapper) {
  return wrapper.findAll('button').find((button) => button.classes('btn-primary'));
}

function characterBox(wrapper, name) {
  return wrapper
    .findAll('.character-option')
    .find((option) => option.text().includes(name))
    .find('input');
}

describe('ChatSetupModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsAPI.get.mockResolvedValue({ settings: { defaultPersonaId: 'bradley' } });
  });

  it('starts a chat with the chosen characters, the default persona, and a scenario', async () => {
    chatsAPI.create.mockResolvedValue({ chat: { id: 'c1' } });
    const wrapper = mountModal();
    await flushPromises();

    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
    await characterBox(wrapper, 'Layla').setValue(true);
    await characterBox(wrapper, 'Sam').setValue(true);
    await wrapper.find('#chatScenario').setValue('  Bradley texts from the airport.  ');
    await wrapper.find('#chatPreset').setValue('p1');
    await wrapper.find('.lorebook-list input').setValue(true);
    // The persona can't also be in the chat.
    expect(characterBox(wrapper, 'Bradley').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('#chatPersona option').map((option) => option.text())).not.toContain(
      'Layla',
    );

    await saveButton(wrapper).trigger('click');
    await flushPromises();

    expect(chatsAPI.create).toHaveBeenCalledWith({
      title: '',
      scenario: 'Bradley texts from the airport.',
      characterIds: ['layla', 'sam'],
      personaCharacterId: 'bradley',
      lorebookIds: ['book'],
      configPresetId: 'p1',
    });
    expect(wrapper.emitted('saved')[0]).toEqual([{ id: 'c1' }]);
  });

  it('edits an existing chat', async () => {
    const chat = {
      id: 'c1',
      title: 'Late night',
      scenario: 'Midnight.',
      characterIds: ['layla'],
      personaCharacterId: null,
      lorebookIds: [],
      configPresetId: null,
    };
    chatsAPI.update.mockResolvedValue({ chat: { ...chat, scenario: 'Dawn.' } });
    const wrapper = mountModal({ chat });
    await flushPromises();

    // An existing chat keeps its own persona choice.
    expect(wrapper.find('#chatPersona').element.selectedIndex).toBe(0);
    await wrapper.find('#chatScenario').setValue('Dawn.');
    await saveButton(wrapper).trigger('click');
    await flushPromises();

    expect(chatsAPI.update).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ title: 'Late night', scenario: 'Dawn.', characterIds: ['layla'] }),
    );
  });
});
