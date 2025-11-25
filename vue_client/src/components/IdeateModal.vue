<template>
  <Modal title="AI Ideation" max-width="800px" @close="$emit('close')">
    <!-- Show loading spinner only when loading AND no response yet -->
    <div v-if="loading && !response" class="loading-container">
      <div class="spinner"></div>
      <p>{{ status }}</p>
    </div>

    <!-- Show response (streaming or complete) -->
    <div v-else class="ideation-content">
      <div v-if="response" class="response-display">
        {{ response }}<span v-if="loading" class="cursor"></span>
      </div>
      <div v-else class="no-response">
        No response generated yet.
      </div>
      <!-- Show subtle loading indicator while streaming -->
      <div v-if="loading && response" class="streaming-indicator">
        <span class="streaming-dot"></span>
        {{ status }}
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

.cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background-color: var(--accent-primary);
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.streaming-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  margin-top: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.streaming-dot {
  width: 8px;
  height: 8px;
  background-color: var(--accent-primary);
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1); }
}
</style>
