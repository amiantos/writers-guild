<template>
  <div class="auth-page">
    <form class="auth-card" @submit.prevent="$emit('submit')">
      <div class="auth-icon">
        <i :class="icon"></i>
      </div>
      <h1>{{ title }}</h1>
      <slot />
    </form>
  </div>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  icon: { type: String, default: 'fas fa-book-open' },
});

defineEmits(['submit']);
</script>

<style scoped>
.auth-page {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
  padding: 2rem 1rem;
}

.auth-card {
  background: var(--bg-secondary);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  max-width: 420px;
  width: 100%;
  padding: 2.5rem 2rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.auth-icon {
  font-size: 2.5rem;
  color: var(--accent-primary);
  text-align: center;
}

h1 {
  margin: 0;
  text-align: center;
  font-size: 1.5rem;
  color: var(--text-primary);
}

.auth-card :deep(.description) {
  margin: 0;
  text-align: center;
  color: var(--text-secondary);
  line-height: 1.5;
}

.auth-card :deep(.form-group) {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.auth-card :deep(label) {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.auth-card :deep(input) {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  outline: none;
}

.auth-card :deep(input:focus) {
  border-color: var(--accent-primary);
}

.auth-card :deep(.error-text) {
  margin: 0;
  color: var(--danger);
  font-size: 0.875rem;
  text-align: center;
}

.auth-card :deep(.btn) {
  width: 100%;
  padding: 0.75rem;
  font-size: 1rem;
}
</style>
