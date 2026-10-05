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
    duplicate: vi.fn(),
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
  GreetingSelectorModal: true,
  ViewPromptModal: true,
  CustomPromptModal: true,
  EditStoryModal: { name: 'EditStoryModal', props: ['story'], template: '<div />' },
  IdeateModal: true,
  ArchivistModal: true,
  FloatingAvatarWindow: true,
  ThirdPersonPromptModal: true,
};

async function mountEditor() {
  storiesAPI.get.mockResolvedValue({
    story: { id: 's1', title: 'Rain', content: 'Opening.', passages: [], characterIds: [] },
  });
  settingsAPI.get.mockResolvedValue({ settings: { showReasoning: false } });
  const wrapper = mount(StoryEditor, { props: { storyId: 's1' }, global: { stubs: STUBS } });
  await flushPromises();
  return wrapper;
}

function newStoryButton(wrapper) {
  return wrapper
    .findAll('button')
    .find((candidate) => candidate.attributes('title') === "New Story with this story's setup");
}

describe('StoryEditor New Story', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    route.query = {};
    storiesAPI.getHistoryStatus.mockResolvedValue({ canUndo: false, canRedo: false });
    charactersAPI.list.mockResolvedValue({ characters: [] });
  });

  it('starts a blank copy and opens it on Edit Story', async () => {
    storiesAPI.duplicate.mockResolvedValue({ story: { id: 's2' } });
    const wrapper = await mountEditor();

    await newStoryButton(wrapper).trigger('click');
    await flushPromises();

    expect(storiesAPI.duplicate).toHaveBeenCalledWith('s1', { blank: true });
    expect(router.push).toHaveBeenCalledWith({
      name: 'story',
      params: { storyId: 's2' },
      query: { edit: '1' },
    });
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
