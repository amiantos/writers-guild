<template>
  <Modal title="AI Ideation" max-width="800px" @close="$emit('close')">
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>{{ status }}</p>
    </div>

    <div v-else class="ideation-content">
      <div v-if="response" class="response-display">
        {{ response }}
      </div>
      <div v-else class="no-response">
        No response generated yet.
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">
        Close
      </button>
    </template>
  </Modal>
</template>

<script setup>
import Modal from './Modal.vue'

defineProps({
  response: {
    type: String,
    default: ''
  },
  loading: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    default: 'Thinking...'
  }
})

defineEmits(['close'])
</script>

<style scoped>
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--border-color);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-container p {
  color: var(--text-secondary);
  margin: 0;
}

.ideation-content {
  min-height: 200px;
}

.response-display {
  padding: 1rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  white-space: pre-wrap;
  word-wrap: break-word;
  line-height: 1.6;
  color: var(--text-primary);
  max-height: 500px;
  overflow-y: auto;
}

.no-response {
  padding: 2rem;
  text-align: center;
  color: var(--text-secondary);
}
</style>
