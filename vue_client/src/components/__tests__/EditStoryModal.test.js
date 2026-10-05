import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { shallowRef } from 'vue';
import EditStoryModal from '../EditStoryModal.vue';
import { charactersAPI, lorebooksAPI, presetsAPI, storiesAPI } from '../../services/api';
import { chatsAPI } from '../../services/chatsApi';

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
vi.mock('../../services/chatsApi', () => ({ chatsAPI: { update: vi.fn() } }));
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
  { id: 'c2', name: 'Marcus', tags: ['pilot'] },
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

const CHAT = {
  id: 'ch1',
  title: 'Chat with Layla',
  scenario: 'Midnight.',
  configPresetId: null,
  characterIds: ['c1'],
  personaCharacterId: 'p9',
  lorebookIds: [],
};

async function mountModal({ story = STORY, systemPrompt = null, ...props } = {}) {
  presetsAPI.get.mockResolvedValue({ preset: { promptTemplates: { systemPrompt } } });
  const wrapper = mount(EditStoryModal, {
    props: { story, ...props },
    global: { stubs: { ContinuityPicker, PresetEditorModal: true, Teleport: true } },
    // Focus is only tracked in the document
    attachTo: props.focusScenario ? document.body : undefined,
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
        { id: 'lb2', name: 'Marcus Lore', characters: [{ id: 'c2', name: 'Marcus' }] },
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
      'Persona',
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

    expect(wrapper.findAll('.cast-name').map((name) => name.text())).toEqual(['Layla', 'Marcus']);
    expect(wrapper.findAll('.chip').map((chip) => chip.text())).toEqual([
      'Harbor Town',
      'Marcus Lore',
    ]);
    expect(charactersAPI.addToStory).not.toHaveBeenCalled();

    await save(wrapper);
    expect(charactersAPI.addToStory).toHaveBeenCalledWith('s1', 'c2');
    // The server already attached Marcus's lorebook, so it isn't added twice
    expect(storiesAPI.addLorebookToStory).not.toHaveBeenCalled();
    expect(storiesAPI.updateMetadata.mock.calls[0][1]).toMatchObject({ title: 'Harbor' });
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

  it('keeps a lorebook the server attached even when it is not known here', async () => {
    charactersAPI.addToStory.mockResolvedValue({ addedLorebookId: 'lb9' });
    const wrapper = await mountModal();

    await wrapper.find('#characterFilter').setValue('Brad');
    await wrapper.find('.search-result').trigger('click');
    await save(wrapper);

    expect(charactersAPI.addToStory).toHaveBeenCalledWith('s1', 'p9');
    expect(storiesAPI.removeLorebookFromStory).not.toHaveBeenCalled();
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

  it('renames a cast-named story as characters are added and removed', async () => {
    const wrapper = await mountModal({ story: { ...STORY, title: 'A Story with Layla' } });

    await wrapper.find('#characterFilter').setValue('Marcus');
    await wrapper.find('.search-result').trigger('click');
    expect(wrapper.find('#storyTitle').element.value).toBe('A Story with Layla and Marcus');

    await wrapper.find('[aria-label="Remove Layla"]').trigger('click');
    expect(wrapper.find('#storyTitle').element.value).toBe('A Story with Marcus');

    await save(wrapper);
    expect(storiesAPI.updateMetadata.mock.calls[0][1]).toMatchObject({
      title: 'A Story with Marcus',
    });
  });

  it('keeps the name when the character list refreshes without a cast change', async () => {
    const wrapper = await mountModal({ story: { ...STORY, title: 'A Story with Layla (New)' } });
    cachedCharacters.value = [...CHARACTERS];
    await flushPromises();
    expect(wrapper.find('#storyTitle').element.value).toBe('A Story with Layla (New)');
  });

  it('leaves a typed or custom name alone when the cast changes', async () => {
    const custom = await mountModal();
    await custom.find('#characterFilter').setValue('Marcus');
    await custom.find('.search-result').trigger('click');
    expect(custom.find('#storyTitle').element.value).toBe('Harbor');

    const typed = await mountModal({ story: { ...STORY, title: 'A Story with Layla' } });
    await typed.find('#storyTitle').setValue('A Story with Layla at sea');
    await typed.find('#characterFilter').setValue('Marcus');
    await typed.find('.search-result').trigger('click');
    expect(typed.find('#storyTitle').element.value).toBe('A Story with Layla at sea');
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
      'Narrator: not set',
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

describe('EditStoryModal for a chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cachedCharacters.value = CHARACTERS;
    chatsAPI.update.mockImplementation(async (id, fields) => ({ chat: { ...CHAT, ...fields } }));
    lorebooksAPI.list.mockResolvedValue({
      lorebooks: [{ id: 'lb2', name: 'Marcus Lore', characters: [{ id: 'c2', name: 'Marcus' }] }],
    });
    presetsAPI.list.mockResolvedValue({ presets: [{ id: 'p1', name: 'Story Preset' }] });
    presetsAPI.getDefaultId.mockResolvedValue({ defaultPresetId: 'p1' });
  });

  it('leaves out the perspective', async () => {
    const wrapper = await mountModal({ story: CHAT, kind: 'chat' });
    const labels = wrapper.findAll('.form-group > label').map((label) => label.text());
    expect(labels).toEqual([
      'Chat Name *',
      'Characters',
      'Persona',
      'Lorebooks',
      'Chat Scenario',
      'Generation Preset',
    ]);
    expect(presetsAPI.get).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('saves everything in one chat update, without a character’s lorebook', async () => {
    const wrapper = await mountModal({ story: CHAT, kind: 'chat' });

    await wrapper.find('#characterFilter').setValue('Marcus');
    await wrapper.find('.search-result').trigger('click');
    expect(wrapper.find('#storyTitle').element.value).toBe('Chat with Layla and Marcus');
    expect(wrapper.findAll('.chip')).toHaveLength(0);

    await wrapper.find('#storyScenario').setValue('  Dawn.  ');
    await wrapper.find('#storyPreset').setValue('p1');
    await save(wrapper);

    // The cast-named title is left to the server, which renames it from the cast
    expect(chatsAPI.update).toHaveBeenCalledWith('ch1', {
      scenario: 'Dawn.',
      characterIds: ['c1', 'c2'],
      personaCharacterId: 'p9',
      lorebookIds: [],
      configPresetId: 'p1',
    });
    expect(charactersAPI.addToStory).not.toHaveBeenCalled();
    expect(storiesAPI.updateMetadata).not.toHaveBeenCalled();
    expect(wrapper.emitted('updated')[0][0].scenario).toBe('Dawn.');
    expect(wrapper.emitted('close')).toBeTruthy();
    wrapper.unmount();
  });

  it('sends a typed or custom title', async () => {
    const wrapper = await mountModal({ story: CHAT, kind: 'chat' });
    await wrapper.find('#storyTitle').setValue('Late night');
    await save(wrapper);
    expect(chatsAPI.update.mock.calls[0][1]).toMatchObject({ title: 'Late night' });
    wrapper.unmount();
  });

  it('keeps the Persona out of the cast', async () => {
    const wrapper = await mountModal({ story: CHAT, kind: 'chat' });

    // Picking a cast member as Persona takes them out of the chat
    await wrapper.find('#storyPersona').setValue('c1');
    expect(wrapper.findAll('.cast-name')).toHaveLength(0);
    expect(wrapper.find('#storyTitle').element.value).toBe('Untitled Chat');

    // Adding the Persona to the cast leaves the chat without one
    await wrapper.find('#characterFilter').setValue('Layla');
    await wrapper.find('.search-result').trigger('click');
    expect(wrapper.find('#storyPersona').element.selectedIndex).toBe(0);
    wrapper.unmount();
  });

  it('can open on the scenario', async () => {
    const wrapper = await mountModal({ story: CHAT, kind: 'chat', focusScenario: true });
    expect(document.activeElement).toBe(wrapper.find('#storyScenario').element);
    wrapper.unmount();
  });
});
