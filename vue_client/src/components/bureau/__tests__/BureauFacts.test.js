import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import BureauFacts from '../BureauFacts.vue';
import { bureausAPI } from '../../../services/bureauApi';

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));

vi.mock('../../../services/bureauApi', () => ({
  bureausAPI: {
    listFacts: vi.fn(),
    addFact: vi.fn(),
    updateFact: vi.fn(),
    removeFact: vi.fn(),
  },
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm }),
}));

function fact(id, fields = {}) {
  return {
    id,
    content: `Fact ${id}.`,
    proposedContent: `Fact ${id}.`,
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

async function mountFacts() {
  const wrapper = mount(BureauFacts, {
    props: { bureauId: 'b1' },
    global: { stubs: { RouterLink: RouterLinkStub } },
  });
  await flushPromises();
  return wrapper;
}

function contents(wrapper) {
  return wrapper.findAll('.fact-content').map((node) => node.text());
}

describe('BureauFacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bureausAPI.listFacts.mockResolvedValue({
      facts: [
        fact(1, { replacedBy: 4 }),
        fact(2),
        fact(3, { status: 'rejected', sourceType: 'story' }),
        fact(4, { replaces: 1, sourceType: 'story' }),
        fact(5, { status: 'proposed', sourceType: 'story' }),
        fact(6, { status: 'proposed', sourceType: 'correspondence' }),
      ],
    });
  });

  it('lists proposals first, then the facts that stand, and replaced or rejected ones on request', async () => {
    const wrapper = await mountFacts();

    expect(contents(wrapper)).toEqual(['Fact 6.', 'Fact 5.', 'Fact 2.', 'Fact 4.']);
    const toggle = wrapper.find('.history-toggle');
    expect(toggle.text()).toBe('Show 2 replaced or rejected');

    await toggle.trigger('click');
    expect(contents(wrapper)).toEqual([
      'Fact 6.',
      'Fact 5.',
      'Fact 2.',
      'Fact 4.',
      'Fact 1.',
      'Fact 3.',
    ]);
  });

  it('adds a fact and loads the facts again', async () => {
    bureausAPI.addFact.mockResolvedValue({ fact: fact(7) });
    const wrapper = await mountFacts();

    await wrapper.find('textarea').setValue('  Theo works days. ');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(bureausAPI.addFact).toHaveBeenCalledWith('b1', 'Theo works days.');
    expect(bureausAPI.listFacts).toHaveBeenCalledTimes(2);
    expect(wrapper.find('textarea').element.value).toBe('');
  });

  it('accepts a proposal, and deletes a fact once confirmed', async () => {
    bureausAPI.updateFact.mockResolvedValue({});
    bureausAPI.removeFact.mockResolvedValue({ success: true });
    const wrapper = await mountFacts();

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Accept')
      .trigger('click');
    await flushPromises();
    expect(bureausAPI.updateFact).toHaveBeenCalledWith('b1', 6, { status: 'accepted' });

    await wrapper.find('button[title="Delete"]').trigger('click');
    await flushPromises();
    expect(confirm).toHaveBeenCalled();
    expect(bureausAPI.removeFact).toHaveBeenCalledWith('b1', 6);
  });
});
