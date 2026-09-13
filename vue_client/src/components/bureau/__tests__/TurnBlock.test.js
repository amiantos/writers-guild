import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import TurnBlock from '../TurnBlock.vue';
import { formatDateTime } from '../../../composables/bureau/format';

// happy-dom's DOM trips up DOMPurify; renderProse's own tests cover sanitizing.
vi.mock('dompurify', () => ({ default: { sanitize: (html) => html } }));

function turn(fields = {}) {
  return {
    id: 'turn-1',
    kind: 'prose',
    source: 'generated',
    content: 'The lamp was lit.\n\nMara looked up.',
    activeVariantId: 'v2',
    variants: [
      { id: 'v1', runId: 'run-1' },
      { id: 'v2', runId: 'run-2' },
      { id: 'v3', runId: 'run-3' },
    ],
    ...fields,
  };
}

function buttonTitled(wrapper, title) {
  return wrapper.find(`button[title="${title}"]`);
}

describe('TurnBlock', () => {
  it('renders prose as paragraphs', () => {
    const wrapper = mount(TurnBlock, { props: { turn: turn() } });

    expect(wrapper.findAll('.prose p').map((p) => p.text())).toEqual([
      'The lamp was lit.',
      'Mara looked up.',
    ]);
  });

  it('shows streamed text in place of the turn while it is regenerated', () => {
    const wrapper = mount(TurnBlock, {
      props: { turn: turn(), overrideContent: 'A new version...' },
    });

    expect(wrapper.find('.prose').text()).toBe('A new version...');
  });

  it('shows directions as notes and scene breaks as dividers', () => {
    const direction = mount(TurnBlock, {
      props: {
        turn: turn({ kind: 'direction', source: 'user', content: 'Rain starts.', variants: [] }),
      },
    });
    const sceneBreak = mount(TurnBlock, {
      props: { turn: turn({ kind: 'scene_break', source: 'user', content: '', variants: [] }) },
    });

    expect(direction.find('.direction-note').text()).toBe('Rain starts.');
    expect(sceneBreak.find('[role="separator"]').exists()).toBe(true);
    expect(buttonTitled(sceneBreak, 'Edit').exists()).toBe(false);
  });

  it('shows time passing as a divider with the new time, in the Bureau time zone', () => {
    const bureauTime = '2026-10-28T15:00:00.000Z';
    const wrapper = mount(TurnBlock, {
      props: {
        turn: turn({ kind: 'time_passes', source: 'user', content: '', bureauTime, variants: [] }),
        timeZone: 'America/Los_Angeles',
      },
    });

    const divider = wrapper.find('.time-passes-divider');
    expect(divider.attributes('role')).toBe('separator');
    expect(divider.text()).toBe(formatDateTime(bureauTime, 'America/Los_Angeles'));
    expect(divider.text()).toContain('8:00');
    expect(buttonTitled(wrapper, 'Edit').exists()).toBe(false);
    expect(buttonTitled(wrapper, 'Delete').exists()).toBe(true);
  });

  it('switches to the neighboring version', async () => {
    const wrapper = mount(TurnBlock, { props: { turn: turn() } });

    expect(wrapper.find('.variant-count').text()).toBe('2 / 3');
    await buttonTitled(wrapper, 'Next version').trigger('click');
    await buttonTitled(wrapper, 'Previous version').trigger('click');

    expect(wrapper.emitted('select-variant').map(([, variantId]) => variantId)).toEqual([
      'v3',
      'v1',
    ]);
  });

  it('saves an edit, ignoring unchanged text', async () => {
    const wrapper = mount(TurnBlock, { props: { turn: turn() } });

    await buttonTitled(wrapper, 'Edit').trigger('click');
    await wrapper.find('textarea').setValue('  The lamp flickered.  ');
    await wrapper.find('.editor-actions .btn-primary').trigger('click');

    expect(wrapper.emitted('save')).toEqual([[turn(), 'The lamp flickered.']]);

    await buttonTitled(wrapper, 'Edit').trigger('click');
    await wrapper.find('.editor-actions .btn-primary').trigger('click');
    expect(wrapper.emitted('save')).toHaveLength(1);
  });

  it('offers regeneration only for generated turns, when allowed', () => {
    const generated = mount(TurnBlock, { props: { turn: turn(), canRegenerate: true } });
    const readers = mount(TurnBlock, {
      props: { turn: turn({ source: 'user', variants: [] }), canRegenerate: true },
    });
    const ended = mount(TurnBlock, { props: { turn: turn(), canRegenerate: false } });

    expect(buttonTitled(generated, 'Write another version').exists()).toBe(true);
    expect(buttonTitled(readers, 'Write another version').exists()).toBe(false);
    expect(buttonTitled(ended, 'Write another version').exists()).toBe(false);
  });
});
