import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import SharedKeyModal from '../SharedKeyModal.vue';
import { bureausAPI } from '../../../services/bureauApi';

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('../../../services/bureauApi', () => ({
  bureausAPI: { sharedKey: vi.fn(), updateSharedKey: vi.fn() },
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../../composables/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));

const ModalStub = {
  props: ['title', 'closeOnOverlayClick'],
  template: '<div><slot /><slot name="footer" /></div>',
};

function button(wrapper, label) {
  return wrapper.findAll('button').find((candidate) => candidate.text().includes(label));
}

async function mountModal(sharedKey) {
  bureausAPI.sharedKey.mockResolvedValue({ sharedKey });
  const wrapper = mount(SharedKeyModal, { global: { stubs: { Modal: ModalStub } } });
  await flushPromises();
  return wrapper;
}

describe('SharedKeyModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves a pasted key as the shared key', async () => {
    const saved = { hasApiKey: true, apiKeyPreview: 'sk-…5678' };
    bureausAPI.updateSharedKey.mockResolvedValue({ sharedKey: saved });
    const wrapper = await mountModal({ hasApiKey: false, apiKeyPreview: '' });

    expect(button(wrapper, 'Remove key')).toBeUndefined();
    expect(button(wrapper, 'Save key').attributes('disabled')).toBeDefined();
    await wrapper.find('#shared-api-key').setValue('  sk-shared-5678 ');
    await button(wrapper, 'Save key').trigger('click');
    await flushPromises();

    expect(bureausAPI.updateSharedKey).toHaveBeenCalledWith('sk-shared-5678');
    expect(wrapper.emitted('saved')[0][0]).toEqual(saved);
  });

  it('removes the saved key once confirmed', async () => {
    confirm.mockResolvedValue(true);
    bureausAPI.updateSharedKey.mockResolvedValue({
      sharedKey: { hasApiKey: false, apiKeyPreview: '' },
    });
    const wrapper = await mountModal({ hasApiKey: true, apiKeyPreview: 'sk-…5678' });

    expect(wrapper.text()).toContain('Saved key sk-…5678');
    await button(wrapper, 'Remove key').trigger('click');
    await flushPromises();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(bureausAPI.updateSharedKey).toHaveBeenCalledWith('');
    expect(wrapper.emitted('saved')).toHaveLength(1);
  });
});
