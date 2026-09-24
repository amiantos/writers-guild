import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import ManageCharactersModal from '../ManageCharactersModal.vue';
import ManageLorebooksModal from '../ManageLorebooksModal.vue';
import StoryPresetModal from '../StoryPresetModal.vue';
import { storiesAPI, charactersAPI, lorebooksAPI, presetsAPI } from '../../services/api';

vi.mock('../../services/api', () => ({
  storiesAPI: {
    removeCharacterFromStory: vi.fn(),
    setPersona: vi.fn(),
    addLorebookToStory: vi.fn(),
    removeLorebookFromStory: vi.fn(),
    updateMetadata: vi.fn(),
  },
  charactersAPI: { addToStory: vi.fn() },
  lorebooksAPI: { list: vi.fn() },
  presetsAPI: { list: vi.fn(), getDefaultId: vi.fn() },
}));
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../../composables/useToast', () => ({ useToast: () => toast }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../composables/useDataCache', () => ({
  useDataCache: () => ({
    characters: ref([{ id: 'layla', name: 'Layla' }]),
    loadCharacters: vi.fn(async () => {}),
    loadingCharacters: ref(false),
  }),
}));

const stubs = {
  Modal: { template: '<div><slot /></div>' },
  CharacterCard: true,
  PresetEditorModal: true,
};

function buttonWithText(wrapper, text) {
  return wrapper.findAll('button').find((button) => button.text().includes(text));
}

describe('story modals with a chat adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lorebooksAPI.list.mockResolvedValue({ lorebooks: [{ id: 'book', name: 'Lore' }] });
    presetsAPI.list.mockResolvedValue({
      presets: [{ id: 'p1', name: 'Local', provider: 'ollama' }],
    });
    presetsAPI.getDefaultId.mockResolvedValue({ defaultPresetId: null });
  });

  it('manages characters through the adapter instead of the story API', async () => {
    const adapter = {
      addCharacter: vi.fn(async () => ({})),
      removeCharacter: vi.fn(),
      setPersona: vi.fn(),
    };
    const wrapper = mount(ManageCharactersModal, {
      props: {
        story: { id: 'c1', characterIds: [], personaCharacterId: null },
        noun: 'chat',
        adapter,
      },
      global: { stubs },
    });
    await flushPromises();

    await buttonWithText(wrapper, 'Add').trigger('click');
    await flushPromises();
    await buttonWithText(wrapper, 'Set Persona').trigger('click');
    await flushPromises();

    expect(adapter.addCharacter).toHaveBeenCalledWith('layla');
    expect(adapter.setPersona).toHaveBeenCalledWith('layla');
    expect(charactersAPI.addToStory).not.toHaveBeenCalled();
    expect(storiesAPI.setPersona).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Character added to chat');
  });

  it('still manages a story’s characters by default', async () => {
    charactersAPI.addToStory.mockResolvedValue({});
    const wrapper = mount(ManageCharactersModal, {
      props: { story: { id: 's1', characterIds: [], personaCharacterId: null } },
      global: { stubs },
    });
    await flushPromises();

    await buttonWithText(wrapper, 'Add').trigger('click');
    await flushPromises();

    expect(charactersAPI.addToStory).toHaveBeenCalledWith('s1', 'layla');
    expect(toast.success).toHaveBeenCalledWith('Character added to story');
  });

  it('manages lorebooks through the adapter', async () => {
    const adapter = { addLorebook: vi.fn(), removeLorebook: vi.fn() };
    const wrapper = mount(ManageLorebooksModal, {
      props: { story: { id: 'c1', lorebookIds: [] }, noun: 'chat', adapter },
      global: { stubs },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('include in this chat');
    await wrapper.find('input[type="checkbox"]').trigger('change');
    await flushPromises();

    expect(adapter.addLorebook).toHaveBeenCalledWith('book');
    expect(storiesAPI.addLorebookToStory).not.toHaveBeenCalled();
  });

  it('saves the preset through savePreset', async () => {
    const savePreset = vi.fn();
    const wrapper = mount(StoryPresetModal, {
      props: { storyId: 'c1', noun: 'chat', savePreset },
      global: { stubs },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('This chat is using the default preset');
    await wrapper.find('#presetSelect').setValue('p1');
    await flushPromises();

    expect(savePreset).toHaveBeenCalledWith('p1');
    expect(storiesAPI.updateMetadata).not.toHaveBeenCalled();
  });
});
