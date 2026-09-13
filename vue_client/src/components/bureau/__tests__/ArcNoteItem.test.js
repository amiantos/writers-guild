import { describe, it, expect } from 'vitest';
import { mount, RouterLinkStub } from '@vue/test-utils';
import ArcNoteItem from '../ArcNoteItem.vue';

function note(fields = {}) {
  return {
    id: 3,
    content: 'Mara lets Theo steer.',
    proposedContent: 'Mara lets Theo steer.',
    rationale: 'She handed him the oars.',
    status: 'proposed',
    sourceType: 'story',
    sourceId: 's1',
    sourceTitle: 'Lamplight',
    sourceTurnIds: ['t2'],
    needsReview: false,
    ...fields,
  };
}

function mountNote(fields) {
  return mount(ArcNoteItem, {
    props: { note: note(fields), bureauId: 'b1' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
}

/** A button by its title, or by its text. */
function button(wrapper, label) {
  return wrapper
    .findAll('button')
    .find((candidate) => candidate.attributes('title') === label || candidate.text() === label);
}

function lastUpdate(wrapper) {
  return wrapper.emitted('update').at(-1)[1];
}

describe('ArcNoteItem', () => {
  it('shows a proposal with its rationale and source, and accepts or rejects it', async () => {
    const wrapper = mountNote();

    expect(wrapper.text()).toContain('She handed him the oars.');
    expect(wrapper.text()).toContain('Waiting for review');
    expect(wrapper.findComponent(RouterLinkStub).props('to')).toEqual({
      name: 'bureau-story',
      params: { bureauId: 'b1', storyId: 's1' },
      query: { turn: 't2' },
    });

    await button(wrapper, 'Accept').trigger('click');
    expect(lastUpdate(wrapper)).toEqual({ status: 'accepted' });
    await button(wrapper, 'Reject').trigger('click');
    expect(lastUpdate(wrapper)).toEqual({ status: 'rejected' });
  });

  it('accepts a proposal with edits', async () => {
    const wrapper = mountNote();

    await button(wrapper, 'Edit, then accept').trigger('click');
    await wrapper.find('textarea').setValue('Mara lets Theo steer, in calm water.');
    await button(wrapper, 'Accept with edits').trigger('click');

    expect(lastUpdate(wrapper)).toEqual({
      content: 'Mara lets Theo steer, in calm water.',
      status: 'accepted',
    });
  });

  it('marks an accepted note that differs from its proposal, and can undo it', async () => {
    const wrapper = mountNote({
      status: 'accepted',
      content: 'Mara lets Theo steer, in calm water.',
    });

    expect(wrapper.text()).toContain('Edited');
    await button(wrapper, 'Undo: reject this change').trigger('click');
    expect(lastUpdate(wrapper)).toEqual({ status: 'rejected' });
  });

  it('offers to accept a rejected note after all', async () => {
    const wrapper = mountNote({ status: 'rejected', sourceType: 'manual', sourceTitle: null });

    expect(wrapper.text()).toContain('Rejected');
    expect(wrapper.text()).toContain('Written by you');
    await button(wrapper, 'Accept after all').trigger('click');
    expect(lastUpdate(wrapper)).toEqual({ status: 'accepted' });
  });
});
