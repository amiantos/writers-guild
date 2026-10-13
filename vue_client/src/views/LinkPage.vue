<template>
  <AuthLayout :title="title" :icon="icon" @submit="submit">
    <p v-if="loading" class="description">Checking your link...</p>

    <template v-else-if="!link">
      <p class="description">{{ loadError }}</p>
      <RouterLink to="/login" class="btn btn-secondary">Go to Sign In</RouterLink>
    </template>

    <template v-else>
      <p class="description">
        <template v-if="link.kind === 'invite'">
          You've been invited to Writers Guild. Choose a username and password for your account.
        </template>
        <template v-else>Choose a new password for {{ link.username }}.</template>
      </p>
      <div v-if="link.kind === 'invite'" class="form-group">
        <label for="username">Username</label>
        <input id="username" v-model="username" type="text" autocomplete="username" autofocus />
      </div>
      <div class="form-group">
        <label for="password">{{ link.kind === 'invite' ? 'Password' : 'New password' }}</label>
        <input id="password" v-model="password" type="password" autocomplete="new-password" />
      </div>
      <div class="form-group">
        <label for="confirm">Confirm password</label>
        <input id="confirm" v-model="confirmation" type="password" autocomplete="new-password" />
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <button type="submit" class="btn btn-primary" :disabled="busy || !ready">
        {{ link.kind === 'invite' ? 'Create Account' : 'Set Password' }}
      </button>
    </template>
  </AuthLayout>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import AuthLayout from '../components/auth/AuthLayout.vue';
import { authAPI } from '../services/authApi';
import { useAuth } from '../composables/useAuth';

const props = defineProps({
  token: { type: String, required: true },
});

const { reloadAt } = useAuth();

const link = ref(null);
const loading = ref(true);
const loadError = ref('');
const username = ref('');
const password = ref('');
const confirmation = ref('');
const error = ref('');
const busy = ref(false);

const title = computed(() =>
  link.value?.kind === 'reset' ? 'Reset Your Password' : 'Join Writers Guild',
);
const icon = computed(() => (link.value?.kind === 'reset' ? 'fas fa-key' : 'fas fa-user-plus'));
const ready = computed(
  () => !!password.value && (link.value?.kind !== 'invite' || !!username.value),
);

onMounted(async () => {
  try {
    link.value = await authAPI.getLink(props.token);
  } catch (err) {
    loadError.value = err.message;
  } finally {
    loading.value = false;
  }
});

async function submit() {
  if (!link.value) return;
  if (password.value !== confirmation.value) {
    error.value = "The passwords don't match";
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    await authAPI.useLink(props.token, { username: username.value, password: password.value });
    reloadAt('/');
  } catch (err) {
    error.value = err.message;
    busy.value = false;
  }
}
</script>
