import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import CreateBureauModal from '../CreateBureauModal.vue';
import { bureausAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({
  bureausAPI: { sharedKey: vi.fn(), create: vi.fn() },
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
  });

  it('uses the shared key when there is one', async () => {
    const wrapper = await mountModal(SAVED);

    expect(wrapper.text()).toContain('Uses the shared key sk-…5678');
    expect(wrapper.find('#new-bureau-api-key').exists()).toBe(false);
    await create(wrapper);

    expect(bureausAPI.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Harbor', apiKey: '', shareApiKey: false }),
    );
    expect(wrapper.emitted('created')[0][0]).toEqual({ id: 'b1', name: 'Harbor' });
  });

  it('gives the Bureau its own key when asked', async () => {
    const wrapper = await mountModal(SAVED);

    await button(wrapper, 'Use a different key').trigger('click');
    expect(wrapper.find('#new-bureau-share-key').exists()).toBe(false);
    await wrapper.find('#new-bureau-api-key').setValue(' sk-own-key ');
    await create(wrapper);

    expect(bureausAPI.create).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-own-key', shareApiKey: false }),
    );
  });

  it('offers to share the first key, and asks the server to', async () => {
    const wrapper = await mountModal(NONE);

    expect(wrapper.find('#new-bureau-share-key').element.checked).toBe(true);
    await wrapper.find('#new-bureau-api-key').setValue('sk-first-key');
    await create(wrapper);

    expect(bureausAPI.create).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-first-key', shareApiKey: true }),
    );
  });

  it("keeps the key to this Bureau when it isn't shared", async () => {
    const wrapper = await mountModal(NONE);

    await wrapper.find('#new-bureau-api-key').setValue('sk-first-key');
    await wrapper.find('#new-bureau-share-key').setValue(false);
    await create(wrapper);

    expect(bureausAPI.create).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'sk-first-key', shareApiKey: false }),
    );
  });

  it('waits for the shared key check before taking a key or creating', async () => {
    let answer;
    bureausAPI.sharedKey.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const wrapper = mount(CreateBureauModal, { global: { stubs: { Modal: ModalStub } } });
    await wrapper.find('#new-bureau-name').setValue('Harbor');

    expect(wrapper.text()).toContain('Checking for a shared key');
    expect(wrapper.find('#new-bureau-api-key').exists()).toBe(false);
    expect(button(wrapper, 'Create Bureau').attributes('disabled')).toBeDefined();
    await wrapper.find('#new-bureau-name').trigger('keydown.enter');
    expect(bureausAPI.create).not.toHaveBeenCalled();

    answer(NONE);
    await flushPromises();

    expect(wrapper.find('#new-bureau-share-key').element.checked).toBe(true);
    expect(button(wrapper, 'Create Bureau').attributes('disabled')).toBeUndefined();
  });
});
