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

function runStep(id, fields) {
  return { id, durationMs: null, usage: null, error: null, ...fields };
}

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
      props: { bureauId: 'b1', turn: turn({}), castById: CAST },
    });

    expect(wrapper.find('.seam-panel').exists()).toBe(false);
    await wrapper.find('.seam-toggle').trigger('click');
    await flushPromises();

    expect(bureausAPI.getRun).toHaveBeenCalledWith('b1', 'run-1');
    const panel = wrapper.find('.seam-panel').text();
    expect(panel).toContain('Written');
    expect(panel).not.toContain('centered on');
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

  it('shows the brief, lookups, style findings, and fixes, and offers to revert a fix', async () => {
    const original = '"Coming?" Mara asked. "No," Theo said.';
    const replacement = '"Coming?" Mara asked.\n\n"No," Theo said.';
    const reason = 'Mara and Theo both speak in one paragraph';
    const brief = {
      beats: ['Mara offers a lesson'],
      pov: 'Mara',
      tone: 'wry',
      length: 'short',
      memories: [{ id: 4, content: "Theo can't swim.", reason: 'He is afraid' }],
      notes: 'Keep it light.',
    };
    bureausAPI.getRun.mockResolvedValue({
      run: {
        ...RUN,
        steps: [
          runStep(1, {
            role: 'director',
            kind: 'model',
            request: {
              model: 'deepseek-flash',
              thinking: true,
              reasoningEffort: 'low',
              maxTokens: 8000,
            },
          }),
          runStep(2, {
            role: 'director',
            kind: 'tool',
            request: { name: 'recall', arguments: '{"query":"swim","character":""}' },
            response: '{"memories":[]}',
          }),
          runStep(3, {
            role: 'director',
            kind: 'tool',
            request: { name: 'submit_brief', arguments: '{}' },
            response: JSON.stringify(brief),
          }),
          runStep(4, {
            role: 'lint',
            kind: 'tool',
            request: { name: 'style_lint' },
            response: { findings: [{ paragraph: 0, rule: 'multiple_speakers', reason }] },
          }),
          runStep(5, {
            role: 'editor',
            kind: 'tool',
            request: { name: 'edit_paragraphs' },
            response: {
              edits: [
                { paragraph: 0, rules: ['multiple_speakers'], reason, original, replacement },
              ],
            },
          }),
        ],
      },
    });
    const wrapper = mount(TurnSeam, {
      props: { bureauId: 'b1', turn: turn({ content: replacement }), castById: CAST },
    });

    await wrapper.find('.seam-toggle').trigger('click');
    await flushPromises();

    const panel = wrapper.find('.seam-panel').text();
    expect(panel).toContain('deepseek-flash · thinking (low effort) · up to 8000 tokens');
    expect(panel).toContain('Director · recall');
    expect(panel).toContain('"query": "swim"');
    expect(panel).toContain('Mara offers a lesson');
    // An older brief may still carry a point of view; it isn't shown.
    expect(panel).toContain('Tone: wry · Length: short');
    expect(panel).not.toContain('Point of view');
    expect(panel).toContain("Theo can't swim. (He is afraid)");
    expect(panel).toContain(`Paragraph 1: ${reason}`);

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Revert'))
      .trigger('click');
    expect(wrapper.emitted('revert-edit')[0][0]).toMatchObject({ runId: 'run-1', index: 0 });

    await wrapper.setProps({ turn: turn({ content: original }) });
    expect(wrapper.find('.seam-panel').text()).toContain('Reverted');
  });

  it('shows a cut-down fix as reverted once its original is back', async () => {
    const original = 'Mara grinned. "Race you," she said. Theo laughed. "You\'re on," he said.';
    const replacement = 'Mara grinned. "Race you," she said.';
    bureausAPI.getRun.mockResolvedValue({
      run: {
        ...RUN,
        steps: [
          runStep(1, {
            role: 'editor',
            kind: 'tool',
            request: { name: 'edit_paragraphs' },
            response: {
              edits: [
                {
                  paragraph: 0,
                  rules: ['speaking_for_reader'],
                  reason: 'Theo speaks',
                  original,
                  replacement,
                },
              ],
            },
          }),
        ],
      },
    });
    const wrapper = mount(TurnSeam, {
      props: { bureauId: 'b1', turn: turn({ content: original }), castById: CAST },
    });

    await wrapper.find('.seam-toggle').trigger('click');
    await flushPromises();

    expect(wrapper.find('.seam-fix').text()).toContain('Reverted');
    expect(wrapper.findAll('button').some((button) => button.text().includes('Revert'))).toBe(
      false,
    );
  });

  it('shows the scene brief while the passage is written', async () => {
    const wrapper = mount(TurnSeam, {
      props: {
        bureauId: 'b1',
        live: { status: 'Writing...', reasoning: '', brief: { beats: ['Mara offers a lesson'] } },
      },
    });

    await wrapper.find('.seam-toggle').trigger('click');

    const panel = wrapper.find('.seam-panel').text();
    expect(panel).toContain('Mara offers a lesson');
    expect(panel).not.toContain('thinking mode');
  });

  it('reports a run that cannot be loaded', async () => {
    bureausAPI.getRun.mockRejectedValue(new Error('Run not found'));
    const wrapper = mount(TurnSeam, { props: { bureauId: 'b1', turn: turn({}), castById: CAST } });

    await wrapper.find('.seam-toggle').trigger('click');
    await flushPromises();

    expect(wrapper.find('.seam-error').text()).toContain('Run not found');
  });
});
