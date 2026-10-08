import { describe, it, expect, beforeEach } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';
import CharacterShelf from '../CharacterShelf.vue';

const CHARACTERS = [
  { id: 'mara', name: 'Mara Voss', created: '2026-01-01T00:00:00.000Z' },
  { id: 'rhee', name: 'Captain Rhee', created: '2026-02-01T00:00:00.000Z' },
  { id: 'ash', name: 'Ash', created: '2026-03-01T00:00:00.000Z' },
];

const STORIES = [
  {
    id: 's1',
    title: 'The Lantern at Saltmarsh',
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
    created: '2026-10-01T00:00:00.000Z',
    modified: '2026-10-08T00:00:00.000Z',
  },
];

function mountShelf(props = {}) {
  return mount(CharacterShelf, {
    props: {
      characters: CHARACTERS,
      stories: STORIES,
      chats: CHATS,
      continuities: [{ id: 'k1', name: 'Saltmarsh Cycle' }],
      ...props,
    },
    global: { stubs: { Teleport: true, RouterLink: RouterLinkStub } },
  });
}

const shelfNames = (wrapper) =>
  wrapper
    .find('.shelf-grid')
    .findAll('.tile-name')
    .map((node) => node.text());

const tileLines = (wrapper, line) => wrapper.findAll(`.tile-${line}`).map((node) => node.text());

async function openSheet(wrapper, name) {
  await wrapper.find(`[aria-label="More actions for ${name}"]`).trigger('click');
}

describe('CharacterShelf', () => {
  beforeEach(() => localStorage.clear());

  it('shelves characters by when they were last in a story', () => {
    const wrapper = mountShelf();
    expect(shelfNames(wrapper)).toEqual(['Mara Voss', 'Captain Rhee', 'Ash']);
    expect(wrapper.find('.shelf-count').text()).toBe('3 characters');
  });

  it('counts chats only while they are turned on', () => {
    expect(tileLines(mountShelf(), 'counts')).toEqual(['1 story', '1 story', 'No stories yet']);
    const withChats = mountShelf({ chatsEnabled: true });
    expect(shelfNames(withChats)[0]).toBe('Captain Rhee');
    expect(tileLines(withChats, 'counts')[0]).toBe('1 story · 1 chat');
  });

  it('dates a card by when they were last active, or else when they were added', () => {
    const [mara, , ash] = tileLines(mountShelf(), 'meta');
    expect(mara).toMatch(/^Active /);
    expect(ash).toMatch(/^Added /);
  });

  it('links each card to the character’s page', () => {
    const links = mountShelf()
      .findAllComponents(RouterLinkStub)
      .map((link) => link.props('to').params.characterId);
    expect(links).toEqual(['mara', 'rhee', 'ash']);
  });

  it('filters by Continuity chip', async () => {
    const wrapper = mountShelf();
    const chip = wrapper.findAll('.chip').find((c) => c.text().includes('Saltmarsh Cycle'));
    await chip.trigger('click');
    expect(shelfNames(wrapper)).toEqual(['Mara Voss']);
    await chip.trigger('click');
    expect(shelfNames(wrapper)).toEqual(['Mara Voss', 'Captain Rhee', 'Ash']);
  });

  it('searches with the header’s query, and sorts by the remembered choice', async () => {
    expect(shelfNames(mountShelf({ query: 'rhee' }))).toEqual(['Captain Rhee']);
    const wrapper = mountShelf();
    await wrapper.find('.sort select').setValue('name');
    expect(shelfNames(wrapper)).toEqual(['Ash', 'Captain Rhee', 'Mara Voss']);
    expect(JSON.parse(localStorage.getItem('writers-guild-characters')).sort).toBe('name');
  });

  it('starts a new story and continues the latest from a card', async () => {
    const wrapper = mountShelf();
    const tiles = wrapper.findAll('.character-tile');
    await tiles[0].find('.hover-btn.primary').trigger('click');
    expect(wrapper.emitted('new-story')[0]).toEqual(['mara']);
    await tiles[0].findAll('.hover-btn')[1].trigger('click');
    expect(wrapper.emitted('open-story')[0]).toEqual(['s1']);
    // Ash has no story to continue
    expect(tiles[2].findAll('.hover-btn')).toHaveLength(1);
  });

  it('lists a character’s stories and chats in their sheet', async () => {
    const wrapper = mountShelf({ chatsEnabled: true });
    await openSheet(wrapper, 'Captain Rhee');
    const rows = wrapper.findAll('.appearance');
    expect(rows.map((row) => row.find('.appearance-title').text())).toEqual([
      'Chat with Captain Rhee',
      'A Quiet Coup',
    ]);
    await rows[1].trigger('click');
    expect(wrapper.emitted('open-story')[0]).toEqual(['s2']);
    expect(wrapper.find('.appearance').exists()).toBe(false);
  });

  it('sends a character with many stories to the library to see them all', async () => {
    const stories = Array.from({ length: 7 }, (_, i) => ({
      id: `m${i}`,
      title: `Voyage ${i}`,
      characterIds: ['mara'],
      created: '2026-01-01T00:00:00.000Z',
      modified: `2026-01-0${i + 1}T00:00:00.000Z`,
    }));
    const wrapper = mountShelf({ stories });
    await openSheet(wrapper, 'Mara Voss');
    expect(wrapper.findAll('.appearance')).toHaveLength(5);
    await wrapper.find('.see-all').trigger('click');
    expect(wrapper.emitted('show-in-library')[0]).toEqual(['mara']);
  });

  it('deletes from a character’s sheet', async () => {
    const wrapper = mountShelf();
    await openSheet(wrapper, 'Ash');
    const remove = wrapper
      .findAll('.sheet-list button')
      .find((b) => b.text() === 'Delete character');
    await remove.trigger('click');
    expect(wrapper.emitted('delete')[0][0]).toEqual(CHARACTERS[2]);
  });

  it('adds a character from the New tile', async () => {
    const wrapper = mountShelf();
    await wrapper.find('.new-tile').trigger('click');
    const generate = wrapper.findAll('.new-row').find((b) => b.text().includes('Generate'));
    await generate.trigger('click');
    expect(wrapper.emitted('generate')).toHaveLength(1);
    expect(wrapper.find('.new-row').exists()).toBe(false);
  });

  it('offers the ways to add one when there are no characters', async () => {
    const wrapper = mountShelf({ characters: [] });
    const buttons = wrapper.findAll('.empty-actions button');
    expect(buttons.map((b) => b.text())).toEqual(['Create', 'Generate', 'Import']);
    await buttons[2].trigger('click');
    expect(wrapper.emitted('import')).toHaveLength(1);
  });
});
