import { describe, it, expect, beforeEach } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';
import LorebookShelf from '../LorebookShelf.vue';

const STORIES = [
  {
    id: 's1',
    title: 'The Lantern at Saltmarsh',
    characterIds: ['mara'],
    wordCount: 1200,
    created: '2026-09-01T00:00:00.000Z',
    modified: '2026-10-07T00:00:00.000Z',
  },
];

const LOREBOOKS = [
  {
    id: 'lb1',
    name: 'Saltmarsh Gazetteer',
    description: 'Towns, tides and the lighthouse.',
    entryCount: 24,
    created: '2026-01-01T00:00:00.000Z',
    modified: '2026-09-01T00:00:00.000Z',
    characters: [{ id: 'mara', name: 'Mara Voss' }],
    storyIds: ['s1'],
  },
  {
    id: 'lb2',
    name: 'Abandoned Notes',
    description: '',
    entryCount: 0,
    created: '2026-06-01T00:00:00.000Z',
    modified: '2026-10-01T00:00:00.000Z',
    characters: [],
    storyIds: [],
  },
];

function mountShelf(props = {}) {
  return mount(LorebookShelf, {
    props: {
      lorebooks: LOREBOOKS,
      stories: STORIES,
      characters: [{ id: 'mara', name: 'Mara Voss' }],
      ...props,
    },
    global: { stubs: { Teleport: true, RouterLink: RouterLinkStub } },
  });
}

const shelfNames = (wrapper) =>
  wrapper
    .find('.shelf-grid')
    .findAll('.cover-name')
    .map((node) => node.text());

async function openSheet(wrapper, name) {
  await wrapper.find(`[aria-label="More actions for ${name}"]`).trigger('click');
}

describe('LorebookShelf', () => {
  beforeEach(() => localStorage.clear());

  it('shelves lorebooks by when they were last edited, each linking to its page', () => {
    const wrapper = mountShelf();
    expect(shelfNames(wrapper)).toEqual(['Abandoned Notes', 'Saltmarsh Gazetteer']);
    expect(wrapper.find('.shelf-count').text()).toBe('2 lorebooks');
    const links = wrapper
      .find('.shelf-grid')
      .findAllComponents(RouterLinkStub)
      .map((link) => link.props('to').params.lorebookId);
    expect(links).toEqual(['lb2', 'lb1']);
  });

  it('shows the unused ones, and sorts by the remembered choice', async () => {
    const wrapper = mountShelf();
    const unused = wrapper.findAll('.chip').find((c) => c.text().startsWith('Unused'));
    expect(unused.text()).toContain('1');
    await unused.trigger('click');
    expect(shelfNames(wrapper)).toEqual(['Abandoned Notes']);

    await wrapper.findAll('.chip')[0].trigger('click');
    await wrapper.find('.sort select').setValue('entries');
    expect(shelfNames(wrapper)).toEqual(['Saltmarsh Gazetteer', 'Abandoned Notes']);
    expect(JSON.parse(localStorage.getItem('writers-guild-lorebooks')).sort).toBe('entries');
  });

  it('searches with the header’s query', () => {
    expect(shelfNames(mountShelf({ query: 'tides' }))).toEqual(['Saltmarsh Gazetteer']);
    expect(
      mountShelf()
        .findAll('.cover-byline')
        .map((node) => node.text()),
    ).toEqual(['Mara Voss']);
  });

  it('lists what uses a lorebook in its sheet, and opens a story from it', async () => {
    const wrapper = mountShelf();
    await openSheet(wrapper, 'Saltmarsh Gazetteer');
    const people = wrapper.findAll('.person .ellipsis').map((node) => node.text());
    expect(people).toEqual(['Mara Voss']);
    await wrapper.find('.story').trigger('click');
    expect(wrapper.emitted('open-story')[0]).toEqual(['s1']);
    expect(wrapper.find('.story').exists()).toBe(false);
  });

  it('says when nothing uses a lorebook, and deletes it with what it’s attached to', async () => {
    const wrapper = mountShelf();
    await openSheet(wrapper, 'Abandoned Notes');
    expect(wrapper.find('.unused').exists()).toBe(true);
    await openSheet(wrapper, 'Saltmarsh Gazetteer');
    await wrapper.find('.sheet-list .danger').trigger('click');
    const [deleted] = wrapper.emitted('delete')[0];
    expect(deleted).toMatchObject({ id: 'lb1', characters: [{ name: 'Mara Voss' }] });
    expect(deleted.stories.map((s) => s.id)).toEqual(['s1']);
  });

  it('opens a lorebook from its sheet', async () => {
    const wrapper = mountShelf();
    await openSheet(wrapper, 'Abandoned Notes');
    await wrapper.find('.sheet-primary .btn').trigger('click');
    expect(wrapper.emitted('edit')[0]).toEqual(['lb2']);
  });

  it('adds a lorebook from the New tile', async () => {
    const wrapper = mountShelf();
    await wrapper.find('.new-tile').trigger('click');
    const create = wrapper.findAll('.new-row').find((b) => b.text().includes('Create'));
    await create.trigger('click');
    expect(wrapper.emitted('create')).toHaveLength(1);
    expect(wrapper.find('.new-row').exists()).toBe(false);
  });

  it('offers the ways to add one when there are no lorebooks', async () => {
    const wrapper = mountShelf({ lorebooks: [] });
    const buttons = wrapper.findAll('.empty-actions button');
    expect(buttons.map((b) => b.text())).toEqual(['Create', 'Import']);
    await buttons[1].trigger('click');
    expect(wrapper.emitted('import')).toHaveLength(1);
  });
});
