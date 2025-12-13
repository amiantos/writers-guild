<template>
  <Modal title="Rewrite to Third Person?" max-width="500px" @close="handleSkip">
    <div class="prompt-content">
      <p class="prompt-message">
        Would you like to rewrite this text to third-person narrative style?
      </p>
      <p class="prompt-description">
        This will convert the text to third-person past tense, which is the recommended format for story writing in Writers Guild.
      </p>
      <div class="dont-ask-checkbox">
        <input type="checkbox" id="dont-ask-third-person" v-model="dontAskAgain" />
        <label for="dont-ask-third-person">Don't ask me again</label>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="handleSkip">
        Skip
      </button>
      <button class="btn btn-primary" @click="handleRewrite">
        <i class="fas fa-repeat"></i> Rewrite
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref } from 'vue'
import Modal from './Modal.vue'

const DONT_ASK_KEY = 'writers-guild-skip-third-person-prompt'

const emit = defineEmits(['close', 'rewrite', 'skip'])

const dontAskAgain = ref(false)

function savePreference() {
  if (dontAskAgain.value) {
    localStorage.setItem(DONT_ASK_KEY, 'true')
  }
}

function handleSkip() {
  savePreference()
  emit('skip')
  emit('close')
}

function handleRewrite() {
  savePreference()
  emit('rewrite')
  emit('close')
}
</script>

<style scoped>
.prompt-content {
  text-align: center;
}

.prompt-message {
  font-size: 1.1rem;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0 0 0.75rem 0;
}

.prompt-description {
  color: var(--text-secondary);
  margin: 0 0 1.5rem 0;
  line-height: 1.5;
}

.dont-ask-checkbox {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.dont-ask-checkbox input[type="checkbox"] {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
}

.dont-ask-checkbox label {
  cursor: pointer;
}

.dont-ask-checkbox:hover {
  color: var(--text-primary);
}
</style>
