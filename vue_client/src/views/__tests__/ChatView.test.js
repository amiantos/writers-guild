import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import ChatView from '../ChatView.vue';
import { chatsAPI } from '../../services/chatsApi';

vi.mock('../../services/chatsApi', () => ({
  chatsAPI: {
    get: vi.fn(),
    send: vi.fn(),
    reply: vi.fn(),
    regenerate: vi.fn(),
    setSwipe: vi.fn(),
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
    update: vi.fn(),
    clear: vi.fn(),
    delete: vi.fn(),
  },
}));

const characters = ref([
  { id: 'layla', name: 'Layla', thumbnailUrl: null },
  { id: 'sam', name: 'Sam', thumbnailUrl: null },
]);
vi.mock('../../composables/useDataCache', () => ({
  useDataCache: () => ({ characters, loadCharacters: vi.fn(async () => {}) }),
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../router', () => ({ setPageTitle: vi.fn() }));
vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));

const CHAT = {
  id: 'c1',
  title: 'Chat with Layla',
  scenario: "It's nearly midnight.",
  characterIds: ['layla'],
  personaCharacterId: null,
};

function turn(id, source, messages, { characterId = null, swipes = null, activeSwipe = 0 } = {}) {
  return {
    id,
    source,
    characterId,
    senderName: source === 'user' ? 'Bradley' : 'Layla',
    messages,
    swipes: swipes ?? [{ messages, reasoning: '' }],
    activeSwipe,
  };
}

const TURNS = [
  turn('t1', 'user', ['you up?']),
  turn('t2', 'character', ['always', 'why?'], { characterId: 'layla' }),
];

function mountChat() {
  return mount(ChatView, {
    props: { chatId: 'c1' },
    global: {
      stubs: {
        ViewPromptModal: true,
        EditChatModal: true,
        StoryPresetModal: true,
        ManageLorebooksModal: true,
        ManageCharactersModal: {
          props: ['story', 'adapter'],
          template: '<div class="manage-characters" />',
        },
        CharacterResponseModal: {
          props: ['characters'],
          emits: ['select'],
          template:
            '<div class="character-picker"><button v-for="c in characters" :key="c.id" class="pick" @click="$emit(\'select\', c.id)">{{ c.name }}</button></div>',
        },
      },
    },
  });
}

function button(wrapper, title) {
  return wrapper.findAll('button').find((candidate) => candidate.attributes('title') === title);
}

describe('ChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatsAPI.get.mockResolvedValue({ chat: CHAT, turns: TURNS });
  });

  it('shows the scenario and the conversation as bubbles', async () => {
    const wrapper = mountChat();
    await flushPromises();

    expect(wrapper.find('.scenario-text').text()).toBe("It's nearly midnight.");
    expect(wrapper.findAll('.bubble').map((bubble) => bubble.text())).toEqual([
      'you up?',
      'always',
      'why?',
    ]);
    // One-on-one chats don't name the sender.
    expect(wrapper.find('.sender').exists()).toBe(false);
  });

  it('sends with Enter, streams the reply, then shows what was saved', async () => {
    let finish;
    const finished = new Promise((resolve) => {
      finish = resolve;
    });
    chatsAPI.send.mockImplementation(async function* stream() {
      yield { type: 'turn', turn: turn('t3', 'user', ['landed']) };
      yield { type: 'speaker', characterId: 'layla', name: 'Layla', otherNames: ['Bradley'] };
      yield { type: 'prompt', system: 'sys', user: 'usr' };
      // An echoed line and the sender's own label, which the saved reply won't have either.
      yield { type: 'content', text: 'Bradley: landed\nLayla: finally\n---\nhow' };
      await finished;
      yield { type: 'done' };
    });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('.message-input').setValue('landed');
    await wrapper.find('.message-input').trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(chatsAPI.send).toHaveBeenCalledWith('c1', 'landed', { signal: expect.anything() });
    expect(wrapper.find('.generating-status').text()).toContain('Layla is typing...');
    expect(wrapper.find('.message-input').element.value).toBe('');
    expect(wrapper.findAll('.pending-bubble').map((bubble) => bubble.text())).toEqual([
      'finally',
      'how',
    ]);

    chatsAPI.get.mockResolvedValue({
      chat: CHAT,
      turns: [
        ...TURNS,
        turn('t3', 'user', ['landed']),
        turn('t4', 'character', ['finally', 'how was it'], { characterId: 'layla' }),
      ],
    });
    finish();
    await flushPromises();

    expect(wrapper.find('.pending-bubble').exists()).toBe(false);
    expect(
      wrapper
        .findAll('.bubble')
        .map((bubble) => bubble.text())
        .slice(-2),
    ).toEqual(['finally', 'how was it']);
  });

  it('streams reasoning into the live seam above the reply', async () => {
    let finish;
    const finished = new Promise((resolve) => {
      finish = resolve;
    });
    chatsAPI.reply.mockImplementation(async function* stream() {
      yield { type: 'speaker', characterId: 'layla', name: 'Layla' };
      yield { type: 'reasoning', text: 'He sounds tired. ' };
      yield { type: 'reasoning', text: 'Keep it short.' };
      await finished;
    });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text().includes('Let Layla Write'))
      .trigger('click');
    await flushPromises();

    const seam = wrapper.findAll('.turn-seam').at(-1);
    expect(seam.classes()).toContain('live');
    expect(seam.find('.seam-label').text()).toBe('Layla is thinking...');
    await seam.find('.seam-toggle').trigger('click');
    expect(seam.find('.block-text').text()).toBe('He sounds tired. Keep it short.');
    // No top panel, whatever the display settings say.
    expect(wrapper.find('.reasoning-panel').exists()).toBe(false);
    finish();
    await flushPromises();
  });

  it('gives the message back when the reply fails before it was saved', async () => {
    chatsAPI.send.mockImplementation(async function* stream() {
      yield* [];
      throw new Error('No configuration preset found');
    });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('.message-input').setValue('hello?');
    await wrapper.find('.message-input').trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.find('.message-input').element.value).toBe('hello?');
  });

  it('keeps the composer empty when a dropped reply’s message was saved after all', async () => {
    chatsAPI.send.mockImplementation(async function* stream() {
      yield* [];
      throw new Error('The connection closed before the reply finished');
    });
    const wrapper = mountChat();
    await flushPromises();
    chatsAPI.get.mockResolvedValue({
      chat: CHAT,
      turns: [...TURNS, turn('t3', 'user', ['hello?'])],
    });

    await wrapper.find('.message-input').setValue('hello?');
    await wrapper.find('.message-input').trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.find('.message-input').element.value).toBe('');
    expect(wrapper.findAll('.bubble').at(-1).text()).toBe('hello?');
  });

  it('regenerates the last reply, hiding the version it replaces', async () => {
    let finish;
    const finished = new Promise((resolve) => {
      finish = resolve;
    });
    chatsAPI.regenerate.mockImplementation(async function* stream() {
      yield { type: 'content', text: 'nope' };
      await finished;
    });
    const wrapper = mountChat();
    await flushPromises();

    await button(wrapper, 'Write another version of this reply').trigger('click');
    await flushPromises();

    expect(chatsAPI.regenerate).toHaveBeenCalledWith('c1', 't2', { signal: expect.anything() });
    expect(wrapper.findAll('.bubble').map((bubble) => bubble.text())).toEqual(['you up?']);
    expect(wrapper.find('.pending-bubble').text()).toBe('nope');
    finish();
    await flushPromises();
  });

  it('switches between versions of a reply and shows its reasoning', async () => {
    const swiped = turn('t2', 'character', ['always'], {
      characterId: 'layla',
      swipes: [
        { messages: ['always'], reasoning: 'She is awake.' },
        { messages: ['no'], reasoning: '' },
      ],
    });
    chatsAPI.get.mockResolvedValue({ chat: CHAT, turns: [TURNS[0], swiped] });
    chatsAPI.setSwipe.mockResolvedValue({
      turn: { ...swiped, activeSwipe: 1, messages: ['no'] },
    });
    const wrapper = mountChat();
    await flushPromises();

    expect(wrapper.find('.swipe-count').text()).toBe('1/2');
    await wrapper.find('.seam-toggle').trigger('click');
    expect(wrapper.find('.seam-panel .block-text').text()).toBe('She is awake.');

    await button(wrapper, 'Next version').trigger('click');
    await flushPromises();

    expect(chatsAPI.setSwipe).toHaveBeenCalledWith('c1', 't2', 1);
    expect(wrapper.find('.swipe-count').text()).toBe('2/2');
    expect(wrapper.findAll('.bubble').at(-1).text()).toBe('no');
    // The seam follows the version shown.
    expect(wrapper.find('.seam-panel').text()).toContain("didn't share any reasoning");
  });

  it('locks versions and regenerating once a later message comes through', async () => {
    const earlier = turn('t2', 'character', ['always'], {
      characterId: 'layla',
      swipes: [
        { messages: ['always'], reasoning: '' },
        { messages: ['no'], reasoning: '' },
      ],
    });
    chatsAPI.get.mockResolvedValue({
      chat: CHAT,
      turns: [TURNS[0], earlier, turn('t3', 'user', ['ok'])],
    });
    const wrapper = mountChat();
    await flushPromises();

    expect(wrapper.find('.swipe-count').exists()).toBe(false);
    expect(button(wrapper, 'Next version')).toBeUndefined();
    expect(button(wrapper, 'Write another version of this reply')).toBeUndefined();
  });

  it('names speakers in a group chat and asks who should write', async () => {
    chatsAPI.get.mockResolvedValue({
      chat: { ...CHAT, characterIds: ['layla', 'sam'] },
      turns: [...TURNS, turn('t3', 'character', ['sup'], { characterId: 'sam' })],
    });
    chatsAPI.reply.mockImplementation(async function* stream() {
      yield { type: 'done' };
    });
    const wrapper = mountChat();
    await flushPromises();

    expect(wrapper.findAll('.sender').map((sender) => sender.text())).toEqual(['Layla', 'Sam']);
    expect(wrapper.find('.message-input').attributes('placeholder')).toBe('Message the group...');
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text().includes('Let a Character Write'))
      .trigger('click');
    await wrapper.findAll('.pick')[1].trigger('click');
    await flushPromises();

    expect(chatsAPI.reply).toHaveBeenCalledWith('c1', {
      characterId: 'sam',
      signal: expect.anything(),
    });
  });

  it('starts a new chat by choosing its characters', async () => {
    chatsAPI.get.mockResolvedValue({
      chat: { ...CHAT, characterIds: [], scenario: '' },
      turns: [],
    });
    const wrapper = mountChat();
    await flushPromises();

    expect(wrapper.find('.manage-characters').exists()).toBe(true);
    expect(wrapper.find('.empty-state').text()).toContain('Add characters to start chatting.');
    expect(wrapper.find('.scenario-text').text()).toContain('Describe this scenario');
    expect(wrapper.find('.message-input').attributes('disabled')).toBeDefined();
  });

  it('adds characters through the chat, keeping the persona out of it', async () => {
    chatsAPI.update.mockImplementation(async (_id, fields) => ({ chat: { ...CHAT, ...fields } }));
    const wrapper = mountChat();
    await flushPromises();

    await button(wrapper, 'Manage Characters').trigger('click');
    const { adapter } = wrapper.findComponent('.manage-characters').props();
    await adapter.addCharacter('sam');
    expect(chatsAPI.update).toHaveBeenLastCalledWith('c1', {
      characterIds: ['layla', 'sam'],
      personaCharacterId: null,
    });
    await adapter.setPersona('layla');
    expect(chatsAPI.update).toHaveBeenLastCalledWith('c1', {
      personaCharacterId: 'layla',
      characterIds: ['sam'],
    });
    await flushPromises();
    expect(wrapper.find('.chat-title').text()).toBe('Chat with Layla');
  });

  it('loads the new chat, dropping the old one’s prompt, when only the chat changes', async () => {
    chatsAPI.reply.mockImplementation(async function* stream() {
      yield { type: 'prompt', system: 'old system', user: 'old user' };
      yield { type: 'done' };
    });
    const wrapper = mountChat();
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text().includes('Let Layla Write'))
      .trigger('click');
    await flushPromises();
    await wrapper.find('[aria-label="More options"]').trigger('click');
    expect(wrapper.text()).toContain('View Last Prompt');

    chatsAPI.get.mockResolvedValue({
      chat: { ...CHAT, id: 'c2', title: 'Another chat' },
      turns: [turn('t9', 'user', ['different'])],
    });
    await wrapper.setProps({ chatId: 'c2' });
    await flushPromises();

    expect(chatsAPI.get).toHaveBeenLastCalledWith('c2');
    expect(wrapper.find('.chat-title').text()).toBe('Another chat');
    expect(wrapper.findAll('.bubble').map((bubble) => bubble.text())).toEqual(['different']);
    await wrapper.find('[aria-label="More options"]').trigger('click');
    expect(wrapper.text()).not.toContain('View Last Prompt');
  });

  it('keeps the newest chat when an older chat’s load finishes last', async () => {
    let finishOld;
    chatsAPI.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = () => resolve({ chat: { ...CHAT, title: 'Old chat' }, turns: TURNS });
        }),
    );
    const wrapper = mountChat();
    chatsAPI.get.mockResolvedValue({
      chat: { ...CHAT, id: 'c2', title: 'New chat' },
      turns: [turn('t9', 'user', ['new'])],
    });
    await wrapper.setProps({ chatId: 'c2' });
    await flushPromises();
    finishOld();
    await flushPromises();

    expect(wrapper.find('.chat-title').text()).toBe('New chat');
    expect(wrapper.findAll('.bubble').map((bubble) => bubble.text())).toEqual(['new']);
  });

  it('clears the chat from the overflow menu', async () => {
    chatsAPI.clear.mockResolvedValue({ success: true });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('[aria-label="More options"]').trigger('click');
    await wrapper
      .findAll('.overflow-menu-item')
      .find((item) => item.text() === 'Clear Chat')
      .trigger('click');
    await flushPromises();

    expect(chatsAPI.clear).toHaveBeenCalledWith('c1');
    expect(wrapper.find('.bubble').exists()).toBe(false);
  });

  it('edits and deletes single messages', async () => {
    chatsAPI.editMessage.mockResolvedValue({
      turn: { ...TURNS[1], messages: ['always!', 'why?'] },
    });
    chatsAPI.deleteMessage.mockResolvedValue({ turn: null });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.findAll('[title="Edit this message"]')[1].trigger('click');
    await wrapper.find('.bubble-editor').setValue('always!');
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Save')
      .trigger('click');
    await flushPromises();
    expect(chatsAPI.editMessage).toHaveBeenCalledWith('c1', 't2', 0, 'always!');

    await wrapper.findAll('[title="Delete this message"]')[0].trigger('click');
    await flushPromises();
    expect(chatsAPI.deleteMessage).toHaveBeenCalledWith('c1', 't1', 0);
    expect(wrapper.findAll('.bubble').map((bubble) => bubble.text())).toEqual(['always!', 'why?']);
  });
});
