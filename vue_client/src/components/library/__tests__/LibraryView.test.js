import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import LibraryView from '../LibraryView.vue';
import StoryCover from '../StoryCover.vue';
import ChatCard from '../ChatCard.vue';

const CHARACTERS = [
  { id: 'mara', name: 'Mara Voss' },
  { id: 'rhee', name: 'Captain Rhee' },
];

const STORIES = [
  {
    id: 's1',
    title: 'The Lantern at Saltmarsh',
    description: 'A storm, a lighthouse, two strangers.',
    characterIds: ['mara'],
    continuityId: 'k1',
    wordCount: 1200,
    created: '2026-09-01T00:00:00.000Z',
    modified: '2026-10-07T10:00:00.000Z',
  },
  {
    id: 's2',
    title: 'A Quiet Coup',
    characterIds: ['rhee'],
    wordCount: 300,
    created: '2026-08-01T00:00:00.000Z',
    modified: '2026-09-20T00:00:00.000Z',
  },
];

const CHATS = [
  {
    id: 'c1',
    title: 'Chat with Captain Rhee',
    characterIds: ['rhee'],
    messageCount: 3,
    lastMessage: { senderName: 'Captain Rhee', content: 'Hold the line.' },
    created: '2026-10-01T00:00:00.000Z',
    modified: '2026-10-06T00:00:00.000Z',
  },
];

function mountLibrary(props = {}) {
  return mount(LibraryView, {
    props: {
      stories: STORIES,
      chats: CHATS,
      characters: CHARACTERS,
      continuities: [{ id: 'k1', name: 'Saltmarsh Cycle' }],
      chatsEnabled: true,
      ...props,
    },
    global: { stubs: { Teleport: true } },
  });
}

const shelfTitles = (wrapper) =>
  wrapper
    .find('.shelf-grid')
    .findAll('.cover-title, .chat-title')
    .map((node) => node.text());

describe('LibraryView', () => {
  beforeEach(() => localStorage.clear());

  it('shelves stories and chats together', () => {
    const wrapper = mountLibrary();
    expect(shelfTitles(wrapper)).toEqual([
      'The Lantern at Saltmarsh',
      'Chat with Captain Rhee',
      'A Quiet Coup',
    ]);
    expect(wrapper.find('.shelf-count').text()).toBe('2 stories · 1 chat');
  });

  it('leaves chats off the shelf while they are turned off', () => {
    const wrapper = mountLibrary({ chatsEnabled: false });
    expect(wrapper.findAllComponents(ChatCard)).toHaveLength(0);
    expect(wrapper.find('.segmented').exists()).toBe(false);
  });

  it('shows the Continuity in place of the cast on a story in one', () => {
    const wrapper = mountLibrary();
    const lantern = wrapper.find('.shelf-grid').findComponent(StoryCover);
    expect(lantern.find('.cover-continuity').text()).toBe('Saltmarsh Cycle');
    expect(lantern.find('.cover-cast').exists()).toBe(false);
  });

  it('filters by Continuity chip', async () => {
    const wrapper = mountLibrary();
    const chip = wrapper.findAll('.chip').find((c) => c.text().includes('Saltmarsh Cycle'));
    await chip.trigger('click');
    expect(shelfTitles(wrapper)).toEqual(['The Lantern at Saltmarsh']);
  });

  it('shows only chats, and remembers the choice', async () => {
    const wrapper = mountLibrary();
    const chats = wrapper.findAll('.segmented button').find((b) => b.text() === 'Chats');
    await chats.trigger('click');
    expect(shelfTitles(wrapper)).toEqual(['Chat with Captain Rhee']);
    expect(JSON.parse(localStorage.getItem('writers-guild-library')).type).toBe('chat');
  });

  it('searches with the header’s query', () => {
    const wrapper = mountLibrary({ query: 'coup' });
    expect(shelfTitles(wrapper)).toEqual(['A Quiet Coup']);
  });

  it('features the latest story and starts a new one from its setup', async () => {
    const wrapper = mountLibrary();
    expect(wrapper.find('.hero-title').text()).toBe('The Lantern at Saltmarsh');
    const button = wrapper
      .findAll('.hero-actions button')
      .find((b) => b.text().includes('New story with this setup'));
    await button.trigger('click');
    expect(wrapper.emitted('new-from')[0][0].id).toBe('s1');
  });

  it('opens a card’s sheet and deletes from it', async () => {
    const wrapper = mountLibrary();
    await wrapper.find('.shelf-grid .chat-menu').trigger('click');
    const remove = wrapper.findAll('.sheet-list button').find((b) => b.text() === 'Delete chat');
    await remove.trigger('click');
    expect(wrapper.emitted('delete-chat')[0][0].id).toBe('c1');
    expect(wrapper.find('.sheet-list').exists()).toBe(false);
  });

  it('starts a new story from a recent setup in the New sheet', async () => {
    const wrapper = mountLibrary();
    await wrapper.find('.new-tile').trigger('click');
    const setup = wrapper.find('[aria-label="New story with Captain Rhee"].new-row');
    await setup.trigger('click');
    expect(wrapper.emitted('new-from')[0][0].id).toBe('s2');
  });
});
