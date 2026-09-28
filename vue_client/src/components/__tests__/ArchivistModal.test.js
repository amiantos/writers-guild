import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const { mockArchivistAPI } = vi.hoisted(() => ({
  mockArchivistAPI: { list: vi.fn(), run: vi.fn(), review: vi.fn(), cancel: vi.fn() },
}));

vi.mock('../../services/api', () => ({ archivistAPI: mockArchivistAPI }));

const { mockToast } = vi.hoisted(() => ({ mockToast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../../composables/useToast', () => ({
  useToast: () => mockToast,
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

    expect(mockArchivistAPI.run).toHaveBeenCalledWith('story', 's1');
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

  it('rejects a suggestion even after its text was edited', async () => {
    mockArchivistAPI.list.mockResolvedValue({ suggestions: [suggestion(1)], running: false });
    mockArchivistAPI.review.mockResolvedValue({ applied: 0, stale: [], suggestions: [] });
    const wrapper = await mountModal();

    await buttonsOf(wrapper, 'Edit')[0].trigger('click');
    await wrapper.find('textarea').setValue('She is in love with Sam.');
    await buttonsOf(wrapper, 'Reject')[0].trigger('click');
    await buttonsOf(wrapper, 'Apply 1 Decision')[0].trigger('click');
    await flushPromises();

    expect(mockArchivistAPI.review).toHaveBeenCalledWith('story', 's1', [{ id: 1, accept: false }]);
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

  it('checks back while a read started elsewhere is running', async () => {
    vi.useFakeTimers();
    try {
      mockArchivistAPI.list
        .mockResolvedValueOnce({ suggestions: [], running: true })
        .mockResolvedValueOnce({ suggestions: [suggestion(1)], running: false });
      const wrapper = await mountModal();
      expect(wrapper.text()).toContain('is reading this story');

      await vi.advanceTimersByTimeAsync(3000);
      await flushPromises();

      expect(mockArchivistAPI.list).toHaveBeenCalledTimes(2);
      expect(wrapper.find('ins').text()).toBe('She is with Sam.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows why a read failed, and says so again when reopened', async () => {
    mockArchivistAPI.list.mockResolvedValue({ suggestions: [], running: false, run: null });
    const failed = Object.assign(new Error('Part 2 of 4: fetch failed (Headers Timeout Error)'), {
      status: 502,
      run: { running: false, error: 'Part 2 of 4: fetch failed (Headers Timeout Error)' },
    });
    mockArchivistAPI.run.mockRejectedValue(failed);
    const wrapper = await mountModal();

    await buttonsOf(wrapper, 'Read Story')[0].trigger('click');
    await flushPromises();

    expect(wrapper.find('.archivist-error').text()).toContain('Headers Timeout Error');
    expect(mockToast.error).toHaveBeenCalledWith(expect.stringContaining('Part 2 of 4'));
    expect(wrapper.text()).not.toContain('Nothing to change');
    wrapper.unmount();

    mockArchivistAPI.list.mockResolvedValue({
      suggestions: [],
      running: false,
      run: { running: false, error: 'Part 2 of 4: fetch failed (Headers Timeout Error)' },
    });
    const reopened = await mountModal();
    expect(reopened.find('.archivist-error').text()).toContain('Part 2 of 4');
  });

  it('finds out how a read ended when its request drops', async () => {
    vi.useFakeTimers();
    try {
      mockArchivistAPI.list
        .mockResolvedValueOnce({ suggestions: [], running: false, run: null })
        .mockResolvedValueOnce({
          suggestions: [],
          running: true,
          run: { running: true, part: { index: 1, count: 3 }, startedAt: 't1' },
        })
        .mockResolvedValueOnce({
          suggestions: [suggestion(1)],
          running: false,
          run: { running: false, added: 1, error: null, startedAt: 't1' },
        });
      // A proxy giving up on the wait answers for the server, without saying how the read went.
      mockArchivistAPI.run.mockRejectedValue(
        Object.assign(new Error('Gateway Timeout'), { status: 504 }),
      );
      const wrapper = await mountModal();

      await buttonsOf(wrapper, 'Read Story')[0].trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('is reading this story');
      expect(mockToast.error).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(3000);
      await flushPromises();
      expect(wrapper.text()).toContain('part 2 of 3');

      await vi.advanceTimersByTimeAsync(3000);
      await flushPromises();
      expect(wrapper.find('ins').text()).toBe('She is with Sam.');
      expect(mockToast.success).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops a read when asked, without reporting it as a failure', async () => {
    mockArchivistAPI.list.mockResolvedValue({ suggestions: [], running: false, run: null });
    let answer;
    mockArchivistAPI.run.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    mockArchivistAPI.cancel.mockImplementation(async () => {
      answer({ added: 0, suggestions: [], run: { cancelled: true, startedAt: 't1' } });
      return { cancelled: true };
    });
    const wrapper = await mountModal();

    await buttonsOf(wrapper, 'Read Story')[0].trigger('click');
    await buttonsOf(wrapper, 'Stop')[0].trigger('click');
    await flushPromises();

    expect(mockArchivistAPI.cancel).toHaveBeenCalledWith('story', 's1');
    expect(wrapper.text()).not.toContain('is reading');
    expect(mockToast.error).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
