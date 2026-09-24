import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import EditChatModal from '../EditChatModal.vue';
import { chatsAPI } from '../../../services/chatsApi';

vi.mock('../../../services/chatsApi', () => ({ chatsAPI: { update: vi.fn() } }));
vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

const CHAT = { id: 'c1', title: 'Late night', scenario: 'Midnight.' };

function mountModal(props = {}) {
  return mount(EditChatModal, {
    props: { chat: CHAT, ...props },
    global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
    attachTo: document.body,
  });
}

function saveButton(wrapper) {
  return wrapper.findAll('button').find((button) => button.text().includes('Save'));
}

describe('EditChatModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('saves the title and the described scenario', async () => {
    chatsAPI.update.mockResolvedValue({ chat: { ...CHAT, scenario: 'Dawn.' } });
    const wrapper = mountModal();

    await wrapper.find('#chatScenario').setValue('  Dawn.  ');
    await saveButton(wrapper).trigger('click');
    await flushPromises();

    expect(chatsAPI.update).toHaveBeenCalledWith('c1', { title: 'Late night', scenario: 'Dawn.' });
    expect(wrapper.emitted('updated')[0][0].scenario).toBe('Dawn.');
    expect(wrapper.emitted('close')).toBeTruthy();
    wrapper.unmount();
  });

  it('needs a title', async () => {
    const wrapper = mountModal();
    await wrapper.find('#chatTitle').setValue('  ');
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('can open on the scenario', () => {
    const wrapper = mountModal({ focusScenario: true });
    expect(document.activeElement).toBe(wrapper.find('#chatScenario').element);
    wrapper.unmount();
  });
});
