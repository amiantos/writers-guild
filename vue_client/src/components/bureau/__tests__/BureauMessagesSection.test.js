import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import BureauMessagesSection from '../BureauMessagesSection.vue';
import { bureauThreadsAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({ bureauThreadsAPI: { list: vi.fn() } }));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ error: vi.fn() }),
}));

const BUREAU = { id: 'b1', timezone: 'UTC' };

describe('BureauMessagesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists cast members with their last message and opens a thread', async () => {
    bureauThreadsAPI.list.mockResolvedValue({
      personaId: 'c2',
      correspondents: [
        {
          castMember: { id: 'c1', name: 'Mara' },
          thread: {
            lastMessage: { source: 'user', content: 'You up?', bureauTime: '2026-10-27T22:00:00Z' },
          },
        },
        { castMember: { id: 'c3', name: 'Ines' }, thread: null },
      ],
    });
    const wrapper = mount(BureauMessagesSection, { props: { bureau: BUREAU, cast: [] } });
    await flushPromises();

    const rows = wrapper.findAll('.thread-row');
    expect(rows.map((row) => row.find('.thread-preview').text())).toEqual([
      'You: You up?',
      'No messages yet',
    ]);
    await rows[1].trigger('click');
    expect(wrapper.emitted('open')[0][0]).toEqual({ id: 'c3', name: 'Ines' });
  });

  it("asks for a reader's character first", async () => {
    bureauThreadsAPI.list.mockResolvedValue({ personaId: null, correspondents: [] });
    const wrapper = mount(BureauMessagesSection, { props: { bureau: BUREAU, cast: [] } });
    await flushPromises();

    expect(wrapper.text()).toContain("Choose a reader's character");
  });
});
