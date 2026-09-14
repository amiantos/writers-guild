import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import BureauInterview from '../BureauInterview.vue';
import { bureauInterviewsAPI } from '../../../services/bureauApi';

const { goBack } = vi.hoisted(() => ({ goBack: vi.fn() }));

vi.mock('../../../services/bureauApi', () => ({
  bureauInterviewsAPI: {
    get: vi.fn(),
    start: vi.fn(),
    answer: vi.fn(),
    askAgain: vi.fn(),
    writeUp: vi.fn(),
    accept: vi.fn(),
    discard: vi.fn(),
  },
}));

vi.mock('../../../composables/useNavigation', () => ({ useNavigation: () => ({ goBack }) }));
vi.mock('../../../router', () => ({ setPageTitle: vi.fn() }));
vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));

const BUREAU = { id: 'b1', name: 'Harbor', hasApiKey: true };
const MARA = { id: 'c1', name: 'Mara', libraryCharacterId: null };
const FOCUSES = [
  { key: 'flesh_out', label: 'Flesh them out', description: 'Who they are.' },
  { key: 'routine', label: 'Daily routine', description: 'Their days.' },
];

function message(id, source, content) {
  return { id, source, content, runId: null };
}

function interview(messages = [], proposal = null) {
  return { id: 'i1', focus: 'routine', note: '', status: 'open', messages, proposal };
}

function loaded(current) {
  return { bureau: BUREAU, castMember: MARA, interview: current, focuses: FOCUSES };
}

function mountInterview() {
  return mount(BureauInterview, { props: { bureauId: 'b1', castId: 'c1' } });
}

function button(wrapper, label) {
  return wrapper.findAll('button').find((candidate) => candidate.text().includes(label));
}

const ASKED = interview([message('m1', 'generated', 'When does Mara sleep?')]);

describe('BureauInterview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bureauInterviewsAPI.get.mockResolvedValue(loaded(null));
  });

  it('starts an interview with a focus and a note, streaming the first question', async () => {
    bureauInterviewsAPI.start.mockImplementation(async function* stream() {
      yield { type: 'interview', interview: interview() };
      yield { type: 'content', text: 'When does Mara sleep?' };
      yield { type: 'done', interview: ASKED };
    });
    const wrapper = mountInterview();
    await flushPromises();
    bureauInterviewsAPI.get.mockResolvedValue(loaded(ASKED));

    expect(wrapper.find('h1').text()).toBe('Interviewing Mara');
    await wrapper.findAll('input[type="radio"]')[1].setValue(true);
    await wrapper.find('#interview-note').setValue(' Her nights ');
    await button(wrapper, 'Start the interview').trigger('click');
    await flushPromises();

    expect(bureauInterviewsAPI.start).toHaveBeenCalledWith(
      'b1',
      'c1',
      { focus: 'routine', note: 'Her nights' },
      expect.anything(),
    );
    expect(wrapper.findAll('.bubble').map((bubble) => bubble.text())).toEqual([
      'When does Mara sleep?',
    ]);
    expect(button(wrapper, 'Write it up').attributes('disabled')).toBeDefined();
  });

  it('answers with Enter, and Skip answers with a skip', async () => {
    bureauInterviewsAPI.get.mockResolvedValue(loaded(ASKED));
    bureauInterviewsAPI.answer.mockImplementation(async function* stream() {
      yield { type: 'done', interview: ASKED };
    });
    const wrapper = mountInterview();
    await flushPromises();

    await wrapper.find('.composer-input').setValue('Mornings.');
    await wrapper.find('.composer-input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    await button(wrapper, 'Skip').trigger('click');
    await flushPromises();

    expect(bureauInterviewsAPI.answer.mock.calls.map((call) => call[2])).toEqual([
      'Mornings.',
      'Skip this one.',
    ]);
    expect(wrapper.find('.composer-input').element.value).toBe('');
  });

  it('writes it up, then accepts it as edited, with only the lines kept', async () => {
    const answered = interview([
      message('m1', 'generated', 'When does Mara sleep?'),
      message('m2', 'user', 'Mornings.'),
    ]);
    const proposal = {
      description: 'Keeps the light.',
      personality: 'Dry.',
      routine: 'Sleeps through the mornings.',
      changes: 'Adds her mornings.',
      relationships: [
        { castId: 'c2', name: 'Ines', addition: 'Ines saves her a stool.' },
        { castId: 'c3', name: 'Theo', addition: 'Theo rows her out.' },
      ],
      base: { description: 'Keeps the light.', personality: 'Dry.', routine: '' },
    };
    bureauInterviewsAPI.get.mockResolvedValue(loaded(answered));
    bureauInterviewsAPI.writeUp.mockResolvedValue({ interview: { ...answered, proposal } });
    bureauInterviewsAPI.accept.mockResolvedValue({
      castMember: MARA,
      interview: { ...answered, status: 'accepted' },
      updated: [{ id: 'c2', name: 'Ines' }],
    });
    const wrapper = mountInterview();
    await flushPromises();

    await button(wrapper, 'Write it up').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain("Mara's new profile");
    expect(wrapper.text()).toContain('Adds her mornings.');

    await wrapper.find('#review-routine').setValue('Sleeps until noon.');
    await wrapper.findAll('.relationship')[1].find('input[type="checkbox"]').setValue(false);
    await button(wrapper, 'Accept').trigger('click');
    await flushPromises();

    expect(bureauInterviewsAPI.accept).toHaveBeenCalledWith('b1', 'c1', {
      description: 'Keeps the light.',
      personality: 'Dry.',
      routine: 'Sleeps until noon.',
      relationships: [{ castId: 'c2', addition: 'Ines saves her a stool.' }],
    });
    expect(goBack).toHaveBeenCalledWith({ name: 'bureau', params: { bureauId: 'b1' } });
  });

  it('opens a waiting write-up for review', async () => {
    const proposal = {
      description: 'Keeps the light.',
      personality: 'Dry.',
      routine: 'Nights.',
      changes: '',
      relationships: [],
      base: { description: 'Keeps the light.', personality: 'Dry.', routine: '' },
    };
    bureauInterviewsAPI.get.mockResolvedValue(loaded(interview(ASKED.messages, proposal)));
    const wrapper = mountInterview();
    await flushPromises();

    expect(wrapper.find('#review-routine').element.value).toBe('Nights.');
    await button(wrapper, 'Back to the interview').trigger('click');
    expect(wrapper.findAll('.bubble').map((bubble) => bubble.text())).toEqual([
      'When does Mara sleep?',
    ]);
    expect(wrapper.find('.composer-note').text()).toContain('A write-up is waiting');
  });

  it("won't accept a routine longer than a profile holds", async () => {
    const proposal = {
      description: 'Keeps the light.',
      personality: 'Dry.',
      routine: 'Nights. '.repeat(300),
      changes: '',
      relationships: [],
      base: { description: 'Keeps the light.', personality: 'Dry.', routine: '' },
    };
    bureauInterviewsAPI.get.mockResolvedValue(loaded(interview(ASKED.messages, proposal)));
    const wrapper = mountInterview();
    await flushPromises();

    expect(wrapper.text()).toContain('Trim it to 2000 characters or fewer');
    expect(button(wrapper, 'Accept').attributes('disabled')).toBeDefined();

    await wrapper.find('#review-routine').setValue('Nights.');
    expect(button(wrapper, 'Accept').attributes('disabled')).toBeUndefined();
  });
});
