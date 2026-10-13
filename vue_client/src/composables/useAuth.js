import { computed, ref } from 'vue';
import { authAPI } from '../services/authApi';

// Shared by every component: whether signing in is on, and who's signed in.
const authEnabled = ref(false);
const user = ref(null);
const loaded = ref(false);

let loading = null;

/** Ask the server, once unless `force`. */
function load({ force = false } = {}) {
  if (loaded.value && !force) return Promise.resolve();
  loading ??= authAPI
    .status()
    .then((status) => {
      authEnabled.value = status.authEnabled;
      user.value = status.user;
      loaded.value = true;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/**
 * Start the app over at `path`. Lists of stories, characters and the rest are kept in memory as
 * the app is used, so after signing in or out a fresh load is the sure way to show only the new
 * user's.
 */
function reloadAt(path = '/') {
  window.location.assign(path);
}

export function useAuth() {
  return {
    authEnabled,
    user,
    loaded,
    isAdmin: computed(() => user.value?.role === 'admin'),
    load,
    reloadAt,
    /** Set what the server said after signing in, turning signing in on or off. */
    setStatus(status) {
      if ('authEnabled' in status) authEnabled.value = status.authEnabled;
      if ('user' in status) user.value = status.user;
      loaded.value = true;
    },
    async signOut() {
      await authAPI.logout();
      reloadAt('/login');
    },
  };
}
