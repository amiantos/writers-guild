import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import StoryEditor from '../StoryEditor.vue';
import { storiesAPI, settingsAPI, charactersAPI } from '../../services/api';

vi.mock('../../services/api', () => ({
  storiesAPI: {
    get: vi.fn(),
    getHistoryStatus: vi.fn(),
    updateContent: vi.fn(),
    continueStory: vi.fn(),
    continueWithInstruction: vi.fn(),
    storyStarter: vi.fn(),
    rewriteThirdPerson: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    setRewritePrompt: vi.fn(),
  },
  settingsAPI: { get: vi.fn() },
  charactersAPI: { list: vi.fn() },
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}));
vi.mock('../../router', () => ({ setPageTitle: vi.fn() }));
vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('../../composables/useNavigation', () => ({
  useNavigation: () => ({ goBack: vi.fn() }),
}));
vi.mock('../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));

const STUBS = {
  ReasoningPanel: true,
  CharacterResponseModal: true,
  GreetingSelectorModal: {
    emits: ['select'],
    template:
      '<button class="pick-greeting" @click="$emit(\'select\', \'I wave.\\n\\nI grin.\')">Pick</button>',
  },
  ViewPromptModal: true,
  CustomPromptModal: true,
  ManageCharactersModal: true,
  ManageLorebooksModal: true,
  RenameStoryModal: true,
  StoryPresetModal: true,
  IdeateModal: true,
  ArchivistModal: { name: 'ArchivistModal', props: ['kind', 'sourceId'], template: '<div />' },
  FloatingAvatarWindow: true,
  ThirdPersonPromptModal: {
    emits: ['rewrite'],
    template: '<button class="accept-rewrite" @click="$emit(\'rewrite\')">Rewrite</button>',
  },
};

async function mountEditor() {
  storiesAPI.get.mockResolvedValue({
    story: { id: 's1', title: 'Rain', content: 'Opening.', passages: [], characterIds: [] },
  });
  // The old story mode's editor, whose edits wait for the next save
  settingsAPI.get.mockResolvedValue({
    settings: { showReasoning: false, experimentalOldStoryMode: true },
  });
  const wrapper = mount(StoryEditor, { props: { storyId: 's1' }, global: { stubs: STUBS } });
  await flushPromises();
  return wrapper;
}

function archivistButton(wrapper) {
  return wrapper
    .findAll('button')
    .find((candidate) => candidate.attributes('title') === 'Review Cards with the Archivist');
}

describe('StoryEditor with the Archivist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storiesAPI.getHistoryStatus.mockResolvedValue({ canUndo: false, canRedo: false });
    charactersAPI.list.mockResolvedValue({ characters: [] });
  });

  it('saves the story before the Archivist reads it', async () => {
    storiesAPI.updateContent.mockResolvedValue({ success: true });
    const wrapper = await mountEditor();
    await wrapper.find('textarea.story-editor').setValue('Opening. Layla met Sam.');

    await archivistButton(wrapper).trigger('click');
    await flushPromises();

    expect(storiesAPI.updateContent).toHaveBeenCalledWith(
      's1',
      'Opening. Layla met Sam.',
      undefined,
    );
    expect(wrapper.findComponent({ name: 'ArchivistModal' }).props()).toEqual({
      kind: 'story',
      sourceId: 's1',
    });
  });

  it("doesn't open when the story couldn't be saved", async () => {
    storiesAPI.updateContent.mockRejectedValue(new Error('offline'));
    const wrapper = await mountEditor();
    await wrapper.find('textarea.story-editor').setValue('Opening. Layla met Sam.');

    await archivistButton(wrapper).trigger('click');
    await flushPromises();

    expect(wrapper.findComponent({ name: 'ArchivistModal' }).exists()).toBe(false);
  });
});
