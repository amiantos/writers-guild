import { describe, it, expect } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';
import FactItem from '../FactItem.vue';

function fact(fields = {}) {
  return {
    id: 3,
    content: 'Mara and Theo live above the bakery.',
    proposedContent: 'Mara and Theo live above the bakery.',
    rationale: '',
    status: 'accepted',
    replaces: null,
    replacesContent: null,
    replacedBy: null,
    worldTime: null,
    sourceType: 'manual',
    sourceId: null,
    sourceTitle: null,
    sourceTurnIds: [],
    needsReview: false,
    ...fields,
  };
}

function mountItem(fields) {
  return mount(FactItem, {
    props: { fact: fact(fields), bureauId: 'b1' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
}

function lastUpdate(wrapper) {
  return wrapper.emitted('update').at(-1)[1];
}

function buttonTitled(wrapper, title) {
  return wrapper.findAll('button').find((button) => button.attributes('title') === title);
}

function buttonLabeled(wrapper, label) {
  return wrapper.findAll('button').find((button) => button.text() === label);
}

describe('FactItem', () => {
  it('shows a proposed change with what it would replace, and accepts, edits, or rejects it', async () => {
    const wrapper = mountItem({
      status: 'proposed',
      content: 'Mara and Theo live by the harbor.',
      proposedContent: 'Mara and Theo live by the harbor.',
      rationale: 'They signed a lease.',
      replaces: 2,
      replacesContent: 'Mara and Theo live above the bakery.',
      sourceType: 'story',
      sourceId: 's1',
      sourceTitle: 'Moving day',
      sourceTurnIds: ['t4'],
      worldTime: '2026-10-27T19:00:00.000Z',
    });

    expect(wrapper.text()).toContain('Would replace: Mara and Theo live above the bakery.');
    expect(wrapper.text()).toContain('They signed a lease.');
    expect(wrapper.text()).toContain('Waiting for review');
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({
      name: 'bureau-story',
      params: { bureauId: 'b1', storyId: 's1' },
      query: { turn: 't4' },
    });

    await buttonLabeled(wrapper, 'Accept').trigger('click');
    expect(lastUpdate(wrapper)).toEqual({ status: 'accepted' });
    await buttonTitled(wrapper, 'Reject').trigger('click');
    expect(lastUpdate(wrapper)).toEqual({ status: 'rejected' });

    await buttonTitled(wrapper, 'Edit, then accept').trigger('click');
    await wrapper.find('textarea').setValue('Mara and Theo live in the house by the harbor.');
    await buttonLabeled(wrapper, 'Accept with edits').trigger('click');
    expect(lastUpdate(wrapper)).toEqual({
      content: 'Mara and Theo live in the house by the harbor.',
      status: 'accepted',
    });
  });

  it("edits and deletes the reader's own fact, without offering to reject it", async () => {
    const wrapper = mountItem();

    expect(wrapper.text()).toContain('Written by you');
    expect(buttonTitled(wrapper, 'Undo: reject this change')).toBeUndefined();

    await buttonTitled(wrapper, 'Edit').trigger('click');
    await wrapper.find('textarea').setValue('Mara and Theo live above the Harrow Street bakery.');
    await buttonLabeled(wrapper, 'Save').trigger('click');
    expect(lastUpdate(wrapper)).toEqual({
      content: 'Mara and Theo live above the Harrow Street bakery.',
    });

    await buttonTitled(wrapper, 'Delete').trigger('click');
    expect(wrapper.emitted('remove')).toHaveLength(1);
  });

  it('marks a replaced fact, and one whose messages changed', async () => {
    const replaced = mountItem({ replacedBy: 9 });
    expect(replaced.text()).toContain('Replaced by a later fact');
    expect(buttonTitled(replaced, 'Edit')).toBeUndefined();

    const flagged = mountItem({
      needsReview: true,
      sourceType: 'correspondence',
      worldTime: '2026-10-27T19:00:00.000Z',
    });
    expect(flagged.text()).toContain('Check this');
    expect(flagged.text()).toContain('Messages ·');
    await buttonTitled(flagged, "It's still right").trigger('click');
    expect(lastUpdate(flagged)).toEqual({ needsReview: false });
    await buttonTitled(flagged, 'Undo: reject this change').trigger('click');
    expect(lastUpdate(flagged)).toEqual({ status: 'rejected' });
  });
});
