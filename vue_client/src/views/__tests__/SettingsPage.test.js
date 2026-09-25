import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const { mockSettingsAPI, leaveGuards } = vi.hoisted(() => ({
  mockSettingsAPI: { get: vi.fn(), update: vi.fn() },
  leaveGuards: [],
}));

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: (guard) => leaveGuards.push(guard),
}));

vi.mock('../../services/api', () => ({
  settingsAPI: mockSettingsAPI,
  charactersAPI: { list: vi.fn(async () => ({ characters: [] })) },
}));

vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../composables/useNavigation', () => ({
  useNavigation: () => ({ goBack: vi.fn() }),
}));

import SettingsPage from '../SettingsPage.vue';

async function mountPage() {
  const wrapper = mount(SettingsPage);
  await flushPromises();
  return wrapper;
}

function chatsToggle(wrapper) {
  return wrapper
    .findAll('input[type="checkbox"]')
    .find((input) => input.element.closest('label')?.textContent.includes('Chats'));
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leaveGuards.length = 0;
    mockSettingsAPI.get.mockResolvedValue({ settings: { experimentalChats: false } });
    mockSettingsAPI.update.mockResolvedValue({});
  });

  it('saves a pending change before leaving the page', async () => {
    const wrapper = await mountPage();
    await chatsToggle(wrapper).setValue(true);
    expect(mockSettingsAPI.update).not.toHaveBeenCalled();

    await Promise.all(leaveGuards.map((guard) => guard()));

    expect(mockSettingsAPI.update).toHaveBeenCalledTimes(1);
    expect(mockSettingsAPI.update.mock.calls[0][0].experimentalChats).toBe(true);
  });

  it('saves again when settings change while a save is in flight', async () => {
    vi.useFakeTimers();
    try {
      let finishFirst;
      mockSettingsAPI.update.mockImplementationOnce(
        () => new Promise((resolve) => (finishFirst = resolve)),
      );
      const wrapper = await mountPage();

      await chatsToggle(wrapper).setValue(true);
      await vi.advanceTimersByTimeAsync(500);
      expect(mockSettingsAPI.update).toHaveBeenCalledTimes(1);

      await chatsToggle(wrapper).setValue(false);
      await vi.advanceTimersByTimeAsync(500);
      finishFirst({});
      await flushPromises();

      expect(mockSettingsAPI.update).toHaveBeenCalledTimes(2);
      expect(mockSettingsAPI.update.mock.calls[1][0].experimentalChats).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
