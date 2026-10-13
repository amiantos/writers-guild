import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const { mockAuthAPI, reloadAt } = vi.hoisted(() => ({
  mockAuthAPI: { getLink: vi.fn(), useLink: vi.fn() },
  reloadAt: vi.fn(),
}));

vi.mock('../../services/authApi', () => ({ authAPI: mockAuthAPI }));

vi.mock('../../composables/useAuth', () => ({ useAuth: () => ({ reloadAt }) }));

import LinkPage from '../LinkPage.vue';

async function mountPage() {
  const wrapper = mount(LinkPage, {
    props: { token: 'tok' },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  });
  await flushPromises();
  return wrapper;
}

describe('LinkPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('makes an account from an invitation, and starts the app as it', async () => {
    mockAuthAPI.getLink.mockResolvedValue({ kind: 'invite', username: null });
    mockAuthAPI.useLink.mockResolvedValue({ user: { id: 'u1' } });
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('Join Writers Guild');
    await wrapper.find('#username').setValue('guest');
    await wrapper.find('#password').setValue('guestpass');
    await wrapper.find('#confirm').setValue('guestpass');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(mockAuthAPI.useLink).toHaveBeenCalledWith('tok', {
      username: 'guest',
      password: 'guestpass',
    });
    expect(reloadAt).toHaveBeenCalledWith('/');
  });

  it('sets a new password from a reset link, with no username to choose', async () => {
    mockAuthAPI.getLink.mockResolvedValue({ kind: 'reset', username: 'guest' });
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('Choose a new password for guest');
    expect(wrapper.find('#username').exists()).toBe(false);
  });

  it("says so when the passwords don't match", async () => {
    mockAuthAPI.getLink.mockResolvedValue({ kind: 'reset', username: 'guest' });
    const wrapper = await mountPage();

    await wrapper.find('#password').setValue('one password');
    await wrapper.find('#confirm').setValue('another one');
    await wrapper.find('form').trigger('submit');

    expect(wrapper.find('.error-text').text()).toBe("The passwords don't match");
    expect(mockAuthAPI.useLink).not.toHaveBeenCalled();
  });

  it('says when a link has been used or has expired', async () => {
    mockAuthAPI.getLink.mockRejectedValue(new Error('This link has expired or was already used'));
    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('This link has expired or was already used');
    expect(wrapper.find('form input').exists()).toBe(false);
  });
});
