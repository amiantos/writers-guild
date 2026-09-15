import { describe, it, expect } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';
import MemoryItem from '../MemoryItem.vue';

function memory(fields = {}) {
  return {
    id: 7,
    layer: 'knowledge',
    content: "Theo can't swim.",
    importance: 4,
    sourceType: 'story',
    sourceId: 's1',
    sourceTitle: 'Lamplight',
    sourceTurnIds: ['t3', 't5'],
    supersededBy: null,
    pinned: false,
    retired: false,
    needsReview: false,
    ...fields,
  };
}

function mountItem(fields) {
  return mount(MemoryItem, {
    props: { memory: memory(fields), bureauId: 'b1' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
}

function lastUpdate(wrapper) {
  return wrapper.emitted('update').at(-1)[1];
}

describe('MemoryItem', () => {
  it('links a story memory to the passage it came from', () => {
    const link = mountItem().findComponent(RouterLinkStub);

    expect(link.props('to')).toEqual({
      name: 'bureau-story',
      params: { bureauId: 'b1', storyId: 's1' },
      query: { turn: 't3' },
    });
    expect(link.text()).toContain('Lamplight');
  });

  it('links a memory from messages to the thread, and labels time away', () => {
    const fromMessages = mountItem({
      sourceType: 'correspondence',
      sourceId: 'thread-1',
      sourceTitle: null,
      castMemberId: 'c1',
      worldTime: '2026-10-27T19:00:00.000Z',
    }).findComponent(RouterLinkStub);

    expect(fromMessages.props('to')).toEqual({
      name: 'bureau-thread',
      params: { bureauId: 'b1', castId: 'c1' },
    });
    expect(fromMessages.text()).toContain('Messages ·');

    const away = mountItem({
      layer: 'offscreen',
      sourceType: 'offscreen',
      sourceId: null,
      sourceTitle: null,
      worldTime: '2026-10-27T19:00:00.000Z',
    });
    expect(away.findComponent(RouterLinkStub).exists()).toBe(false);
    expect(away.text()).toContain('Offscreen ·');
  });

  it("flags a memory whose source changed, and clears the flag when it's still right", async () => {
    const wrapper = mountItem({ needsReview: true });

    expect(wrapper.text()).toContain('Check this');
    await wrapper
      .findAll('button')
      .find((button) => button.attributes('title') === "It's still right")
      .trigger('click');

    expect(lastUpdate(wrapper)).toEqual({ needsReview: false });
  });

  it('says what a held memory disagrees with, and uses it once the reader says it is right', async () => {
    const wrapper = mountItem({
      needsReview: true,
      conflict: "Mara's profile says she lives above the bakery.",
    });

    expect(wrapper.text()).toContain('Disagrees with a profile or fact');
    expect(wrapper.text()).not.toContain('Check this');
    expect(wrapper.find('.memory-conflict').text()).toBe(
      "Kept out of every prompt until you check it. Mara's profile says she lives above the bakery.",
    );
    await wrapper
      .findAll('button')
      .find((button) => button.attributes('title') === "It's right: use it")
      .trigger('click');

    expect(lastUpdate(wrapper)).toEqual({ needsReview: false });
  });

  it('edits the text, pins, retires, and changes importance', async () => {
    const wrapper = mountItem();

    await wrapper.find('button[title="Edit"]').trigger('click');
    await wrapper.find('textarea').setValue('Theo is learning to swim.');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Save'))
      .trigger('click');
    expect(lastUpdate(wrapper)).toEqual({ content: 'Theo is learning to swim.' });

    await wrapper.find('button[title^="Pin"]').trigger('click');
    expect(lastUpdate(wrapper)).toEqual({ pinned: true });

    await wrapper.find('button[title^="Retire"]').trigger('click');
    expect(lastUpdate(wrapper)).toEqual({ retired: true });

    await wrapper.find('select').setValue('2');
    expect(lastUpdate(wrapper)).toEqual({ importance: 2 });
    // The saved importance shows until the updated memory comes back.
    expect(wrapper.find('select').element.value).toBe('4');
  });

  it('pins knowledge but not episodes', () => {
    const wrapper = mountItem({ layer: 'episode' });

    expect(wrapper.find('button[title^="Pin"]').exists()).toBe(false);
    expect(wrapper.find('select').exists()).toBe(false);
    expect(wrapper.find('button[title="Edit"]').exists()).toBe(true);
  });

  it('offers restore, not edits, for a replaced memory', async () => {
    const wrapper = mountItem({ supersededBy: 9, sourceType: 'manual', sourceTitle: null });

    expect(wrapper.text()).toContain('Replaced by a newer memory');
    expect(wrapper.text()).toContain('Written by you');
    expect(wrapper.find('button[title="Edit"]').exists()).toBe(false);
    expect(wrapper.find('select').exists()).toBe(false);

    await wrapper.find('button[title^="Restore this version"]').trigger('click');
    expect(lastUpdate(wrapper)).toEqual({ retired: false });
  });
});
