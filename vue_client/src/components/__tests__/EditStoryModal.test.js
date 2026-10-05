import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { shallowRef } from 'vue';
import EditStoryModal from '../EditStoryModal.vue';
import { charactersAPI, lorebooksAPI, presetsAPI, storiesAPI } from '../../services/api';

vi.mock('../../services/api', () => ({
  storiesAPI: {
    updateMetadata: vi.fn(),
    removeCharacterFromStory: vi.fn(),
    setPersona: vi.fn(),
    addLorebookToStory: vi.fn(),
    removeLorebookFromStory: vi.fn(),
  },
  charactersAPI: { addToStory: vi.fn() },
  lorebooksAPI: { list: vi.fn() },
  presetsAPI: { get: vi.fn(), getDefaultId: vi.fn(), list: vi.fn() },
}));
vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
const cachedCharacters = shallowRef([]);
vi.mock('../../composables/useDataCache', () => ({
  useDataCache: () => ({ characters: cachedCharacters, loadCharacters: vi.fn() }),
}));

const ContinuityPicker = {
  name: 'ContinuityPicker',
  template: '<div />',
  methods: { save: () => undefined },
};

const CHARACTERS = [
  { id: 'c1', name: 'Layla', tags: [] },
  { id: 'c2', name: 'Marcus', tags: ['pilot'], lorebookId: 'lb2' },
  { id: 'p9', name: 'Brad', tags: [] },
];

const STORY = {
  id: 's1',
  title: 'Harbor',
  scenario: '',
  configPresetId: 'p1',
  characterIds: ['c1'],
  personaCharacterId: 'p9',
  lorebookIds: ['lb1'],
  perspective: null,
  perspectiveTense: null,
  perspectiveCharacterId: null,
};

async function mountModal({ story = STORY, systemPrompt = null } = {}) {
  presetsAPI.get.mockResolvedValue({ preset: { promptTemplates: { systemPrompt } } });
  const wrapper = mount(EditStoryModal, {
    props: { story },
    global: { stubs: { ContinuityPicker, PresetEditorModal: true, Teleport: true } },
  });
  await flushPromises();
  return wrapper;
}

async function save(wrapper) {
  await wrapper.findAll('button').at(-1).trigger('click');
  await flushPromises();
}

describe('EditStoryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cachedCharacters.value = CHARACTERS;
    storiesAPI.updateMetadata.mockResolvedValue({});
    charactersAPI.addToStory.mockResolvedValue({});
    lorebooksAPI.list.mockResolvedValue({
      lorebooks: [
        { id: 'lb1', name: 'Harbor Town' },
        { id: 'lb2', name: 'Marcus Lore' },
        { id: 'lb3', name: 'Ships' },
      ],
    });
    presetsAPI.list.mockResolvedValue({
      presets: [
        { id: 'p1', name: 'Story Preset' },
        { id: 'p2', name: 'Other Preset' },
      ],
    });
    presetsAPI.getDefaultId.mockResolvedValue({ defaultPresetId: 'p2' });
  });

  it('lays out the fields in order', async () => {
    const wrapper = await mountModal();
    const labels = wrapper.findAll('.form-group > label').map((label) => label.text());
    expect(labels).toEqual([
      'Story Name *',
      'Characters',
      'Lorebooks',
      'Story Scenario',
      'Perspective & Narrator',
      'Generation Preset',
    ]);
  });

  it('saves only story fields when the cast, lorebooks and preset are untouched', async () => {
    const wrapper = await mountModal();
    await save(wrapper);

    expect(charactersAPI.addToStory).not.toHaveBeenCalled();
    expect(storiesAPI.removeCharacterFromStory).not.toHaveBeenCalled();
    expect(storiesAPI.setPersona).not.toHaveBeenCalled();
    expect(storiesAPI.addLorebookToStory).not.toHaveBeenCalled();
    expect(storiesAPI.removeLorebookFromStory).not.toHaveBeenCalled();
    const [, updates] = storiesAPI.updateMetadata.mock.calls[0];
    expect(updates).toMatchObject({ title: 'Harbor', scenario: '', perspective: null });
    expect(updates).not.toHaveProperty('configPresetId');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('adds a character found by tag, with their lorebook, and applies it on Save', async () => {
    charactersAPI.addToStory.mockResolvedValue({ addedLorebookId: 'lb2' });
    const wrapper = await mountModal();

    await wrapper.find('#characterFilter').setValue('pilot');
    const results = wrapper.findAll('.search-result');
    expect(results.map((result) => result.text())).toEqual(['Marcus']);
    await results[0].trigger('click');

    expect(wrapper.findAll('.chip').map((chip) => chip.text())).toEqual([
      'Layla',
      'Marcus',
      'Harbor Town',
      'Marcus Lore',
    ]);
    expect(charactersAPI.addToStory).not.toHaveBeenCalled();

    await save(wrapper);
    expect(charactersAPI.addToStory).toHaveBeenCalledWith('s1', 'c2');
    // The server already attached Marcus's lorebook, so it isn't added twice
    expect(storiesAPI.addLorebookToStory).not.toHaveBeenCalled();
    // The cast changed and the title didn't, so an auto-generated title can follow the cast
    expect(storiesAPI.updateMetadata.mock.calls[0][1]).not.toHaveProperty('title');
  });

  it('drops a lorebook the server attached when it was removed here', async () => {
    charactersAPI.addToStory.mockResolvedValue({ addedLorebookId: 'lb2' });
    const wrapper = await mountModal();

    await wrapper.find('#characterFilter').setValue('Marcus');
    await wrapper.find('#characterFilter').trigger('keydown', { key: 'Enter' });
    await wrapper.find('[aria-label="Remove Marcus Lore"]').trigger('click');
    await save(wrapper);

    expect(storiesAPI.removeLorebookFromStory).toHaveBeenCalledWith('s1', 'lb2');
  });

  it('removes characters and lorebooks, and changes the Persona and preset', async () => {
    const wrapper = await mountModal();

    await wrapper.find('[aria-label="Remove Layla"]').trigger('click');
    await wrapper.find('[aria-label="Remove Harbor Town"]').trigger('click');
    await wrapper.find('#lorebookSelect').setValue('lb3');
    await wrapper.find('#storyPersona').setValue('c1');
    await wrapper.findAll('#storyPreset option')[0].setSelected();
    await save(wrapper);

    expect(storiesAPI.removeCharacterFromStory).toHaveBeenCalledWith('s1', 'c1');
    expect(storiesAPI.setPersona).toHaveBeenCalledWith('s1', 'c1');
    expect(storiesAPI.removeLorebookFromStory).toHaveBeenCalledWith('s1', 'lb1');
    expect(storiesAPI.addLorebookToStory).toHaveBeenCalledWith('s1', 'lb3');
    expect(storiesAPI.updateMetadata.mock.calls[0][1]).toMatchObject({ configPresetId: null });
  });

  it('clears the Persona when their character is removed', async () => {
    const wrapper = await mountModal({ story: { ...STORY, characterIds: ['c1', 'p9'] } });
    await wrapper.find('[aria-label="Remove Brad"]').trigger('click');
    expect(wrapper.find('#storyPersona').element.selectedIndex).toBe(0);
  });

  it('shows the default perspective and saves it as null', async () => {
    const wrapper = await mountModal();
    expect(wrapper.find('#storyPerspective').element.value).toBe('third');
    expect(wrapper.find('#storyPerspectiveCharacter').exists()).toBe(false);

    await save(wrapper);
    expect(storiesAPI.updateMetadata).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        perspective: null,
        perspectiveTense: null,
        perspectiveCharacterId: null,
      }),
    );
  });

  it('picks a narrator from the characters here, the Persona included', async () => {
    const wrapper = await mountModal();
    await wrapper.find('#storyPerspective').setValue('first');
    await wrapper.find('#storyPerspectiveTense').setValue('present');

    const select = wrapper.find('#storyPerspectiveCharacter');
    expect(select.findAll('option').map((option) => option.text())).toEqual([
      'Not set',
      'Brad (Persona)',
      'Layla',
    ]);

    // A character added here can narrate before anything is saved
    await wrapper.find('#characterFilter').setValue('Marcus');
    await wrapper.find('.search-result').trigger('click');
    expect(select.findAll('option').map((option) => option.text())).toContain('Marcus');

    await select.setValue('p9');
    await save(wrapper);
    expect(storiesAPI.updateMetadata).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        perspective: 'first',
        perspectiveTense: 'present',
        perspectiveCharacterId: 'p9',
      }),
    );
  });

  it('warns when the preset has a custom system prompt without {{perspective}}', async () => {
    const custom = await mountModal({ systemPrompt: 'Write in third person.' });
    expect(custom.find('.perspective-warning').exists()).toBe(true);

    const tagged = await mountModal({ systemPrompt: 'Rules:\n{{perspective}}' });
    expect(tagged.find('.perspective-warning').exists()).toBe(false);

    const defaults = await mountModal();
    expect(defaults.find('.perspective-warning').exists()).toBe(false);
  });

  it('rechecks the warning for a newly picked preset', async () => {
    const wrapper = await mountModal();
    presetsAPI.get.mockResolvedValue({ preset: { promptTemplates: { systemPrompt: 'Custom.' } } });
    await wrapper.find('#storyPreset').setValue('p2');
    await flushPromises();
    expect(presetsAPI.get).toHaveBeenLastCalledWith('p2');
    expect(wrapper.find('.perspective-warning').exists()).toBe(true);
  });
});
