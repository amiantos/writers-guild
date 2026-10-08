import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PresetList from '../PresetList.vue';

const PRESETS = [
  {
    id: 'p1',
    name: 'Quick Draft',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    maxTokens: 4000,
  },
  { id: 'p2', name: 'Careful Prose', provider: 'anthropic', model: 'claude-sonnet' },
];

function mountList(props = {}) {
  return mount(PresetList, {
    props: {
      presets: PRESETS,
      defaultPresetId: 'p1',
      stories: [{ configPresetId: 'p2' }],
      ...props,
    },
    global: { stubs: { Teleport: true } },
  });
}

const names = (wrapper) => wrapper.findAll('.row-name .ellipsis').map((node) => node.text());

async function openSheet(wrapper, name) {
  await wrapper.find(`[aria-label="More actions for ${name}"]`).trigger('click');
}

describe('PresetList', () => {
  it('groups presets by provider, the default first, with each model and use', () => {
    const wrapper = mountList();
    expect(wrapper.findAll('.group-head').map((h) => h.text())).toEqual([
      'DeepSeek 1',
      'Anthropic 1',
    ]);
    expect(names(wrapper)).toEqual(['Quick Draft', 'Careful Prose']);
    expect(wrapper.find('.is-default .default-pill').exists()).toBe(true);
    expect(wrapper.findAll('.row-model').map((node) => node.text())).toEqual([
      'deepseek-v4-flash',
      'claude-sonnet',
    ]);
    expect(wrapper.findAll('.row-meta')[1].text()).toBe('Used by 1 story');
  });

  it('edits a preset from its row, and makes another the default with its star', async () => {
    const wrapper = mountList();
    await wrapper.find('[aria-label="Edit Careful Prose"]').trigger('click');
    expect(wrapper.emitted('edit')[0]).toEqual(['p2']);

    await wrapper.find('[aria-label="Quick Draft is the default preset"]').trigger('click');
    expect(wrapper.emitted('set-default')).toBeUndefined();
    await wrapper.find('[aria-label="Make Careful Prose the default preset"]').trigger('click');
    expect(wrapper.emitted('set-default')[0]).toEqual(['p2']);
  });

  it('duplicates and deletes from a preset’s sheet', async () => {
    const wrapper = mountList();
    await openSheet(wrapper, 'Careful Prose');
    const button = (text) =>
      wrapper.findAll('.sheet-list button').find((b) => b.text().includes(text));
    await button('Duplicate').trigger('click');
    expect(wrapper.emitted('duplicate')[0]).toEqual(['p2']);

    await openSheet(wrapper, 'Careful Prose');
    await button('Delete').trigger('click');
    expect(wrapper.emitted('delete')[0][0]).toMatchObject({ id: 'p2', storyCount: 1 });
  });

  it('keeps the default preset from being deleted', async () => {
    const wrapper = mountList();
    await openSheet(wrapper, 'Quick Draft');
    expect(wrapper.find('.sheet-list .danger').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.sheet-list .is-default').text()).toContain('The default preset');
  });

  it('offers a new preset when there are none', async () => {
    const wrapper = mountList({ presets: [] });
    await wrapper.find('.empty-state .btn').trigger('click');
    expect(wrapper.emitted('create')).toHaveLength(1);
  });
});
