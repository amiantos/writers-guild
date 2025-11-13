<template>
  <Modal title="Configuration Preset" maxWidth="600px" @close="$emit('close')">
    <div class="preset-selector-content">
      <!-- Current Selection -->
      <div class="current-preset">
        <h3>Current Preset</h3>
        <p class="help-text">
          <template v-if="currentStoryPresetId">
            This story is using a specific preset. To use the default preset instead, select "Use Default" below.
          </template>
          <template v-else>
            This story is using the default preset. You can override it by selecting a specific preset below.
          </template>
        </p>
      </div>

      <!-- Preset Selection -->
      <div class="form-group">
        <label for="presetSelect">Select Preset</label>
        <select
          id="presetSelect"
          v-model="selectedPresetId"
          class="select-input"
          @change="handlePresetChange"
        >
          <option :value="null">Use Default Preset</option>
          <option
            v-for="preset in presets"
            :key="preset.id"
            :value="preset.id"
          >
            {{ preset.name }} ({{ getProviderDisplayName(preset.provider) }})
          </option>
        </select>
      </div>

      <!-- Selected Preset Info -->
      <div v-if="selectedPreset" class="preset-info">
        <div class="info-row">
          <span class="info-label">Provider:</span>
          <span class="provider-badge" :class="`provider-${selectedPreset.provider}`">
            {{ getProviderDisplayName(selectedPreset.provider) }}
          </span>
        </div>
        <div v-if="selectedPreset.apiConfig?.model" class="info-row">
          <span class="info-label">Model:</span>
          <span>{{ selectedPreset.apiConfig.model }}</span>
        </div>
        <div v-if="selectedPreset.apiConfig?.models && selectedPreset.apiConfig.models.length > 0" class="info-row">
          <span class="info-label">Models:</span>
          <span>{{ selectedPreset.apiConfig.models.length }} selected</span>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="action-buttons">
        <button
          class="btn btn-secondary"
          @click="editSelectedPreset"
        >
          <i class="fas fa-edit"></i>
          Edit This Preset
        </button>
        <button
          class="btn btn-secondary"
          @click="manageAllPresets"
        >
          <i class="fas fa-cog"></i>
          Manage All Presets
        </button>
      </div>
    </div>

    <!-- Preset Editor Modal -->
    <PresetEditorModal
      v-if="showPresetEditor && editingPreset"
      :preset="editingPreset"
      @close="closePresetEditor"
      @saved="handlePresetSaved"
    />

    <!-- Manage Presets Modal -->
    <ManagePresetsModal
      v-if="showManagePresets"
      @close="showManagePresets = false"
      @updated="loadPresets"
    />
  </Modal>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import Modal from './Modal.vue'
import PresetEditorModal from './PresetEditorModal.vue'
import ManagePresetsModal from './ManagePresetsModal.vue'
import { presetsAPI, storiesAPI } from '../services/api'
import { useToast } from '../composables/useToast'

const props = defineProps({
  storyId: {
    type: String,
    required: true
  },
  currentPresetId: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['close', 'updated'])

const toast = useToast()
const presets = ref([])
const defaultPresetId = ref(null)
const selectedPresetId = ref(null)
const currentStoryPresetId = ref(null)
const showPresetEditor = ref(false)
const showManagePresets = ref(false)
const editingPreset = ref(null)

const selectedPreset = computed(() => {
  if (!selectedPresetId.value) {
    return presets.value.find(p => p.id === defaultPresetId.value)
  }
  return presets.value.find(p => p.id === selectedPresetId.value)
})

onMounted(async () => {
  await loadPresets()
  currentStoryPresetId.value = props.currentPresetId
  selectedPresetId.value = props.currentPresetId
})

async function loadPresets() {
  try {
    const [presetsData, defaultData] = await Promise.all([
      presetsAPI.list(),
      presetsAPI.getDefaultId()
    ])
    presets.value = presetsData.presets || []
    defaultPresetId.value = defaultData.defaultPresetId
  } catch (error) {
    console.error('Failed to load presets:', error)
    toast.error('Failed to load presets: ' + error.message)
  }
}

async function handlePresetChange() {
  try {
    // Update story's preset
    await storiesAPI.updateMetadata(props.storyId, {
      configPresetId: selectedPresetId.value
    })

    currentStoryPresetId.value = selectedPresetId.value

    if (selectedPresetId.value) {
      const preset = presets.value.find(p => p.id === selectedPresetId.value)
      toast.success(`Switched to: ${preset.name}`)
    } else {
      toast.success('Now using default preset')
    }

    emit('updated')
  } catch (error) {
    console.error('Failed to update story preset:', error)
    toast.error('Failed to update preset: ' + error.message)
  }
}

async function editSelectedPreset() {
  // Use the selected preset ID, or fall back to the default preset ID
  const presetIdToEdit = selectedPresetId.value || defaultPresetId.value

  if (!presetIdToEdit) {
    toast.error('No preset available to edit')
    return
  }

  editingPreset.value = presets.value.find(p => p.id === presetIdToEdit)

  if (!editingPreset.value) {
    toast.error('Preset not found')
    return
  }

  showPresetEditor.value = true
}

function manageAllPresets() {
  showManagePresets.value = true
}

function closePresetEditor() {
  showPresetEditor.value = false
  editingPreset.value = null
}

async function handlePresetSaved() {
  closePresetEditor()
  await loadPresets()
  toast.success('Preset saved successfully')
}

function getProviderDisplayName(provider) {
  const names = {
    deepseek: 'DeepSeek',
    aihorde: 'AI Horde',
    openai: 'OpenAI',
    anthropic: 'Claude',
    openrouter: 'OpenRouter'
  }
  return names[provider] || provider
}
</script>

<style scoped>
.preset-selector-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.current-preset h3 {
  margin: 0 0 0.5rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
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

.select-input {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  cursor: pointer;
}

.select-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.help-text {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.preset-info {
  padding: 1rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.info-label {
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 80px;
}

.provider-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.85rem;
  font-weight: 500;
}

.provider-deepseek {
  background-color: #e3f2fd;
  color: #1976d2;
}

.provider-aihorde {
  background-color: #f3e5f5;
  color: #7b1fa2;
}

.provider-openai {
  background-color: #e8f5e9;
  color: #388e3c;
}

.provider-anthropic {
  background-color: #fff3e0;
  color: #f57c00;
}

.provider-openrouter {
  background-color: #fce4ec;
  color: #c2185b;
}

.action-buttons {
  display: flex;
  gap: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-color);
}

.btn {
  padding: 0.6rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
}

.btn-secondary {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
  background-color: var(--bg-quaternary);
}
</style>
