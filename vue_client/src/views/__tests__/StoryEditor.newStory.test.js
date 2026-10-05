import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import StoryEditor from '../StoryEditor.vue';
import { storiesAPI, settingsAPI, charactersAPI } from '../../services/api';

vi.mock('../../services/api', () => ({
  storiesAPI: {
    get: vi.fn(),
    getHistoryStatus: vi.fn(),
    updateContent: vi.fn(),
    setRewritePrompt: vi.fn(),
  },
  settingsAPI: { get: vi.fn() },
  charactersAPI: { list: vi.fn() },
}));
const router = { push: vi.fn(), replace: vi.fn() };
const route = { query: {} };
vi.mock('vue-router', () => ({
  useRouter: () => router,
  useRoute: () => route,
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
    name: 'GreetingSelectorModal',
    emits: ['close'],
    template: '<button class="close-greeting" @click="$emit(\'close\')">Close</button>',
  },
  ViewPromptModal: true,
  CustomPromptModal: true,
  EditStoryModal: { name: 'EditStoryModal', props: ['story'], template: '<div />' },
  IdeateModal: true,
  ArchivistModal: true,
  FloatingAvatarWindow: true,
  ThirdPersonPromptModal: { name: 'ThirdPersonPromptModal', template: '<div />' },
};

async function mountEditor(story = {}) {
  storiesAPI.get.mockResolvedValue({
    story: {
      id: 's1',
      title: 'Rain',
      content: 'Opening.',
      passages: [],
      characterIds: [],
      ...story,
    },
  });
  settingsAPI.get.mockResolvedValue({ settings: { showReasoning: false } });
  const wrapper = mount(StoryEditor, { props: { storyId: 's1' }, global: { stubs: STUBS } });
  await flushPromises();
  return wrapper;
}

describe('StoryEditor opening on Edit Story', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route.query = {};
    storiesAPI.getHistoryStatus.mockResolvedValue({ canUndo: false, canRedo: false });
    charactersAPI.list.mockResolvedValue({ characters: [] });
  });

  it('opens Edit Story on load when asked, and drops the ask from the address', async () => {
    route.query = { edit: '1' };
    const wrapper = await mountEditor();

    expect(wrapper.findComponent({ name: 'EditStoryModal' }).exists()).toBe(true);
    expect(router.replace).toHaveBeenCalledWith({ query: { edit: undefined } });
  });

  it('keeps Edit Story closed on an ordinary load', async () => {
    const wrapper = await mountEditor();
    expect(wrapper.findComponent({ name: 'EditStoryModal' }).exists()).toBe(false);
  });
});

describe('StoryEditor greeting dismissed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route.query = {};
    storiesAPI.getHistoryStatus.mockResolvedValue({ canUndo: false, canRedo: false });
    storiesAPI.setRewritePrompt.mockResolvedValue({});
    charactersAPI.list.mockResolvedValue({ characters: [{ id: 'c1', name: 'Layla' }] });
  });

  it('skips the rewrite prompt when the story is still blank', async () => {
    const wrapper = await mountEditor({
      content: '',
      characterIds: ['c1'],
      needsRewritePrompt: true,
    });

    await wrapper.find('.close-greeting').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent({ name: 'ThirdPersonPromptModal' }).exists()).toBe(false);
  });

  it('still offers the rewrite when the story has text', async () => {
    const wrapper = await mountEditor({
      content: 'Hello there.',
      characterIds: ['c1'],
      needsRewritePrompt: true,
    });

    await wrapper.find('.close-greeting').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent({ name: 'ThirdPersonPromptModal' }).exists()).toBe(true);
  });
});
