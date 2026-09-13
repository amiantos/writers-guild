import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount, RouterLinkStub } from '@vue/test-utils';
import MemoryBrowserModal from '../MemoryBrowserModal.vue';
import { bureausAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({
  bureausAPI: {
    listMemories: vi.fn(),
    addMemory: vi.fn(),
    updateMemory: vi.fn(),
    removeMemory: vi.fn(),
    listArcNotes: vi.fn(),
    addArcNote: vi.fn(),
    updateArcNote: vi.fn(),
    removeArcNote: vi.fn(),
  },
}));

const PROPOSAL = {
  id: 9,
  content: 'Mara lets Theo steer.',
  proposedContent: 'Mara lets Theo steer.',
  rationale: 'She handed him the oars.',
  status: 'proposed',
  sourceType: 'manual',
  sourceId: null,
  sourceTitle: null,
  sourceTurnIds: [],
  needsReview: false,
};

const ModalStub = {
  props: ['title', 'maxWidth'],
  template: '<div><h1>{{ title }}</h1><slot /><slot name="footer" /></div>',
};

function memory(id, fields = {}) {
  return {
    id,
    layer: 'knowledge',
    content: `Memory ${id}`,
    importance: 3,
    sourceType: 'manual',
    sourceId: null,
    sourceTitle: null,
    sourceTurnIds: [],
    supersededBy: null,
    pinned: false,
    retired: false,
    needsReview: false,
    ...fields,
  };
}

const knows = memory(1, { content: "Theo can't swim." });
const happened = memory(2, { layer: 'episode', content: 'Theo confided in Mara.' });
const retired = memory(3, { content: 'Theo hates tea.', retired: true });
const found = memory(4, { content: 'Mara swims every morning.' });

async function mountBrowser() {
  const wrapper = mount(MemoryBrowserModal, {
    props: { bureauId: 'b1', member: { id: 'c1', name: 'Mara' } },
    global: { stubs: { Modal: ModalStub, RouterLink: RouterLinkStub } },
  });
  await flushPromises();
  return wrapper;
}

function tab(wrapper, label) {
  return wrapper.findAll('[role="tab"]').find((button) => button.text().includes(label));
}

describe('MemoryBrowserModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bureausAPI.listMemories.mockImplementation(async (_bureauId, _castId, options = {}) => {
      if (options.q) return { memories: [found] };
      return { memories: options.status === 'retired' ? [retired] : [knows, happened] };
    });
    bureausAPI.listArcNotes.mockResolvedValue({ arcNotes: [PROPOSAL] });
  });

  it('reviews and writes changes on the development tab', async () => {
    bureausAPI.updateArcNote.mockResolvedValue({ arcNote: { ...PROPOSAL, status: 'accepted' } });
    bureausAPI.addArcNote.mockResolvedValue({ arcNote: PROPOSAL });
    const wrapper = await mountBrowser();

    expect(tab(wrapper, "How they've changed").text()).toContain('1');
    await tab(wrapper, "How they've changed").trigger('click');
    expect(wrapper.text()).toContain('Mara lets Theo steer.');
    expect(wrapper.text()).not.toContain("Theo can't swim.");

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Accept')
      .trigger('click');
    await flushPromises();
    expect(bureausAPI.updateArcNote).toHaveBeenCalledWith('b1', 9, { status: 'accepted' });

    await wrapper
      .find('textarea[aria-label="New arc note"]')
      .setValue('Mara sleeps through storms now.');
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(bureausAPI.addArcNote).toHaveBeenCalledWith(
      'b1',
      'c1',
      'Mara sleeps through storms now.',
    );
    expect(wrapper.emitted('changed')).toHaveLength(2);
  });

  it('shows what a character knows, what happened, and what was retired', async () => {
    const wrapper = await mountBrowser();

    expect(wrapper.text()).toContain('What Mara remembers');
    expect(wrapper.text()).toContain("Theo can't swim.");
    expect(wrapper.text()).not.toContain('Theo confided in Mara.');

    await tab(wrapper, 'What happened').trigger('click');
    expect(wrapper.text()).toContain('Theo confided in Mara.');

    await tab(wrapper, 'Retired').trigger('click');
    expect(wrapper.text()).toContain('Theo hates tea.');
    expect(tab(wrapper, 'Retired').text()).toContain('1');
  });

  it('adds a memory, then reloads', async () => {
    bureausAPI.addMemory.mockResolvedValue({ memory: memory(5) });
    const wrapper = await mountBrowser();

    await wrapper.find('textarea[aria-label="New memory"]').setValue('Mara grew up on the island.');
    await wrapper.find('select[aria-label="Importance of the new memory"]').setValue('5');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(bureausAPI.addMemory).toHaveBeenCalledWith('b1', 'c1', {
      content: 'Mara grew up on the island.',
      importance: 5,
    });
    expect(bureausAPI.listMemories).toHaveBeenCalledTimes(4);
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(wrapper.find('textarea[aria-label="New memory"]').element.value).toBe('');
  });

  it('searches once typing pauses', async () => {
    const wrapper = await mountBrowser();

    await wrapper.find('input[type="search"]').setValue('swim');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await flushPromises();

    expect(bureausAPI.listMemories).toHaveBeenCalledWith('b1', 'c1', { q: 'swim' });
    expect(wrapper.text()).toContain('Mara swims every morning.');
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false);
  });

  it('updates a memory from its actions', async () => {
    bureausAPI.updateMemory.mockResolvedValue({ memory: knows });
    const wrapper = await mountBrowser();

    await wrapper.find('button[title^="Retire"]').trigger('click');
    await flushPromises();

    expect(bureausAPI.updateMemory).toHaveBeenCalledWith('b1', 1, { retired: true });
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });
});
