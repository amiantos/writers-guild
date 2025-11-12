<template>
  <Modal title="Last Prompt" max-width="800px" @close="$emit('close')">
    <div class="prompt-section">
      <h3>System Prompt</h3>
      <div class="prompt-display">
        {{ systemPrompt || 'No system prompt available' }}
      </div>
    </div>

    <div class="prompt-section">
      <h3>User Prompt</h3>
      <div class="prompt-display">
        {{ userPrompt || 'No user prompt available' }}
      </div>
    </div>
  </Modal>
</template>

<script setup>
import Modal from './Modal.vue'

defineProps({
  systemPrompt: {
    type: String,
    default: ''
  },
  userPrompt: {
    type: String,
    default: ''
  }
})

defineEmits(['close'])
</script>

<style scoped>
.prompt-section {
  margin-bottom: 1.5rem;
}

.prompt-section:last-child {
  margin-bottom: 0;
}

.prompt-section h3 {
  margin: 0 0 0.75rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.prompt-display {
  padding: 1rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-secondary);
  max-height: 300px;
  overflow-y: auto;
}
</style>
