<template>
  <Modal title="Create New Character" :close-on-overlay-click="false" @close="$emit('close')">
    <div class="create-content">
      <div class="form-group">
        <label for="characterName">Character Name *</label>
        <input
          id="characterName"
          ref="nameInput"
          v-model="characterName"
          type="text"
          class="text-input"
          placeholder="Enter character name..."
          @keydown.enter="createCharacter"
        />
      </div>

      <div class="form-group">
        <label for="characterDescription">Description</label>
        <textarea
          id="characterDescription"
          v-model="characterDescription"
          class="textarea-input"
          placeholder="Physical appearance, background, biography..."
          rows="6"
        ></textarea>
      </div>

      <div class="form-group">
        <label for="characterPersonality">Personality</label>
        <textarea
          id="characterPersonality"
          v-model="characterPersonality"
          class="textarea-input"
          placeholder="Personality traits, mannerisms, speech patterns..."
          rows="4"
        ></textarea>
      </div>

      <div class="form-group">
        <label for="characterScenario">Scenario</label>
        <textarea
          id="characterScenario"
          v-model="characterScenario"
          class="textarea-input"
          placeholder="Current situation, setting, context..."
          rows="4"
        ></textarea>
      </div>

      <div class="form-group">
        <label for="characterFirstMessage">First Message</label>
        <textarea
          id="characterFirstMessage"
          v-model="characterFirstMessage"
          class="textarea-input"
          placeholder="Initial greeting or opening scene..."
          rows="4"
        ></textarea>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">
        Cancel
      </button>
      <button
        class="btn btn-primary"
        :disabled="!characterName.trim() || creating"
        @click="createCharacter"
      >
        <i class="fas fa-plus"></i>
        {{ creating ? 'Creating...' : 'Create Character' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import Modal from './Modal.vue'
import { charactersAPI } from '../services/api'

const emit = defineEmits(['close', 'created'])

const characterName = ref('')
const characterDescription = ref('')
const characterPersonality = ref('')
const characterScenario = ref('')
const characterFirstMessage = ref('')
const creating = ref(false)
const nameInput = ref(null)

onMounted(() => {
  // Focus name input when modal opens
  if (nameInput.value) {
    nameInput.value.focus()
  }
})

async function createCharacter() {
  if (!characterName.value.trim() || creating.value) return

  try {
    creating.value = true

    const data = {
      name: characterName.value.trim(),
      description: characterDescription.value.trim(),
      personality: characterPersonality.value.trim(),
      scenario: characterScenario.value.trim(),
      first_mes: characterFirstMessage.value.trim()
    }

    const result = await charactersAPI.create(data)

    alert(`Successfully created "${result.name}"!`)
    emit('created', result)
    emit('close')
  } catch (error) {
    console.error('Failed to create character:', error)
    alert('Failed to create character: ' + error.message)
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.create-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.text-input,
.textarea-input {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.5;
  outline: none;
}

.text-input:focus,
.textarea-input:focus {
  border-color: var(--accent-primary);
}

.textarea-input {
  resize: vertical;
  min-height: 80px;
}
</style>
