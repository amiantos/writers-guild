import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const { mockAuthAPI, mockUsersAPI, confirmMock } = vi.hoisted(() => ({
  mockAuthAPI: {
    enable: vi.fn(),
    disable: vi.fn(),
    changePassword: vi.fn(),
    logout: vi.fn(),
  },
  mockUsersAPI: {
    list: vi.fn(),
    listInvitations: vi.fn(),
    invite: vi.fn(),
    resetLink: vi.fn(),
    delete: vi.fn(),
    deleteInvitation: vi.fn(),
  },
  confirmMock: vi.fn(),
}));

vi.mock('../../../services/authApi', () => ({
  authAPI: mockAuthAPI,
  usersAPI: mockUsersAPI,
  linkURL: (path) => `http://wg.test${path}`,
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}));

import AccountSettings from '../AccountSettings.vue';
import { useAuth } from '../../../composables/useAuth';

const adminUser = { id: 'admin', username: 'boss', role: 'admin' };
const guestUser = { id: 'g1', username: 'guest', role: 'user' };

async function mountWith(status) {
  useAuth().setStatus(status);
  const wrapper = mount(AccountSettings);
  await flushPromises();
  return wrapper;
}

function button(wrapper, text) {
  return wrapper.findAll('button').find((b) => b.text().includes(text));
}

describe('AccountSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsersAPI.list.mockResolvedValue({
      users: [
        { ...adminUser, created: '2026-01-01T00:00:00Z' },
        { ...guestUser, created: '2026-02-01T00:00:00Z' },
      ],
    });
    mockUsersAPI.listInvitations.mockResolvedValue({ invitations: [] });
  });

  describe('with signing in off', () => {
    it('stays out of the way until asked', async () => {
      const wrapper = await mountWith({
        authEnabled: false,
        user: { ...adminUser, username: null },
      });

      expect(wrapper.find('#enableUsername').exists()).toBe(false);
      expect(wrapper.text()).not.toContain('Users');
      expect(mockUsersAPI.list).not.toHaveBeenCalled();
    });

    it('turns it on with a username and password', async () => {
      mockAuthAPI.enable.mockResolvedValue({ authEnabled: true, user: adminUser });
      const wrapper = await mountWith({
        authEnabled: false,
        user: { ...adminUser, username: null },
      });

      await button(wrapper, 'Turn On Signing In').trigger('click');
      await wrapper.find('#enableUsername').setValue('boss');
      await wrapper.find('#enablePassword').setValue('correct horse');
      await wrapper.find('#enableConfirm').setValue('correct horse');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockAuthAPI.enable).toHaveBeenCalledWith('boss', 'correct horse');
      expect(wrapper.text()).toContain('Signed in as boss');
      expect(mockUsersAPI.list).toHaveBeenCalled();
    });

    it("doesn't turn on when the passwords don't match", async () => {
      const wrapper = await mountWith({
        authEnabled: false,
        user: { ...adminUser, username: null },
      });

      await button(wrapper, 'Turn On Signing In').trigger('click');
      await wrapper.find('#enableUsername').setValue('boss');
      await wrapper.find('#enablePassword').setValue('correct horse');
      await wrapper.find('#enableConfirm').setValue('correct horsf');
      await wrapper.find('form').trigger('submit');

      expect(mockAuthAPI.enable).not.toHaveBeenCalled();
    });
  });

  describe('for the admin, signed in', () => {
    it('lists the users, with what can be done to each other one', async () => {
      const wrapper = await mountWith({ authEnabled: true, user: adminUser });

      const rows = wrapper.findAll('.user-row');
      expect(rows.map((row) => row.find('.user-name').text())).toEqual(['boss', 'guest']);
      expect(rows[0].find('.user-actions').exists()).toBe(false);
      expect(rows[1].text()).toContain('Reset Password');
      // Not while there's someone else
      expect(wrapper.text()).not.toContain('Turn Off Signing In');
    });

    it('shows an invitation link to copy', async () => {
      mockUsersAPI.invite.mockResolvedValue({
        invitation: { id: 'i1', path: '/invite/tok', expires: '2026-01-08T00:00:00Z' },
      });
      const wrapper = await mountWith({ authEnabled: true, user: adminUser });

      await button(wrapper, 'Invite Someone').trigger('click');
      await flushPromises();

      expect(wrapper.find('.link-box input').element.value).toBe('http://wg.test/invite/tok');
    });

    it('deletes a user only once confirmed', async () => {
      confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
      mockUsersAPI.delete.mockResolvedValue({ success: true });
      const wrapper = await mountWith({ authEnabled: true, user: adminUser });
      const deleteButton = () => button(wrapper.findAll('.user-row')[1], 'Delete');

      await deleteButton().trigger('click');
      await flushPromises();
      expect(mockUsersAPI.delete).not.toHaveBeenCalled();

      await deleteButton().trigger('click');
      await flushPromises();
      expect(mockUsersAPI.delete).toHaveBeenCalledWith('g1');
    });

    it('offers to turn signing in off while the admin is alone', async () => {
      mockUsersAPI.list.mockResolvedValue({ users: [{ ...adminUser, created: '2026-01-01' }] });
      const wrapper = await mountWith({ authEnabled: true, user: adminUser });

      expect(button(wrapper, 'Turn Off Signing In')).toBeTruthy();
    });
  });

  it('shows someone else only their own account', async () => {
    const wrapper = await mountWith({ authEnabled: true, user: guestUser });

    expect(wrapper.text()).toContain('Signed in as guest');
    expect(wrapper.text()).not.toContain('Invite Someone');
    expect(wrapper.text()).not.toContain('Turn Off Signing In');
    expect(mockUsersAPI.list).not.toHaveBeenCalled();
  });
});
