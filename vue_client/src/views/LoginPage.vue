<template>
  <AuthLayout title="Sign in to Writers Guild" @submit="signIn">
    <div class="form-group">
      <label for="username">Username</label>
      <input id="username" v-model="username" type="text" autocomplete="username" autofocus />
    </div>
    <div class="form-group">
      <label for="password">Password</label>
      <input id="password" v-model="password" type="password" autocomplete="current-password" />
    </div>
    <p v-if="error" class="error-text">{{ error }}</p>
    <button type="submit" class="btn btn-primary" :disabled="busy || !username || !password">
      {{ busy ? 'Signing in...' : 'Sign In' }}
    </button>
  </AuthLayout>
</template>

<script setup>
import { ref } from 'vue';
import { useRoute } from 'vue-router';
import AuthLayout from '../components/auth/AuthLayout.vue';
import { authAPI } from '../services/authApi';
import { useAuth } from '../composables/useAuth';

const route = useRoute();
const { reloadAt } = useAuth();

const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

/** Where to go once signed in: the page that asked for it, if it's one of ours. */
function destination() {
  const redirect = route.query.redirect;
  return typeof redirect === 'string' && redirect.startsWith('/') && !redirect.startsWith('//')
    ? redirect
    : '/';
}

async function signIn() {
  busy.value = true;
  error.value = '';
  try {
    await authAPI.login(username.value, password.value);
    reloadAt(destination());
  } catch (err) {
    error.value = err.message;
    busy.value = false;
  }
}
</script>
