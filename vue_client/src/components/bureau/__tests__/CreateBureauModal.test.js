import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import CreateBureauModal from '../CreateBureauModal.vue';
import { bureausAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({
  bureausAPI: { sharedKey: vi.fn(), updateSharedKey: vi.fn(), create: vi.fn() },
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const ModalStub = {
  props: ['title', 'closeOnOverlayClick'],
  template: '<div><slot /><slot name="footer" /></div>',
};

const SAVED = { sharedKey: { hasApiKey: true, apiKeyPreview: 'sk-…5678' } };
const NONE = { sharedKey: { hasApiKey: false, apiKeyPreview: '' } };

function button(wrapper, label) {
  return wrapper.findAll('button').find((candidate) => candidate.text().includes(label));
}

async function mountModal(sharedKey) {
  bureausAPI.sharedKey.mockResolvedValue(sharedKey);
  const wrapper = mount(CreateBureauModal, { global: { stubs: { Modal: ModalStub } } });
  await flushPromises();
  await wrapper.find('#new-bureau-name').setValue('Harbor');
  return wrapper;
}

async function create(wrapper) {
  await button(wrapper, 'Create Bureau').trigger('click');
  await flushPromises();
}

describe('CreateBureauModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bureausAPI.create.mockResolvedValue({ bureau: { id: 'b1', name: 'Harbor' } });
    bureausAPI.updateSharedKey.mockResolvedValue(SAVED);
  });

  it('uses the shared key when there is one', async () => {
    const wrapper = await mountModal(SAVED);

    expect(wrapper.text()).toContain('Uses the shared key sk-…5678');
    expect(wrapper.find('#new-bureau-api-key').exists()).toBe(false);
    await create(wrapper);

    expect(bureausAPI.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Harbor', apiKey: '' }),
    );
    expect(wrapper.emitted('created')[0][0]).toEqual({ id: 'b1', name: 'Harbor' });
  });

  it('gives the Bureau its own key when asked', async () => {
    const wrapper = await mountModal(SAVED);

    await button(wrapper, 'Use a different key').trigger('click');
    expect(wrapper.find('#new-bureau-share-key').exists()).toBe(false);
    await wrapper.find('#new-bureau-api-key').setValue(' sk-own-key ');
    await create(wrapper);

    expect(bureausAPI.updateSharedKey).not.toHaveBeenCalled();
    expect(bureausAPI.create).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-own-key' }),
    );
  });

  it('shares the first key before creating the Bureau', async () => {
    const wrapper = await mountModal(NONE);

    expect(wrapper.find('#new-bureau-share-key').element.checked).toBe(true);
    await wrapper.find('#new-bureau-api-key').setValue('sk-first-key');
    await create(wrapper);

    expect(bureausAPI.updateSharedKey).toHaveBeenCalledWith('sk-first-key');
    expect(bureausAPI.create).toHaveBeenCalledWith(expect.objectContaining({ apiKey: '' }));
    expect(bureausAPI.updateSharedKey.mock.invocationCallOrder[0]).toBeLessThan(
      bureausAPI.create.mock.invocationCallOrder[0],
    );
  });

  it("keeps the key to this Bureau when it isn't shared", async () => {
    const wrapper = await mountModal(NONE);

    await wrapper.find('#new-bureau-api-key').setValue('sk-first-key');
    await wrapper.find('#new-bureau-share-key').setValue(false);
    await create(wrapper);

    expect(bureausAPI.updateSharedKey).not.toHaveBeenCalled();
    expect(bureausAPI.create).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-first-key' }),
    );
  });
});
