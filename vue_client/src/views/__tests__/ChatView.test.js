import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import ChatView from '../ChatView.vue';
import { chatsAPI } from '../../services/chatsApi';
import { settingsAPI } from '../../services/api';

vi.mock('../../services/chatsApi', () => ({
  chatsAPI: {
    get: vi.fn(),
    send: vi.fn(),
    reply: vi.fn(),
    regenerate: vi.fn(),
    setSwipe: vi.fn(),
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
  },
}));
vi.mock('../../services/api', () => ({ settingsAPI: { get: vi.fn() } }));

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
    global: { stubs: { ChatSetupModal: true, ViewPromptModal: true } },
  });
}

function button(wrapper, title) {
  return wrapper.findAll('button').find((candidate) => candidate.attributes('title') === title);
}

describe('ChatView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsAPI.get.mockResolvedValue({ settings: { showReasoning: true } });
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
      yield { type: 'speaker', characterId: 'layla', name: 'Layla' };
      yield { type: 'prompt', system: 'sys', user: 'usr' };
      yield { type: 'content', text: 'finally\n---\nhow' };
      await finished;
      yield { type: 'done' };
    });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('.composer-input').setValue('landed');
    await wrapper.find('.composer-input').trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(chatsAPI.send).toHaveBeenCalledWith('c1', 'landed', {
      characterId: null,
      signal: expect.anything(),
    });
    expect(wrapper.find('.composer-input').element.value).toBe('');
    expect(wrapper.findAll('.pending-bubble').map((bubble) => bubble.text())).toEqual([
      'finally',
      'how',
    ]);
    expect(button(wrapper, 'View the last prompt sent')).toBeTruthy();

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

  it('gives the message back when the reply fails before it was saved', async () => {
    chatsAPI.send.mockImplementation(async function* stream() {
      yield* [];
      throw new Error('No configuration preset found');
    });
    const wrapper = mountChat();
    await flushPromises();

    await wrapper.find('.composer-input').setValue('hello?');
    await wrapper.find('.composer-input').trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.find('.composer-input').element.value).toBe('hello?');
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
    await button(wrapper, "Show the model's reasoning").trigger('click');
    expect(wrapper.find('.reasoning').text()).toBe('She is awake.');

    await button(wrapper, 'Next version').trigger('click');
    await flushPromises();

    expect(chatsAPI.setSwipe).toHaveBeenCalledWith('c1', 't2', 1);
    expect(wrapper.find('.swipe-count').text()).toBe('2/2');
    expect(wrapper.findAll('.bubble').at(-1).text()).toBe('no');
  });

  it('names speakers in a group chat and lets the user pick who replies', async () => {
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
    await wrapper.find('.reply-from').setValue('sam');
    await wrapper
      .findAll('button')
      .find((candidate) => candidate.text().includes('Let them write'))
      .trigger('click');
    await flushPromises();

    expect(chatsAPI.reply).toHaveBeenCalledWith('c1', {
      characterId: 'sam',
      signal: expect.anything(),
    });
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
