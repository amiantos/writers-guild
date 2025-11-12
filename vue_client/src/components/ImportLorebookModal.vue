<template>
  <Modal title="Import Lorebook" @close="$emit('close')">
    <div class="import-content">
      <!-- Import from JSON File -->
      <section class="import-section">
        <h3><i class="fas fa-file-code"></i> Import from JSON</h3>
        <p class="help-text">Upload a lorebook JSON file</p>
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          @change="handleFileSelect"
          class="file-input"
        />
        <button
          class="btn btn-primary full-width"
          :disabled="!selectedFile || importing"
          @click="importFromJSON"
        >
          <i class="fas fa-upload"></i>
          {{ importing ? 'Importing...' : 'Import JSON' }}
        </button>
      </section>

      <div class="divider">
        <span>OR</span>
      </div>

      <!-- Import from URL -->
      <section class="import-section">
        <h3><i class="fas fa-link"></i> Import from URL</h3>
        <p class="help-text">Paste a URL to a lorebook JSON file</p>
        <input
          v-model="lorebookUrl"
          type="text"
          class="text-input"
          placeholder="https://example.com/lorebook.json"
          @keydown.enter="importFromURL"
        />
        <button
          class="btn btn-primary full-width"
          :disabled="!lorebookUrl.trim() || importing"
          @click="importFromURL"
        >
          <i class="fas fa-download"></i>
          {{ importing ? 'Importing...' : 'Import from URL' }}
        </button>
      </section>
    </div>
  </Modal>
</template>

<script setup>
import { ref } from 'vue'
import Modal from './Modal.vue'
import { lorebooksAPI } from '../services/api'
import { useToast } from '../composables/useToast'

const emit = defineEmits(['close', 'imported'])
const toast = useToast()

const selectedFile = ref(null)
const fileInput = ref(null)
const lorebookUrl = ref('')
const importing = ref(false)

function handleFileSelect(event) {
  const file = event.target.files[0]
  if (file) {
    selectedFile.value = file
  }
}

async function importFromJSON() {
  if (!selectedFile.value || importing.value) return

  try {
    importing.value = true
    const result = await lorebooksAPI.importJSON(selectedFile.value)

    toast.success(`Successfully imported "${result.name}"!`)
    emit('imported', result)
    emit('close')
  } catch (error) {
    console.error('Failed to import lorebook:', error)
    toast.error('Failed to import lorebook: ' + error.message)
  } finally {
    importing.value = false
  }
}

async function importFromURL() {
  if (!lorebookUrl.value.trim() || importing.value) return

  try {
    importing.value = true
    const result = await lorebooksAPI.importFromURL(lorebookUrl.value.trim())

    toast.success(`Successfully imported "${result.name}"!`)
    emit('imported', result)
    emit('close')
  } catch (error) {
    console.error('Failed to import from URL:', error)
    toast.error('Failed to import lorebook: ' + error.message)
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.import-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.import-section {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.import-section h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.help-text {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.file-input {
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
}

.file-input:hover {
  border-color: var(--accent-primary);
}

.text-input {
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

.text-input:focus {
  border-color: var(--accent-primary);
}

.full-width {
  width: 100%;
}

.divider {
  display: flex;
  align-items: center;
  text-align: center;
  margin: 0.5rem 0;
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  border-bottom: 1px solid var(--border-color);
}

.divider span {
  padding: 0 1rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
}
</style>
