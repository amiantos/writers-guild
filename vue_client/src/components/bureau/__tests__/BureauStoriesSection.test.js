import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import BureauStoriesSection from '../BureauStoriesSection.vue';
import { bureauStoriesAPI } from '../../../services/bureauApi';

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('../../../services/bureauApi', () => ({
  bureauStoriesAPI: { list: vi.fn(), remove: vi.fn() },
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../composables/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));

const BUREAU = { id: 'b1', bureauTime: '2026-09-12T22:15:00.000Z', timezone: 'UTC' };

const STORIES = [
  {
    id: 's1',
    title: 'The harbor',
    status: 'ended',
    startTime: '2026-09-01T08:00:00.000Z',
    turnCount: 12,
    summary: '',
  },
  {
    id: 's2',
    title: 'Test chapter',
    status: 'active',
    startTime: '2026-09-12T22:15:00.000Z',
    turnCount: 1,
    summary: '',
  },
];

async function mountSection() {
  const wrapper = mount(BureauStoriesSection, {
    props: { bureau: BUREAU, cast: [] },
    global: { stubs: { StartStoryModal: true, TimePassesControl: true } },
  });
  await flushPromises();
  return wrapper;
}

async function deleteChapter(wrapper, title) {
  await wrapper.find(`[title="Delete ${title}"]`).trigger('click');
  await flushPromises();
}

describe('BureauStoriesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bureauStoriesAPI.list.mockResolvedValue({ stories: STORIES });
    bureauStoriesAPI.remove.mockResolvedValue({ success: true });
  });

  it('deletes a chapter once confirmed', async () => {
    confirm.mockResolvedValue(true);
    const wrapper = await mountSection();

    await deleteChapter(wrapper, 'Test chapter');

    expect(confirm.mock.calls[0][0].message).toContain('Delete "Test chapter"?');
    expect(bureauStoriesAPI.remove).toHaveBeenCalledWith('b1', 's2');
    expect(wrapper.text()).not.toContain('Test chapter');
    expect(wrapper.text()).toContain('The harbor');
    expect(wrapper.emitted('deleted')[0][0].id).toBe('s2');
    expect(wrapper.emitted('open')).toBeUndefined();
  });

  it('keeps the chapter when deleting is cancelled', async () => {
    confirm.mockResolvedValue(false);
    const wrapper = await mountSection();

    await deleteChapter(wrapper, 'Test chapter');

    expect(bureauStoriesAPI.remove).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Test chapter');
    expect(wrapper.emitted('deleted')).toBeUndefined();
  });
});
