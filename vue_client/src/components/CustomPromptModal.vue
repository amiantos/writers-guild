<template>
  <Modal title="Continue with Instruction" @close="$emit('close')">
    <div class="content-wrapper">
      <p class="instruction-text">
        Enter an instruction to guide the AI's generation. For example:
        "Add more dialogue" or "Describe the setting in detail".
      </p>

      <textarea
        ref="inputRef"
        v-model="instruction"
        class="instruction-input"
        placeholder="Enter your instruction here..."
        rows="5"
        @keydown.enter.ctrl="handleGenerate"
      ></textarea>

      <div class="modal-actions">
        <button class="btn btn-secondary" @click="$emit('close')">
          Cancel
        </button>
        <button
          class="btn btn-primary"
          :disabled="!instruction.trim()"
          @click="handleGenerate"
        >
          <i class="fas fa-wand-magic-sparkles"></i> Generate
        </button>
      </div>

      <div class="hint">
        <i class="fas fa-lightbulb"></i>
        Press Ctrl+Enter to generate
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import Modal from './Modal.vue'

const emit = defineEmits(['close', 'generate'])

const instruction = ref('')
const inputRef = ref(null)

onMounted(() => {
  // Focus the input when modal opens
  if (inputRef.value) {
    inputRef.value.focus()
  }
})

function handleGenerate() {
  const trimmed = instruction.value.trim()
  if (trimmed) {
    emit('generate', trimmed)
    emit('close')
  }
}
</script>

<style scoped>
.content-wrapper {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.instruction-text {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.instruction-input {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}

.instruction-input:focus {
  border-color: var(--accent-primary);
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.hint {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-style: italic;
}

.hint i {
  color: var(--accent-primary);
}
</style>
