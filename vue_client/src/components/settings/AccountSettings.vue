<template>
  <div class="account-settings">
    <!-- Account Section -->
    <section class="edit-section">
      <div class="section-header">
        <h2>Account</h2>
      </div>

      <!-- Signing in off: everything runs as the admin -->
      <div v-if="!authEnabled && !open.enable" class="section-content">
        <div class="signed-in-row">
          <p class="help-text">
            Anyone who can reach Writers Guild can use it. Turn on signing in to protect it with a
            username and password, and to invite other people, each with a library of their own.
          </p>
          <button class="btn btn-secondary btn-small" @click="open.enable = true">
            Turn On Signing In
          </button>
        </div>
      </div>
      <form v-else-if="!authEnabled" class="section-content" @submit.prevent="enableSignIn">
        <p class="help-text">
          Choose the username and password you'll sign in with. You'll stay signed in on this
          browser.
        </p>
        <div class="form-group">
          <label for="enableUsername">Username</label>
          <input
            id="enableUsername"
            v-model="enableForm.username"
            type="text"
            class="text-input"
            autocomplete="username"
          />
        </div>
        <div class="form-group">
          <label for="enablePassword">Password</label>
          <input
            id="enablePassword"
            v-model="enableForm.password"
            type="password"
            class="text-input"
            autocomplete="new-password"
          />
        </div>
        <div class="form-group">
          <label for="enableConfirm">Confirm password</label>
          <input
            id="enableConfirm"
            v-model="enableForm.confirmation"
            type="password"
            class="text-input"
            autocomplete="new-password"
          />
        </div>
        <div class="actions">
          <button type="button" class="btn btn-secondary" @click="open.enable = false">
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-primary"
            :disabled="busy || !enableForm.username || !enableForm.password"
          >
            Turn On Signing In
          </button>
        </div>
      </form>

      <div v-else class="section-content">
        <div class="signed-in-row">
          <p class="signed-in">
            Signed in as <strong>{{ user?.username }}</strong>
            <span v-if="isAdmin" class="role-badge">Admin</span>
          </p>
          <div class="user-actions">
            <button
              v-if="!open.password"
              class="btn btn-secondary btn-small"
              @click="open.password = true"
            >
              <i class="fas fa-key"></i> Change Password
            </button>
            <button class="btn btn-secondary btn-small" @click="signOut">
              <i class="fas fa-sign-out-alt"></i> Sign Out
            </button>
          </div>
        </div>

        <form v-if="open.password" class="subsection" @submit.prevent="changePassword">
          <h3>Change Password</h3>
          <div class="form-group">
            <label for="currentPassword">Current password</label>
            <input
              id="currentPassword"
              v-model="passwordForm.current"
              type="password"
              class="text-input"
              autocomplete="current-password"
            />
          </div>
          <div class="form-group">
            <label for="newPassword">New password</label>
            <input
              id="newPassword"
              v-model="passwordForm.password"
              type="password"
              class="text-input"
              autocomplete="new-password"
            />
          </div>
          <div class="form-group">
            <label for="confirmPassword">Confirm new password</label>
            <input
              id="confirmPassword"
              v-model="passwordForm.confirmation"
              type="password"
              class="text-input"
              autocomplete="new-password"
            />
          </div>
          <p class="help-text">Changing your password signs you out everywhere else.</p>
          <div class="actions">
            <button type="button" class="btn btn-secondary" @click="open.password = false">
              Cancel
            </button>
            <button
              type="submit"
              class="btn btn-primary"
              :disabled="busy || !passwordForm.current || !passwordForm.password"
            >
              Change Password
            </button>
          </div>
        </form>

        <div v-if="isAdmin && users.length <= 1 && !open.disable" class="signed-in-row">
          <p class="help-text">While you're the only user, signing in can be turned off again.</p>
          <button class="btn btn-secondary btn-small" @click="open.disable = true">
            Turn Off Signing In
          </button>
        </div>
        <form
          v-else-if="isAdmin && users.length <= 1"
          class="subsection"
          @submit.prevent="disableSignIn"
        >
          <h3>Turn Off Signing In</h3>
          <p class="help-text">
            Writers Guild will be open to anyone who can reach it again, as your library.
          </p>
          <div class="form-group">
            <label for="disablePassword">Your password</label>
            <input
              id="disablePassword"
              v-model="disablePassword"
              type="password"
              class="text-input"
              autocomplete="current-password"
            />
          </div>
          <div class="actions">
            <button type="button" class="btn btn-secondary" @click="open.disable = false">
              Cancel
            </button>
            <button type="submit" class="btn btn-danger" :disabled="busy || !disablePassword">
              Turn Off Signing In
            </button>
          </div>
        </form>
      </div>
    </section>

    <!-- Users Section: the admin's, once signing in is on -->
    <section v-if="authEnabled && isAdmin" class="edit-section">
      <div class="section-header">
        <h2>Users</h2>
        <button class="btn btn-primary btn-small" :disabled="busy" @click="invite">
          <i class="fas fa-user-plus"></i> Invite Someone
        </button>
      </div>
      <div class="section-content">
        <p class="help-text">
          There's no signing up: people join with an invitation link from you. Each person's
          stories, characters, lorebooks and presets, API keys included, are theirs alone.
        </p>

        <div v-if="newLink" class="link-box">
          <p class="link-label">{{ newLink.label }}</p>
          <div class="link-row">
            <input
              ref="linkInput"
              class="text-input"
              type="text"
              readonly
              :value="newLink.url"
              @focus="$event.target.select()"
            />
            <button class="btn btn-secondary" @click="copyLink">
              <i class="fas fa-copy"></i> Copy
            </button>
          </div>
          <p class="help-text">
            Copy it now: it won't be shown again. It works once, until
            {{ formatDate(newLink.expires) }}.
          </p>
        </div>

        <ul class="user-list">
          <li v-for="account in users" :key="account.id" class="user-row">
            <div class="user-info">
              <span class="user-name">{{ account.username }}</span>
              <span v-if="account.role === 'admin'" class="role-badge">Admin</span>
              <span class="user-meta">Joined {{ formatDate(account.created) }}</span>
            </div>
            <div v-if="account.id !== user?.id" class="user-actions">
              <button
                class="btn btn-secondary btn-small"
                :disabled="busy"
                @click="makeResetLink(account)"
              >
                <i class="fas fa-key"></i> Reset Password
              </button>
              <button
                class="btn btn-danger btn-small"
                :disabled="busy"
                @click="deleteUser(account)"
              >
                <i class="fas fa-trash"></i> Delete
              </button>
            </div>
          </li>
        </ul>

        <div v-if="invitations.length" class="subsection">
          <h3>Waiting Invitations</h3>
          <ul class="user-list">
            <li v-for="invitation in invitations" :key="invitation.id" class="user-row">
              <div class="user-info">
                <span class="user-meta">
                  Made {{ formatDate(invitation.created) }}, works until
                  {{ formatDate(invitation.expires) }}
                </span>
              </div>
              <button
                class="btn btn-secondary btn-small"
                :disabled="busy"
                @click="revoke(invitation)"
              >
                Take Back
              </button>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { nextTick, onMounted, reactive, ref } from 'vue';
import { authAPI, usersAPI, linkURL } from '../../services/authApi';
import { useAuth } from '../../composables/useAuth';
import { useConfirm } from '../../composables/useConfirm';
import { useToast } from '../../composables/useToast';

const { authEnabled, user, isAdmin, setStatus, signOut, reloadAt } = useAuth();
const { confirm } = useConfirm();
const toast = useToast();

const busy = ref(false);
const users = ref([]);
const invitations = ref([]);
const newLink = ref(null);
const linkInput = ref(null);
const enableForm = reactive({ username: '', password: '', confirmation: '' });
const passwordForm = reactive({ current: '', password: '', confirmation: '' });
const disablePassword = ref('');
// Which forms are showing
const open = reactive({ enable: false, password: false, disable: false });

onMounted(loadUsers);

async function loadUsers() {
  if (!authEnabled.value || !isAdmin.value) return;
  try {
    const [userList, invitationList] = await Promise.all([
      usersAPI.list(),
      usersAPI.listInvitations(),
    ]);
    users.value = userList.users;
    invitations.value = invitationList.invitations;
  } catch (error) {
    toast.error('Failed to load users: ' + error.message);
  }
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Run a change, showing its error if it fails. */
async function act(fn) {
  busy.value = true;
  try {
    await fn();
  } catch (error) {
    toast.error(error.message);
  } finally {
    busy.value = false;
  }
}

function enableSignIn() {
  if (enableForm.password !== enableForm.confirmation) {
    toast.error("The passwords don't match");
    return;
  }
  return act(async () => {
    const status = await authAPI.enable(enableForm.username, enableForm.password);
    setStatus(status);
    enableForm.password = enableForm.confirmation = '';
    toast.success('Signing in is on');
    await loadUsers();
  });
}

function changePassword() {
  if (passwordForm.password !== passwordForm.confirmation) {
    toast.error("The passwords don't match");
    return;
  }
  return act(async () => {
    await authAPI.changePassword(passwordForm.current, passwordForm.password);
    passwordForm.current = passwordForm.password = passwordForm.confirmation = '';
    open.password = false;
    toast.success('Password changed');
  });
}

async function disableSignIn() {
  const confirmed = await confirm({
    message:
      'Turn off signing in? Anyone who can reach Writers Guild will be able to use it, as you.',
    confirmText: 'Turn Off',
    variant: 'danger',
  });
  if (!confirmed) return;
  return act(async () => {
    await authAPI.disable(disablePassword.value);
    reloadAt('/settings');
  });
}

function showLink(label, link) {
  newLink.value = { label, url: linkURL(link.path), expires: link.expires };
  nextTick(() => linkInput.value?.select());
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(newLink.value.url);
    toast.success('Link copied');
  } catch {
    // The clipboard needs HTTPS or localhost; the link is selected to copy by hand instead.
    linkInput.value?.select();
    toast.info('Press Ctrl+C or Cmd+C to copy the selected link');
  }
}

function invite() {
  return act(async () => {
    const { invitation } = await usersAPI.invite();
    showLink('Send this link to the person you want to invite:', invitation);
    await loadUsers();
  });
}

function makeResetLink(account) {
  return act(async () => {
    const { link } = await usersAPI.resetLink(account.id);
    showLink(`Send this link to ${account.username} to choose a new password:`, link);
  });
}

function revoke(invitation) {
  return act(async () => {
    await usersAPI.deleteInvitation(invitation.id);
    await loadUsers();
  });
}

async function deleteUser(account) {
  const confirmed = await confirm({
    message: `Delete ${account.username}'s account? Their stories, characters, lorebooks, chats and presets are deleted with it, and can't be brought back.`,
    confirmText: 'Delete Account',
    variant: 'danger',
  });
  if (!confirmed) return;
  return act(async () => {
    await usersAPI.delete(account.id);
    toast.success(`Deleted ${account.username}`);
    await loadUsers();
  });
}
</script>

<style scoped>
.account-settings {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.edit-section {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background-color: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}

.section-header h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.section-content {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.subsection {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--border-color);
}

.subsection h3 {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.text-input {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.5;
  outline: none;
}

.text-input:focus {
  border-color: var(--accent-primary);
}

.help-text {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.signed-in-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}

.signed-in {
  margin: 0;
  color: var(--text-primary);
}

.role-badge {
  margin-left: 0.5rem;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  background-color: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
}

.link-box {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  border: 1px solid var(--accent-primary);
  border-radius: 6px;
}

.link-label {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.link-row {
  display: flex;
  gap: 0.5rem;
}

.link-row .text-input {
  font-family: monospace;
  font-size: 0.85rem;
}

.user-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.user-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--border-color);
}

.user-row:last-child {
  border-bottom: none;
}

.user-info {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.user-name {
  font-weight: 600;
  color: var(--text-primary);
}

.user-meta {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.user-actions {
  display: flex;
  gap: 0.5rem;
}
</style>
