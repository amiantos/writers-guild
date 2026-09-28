import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ChatsTable from '../ChatsTable.vue';

const CHARACTERS = [
  { id: 'layla', name: 'Layla', thumbnailUrl: '/layla.png' },
  { id: 'bradley', name: 'Bradley', thumbnailUrl: '/bradley.png' },
];

const CHATS = [
  {
    id: 'c1',
    title: 'Chat with Layla',
    characterIds: ['layla'],
    personaCharacterId: 'bradley',
    created: '2026-01-01T00:00:00Z',
    modified: '2026-01-02T03:04:05Z',
    messageCount: 12,
    lastMessage: { senderName: 'Layla', content: 'night!' },
  },
  {
    id: 'c2',
    title: 'Empty',
    characterIds: [],
    personaCharacterId: null,
    created: '2026-01-01T00:00:00Z',
    modified: '2026-01-01T00:00:00Z',
    messageCount: 0,
    lastMessage: null,
  },
];

function mountTable() {
  return mount(ChatsTable, { props: { chats: CHATS, characters: CHARACTERS } });
}

describe('ChatsTable', () => {
  it('lists chats like stories, with the last message under the title', () => {
    const wrapper = mountTable();
    const rows = wrapper.findAll('tbody tr');

    expect(rows).toHaveLength(2);
    expect(rows[0].find('.chat-title').text()).toBe('Chat with Layla');
    expect(rows[0].find('.chat-preview').text()).toBe('Layla: night!');
    expect(rows[0].text()).toContain('12');
    expect(rows[1].find('.chat-preview').exists()).toBe(false);
  });

  it('opens and deletes chats', async () => {
    const wrapper = mountTable();

    await wrapper.findAll('tbody tr')[0].find('.btn-primary').trigger('click');
    await wrapper.findAll('tbody tr')[1].find('[title="Delete chat"]').trigger('click');

    expect(wrapper.emitted('open')[0]).toEqual(['c1']);
    expect(wrapper.emitted('delete')[0][0].id).toBe('c2');
  });
});
