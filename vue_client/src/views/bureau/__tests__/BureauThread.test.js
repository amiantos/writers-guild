import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import BureauThread from '../BureauThread.vue';
import { bureausAPI, bureauThreadsAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({
  bureausAPI: { listCast: vi.fn() },
  bureauThreadsAPI: {
    get: vi.fn(),
    send: vi.fn(),
    reply: vi.fn(),
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
    archive: vi.fn(),
  },
}));

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../../router', () => ({ setPageTitle: vi.fn() }));
vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));

const BUREAU = { id: 'b1', name: 'Harbor', timezone: 'UTC', hasApiKey: true, presentOffsetDays: 0 };
const MARA = { id: 'c1', name: 'Mara', libraryCharacterId: null };

function message(id, source, content, bureauTime, runId = null) {
  return { id, source, content, bureauTime, runId, edited: false };
}

const EARLIER = [
  message('m1', 'user', 'You up?', '2026-10-24T21:00:00Z'),
  message('m2', 'generated', 'Always.', '2026-10-24T21:01:00Z', 'run-1'),
  message('m3', 'generated', 'Why?', '2026-10-24T21:01:00Z', 'run-1'),
  message('m4', 'user', 'Storm coming.', '2026-10-27T22:00:00Z'),
];

function mountThread() {
  return mount(BureauThread, {
    props: { bureauId: 'b1', castId: 'c1' },
    global: { stubs: { TurnSeam: { props: ['turn', 'live'], template: '<div class="seam" />' } } },
  });
}

describe('BureauThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bureausAPI.listCast.mockResolvedValue({ cast: [MARA, { id: 'c2', isPersona: true }] });
    bureauThreadsAPI.get.mockResolvedValue({
      bureau: BUREAU,
      castMember: MARA,
      messages: EARLIER,
    });
  });

  it('shows sessions of messages with one seam per reply', async () => {
    const wrapper = mountThread();
    await flushPromises();

    expect(wrapper.findAll('.thread-session')).toHaveLength(2);
    expect(wrapper.findAll('.bubble').map((bubble) => bubble.text())).toEqual([
      'You up?',
      'Always.',
      'Why?',
      'Storm coming.',
    ]);
    expect(wrapper.findAll('.seam')).toHaveLength(1);
  });

  it('sends with Enter, streams the reply, then shows what was saved', async () => {
    let finish;
    const finished = new Promise((resolve) => {
      finish = resolve;
    });
    bureauThreadsAPI.send.mockImplementation(async function* stream() {
      yield { type: 'message', message: message('m5', 'user', 'Stay in.', '2026-10-27T22:05:00Z') };
      yield { type: 'content', text: 'Fine.\n---\nYou' };
      await finished;
      yield { type: 'done' };
    });
    const wrapper = mountThread();
    await flushPromises();

    await wrapper.find('.composer-input').setValue('Stay in.');
    await wrapper.find('.composer-input').trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(bureauThreadsAPI.send).toHaveBeenCalledWith('b1', 'c1', 'Stay in.', expect.anything());
    expect(wrapper.find('.composer-input').element.value).toBe('');
    expect(wrapper.findAll('.pending-bubble').map((bubble) => bubble.text())).toEqual([
      'Fine.',
      'You',
    ]);
    expect(wrapper.text()).toContain('Stop');

    bureauThreadsAPI.get.mockResolvedValue({
      bureau: BUREAU,
      castMember: MARA,
      messages: [
        ...EARLIER,
        message('m5', 'user', 'Stay in.', '2026-10-27T22:05:00Z'),
        message('m6', 'generated', 'Fine.', '2026-10-27T22:05:00Z', 'run-2'),
        message('m7', 'generated', 'You too.', '2026-10-27T22:05:00Z', 'run-2'),
      ],
    });
    finish();
    await flushPromises();

    expect(wrapper.findAll('.pending-bubble')).toHaveLength(0);
    expect(wrapper.findAll('.bubble').map((bubble) => bubble.text())).toContain('You too.');
    expect(wrapper.findAll('.seam')).toHaveLength(2);
  });

  it('commits unread messages to memory', async () => {
    bureauThreadsAPI.get.mockResolvedValue({
      bureau: BUREAU,
      castMember: MARA,
      thread: { archivedThrough: 1 },
      messages: EARLIER.map((item, position) => ({ ...item, position })),
    });
    bureauThreadsAPI.archive.mockResolvedValue({
      thread: { archivedThrough: 3 },
      archive: { passes: 1, added: 1, superseded: 0, episodes: 1, arcNotes: 0, warnings: [] },
    });
    const wrapper = mountThread();
    await flushPromises();
    const commitButton = () =>
      wrapper.findAll('button').find((button) => button.text().includes('Commit to memory'));

    await commitButton().trigger('click');
    await flushPromises();

    expect(bureauThreadsAPI.archive).toHaveBeenCalledWith('b1', 'c1');
    expect(commitButton()).toBeUndefined();
  });

  it("can't write without a reader's character", async () => {
    bureausAPI.listCast.mockResolvedValue({ cast: [MARA] });
    const wrapper = mountThread();
    await flushPromises();

    expect(wrapper.text()).toContain("Choose a reader's character");
    expect(wrapper.find('.composer-input').attributes('disabled')).toBeDefined();
  });
});
