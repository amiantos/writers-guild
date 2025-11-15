<template>
  <Modal
    :title="preset ? 'Edit Preset' : 'Create New Preset'"
    :close-on-overlay-click="false"
    maxWidth="800px"
    @close="$emit('close')"
  >
    <div class="editor-content">
      <!-- Basic Information -->
      <section class="form-section">
        <h3 class="section-title">Basic Information</h3>

        <div class="form-group">
          <label for="presetName">Preset Name *</label>
          <input
            id="presetName"
            ref="nameInput"
            v-model="formData.name"
            type="text"
            class="text-input"
            placeholder="My Custom Configuration"
          />
        </div>

        <div class="form-group">
          <label for="provider">AI Provider</label>
          <div class="locked-provider">
            <i :class="`fas ${providerIcon}`"></i>
            <span>{{ providerDisplayName }}</span>
            <span class="locked-badge">
              <i class="fas fa-lock"></i> Locked
            </span>
          </div>
          <small class="help-text">Provider is locked for this preset</small>
        </div>
      </section>

      <!-- Provider-Specific Configuration (Everything else) -->
      <component
        :is="currentProviderComponent"
        v-if="currentProviderComponent"
        v-model:config="formData"
      />
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">
        Cancel
      </button>
      <button
        class="btn btn-primary"
        :disabled="!canSave || saving"
        @click="savePreset"
      >
        <i class="fas fa-save"></i>
        {{ saving ? 'Saving...' : (preset ? 'Save Changes' : 'Create Preset') }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import Modal from './Modal.vue'
import { presetsAPI } from '../services/api'
import { useToast } from '../composables/useToast'
import { getProviderComponent } from './providers'
import { getProviderDefaults, PROVIDER_INFO } from '../config/providerDefaults'

const props = defineProps({
  preset: {
    type: Object,
    default: null
  },
  provider: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['close', 'saved'])

const toast = useToast()
const saving = ref(false)
const nameInput = ref(null)

// Form data - will be initialized in onMounted with provider-specific defaults
const formData = ref({
  name: '',
  provider: props.provider || 'deepseek',
  apiConfig: {
    apiKey: '',
    baseURL: '',
    model: '',
    models: []
  },
  generationSettings: {
    maxTokens: 4000,
    temperature: 1.5,
    includeDialogueExamples: false
  },
  lorebookSettings: {
    scanDepth: 2000,
    tokenBudget: 1800,
    recursionDepth: 3,
    enableRecursion: true
  },
  promptTemplates: {
    systemPrompt: null,
    continue: null,
    character: null,
    instruction: null,
    rewriteThirdPerson: null
  }
})

// Get the dynamic provider component based on the selected provider
const currentProviderComponent = computed(() => {
  return getProviderComponent(formData.value.provider)
})

// Provider display information
const providerDisplayName = computed(() => {
  return PROVIDER_INFO[formData.value.provider]?.name || formData.value.provider
})

const providerIcon = computed(() => {
  return PROVIDER_INFO[formData.value.provider]?.icon || 'fa-robot'
})

onMounted(async () => {
  // If editing existing preset, load its data
  if (props.preset) {
    try {
      const { preset } = await presetsAPI.get(props.preset.id)

      // Ensure promptTemplates has all required fields (null = use system defaults)
      const presetTemplates = preset.promptTemplates || {}
      const promptTemplates = {
        systemPrompt: presetTemplates.systemPrompt ?? null,
        continue: presetTemplates.continue ?? null,
        character: presetTemplates.character ?? null,
        instruction: presetTemplates.instruction ?? null,
        rewriteThirdPerson: presetTemplates.rewriteThirdPerson ?? null
      }

      formData.value = {
        ...preset,
        apiConfig: {
          ...(preset.apiConfig || formData.value.apiConfig),
          models: Array.isArray(preset.apiConfig?.models) ? preset.apiConfig.models : []
        },
        generationSettings: preset.generationSettings || formData.value.generationSettings,
        lorebookSettings: preset.lorebookSettings || formData.value.lorebookSettings,
        promptTemplates
      }
    } catch (error) {
      console.error('Failed to load preset:', error)
      toast.error('Failed to load preset: ' + error.message)
    }
  } else if (props.provider) {
    // Creating new preset with a specific provider - load provider defaults
    const defaults = getProviderDefaults(props.provider)
    formData.value = {
      ...defaults,
      name: '' // Keep name empty for user to fill
    }
  }

  // Focus name input
  if (nameInput.value) {
    nameInput.value.focus()
  }
})

const canSave = computed(() => {
  // AI Horde uses "0000000000" as default anonymous key, so it's always valid
  const hasValidApiKey = formData.value.apiConfig.apiKey.trim() !== ''
  return formData.value.name.trim() && hasValidApiKey
})

async function savePreset() {
  if (!canSave.value) return

  try {
    saving.value = true

    // Prepare data - provider defaults already include baseURL and model
    const presetData = {
      ...formData.value
    }

    if (props.preset) {
      // Update existing preset
      await presetsAPI.update(props.preset.id, presetData)
    } else {
      // Create new preset
      await presetsAPI.create(presetData)
    }

    emit('saved')
  } catch (error) {
    console.error('Failed to save preset:', error)
    toast.error('Failed to save preset: ' + error.message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.editor-content {
  /* Let the Modal component handle scrolling */
}

.form-section {
  margin-bottom: 2rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid var(--border-color);
}

.form-section:last-child {
  border-bottom: none;
}

.section-title {
  margin: 0 0 0.5rem 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--text-primary);
}

.form-group {
  margin-bottom: 1.25rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--text-primary);
}

.text-input,
.select-input {
  width: 100%;
  padding: 0.6rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.95rem;
  font-family: inherit;
}

.text-input:focus,
.select-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.help-text {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.locked-provider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.95rem;
  color: var(--text-primary);
}

.locked-provider i:first-child {
  font-size: 1.2rem;
  color: var(--accent-primary);
}

.locked-provider span:first-of-type {
  flex: 1;
  font-weight: 500;
}

.locked-badge {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.25rem 0.6rem;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.locked-badge i {
  font-size: 0.75rem;
}

.btn {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.95rem;
  transition: all 0.2s;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-primary {
  background-color: var(--accent-primary);
  color: var(--text-on-accent);
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-secondary {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--bg-quaternary);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
