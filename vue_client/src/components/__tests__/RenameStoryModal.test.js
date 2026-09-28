import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import RenameStoryModal from '../RenameStoryModal.vue';
import { presetsAPI, storiesAPI } from '../../services/api';

vi.mock('../../services/api', () => ({
  storiesAPI: { updateMetadata: vi.fn() },
  presetsAPI: { get: vi.fn(), getDefaultId: vi.fn() },
}));
vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const ContinuityPicker = {
  name: 'ContinuityPicker',
  template: '<div />',
  methods: { save: () => undefined },
};

const STORY = {
  id: 's1',
  title: 'Harbor',
  scenario: '',
  configPresetId: 'p1',
  perspective: null,
  perspectiveTense: null,
  perspectiveCharacterId: null,
};

async function mountModal({ story = STORY, systemPrompt = null } = {}) {
  presetsAPI.get.mockResolvedValue({ preset: { promptTemplates: { systemPrompt } } });
  const wrapper = mount(RenameStoryModal, {
    props: {
      story,
      characters: [{ id: 'c1', name: 'Layla' }],
      persona: { id: 'p9', name: 'Brad' },
    },
    global: { stubs: { ContinuityPicker, Teleport: true } },
  });
  await flushPromises();
  return wrapper;
}

describe('RenameStoryModal perspective', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storiesAPI.updateMetadata.mockResolvedValue({});
  });

  it('shows the default and saves it as null', async () => {
    const wrapper = await mountModal();
    expect(wrapper.find('#storyPerspective').element.value).toBe('third');
    expect(wrapper.find('#storyPerspectiveCharacter').exists()).toBe(false);

    await wrapper.findAll('button').at(-1).trigger('click');
    await flushPromises();
    expect(storiesAPI.updateMetadata).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        perspective: null,
        perspectiveTense: null,
        perspectiveCharacterId: null,
      }),
    );
  });

  it('picks a narrator, the Persona included, for first person', async () => {
    const wrapper = await mountModal();
    await wrapper.find('#storyPerspective').setValue('first');
    await wrapper.find('#storyPerspectiveTense').setValue('present');

    const select = wrapper.find('#storyPerspectiveCharacter');
    expect(select.findAll('option').map((option) => option.text())).toEqual([
      'Not set',
      'Brad (Persona)',
      'Layla',
    ]);
    await select.setValue('p9');

    await wrapper.findAll('button').at(-1).trigger('click');
    await flushPromises();
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
});
