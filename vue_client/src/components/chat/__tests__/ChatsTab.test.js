import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import ChatsTab from '../ChatsTab.vue';
import { chatsAPI } from '../../../services/chatsApi';

const push = vi.fn();

vi.mock('../../../services/chatsApi', () => ({
  chatsAPI: { list: vi.fn(), delete: vi.fn() },
}));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock('../../../composables/useDataCache', () => ({
  useDataCache: () => ({
    characters: ref([{ id: 'layla', name: 'Layla', thumbnailUrl: '/layla.png' }]),
    loadCharacters: vi.fn(async () => {}),
  }),
}));

const CHATS = [
  {
    id: 'c1',
    title: 'Chat with Layla',
    characterIds: ['layla'],
    modified: '2026-01-02T03:04:05Z',
    lastMessage: { senderName: 'Layla', content: 'night!' },
  },
  {
    id: 'c2',
    title: 'Empty',
    characterIds: [],
    modified: '2026-01-01T00:00:00Z',
    lastMessage: null,
  },
];

function mountTab() {
  return mount(ChatsTab, { global: { stubs: { ChatSetupModal: true } } });
}

describe('ChatsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatsAPI.list.mockResolvedValue({ chats: CHATS });
  });

  it('lists chats with their last message', async () => {
    const wrapper = mountTab();
    await flushPromises();

    const rows = wrapper.findAll('.chat-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].find('.chat-preview').text()).toBe('Layla: night!');
    expect(rows[0].find('img').attributes('src')).toBe('/layla.png');
    expect(rows[1].find('.chat-preview').text()).toBe('No messages yet');
  });

  it('opens a chat', async () => {
    const wrapper = mountTab();
    await flushPromises();

    await wrapper.find('.chat-row').trigger('click');
    expect(push).toHaveBeenCalledWith({ name: 'chat', params: { chatId: 'c1' } });
  });

  it('deletes a chat after confirming', async () => {
    chatsAPI.delete.mockResolvedValue({ success: true });
    const wrapper = mountTab();
    await flushPromises();

    await wrapper.find('[title="Delete chat"]').trigger('click');
    await flushPromises();

    expect(chatsAPI.delete).toHaveBeenCalledWith('c1');
    expect(push).not.toHaveBeenCalled();
    expect(wrapper.findAll('.chat-row')).toHaveLength(1);
  });

  it('invites the user to start one when there are none', async () => {
    chatsAPI.list.mockResolvedValue({ chats: [] });
    const wrapper = mountTab();
    await flushPromises();

    expect(wrapper.find('.empty-state').text()).toContain('No chats yet');
  });
});
