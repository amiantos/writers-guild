<template>
  <Modal
    :title="isNewEntry ? 'Add Lorebook Entry' : 'Edit Lorebook Entry'"
    :close-on-overlay-click="false"
    @close="$emit('close')"
  >
    <div class="entry-editor-content">
      <!-- Entry Name/Comment -->
      <div class="form-group">
        <label for="entryComment">Entry Name/Comment</label>
        <input
          id="entryComment"
          ref="commentInput"
          v-model="formData.comment"
          type="text"
          class="text-input"
          placeholder="For reference (e.g., 'Dragon Lore', 'Magic System')..."
        />
      </div>

      <!-- Primary Keywords -->
      <div class="form-group">
        <label for="entryKeys">Primary Keywords *</label>
        <input
          id="entryKeys"
          v-model="keysInput"
          type="text"
          class="text-input"
          placeholder="dragon, wyrm, dragonkind"
        />
        <p class="field-help">
          Entry activates when any of these keywords appear in recent story content.
        </p>
      </div>

      <!-- Content -->
      <div class="form-group">
        <label for="entryContent">Content *</label>
        <textarea
          id="entryContent"
          v-model="formData.content"
          class="textarea-input"
          placeholder="The lorebook entry content that will be injected into context..."
          rows="8"
        ></textarea>
        <p class="field-help" v-pre>
          Supports macros: {{random:a,b,c}}, {{pick:x,y,z}}, {{roll:d20}}, {{user}}, {{char}}
        </p>
      </div>

      <!-- Insertion Order -->
      <div class="form-group">
        <label for="insertionOrder">Insertion Order (Priority)</label>
        <input
          id="insertionOrder"
          v-model.number="formData.insertionOrder"
          type="number"
          class="text-input"
          min="0"
          max="1000"
        />
        <p class="field-help">
          Higher values = more influence. Lower priority entries discarded first if token budget exceeded. (0-1000, default: 100)
        </p>
      </div>

      <!-- Toggle Options -->
      <div class="form-group">
        <label class="section-label">Options</label>
        <div class="toggle-grid">
          <label class="checkbox-label">
            <input type="checkbox" v-model="formData.enabled" />
            <span>Enabled</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="formData.constant" />
            <span>Always Active</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="formData.caseSensitive" />
            <span>Case Sensitive</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="formData.matchWholeWords" />
            <span>Match Whole Words</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="formData.useRegex" />
            <span>Use Regex</span>
          </label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="formData.preventRecursion" />
            <span>Prevent Recursion</span>
          </label>
        </div>
      </div>

      <!-- Advanced Options (Collapsible) -->
      <details class="advanced-section">
        <summary class="advanced-summary">Advanced Options</summary>
        <div class="advanced-content">
          <!-- Secondary Keywords -->
          <div class="form-group">
            <label for="secondaryKeys">Secondary Keywords</label>
            <input
              id="secondaryKeys"
              v-model="secondaryKeysInput"
              type="text"
              class="text-input"
              placeholder="fire, flame, breath"
            />
          </div>

          <!-- Secondary Key Logic -->
          <div class="form-group">
            <label for="selectiveLogic">Secondary Key Logic</label>
            <select
              id="selectiveLogic"
              v-model.number="formData.selectiveLogic"
              class="select-input"
            >
              <option :value="0">AND ANY (primary + at least one secondary)</option>
              <option :value="1">NOT ANY (primary but NO secondary)</option>
              <option :value="2">NOT ALL (primary but NOT all secondary)</option>
              <option :value="3">AND ALL (primary + all secondary)</option>
            </select>
          </div>

          <!-- Probability -->
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" v-model="formData.useProbability" />
              <span>Enable Probability Check</span>
            </label>
          </div>

          <div v-if="formData.useProbability" class="form-group">
            <label for="probability">Activation Probability (%)</label>
            <input
              id="probability"
              v-model.number="formData.probability"
              type="number"
              class="text-input"
              min="0"
              max="100"
            />
            <p class="field-help">
              Chance to activate when keywords match (0-100%). Use &lt;100 for random events.
            </p>
          </div>

          <!-- Inclusion Group -->
          <div class="form-group">
            <label for="group">Inclusion Group</label>
            <input
              id="group"
              v-model="formData.group"
              type="text"
              class="text-input"
              placeholder="e.g., 'weather', 'combat'"
            />
            <p class="field-help">
              Entries with same group name: only ONE will activate randomly.
            </p>
          </div>
        </div>
      </details>
    </div>

    <template #footer>
      <div class="footer-content">
        <button
          v-if="!isNewEntry"
          class="btn btn-danger"
          @click="deleteEntry"
        >
          <i class="fas fa-trash"></i> Delete
        </button>
        <div class="footer-right">
          <button class="btn btn-secondary" @click="$emit('close')">
            Cancel
          </button>
          <button
            class="btn btn-primary"
            :disabled="!canSave || saving"
            @click="saveEntry"
          >
            <i class="fas fa-save"></i>
            {{ saving ? 'Saving...' : 'Save Entry' }}
          </button>
        </div>
      </div>
    </template>
  </Modal>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import Modal from './Modal.vue'
import { lorebooksAPI } from '../services/api'
import { useToast } from '../composables/useToast'
import { useConfirm } from '../composables/useConfirm'

const props = defineProps({
  lorebookId: {
    type: String,
    required: true
  },
  entry: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close', 'saved'])
const toast = useToast()
const { confirm } = useConfirm()

const commentInput = ref(null)
const saving = ref(false)

// Form data with defaults
const formData = ref({
  comment: '',
  content: '',
  insertionOrder: 100,
  enabled: true,
  constant: false,
  caseSensitive: false,
  matchWholeWords: false,
  useRegex: false,
  preventRecursion: false,
  selectiveLogic: 0,
  probability: 100,
  useProbability: false,
  group: ''
})

// Comma-separated string inputs
const keysInput = ref('')
const secondaryKeysInput = ref('')

const isNewEntry = computed(() => !props.entry)

const canSave = computed(() => {
  return keysInput.value.trim() !== '' && formData.value.content.trim() !== ''
})

onMounted(() => {
  if (props.entry) {
    // Load existing entry data
    formData.value = {
      comment: props.entry.comment || '',
      content: props.entry.content || '',
      insertionOrder: props.entry.insertionOrder ?? 100,
      enabled: props.entry.enabled ?? true,
      constant: props.entry.constant ?? false,
      caseSensitive: props.entry.caseSensitive ?? false,
      matchWholeWords: props.entry.matchWholeWords ?? false,
      useRegex: props.entry.useRegex ?? false,
      preventRecursion: props.entry.preventRecursion ?? false,
      selectiveLogic: props.entry.selectiveLogic ?? 0,
      probability: props.entry.probability ?? 100,
      useProbability: props.entry.useProbability ?? false,
      group: props.entry.group || ''
    }
    keysInput.value = (props.entry.keys || []).join(', ')
    secondaryKeysInput.value = (props.entry.secondaryKeys || []).join(', ')
  }

  // Focus first input when modal opens
  if (commentInput.value) {
    commentInput.value.focus()
  }
})

function parseKeywords(input) {
  if (!input.trim()) return []
  return input.split(',').map(k => k.trim()).filter(k => k.length > 0)
}

async function saveEntry() {
  if (!canSave.value || saving.value) return

  try {
    saving.value = true

    const keys = parseKeywords(keysInput.value)
    const secondaryKeys = parseKeywords(secondaryKeysInput.value)

    const entryData = {
      comment: formData.value.comment,
      keys: keys,
      secondaryKeys: secondaryKeys,
      content: formData.value.content,
      insertionOrder: formData.value.insertionOrder,
      enabled: formData.value.enabled,
      constant: formData.value.constant,
      caseSensitive: formData.value.caseSensitive,
      matchWholeWords: formData.value.matchWholeWords,
      useRegex: formData.value.useRegex,
      preventRecursion: formData.value.preventRecursion,
      selective: secondaryKeys.length > 0,
      selectiveLogic: formData.value.selectiveLogic,
      probability: formData.value.probability,
      useProbability: formData.value.useProbability,
      group: formData.value.group
    }

    if (isNewEntry.value) {
      await lorebooksAPI.addEntry(props.lorebookId, entryData)
      toast.success('Entry created successfully!')
    } else {
      await lorebooksAPI.updateEntry(props.lorebookId, props.entry.id, entryData)
      toast.success('Entry updated successfully!')
    }

    emit('saved')
  } catch (error) {
    console.error('Failed to save entry:', error)
    toast.error('Failed to save entry: ' + error.message)
  } finally {
    saving.value = false
  }
}

async function deleteEntry() {
  const confirmed = await confirm({
    message: 'Delete this entry? This cannot be undone.',
    confirmText: 'Delete Entry',
    variant: 'danger'
  })

  if (!confirmed) return

  try {
    await lorebooksAPI.deleteEntry(props.lorebookId, props.entry.id)
    toast.success('Entry deleted successfully!')
    emit('saved')
  } catch (error) {
    console.error('Failed to delete entry:', error)
    toast.error('Failed to delete entry: ' + error.message)
  }
}
</script>

<style scoped>
.entry-editor-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  max-height: 70vh;
  overflow-y: auto;
  padding-right: 0.5rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label,
.section-label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.text-input,
.textarea-input,
.select-input {
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
.textarea-input:focus,
.select-input:focus {
  border-color: var(--accent-primary);
}

.textarea-input {
  resize: vertical;
  min-height: 100px;
}

.select-input {
  cursor: pointer;
}

.field-help {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

/* Toggle Grid */
.toggle-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  border-radius: 4px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  color: var(--text-primary);
  font-weight: normal;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.checkbox-label span {
  font-size: 0.9rem;
}

/* Advanced Section */
.advanced-section {
  margin-top: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  overflow: hidden;
}

.advanced-summary {
  padding: 0.75rem 1rem;
  background-color: var(--bg-tertiary);
  cursor: pointer;
  font-weight: 600;
  color: var(--text-primary);
  list-style: none;
  user-select: none;
}

.advanced-summary::-webkit-details-marker {
  display: none;
}

.advanced-summary::before {
  content: '▶ ';
  display: inline-block;
  margin-right: 0.5rem;
  transition: transform 0.2s;
}

.advanced-section[open] .advanced-summary::before {
  transform: rotate(90deg);
}

.advanced-summary:hover {
  background-color: var(--bg-primary);
}

.advanced-content {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  background-color: var(--bg-secondary);
}

/* Footer */
.footer-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.footer-right {
  display: flex;
  gap: 0.75rem;
}
</style>
