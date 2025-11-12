<template>
  <div class="lorebook-detail-page">
    <!-- Header -->
    <header class="detail-header">
      <div class="header-left">
        <button class="btn btn-secondary btn-small" @click="goBack()">
          <i class="fas fa-arrow-left"></i> Back
        </button>
        <h1 class="lorebook-title">{{ lorebook?.name || 'Loading...' }}</h1>
      </div>
      <div class="header-right">
        <button class="btn btn-danger btn-small" @click="deleteLorebook">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </header>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>Loading lorebook...</p>
    </div>

    <!-- Main Content -->
    <div v-else-if="lorebook" class="detail-content">
      <div class="sections-container">
        <!-- Name Section -->
        <section class="edit-section">
          <div class="section-header">
            <h2>Name</h2>
            <button
              v-if="!editingName"
              class="btn btn-small btn-secondary"
              @click="startEdit('name')"
            >
              <i class="fas fa-edit"></i> Edit
            </button>
          </div>
          <div v-if="editingName" class="section-content editing">
            <input
              v-model="editedName"
              type="text"
              class="text-input"
              placeholder="Lorebook name..."
            />
            <div class="section-actions">
              <button class="btn btn-secondary" @click="cancelEdit('name')">
                Cancel
              </button>
              <button
                class="btn btn-primary"
                :disabled="!editedName.trim()"
                @click="saveName"
              >
                <i class="fas fa-save"></i> Save
              </button>
            </div>
          </div>
          <div v-else class="section-content">
            <p class="section-display">{{ lorebook.name || 'No name set' }}</p>
          </div>
        </section>

        <!-- Description Section -->
        <section class="edit-section">
          <div class="section-header">
            <h2>Description</h2>
            <button
              v-if="!editingDescription"
              class="btn btn-small btn-secondary"
              @click="startEdit('description')"
            >
              <i class="fas fa-edit"></i> Edit
            </button>
          </div>
          <div v-if="editingDescription" class="section-content editing">
            <textarea
              v-model="editedDescription"
              class="textarea-input"
              placeholder="Optional description for this lorebook..."
              rows="4"
            ></textarea>
            <div class="section-actions">
              <button class="btn btn-secondary" @click="cancelEdit('description')">
                Cancel
              </button>
              <button class="btn btn-primary" @click="saveDescription">
                <i class="fas fa-save"></i> Save
              </button>
            </div>
          </div>
          <div v-else class="section-content">
            <p class="section-display">
              {{ lorebook.description || 'No description set' }}
            </p>
          </div>
        </section>

        <!-- Entries Section -->
        <section class="edit-section">
          <div class="section-header">
            <h2>Entries</h2>
            <button
              class="btn btn-small btn-primary"
              @click="addEntry"
            >
              <i class="fas fa-plus"></i> Add Entry
            </button>
          </div>
          <div class="section-content">
            <p class="help-text">
              Lorebook entries are automatically injected into story context when their keywords are detected.
            </p>

            <div v-if="!lorebook.entries || lorebook.entries.length === 0" class="empty-entries">
              <p>No entries yet. Add one to get started!</p>
            </div>

            <div v-else class="entries-list">
              <div
                v-for="entry in sortedEntries"
                :key="entry.id"
                class="entry-card"
              >
                <div class="entry-header">
                  <span class="entry-comment">{{ entry.comment || 'Untitled Entry' }}</span>
                  <div class="entry-actions">
                    <button
                      class="btn btn-small btn-secondary"
                      @click="editEntry(entry)"
                    >
                      <i class="fas fa-edit"></i> Edit
                    </button>
                  </div>
                </div>

                <div class="entry-body">
                  <div class="entry-keys">
                    <strong>Keys:</strong> {{ entry.keys.join(', ') }}
                  </div>
                  <div class="entry-content-preview">
                    {{ getContentPreview(entry.content) }}
                  </div>
                  <div class="entry-badges">
                    <span v-if="!entry.enabled" class="badge badge-disabled">Disabled</span>
                    <span v-if="entry.constant" class="badge badge-constant">Always Active</span>
                    <span v-if="entry.useRegex" class="badge badge-regex">Regex</span>
                    <span v-if="entry.useProbability" class="badge badge-probability">{{ entry.probability }}%</span>
                    <span v-if="entry.group" class="badge badge-group">Group: {{ entry.group }}</span>
                    <span class="badge badge-order">Order: {{ entry.insertionOrder }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- Error State -->
    <div v-else class="error-container">
      <i class="fas fa-exclamation-triangle"></i>
      <p>Failed to load lorebook</p>
    </div>

    <!-- Entry Editor Modal -->
    <EntryEditorModal
      v-if="showEntryEditor"
      :lorebook-id="lorebookId"
      :entry="currentEntry"
      @close="closeEntryEditor"
      @saved="handleEntrySaved"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { lorebooksAPI } from '../services/api'
import { useToast } from '../composables/useToast'
import { useNavigation } from '../composables/useNavigation'
import { useConfirm } from '../composables/useConfirm'
import { setPageTitle } from '../router'
import EntryEditorModal from '../components/EntryEditorModal.vue'

const props = defineProps({
  lorebookId: {
    type: String,
    required: true
  }
})

const router = useRouter()
const toast = useToast()
const { goBack } = useNavigation()
const { confirm } = useConfirm()

// State
const loading = ref(true)
const lorebook = ref(null)

// Editing states
const editingName = ref(false)
const editingDescription = ref(false)

// Edited values
const editedName = ref('')
const editedDescription = ref('')

// Entry editor state
const showEntryEditor = ref(false)
const currentEntry = ref(null)

// Load lorebook data
onMounted(async () => {
  await loadLorebook()
})

async function loadLorebook() {
  try {
    loading.value = true
    const response = await lorebooksAPI.get(props.lorebookId)
    lorebook.value = {
      id: props.lorebookId,
      name: response.lorebook.name,
      description: response.lorebook.description || '',
      entries: response.lorebook.entries || []
    }
    // Update page title with lorebook name
    setPageTitle(lorebook.value.name || 'Lorebook')
  } catch (error) {
    console.error('Failed to load lorebook:', error)
    toast.error('Failed to load lorebook: ' + error.message)
  } finally {
    loading.value = false
  }
}

const sortedEntries = computed(() => {
  if (!lorebook.value?.entries) return []
  // Sort by insertion order (descending) for display
  return [...lorebook.value.entries].sort((a, b) => b.insertionOrder - a.insertionOrder)
})

function startEdit(section) {
  if (section === 'name') {
    editedName.value = lorebook.value.name || ''
    editingName.value = true
  } else if (section === 'description') {
    editedDescription.value = lorebook.value.description || ''
    editingDescription.value = true
  }
}

function cancelEdit(section) {
  if (section === 'name') {
    editingName.value = false
    editedName.value = ''
  } else if (section === 'description') {
    editingDescription.value = false
    editedDescription.value = ''
  }
}

async function saveName() {
  try {
    await lorebooksAPI.update(props.lorebookId, {
      name: editedName.value.trim()
    })
    lorebook.value.name = editedName.value.trim()
    editingName.value = false
    editedName.value = ''
    // Update page title with new name
    setPageTitle(lorebook.value.name)
  } catch (error) {
    console.error('Failed to update name:', error)
    toast.error('Failed to update name: ' + error.message)
  }
}

async function saveDescription() {
  try {
    await lorebooksAPI.update(props.lorebookId, {
      description: editedDescription.value
    })
    lorebook.value.description = editedDescription.value
    editingDescription.value = false
    editedDescription.value = ''
  } catch (error) {
    console.error('Failed to update description:', error)
    toast.error('Failed to update description: ' + error.message)
  }
}

async function deleteLorebook() {
  const confirmed = await confirm({
    message: `Are you sure you want to delete "${lorebook.value.name}"? This cannot be undone.`,
    confirmText: 'Delete Lorebook',
    variant: 'danger'
  })

  if (!confirmed) return

  try {
    await lorebooksAPI.delete(props.lorebookId)
    toast.success('Lorebook deleted successfully')
    router.push('/')
  } catch (error) {
    console.error('Failed to delete lorebook:', error)
    toast.error('Failed to delete lorebook: ' + error.message)
  }
}

function getContentPreview(content) {
  if (!content) return 'No content'
  return content.length > 100 ? content.substring(0, 100) + '...' : content
}

function addEntry() {
  currentEntry.value = null
  showEntryEditor.value = true
}

function editEntry(entry) {
  currentEntry.value = entry
  showEntryEditor.value = true
}

function closeEntryEditor() {
  showEntryEditor.value = false
  currentEntry.value = null
}

async function handleEntrySaved() {
  closeEntryEditor()
  await loadLorebook()
}
</script>

<style scoped>
.lorebook-detail-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--bg-primary);
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.lorebook-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.loading-container,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
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

.error-container i {
  font-size: 3rem;
  color: var(--danger);
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
}

.sections-container {
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.edit-section {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background-color: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}

.section-header h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.section-content {
  padding: 1.5rem;
}

.section-content.editing {
  background-color: var(--bg-primary);
}

.section-display {
  margin: 0;
  color: var(--text-primary);
  white-space: pre-wrap;
  line-height: 1.6;
}

.help-text {
  margin: 0 0 1rem 0;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  border-left: 3px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
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
  margin-bottom: 1rem;
}

.text-input:focus,
.textarea-input:focus {
  border-color: var(--accent-primary);
}

.textarea-input {
  resize: vertical;
  min-height: 80px;
}

.section-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

/* Entries Styles */
.empty-entries {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
  font-style: italic;
}

.empty-entries p {
  margin: 0;
}

.entries-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.entry-card {
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  overflow: hidden;
}

.entry-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background-color: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
}

.entry-comment {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.entry-actions {
  display: flex;
  gap: 0.5rem;
}

.entry-body {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.entry-keys {
  color: var(--text-primary);
  font-size: 0.9rem;
}

.entry-keys strong {
  color: var(--text-secondary);
}

.entry-content-preview {
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.entry-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.badge {
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
}

.badge-disabled {
  background-color: #6c757d;
  color: white;
}

.badge-constant {
  background-color: #17a2b8;
  color: white;
}

.badge-regex {
  background-color: #ffc107;
  color: #000;
}

.badge-probability {
  background-color: #28a745;
  color: white;
}

.badge-group {
  background-color: #6f42c1;
  color: white;
}

.badge-order {
  background-color: var(--bg-primary);
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}
</style>
