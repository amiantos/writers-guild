import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const { mockArchivistAPI } = vi.hoisted(() => ({
  mockArchivistAPI: { list: vi.fn(), run: vi.fn(), review: vi.fn() },
}));

vi.mock('../../services/api', () => ({ archivistAPI: mockArchivistAPI }));

vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import ArchivistModal from '../ArchivistModal.vue';

function suggestion(id, fields = {}) {
  return {
    id,
    characterId: 'layla',
    characterName: 'Layla',
    field: 'description',
    find: 'She is single.',
    replace: 'She is with Sam.',
    rationale: 'They got together.',
    quote: 'Layla kissed Sam.',
    current: 'She is single.',
    stale: false,
    ...fields,
  };
}

async function mountModal() {
  const wrapper = mount(ArchivistModal, { props: { kind: 'story', sourceId: 's1' } });
  await flushPromises();
  return wrapper;
}

function buttonsOf(wrapper, label) {
  return wrapper.findAll('button').filter((button) => button.text().includes(label));
}

describe('ArchivistModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('explains itself before its first read, then reads when asked', async () => {
    mockArchivistAPI.list.mockResolvedValue({ suggestions: [], running: false });
    mockArchivistAPI.run.mockResolvedValue({ added: 1, suggestions: [suggestion(1)] });
    const wrapper = await mountModal();
    expect(wrapper.text()).toContain('Nothing changes until you accept it');

    await buttonsOf(wrapper, 'Read Story')[0].trigger('click');
    await flushPromises();

    expect(mockArchivistAPI.run).toHaveBeenCalledWith('story', 's1', expect.any(Object));
    expect(wrapper.find('del').text()).toBe('She is single.');
    expect(wrapper.find('ins').text()).toBe('She is with Sam.');
  });

  it('sends only the decided suggestions, with edited text', async () => {
    mockArchivistAPI.list.mockResolvedValue({
      suggestions: [
        suggestion(1),
        suggestion(2, { field: 'personality', find: '', replace: 'Hopeful.' }),
        suggestion(3, { replace: 'She is engaged.' }),
      ],
      running: false,
    });
    mockArchivistAPI.review.mockResolvedValue({ applied: 1, stale: [], suggestions: [] });
    const wrapper = await mountModal();

    await buttonsOf(wrapper, 'Edit')[0].trigger('click');
    await wrapper.find('textarea').setValue('She is in love with Sam.');
    await buttonsOf(wrapper, 'Done')[0].trigger('click');
    await buttonsOf(wrapper, 'Reject')[1].trigger('click');
    await buttonsOf(wrapper, 'Apply 2 Decisions')[0].trigger('click');
    await flushPromises();

    expect(mockArchivistAPI.review).toHaveBeenCalledWith('story', 's1', [
      { id: 1, accept: true, replace: 'She is in love with Sam.' },
      { id: 2, accept: false },
    ]);
    expect(wrapper.emitted('applied')).toHaveLength(1);
  });

  it("won't accept a suggestion that no longer fits its card", async () => {
    mockArchivistAPI.list.mockResolvedValue({
      suggestions: [suggestion(1, { stale: true })],
      running: false,
    });
    const wrapper = await mountModal();
    expect(wrapper.text()).toContain('no longer fits');
    expect(buttonsOf(wrapper, 'Accept')[0].attributes('disabled')).toBeDefined();
    expect(buttonsOf(wrapper, 'Reject')[0].attributes('disabled')).toBeUndefined();
  });
});
