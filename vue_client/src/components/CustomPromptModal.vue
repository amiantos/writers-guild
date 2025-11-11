<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Continue with Instruction</h2>
        <button class="close-btn" @click="$emit('close')">
          <i class="fas fa-xmark"></i>
        </button>
      </div>
      <div class="modal-body">
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
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'

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
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background-color: var(--bg-secondary);
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 1.5rem;
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
