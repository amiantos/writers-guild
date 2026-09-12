import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import TurnSeam from '../TurnSeam.vue';
import { bureausAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({
  bureausAPI: { getRun: vi.fn() },
}));

const CAST = {
  'cast-mara': { id: 'cast-mara', name: 'Mara' },
  'cast-theo': { id: 'cast-theo', name: 'Theo' },
};

function turn(fields) {
  return {
    id: 'turn-1',
    kind: 'prose',
    source: 'generated',
    content: 'The lamp was lit.',
    authorCastId: null,
    runId: 'run-1',
    edited: false,
    variants: [],
    created: '2026-09-12T08:00:00.000Z',
    ...fields,
  };
}

const RUN = {
  id: 'run-1',
  status: 'completed',
  started: '2026-09-12T08:00:00.000Z',
  steps: [
    {
      id: 1,
      role: 'writer',
      kind: 'model',
      durationMs: 2400,
      usage: { prompt_tokens: 1204, prompt_cache_hit_tokens: 512, completion_tokens: 310 },
      reasoning: 'Mara should answer the door.',
      error: null,
      request: {
        model: 'deepseek-flash',
        thinking: false,
        temperature: 1,
        maxTokens: 4000,
        messages: [
          { role: 'system', content: '=== HOUSE STYLE ===' },
          { role: 'user', content: '=== NEXT ===' },
        ],
      },
    },
  ],
};

describe('TurnSeam', () => {
  beforeEach(() => {
    bureausAPI.getRun.mockReset();
  });

  it("names the reader's character on their own turns", async () => {
    const wrapper = mount(TurnSeam, {
      props: {
        bureauId: 'b1',
        turn: turn({ source: 'user', runId: null, authorCastId: 'cast-theo', edited: true }),
        castById: CAST,
      },
    });

    expect(wrapper.find('.seam-label').text()).toBe('Written by Theo');
    await wrapper.find('.seam-toggle').trigger('click');

    expect(wrapper.find('.seam-panel').text()).toContain('edited');
    expect(bureausAPI.getRun).not.toHaveBeenCalled();
  });

  it('stays closed until clicked, then shows how a generated turn was made', async () => {
    bureausAPI.getRun.mockResolvedValue({ run: RUN });
    const wrapper = mount(TurnSeam, {
      props: { bureauId: 'b1', turn: turn({ authorCastId: 'cast-mara' }), castById: CAST },
    });

    expect(wrapper.find('.seam-panel').exists()).toBe(false);
    await wrapper.find('.seam-toggle').trigger('click');
    await flushPromises();

    expect(bureausAPI.getRun).toHaveBeenCalledWith('b1', 'run-1');
    const panel = wrapper.find('.seam-panel').text();
    expect(panel).toContain('Written');
    expect(panel).toContain('centered on Mara');
    expect(panel).toContain('2.4s');
    expect(panel).toContain('1,204 in (512 cached) · 310 out');
    expect(panel).toContain('deepseek-flash · temperature 1 · up to 4000 tokens');
    expect(panel).toContain('Mara should answer the door.');
    expect(panel).toContain('=== HOUSE STYLE ===');
  });

  it('shows a one-line live status, with the reasoning a click away', async () => {
    const wrapper = mount(TurnSeam, {
      props: { bureauId: 'b1', live: { status: 'Thinking...', reasoning: 'Planning the scene.' } },
    });

    expect(wrapper.find('.seam-label').text()).toBe('Thinking...');
    expect(wrapper.find('.seam-panel').exists()).toBe(false);

    await wrapper.find('.seam-toggle').trigger('click');
    expect(wrapper.find('.seam-panel').text()).toContain('Planning the scene.');

    await wrapper.setProps({ turn: turn({}), live: null });
    expect(wrapper.find('.seam-panel').exists()).toBe(false);
  });

  it('says when a live turn has no reasoning to show', async () => {
    const wrapper = mount(TurnSeam, {
      props: { bureauId: 'b1', live: { status: 'Writing...', reasoning: '' } },
    });

    await wrapper.find('.seam-toggle').trigger('click');

    expect(wrapper.find('.seam-panel').text()).toContain('thinking mode');
  });

  it('reports a run that cannot be loaded', async () => {
    bureausAPI.getRun.mockRejectedValue(new Error('Run not found'));
    const wrapper = mount(TurnSeam, { props: { bureauId: 'b1', turn: turn({}), castById: CAST } });

    await wrapper.find('.seam-toggle').trigger('click');
    await flushPromises();

    expect(wrapper.find('.seam-error').text()).toContain('Run not found');
  });
});
