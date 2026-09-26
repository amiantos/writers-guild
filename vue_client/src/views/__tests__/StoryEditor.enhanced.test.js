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
  FloatingAvatarWindow: true,
  ThirdPersonPromptModal: {
    emits: ['rewrite'],
    template: '<button class="accept-rewrite" @click="$emit(\'rewrite\')">Rewrite</button>',
  },
};

async function* stream(chunks) {
  for (const chunk of chunks) yield chunk;
  yield { finished: true };
}

/** A stream that fails before sending anything. */
async function* failedStream(message) {
  yield* [];
  throw new Error(message);
}

function loadStory(content, passages = []) {
  storiesAPI.get.mockResolvedValue({
    story: { id: 's1', title: 'Rain', content, passages, characterIds: [] },
  });
}

async function mountEditor({ enhanced = true } = {}) {
  settingsAPI.get.mockResolvedValue({
    settings: { showReasoning: false, experimentalEnhancedStory: enhanced },
  });
  const wrapper = mount(StoryEditor, { props: { storyId: 's1' }, global: { stubs: STUBS } });
  await flushPromises();
  return wrapper;
}

function button(wrapper, label) {
  return wrapper.findAll('button').find((candidate) => candidate.text().trim() === label);
}

/** What the last save sent: the content, and the record of passages if it went along. */
function lastSave() {
  const [, content, passages] = storiesAPI.updateContent.mock.calls.at(-1);
  return { content, passages };
}

describe('StoryEditor in Enhanced Story Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storiesAPI.getHistoryStatus.mockResolvedValue({ canUndo: false, canRedo: false });
    storiesAPI.updateContent.mockResolvedValue({ success: true, canUndo: true, canRedo: false });
    charactersAPI.list.mockResolvedValue({ characters: [] });
  });

  it('opens on the story as passages, with a seam above each recorded one', async () => {
    loadStory('Opening.\n\nThe rain came down.\n\n', [
      { id: 'p1', text: 'The rain came down.', source: 'generated', action: 'continue' },
    ]);
    const wrapper = await mountEditor();

    expect(wrapper.find('textarea.story-editor').exists()).toBe(false);
    const blocks = wrapper.findAll('article.turn');
    expect(blocks.map((block) => block.text())).toEqual(['Opening.', 'The rain came down.']);
    expect(wrapper.findAll('.seam-label').map((label) => label.text())).toEqual([
      'How this was written',
    ]);
  });

  it('is the only view, with no switch to the editor or preview', async () => {
    loadStory('Opening.\n\n![map](/map.png)\n\n');
    const wrapper = await mountEditor();

    expect(wrapper.find('.story-column').exists()).toBe(true);
    expect(wrapper.find('button[title="Switch to editor"]').exists()).toBe(false);
    expect(wrapper.find('button[title="Preview rendered content"]').exists()).toBe(false);
    expect(wrapper.find('.story-preview').exists()).toBe(false);
    expect(wrapper.find('.bottom-toolbar').exists()).toBe(false);
  });

  it('records a continuation and its reasoning, and shows them in the seam', async () => {
    loadStory('Opening.\n\n');
    storiesAPI.continueStory.mockReturnValue(
      stream([{ reasoning: 'Keep it wet.' }, { content: 'The rain ' }, { content: 'came down.' }]),
    );
    const wrapper = await mountEditor();

    await button(wrapper, 'Continue').trigger('click');
    await flushPromises();

    const { content, passages } = lastSave();
    expect(content).toBe('Opening.\n\nThe rain came down.\n\n');
    expect(passages).toEqual([
      expect.objectContaining({
        text: 'The rain came down.',
        source: 'generated',
        action: 'continue',
        reasoning: 'Keep it wet.',
      }),
    ]);

    const seams = wrapper.findAll('.seam-toggle');
    await seams.at(-1).trigger('click');
    expect(wrapper.find('.seam-panel').text()).toContain('Keep it wet.');
    expect(wrapper.find('.seam-panel').text()).toContain('Continued the story');
  });

  it('sends the same request as story mode: the saved story, then continue', async () => {
    loadStory('Opening.\n\n');
    storiesAPI.continueStory.mockReturnValue(stream([{ content: 'More.' }]));
    const wrapper = await mountEditor();

    await wrapper.find('textarea.composer-input').setValue('She waited.');
    await button(wrapper, 'Send').trigger('click');
    await flushPromises();

    const firstSave = storiesAPI.updateContent.mock.calls[0];
    expect(firstSave[1]).toBe('Opening.\n\nShe waited.\n\n');
    expect(firstSave[2]).toEqual([
      expect.objectContaining({ text: 'She waited.', source: 'user', action: 'write' }),
    ]);
    // No characters in the story, so Send continues.
    expect(storiesAPI.continueStory).toHaveBeenCalledWith('s1', null, expect.anything());
    expect(lastSave().content).toBe('Opening.\n\nShe waited.\n\nMore.\n\n');
  });

  it('continues with an instruction, and keeps the instruction in the seam', async () => {
    loadStory('Opening.\n\n');
    storiesAPI.continueWithInstruction.mockReturnValue(stream([{ content: 'Thunder.' }]));
    const wrapper = await mountEditor();

    await wrapper.find('textarea.composer-input').setValue('Add thunder');
    await button(wrapper, 'Instruct').trigger('click');
    await flushPromises();

    expect(storiesAPI.continueWithInstruction).toHaveBeenCalledWith(
      's1',
      'Add thunder',
      expect.anything(),
    );
    expect(lastSave().passages).toEqual([
      expect.objectContaining({
        text: 'Thunder.',
        action: 'instruction',
        instruction: 'Add thunder',
      }),
    ]);
    expect(wrapper.find('textarea.composer-input').element.value).toBe('');
  });

  it('gives an instruction back when nothing was written', async () => {
    loadStory('Opening.\n\n');
    storiesAPI.continueWithInstruction.mockReturnValue(stream([]));
    const wrapper = await mountEditor();

    await wrapper.find('textarea.composer-input').setValue('Add thunder');
    await button(wrapper, 'Instruct').trigger('click');
    await flushPromises();

    expect(wrapper.find('textarea.composer-input').element.value).toBe('Add thunder');
  });

  it('keeps a rewritten greeting as one passage under one seam', async () => {
    loadStory('');
    storiesAPI.rewriteThirdPerson.mockReturnValue(
      stream([{ reasoning: 'Shift to third person.' }, { content: 'She waved.\n\nShe grinned.' }]),
    );
    const wrapper = await mountEditor();

    await button(wrapper, 'Greeting').trigger('click');
    await wrapper.find('.pick-greeting').trigger('click');
    await flushPromises();
    await wrapper.find('.accept-rewrite').trigger('click');
    await flushPromises();
    // The rewrite waits a frame after saving, to scroll the preview.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await flushPromises();

    const blocks = wrapper.findAll('article.turn');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text()).toContain('She waved.');
    expect(blocks[0].text()).toContain('She grinned.');
    expect(wrapper.findAll('.seam-label').map((label) => label.text())).toEqual([
      'How this was written',
    ]);
    expect(lastSave().passages.at(-1)).toEqual(
      expect.objectContaining({
        text: 'She waved.\n\nShe grinned.',
        action: 'rewrite',
        reasoning: 'Shift to third person.',
      }),
    );
  });

  it('edits a passage in place, marking its record edited', async () => {
    loadStory('Opening.\n\nThe rain came down.\n\nEnd.\n\n', [
      { id: 'p1', text: 'The rain came down.', source: 'generated', action: 'continue' },
    ]);
    const wrapper = await mountEditor();

    const passage = wrapper.findAll('article.turn')[1];
    await passage.find('button[title="Edit"]').trigger('click');
    await passage.find('textarea').setValue('The rain poured.');
    await button(passage, 'Save').trigger('click');
    await flushPromises();

    const { content, passages } = lastSave();
    expect(content).toBe('Opening.\n\nThe rain poured.\n\nEnd.\n\n');
    expect(passages).toEqual([
      expect.objectContaining({ id: 'p1', text: 'The rain poured.', edited: true }),
      expect.objectContaining({ text: 'The rain came down.', action: 'continue' }),
    ]);
    expect(passages[1].id).not.toBe('p1');
    expect(passages[1].edited).toBeUndefined();
  });

  it('keeps the seam on a passage through undoing and redoing its edit', async () => {
    loadStory('Opening.\n\nThe rain came down.\n\n', [
      {
        id: 'p1',
        text: 'The rain came down.',
        source: 'generated',
        action: 'continue',
        reasoning: 'Keep it wet.',
      },
    ]);
    const wrapper = await mountEditor();

    const passage = wrapper.findAll('article.turn')[1];
    await passage.find('button[title="Edit"]').trigger('click');
    await passage.find('textarea').setValue('The rain poured.');
    await button(passage, 'Save').trigger('click');
    await flushPromises();

    const seamLabels = () => wrapper.findAll('.seam-label').map((label) => label.text());
    storiesAPI.undo.mockResolvedValue({
      content: 'Opening.\n\nThe rain came down.\n\n',
      canUndo: false,
      canRedo: true,
    });
    await wrapper.find('button[aria-label="Undo"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('article.turn')[1].text()).toBe('The rain came down.');
    expect(seamLabels()).toEqual(['How this was written']);
    await wrapper.find('.seam-toggle').trigger('click');
    expect(wrapper.find('.seam-panel').text()).toContain('Keep it wet.');
    expect(wrapper.find('.seam-panel').text()).not.toContain('edited');

    storiesAPI.redo.mockResolvedValue({
      content: 'Opening.\n\nThe rain poured.\n\n',
      canUndo: true,
      canRedo: false,
    });
    await wrapper.find('button[aria-label="Redo"]').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('article.turn')[1].text()).toBe('The rain poured.');
    expect(seamLabels()).toEqual(['How this was written']);
  });

  it('deletes a passage, keeping its record last for undo', async () => {
    loadStory('Opening.\n\nThe rain came down.\n\nEnd.\n\n', [
      { id: 'p1', text: 'The rain came down.', source: 'generated', action: 'continue' },
      { id: 'p2', text: 'End.', source: 'generated', action: 'continue' },
    ]);
    const wrapper = await mountEditor();

    await wrapper.findAll('article.turn')[1].find('button[title="Delete"]').trigger('click');
    await flushPromises();

    const { content, passages } = lastSave();
    expect(content).toBe('Opening.\n\nEnd.\n\n');
    expect(passages.map((record) => record.id)).toEqual(['p2', 'p1']);
    expect(wrapper.findAll('article.turn').map((block) => block.text())).toEqual([
      'Opening.',
      'End.',
    ]);
  });

  it('writes the last passage again with the same instruction', async () => {
    loadStory('Opening.\n\nThunder.\n\n', [
      {
        id: 'p1',
        text: 'Thunder.',
        source: 'generated',
        action: 'instruction',
        instruction: 'Add thunder',
      },
    ]);
    storiesAPI.continueWithInstruction.mockReturnValue(stream([{ content: 'Lightning.' }]));
    const wrapper = await mountEditor();

    const blocks = wrapper.findAll('article.turn');
    expect(blocks[0].find('button[title="Write another version"]').exists()).toBe(false);
    await blocks[1].find('button[title="Write another version"]').trigger('click');
    await flushPromises();

    // The story is saved without the old passage before the model is asked again.
    expect(storiesAPI.updateContent.mock.calls[0][1]).toBe('Opening.\n\n');
    expect(storiesAPI.continueWithInstruction).toHaveBeenCalledWith(
      's1',
      'Add thunder',
      expect.anything(),
    );
    expect(lastSave().content).toBe('Opening.\n\nLightning.\n\n');
  });

  it("shows the new version's seam when it comes back with the same text", async () => {
    loadStory('Opening.\n\nThunder.\n\n', [
      {
        id: 'p1',
        text: 'Thunder.',
        source: 'generated',
        action: 'continue',
        reasoning: 'First try.',
      },
    ]);
    storiesAPI.continueStory.mockReturnValue(
      stream([{ reasoning: 'Second try.' }, { content: 'Thunder.' }]),
    );
    const wrapper = await mountEditor();

    await wrapper
      .findAll('article.turn')[1]
      .find('button[title="Write another version"]')
      .trigger('click');
    await flushPromises();

    const { content, passages } = lastSave();
    expect(content).toBe('Opening.\n\nThunder.\n\n');
    // The old version stays, for Undo, but the newer record wins the text.
    expect(passages.map((record) => record.reasoning)).toEqual(['First try.', 'Second try.']);
    await wrapper.findAll('.seam-toggle').at(-1).trigger('click');
    expect(wrapper.find('.seam-panel').text()).toContain('Second try.');
  });

  it('puts the passage back when writing another version fails', async () => {
    loadStory('Opening.\n\nThunder.\n\n', [
      { id: 'p1', text: 'Thunder.', source: 'generated', action: 'continue' },
    ]);
    storiesAPI.continueStory.mockReturnValue(failedStream('Network down'));
    const wrapper = await mountEditor();

    await wrapper
      .findAll('article.turn')[1]
      .find('button[title="Write another version"]')
      .trigger('click');
    await flushPromises();

    expect(lastSave().content).toBe('Opening.\n\nThunder.\n\n');
    expect(wrapper.findAll('article.turn').map((block) => block.text())).toEqual([
      'Opening.',
      'Thunder.',
    ]);
    expect(wrapper.findAll('.seam-label').map((label) => label.text())).toEqual([
      'How this was written',
    ]);
  });

  it("leaves a character's passage alone when the character has left the story", async () => {
    loadStory('Opening.\n\nMara spoke.\n\n', [
      {
        id: 'p1',
        text: 'Mara spoke.',
        source: 'generated',
        action: 'character',
        characterId: 'gone',
        characterName: 'Mara',
      },
    ]);
    const wrapper = await mountEditor();

    await wrapper
      .findAll('article.turn')[1]
      .find('button[title="Write another version"]')
      .trigger('click');
    await flushPromises();

    expect(storiesAPI.updateContent).not.toHaveBeenCalled();
    expect(storiesAPI.continueStory).not.toHaveBeenCalled();
    expect(wrapper.findAll('article.turn')).toHaveLength(2);
  });

  it("keeps the composer's buttons off until the story's characters have loaded", async () => {
    storiesAPI.get.mockResolvedValue({
      story: {
        id: 's1',
        title: 'Rain',
        content: 'Opening.\n\n',
        passages: [],
        characterIds: ['mara'],
      },
    });
    let finishLoading;
    charactersAPI.list.mockReturnValue(
      new Promise((resolve) => {
        finishLoading = () => resolve({ characters: [{ id: 'mara', name: 'Mara' }] });
      }),
    );
    const wrapper = await mountEditor();

    await wrapper.find('textarea.composer-input').setValue('She waited.');
    expect(button(wrapper, 'Send').element.disabled).toBe(true);
    expect(button(wrapper, 'Continue').element.disabled).toBe(true);

    finishLoading();
    await flushPromises();
    expect(button(wrapper, 'Send').element.disabled).toBe(false);
    expect(button(wrapper, 'Continue for Character').element.disabled).toBe(false);
  });

  it('stays plain story mode with the setting off: preview, toolbar, and no record', async () => {
    loadStory('Opening.\n\n');
    storiesAPI.continueStory.mockReturnValue(stream([{ content: 'More.' }]));
    const wrapper = await mountEditor({ enhanced: false });

    expect(wrapper.find('textarea.story-editor').exists()).toBe(true);
    expect(wrapper.find('.composer').exists()).toBe(false);

    await button(wrapper, 'Continue').trigger('click');
    await flushPromises();

    expect(lastSave().passages).toBeUndefined();
    await wrapper.find('button[title="Preview rendered content"]').trigger('click');
    expect(wrapper.find('.story-preview').exists()).toBe(true);
    expect(wrapper.find('.preview-input-bar').exists()).toBe(true);
  });
});
