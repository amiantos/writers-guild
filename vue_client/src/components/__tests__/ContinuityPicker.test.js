import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ContinuityPicker from '../ContinuityPicker.vue';
import { continuitiesAPI, settingsAPI } from '../../services/api';

vi.mock('../../services/api', () => ({
  settingsAPI: { get: vi.fn() },
  continuitiesAPI: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    listVersions: vi.fn(),
    restoreVersion: vi.fn(),
  },
}));
vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
const confirm = vi.fn();
vi.mock('../../composables/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));

const HARBOR = {
  id: 'k1',
  name: 'Harbor',
  content: 'Layla and Sam are married.',
  storyCount: 2,
  chatCount: 1,
};

async function mountPicker(props = {}, { enabled = true } = {}) {
  settingsAPI.get.mockResolvedValue({ settings: { experimentalContinuity: enabled } });
  continuitiesAPI.list.mockResolvedValue({ continuities: [HARBOR] });
  const wrapper = mount(ContinuityPicker, { props });
  await flushPromises();
  return wrapper;
}

describe('ContinuityPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows nothing and leaves the story alone while Continuities are off', async () => {
    const wrapper = await mountPicker({}, { enabled: false });
    expect(wrapper.find('#continuitySelect').exists()).toBe(false);
    expect(await wrapper.vm.save()).toBeUndefined();
  });

  it("shows the Continuity's text and how many others share it", async () => {
    const wrapper = await mountPicker({ continuityId: 'k1' });
    expect(wrapper.find('#continuityContent').element.value).toBe('Layla and Sam are married.');
    expect(wrapper.text()).toContain('Also used by 2 other stories and chats');
  });

  it('saves edits to the text and returns its id', async () => {
    continuitiesAPI.update.mockResolvedValue({ continuity: { ...HARBOR, content: 'Separated.' } });
    const wrapper = await mountPicker({ continuityId: 'k1' });
    await wrapper.find('#continuityContent').setValue('  Separated. ');

    expect(await wrapper.vm.save()).toBe('k1');
    expect(continuitiesAPI.update).toHaveBeenCalledWith('k1', {
      name: 'Harbor',
      content: 'Separated.',
    });
  });

  it("doesn't save a Continuity that hasn't changed", async () => {
    const wrapper = await mountPicker({ continuityId: 'k1' });
    expect(await wrapper.vm.save()).toBe('k1');
    expect(continuitiesAPI.update).not.toHaveBeenCalled();
  });

  it('creates a new Continuity', async () => {
    continuitiesAPI.create.mockResolvedValue({ continuity: { id: 'k2' } });
    const wrapper = await mountPicker();
    await wrapper.find('#continuitySelect').setValue('__new__');
    await wrapper.find('#continuityName').setValue('Mars');
    await wrapper.find('#continuityContent').setValue('The colony is new.');

    expect(await wrapper.vm.save()).toBe('k2');
    expect(continuitiesAPI.create).toHaveBeenCalledWith({
      name: 'Mars',
      content: 'The colony is new.',
    });
  });

  it('takes the story out of its Continuity', async () => {
    const wrapper = await mountPicker({ continuityId: 'k1' });
    await wrapper.find('#continuitySelect').setValue('');
    expect(await wrapper.vm.save()).toBeNull();
  });

  it('restores an earlier version from History', async () => {
    continuitiesAPI.listVersions.mockResolvedValue({
      versions: [
        { id: 1, source: 'created', content: 'Engaged.', created: '2026-09-01T00:00:00Z' },
        { id: 2, source: 'edit', content: HARBOR.content, created: '2026-09-02T00:00:00Z' },
      ],
    });
    continuitiesAPI.restoreVersion.mockResolvedValue({
      continuity: { ...HARBOR, content: 'Engaged.' },
    });
    confirm.mockResolvedValue(true);
    const wrapper = await mountPicker({ continuityId: 'k1' });

    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('History'))
      .trigger('click');
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Restore'))
      .trigger('click');
    await flushPromises();

    expect(continuitiesAPI.restoreVersion).toHaveBeenCalledWith('k1', 1);
    expect(wrapper.find('#continuityContent').element.value).toBe('Engaged.');
  });
});
