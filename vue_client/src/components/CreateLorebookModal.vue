<template>
  <Modal title="Create New Lorebook" :close-on-overlay-click="false" @close="$emit('close')">
    <div class="create-content">
      <div class="form-group">
        <label for="lorebookName">Lorebook Name *</label>
        <input
          id="lorebookName"
          ref="nameInput"
          v-model="lorebookName"
          type="text"
          class="text-input"
          placeholder="Enter lorebook name..."
          @keydown.enter="createLorebook"
        />
      </div>

      <div class="form-group">
        <label for="lorebookDescription">Description</label>
        <textarea
          id="lorebookDescription"
          v-model="lorebookDescription"
          class="textarea-input"
          placeholder="Optional description for this lorebook..."
          rows="3"
        ></textarea>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">
        Cancel
      </button>
      <button
        class="btn btn-primary"
        :disabled="!lorebookName.trim() || creating"
        @click="createLorebook"
      >
        <i class="fas fa-plus"></i>
        {{ creating ? 'Creating...' : 'Create Lorebook' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import Modal from './Modal.vue'
import { lorebooksAPI } from '../services/api'

const emit = defineEmits(['close', 'created'])
const router = useRouter()

const lorebookName = ref('')
const lorebookDescription = ref('')
const creating = ref(false)
const nameInput = ref(null)

onMounted(() => {
  // Focus name input when modal opens
  if (nameInput.value) {
    nameInput.value.focus()
  }
})

async function createLorebook() {
  if (!lorebookName.value.trim() || creating.value) return

  try {
    creating.value = true

    const result = await lorebooksAPI.create(
      lorebookName.value.trim(),
      lorebookDescription.value.trim()
    )

    alert(`Successfully created "${result.name}"!`)
    emit('created', result)
    emit('close')

    // Navigate to the lorebook editor
    router.push(`/lorebooks/${result.id}`)
  } catch (error) {
    console.error('Failed to create lorebook:', error)
    alert('Failed to create lorebook: ' + error.message)
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
  min-height: 60px;
}
</style>
