import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import BureausTab from '../BureausTab.vue';
import { bureausAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({ bureausAPI: { list: vi.fn() } }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ error: vi.fn() }),
}));

const IntroStub = {
  emits: ['close'],
  template:
    '<div class="intro-stub"><button class="close-intro" @click="$emit(\'close\')" /></div>',
};

function mountTab() {
  return mount(BureausTab, {
    global: { stubs: { BureauIntroModal: IntroStub, CreateBureauModal: true } },
  });
}

describe('BureausTab', () => {
  beforeEach(() => {
    // A fresh browser: nothing remembered yet.
    const stored = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, String(value)),
      removeItem: (key) => stored.delete(key),
    });
    bureausAPI.list.mockResolvedValue({ bureaus: [] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the intro the first time, then only when asked', async () => {
    const first = mountTab();
    await flushPromises();

    expect(first.find('.intro-stub').exists()).toBe(true);
    await first.find('.close-intro').trigger('click');
    expect(first.find('.intro-stub').exists()).toBe(false);
    first.unmount();

    const later = mountTab();
    await flushPromises();
    expect(later.find('.intro-stub').exists()).toBe(false);

    await later
      .findAll('button')
      .find((button) => button.text().includes("What's a Bureau?"))
      .trigger('click');
    expect(later.find('.intro-stub').exists()).toBe(true);
  });
});
