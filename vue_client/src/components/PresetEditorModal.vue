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
          <label for="provider">AI Provider *</label>
          <select id="provider" v-model="formData.provider" class="select-input">
            <option value="deepseek">DeepSeek (with reasoning)</option>
            <option value="aihorde">AI Horde (free, queue-based)</option>
            <option value="openai">OpenAI GPT-4</option>
            <option value="anthropic">Claude (Anthropic)</option>
            <option value="openrouter">OpenRouter (multi-model)</option>
          </select>
          <small class="help-text">Different providers have different capabilities and pricing</small>
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

const props = defineProps({
  preset: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close', 'saved'])

const toast = useToast()
const saving = ref(false)
const nameInput = ref(null)

// Form data with defaults
const formData = ref({
  name: '',
  provider: 'deepseek',
  apiConfig: {
    apiKey: '',
    baseURL: '',
    model: '',
    models: []  // For AI Horde - array of model names
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
    continue: "Continue the story naturally from where it left off. Write the next 2-3 paragraphs maximum, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters.",
    character: "Write the next part of the story from {{char}}'s perspective. Focus on their thoughts, actions, and dialogue. Write 2-3 paragraphs maximum, less if it makes sense stylistically or sets up a good response opportunity for other characters. (There is a chance that \"{{char}}'s\" is multiple characters, at which point you may respond as any of them as is relevant to the story.)",
    instruction: "Continue the story naturally from where it left off. Write the next 2-3 paragraphs maximum, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters. The user additionally sends along these instructions for what they would like to see happen: {{instruction}}",
    rewriteThirdPerson: "Rewrite the following text to be in third person narrative perspective, using past tense. Assume reference to \"you\" in the original text are meant to reference the user's Persona, if one is provided. Convert all first-person pronouns (I, me, my, we, us, our) to third-person (he, she, they, him, her, them, his, her, their). Change all verbs to past tense. Maintain the same events, dialogue, and meaning, but from a third-person narrator's viewpoint. Only return the rewritten text by itself in your response."
  }
})

// Get the dynamic provider component based on the selected provider
const currentProviderComponent = computed(() => {
  return getProviderComponent(formData.value.provider)
})

onMounted(async () => {
  // If editing existing preset, load its data
  if (props.preset) {
    try {
      const { preset } = await presetsAPI.get(props.preset.id)
      formData.value = {
        ...preset,
        apiConfig: {
          ...(preset.apiConfig || formData.value.apiConfig),
          models: Array.isArray(preset.apiConfig?.models) ? preset.apiConfig.models : []
        },
        generationSettings: preset.generationSettings || formData.value.generationSettings,
        lorebookSettings: preset.lorebookSettings || formData.value.lorebookSettings,
        promptTemplates: preset.promptTemplates || formData.value.promptTemplates
      }
    } catch (error) {
      console.error('Failed to load preset:', error)
      toast.error('Failed to load preset: ' + error.message)
    }
  }

  // Focus name input
  if (nameInput.value) {
    nameInput.value.focus()
  }
})

const canSave = computed(() => {
  return formData.value.name.trim() && formData.value.apiConfig.apiKey.trim()
})

function getDefaultBaseURL() {
  const urls = {
    deepseek: 'https://api.deepseek.com/v1',
    aihorde: 'https://aihorde.net/api/v2',
    openai: 'https://api.openai.com/v1',
    anthropic: 'https://api.anthropic.com/v1',
    openrouter: 'https://openrouter.ai/api/v1'
  }
  return urls[formData.value.provider] || ''
}

function getDefaultModel() {
  const models = {
    deepseek: 'deepseek-reasoner',
    aihorde: 'Mythomax 13B',
    openai: 'gpt-4-turbo-preview',
    anthropic: 'claude-3-5-sonnet-20241022',
    openrouter: 'anthropic/claude-3.5-sonnet'
  }
  return models[formData.value.provider] || ''
}

async function savePreset() {
  if (!canSave.value) return

  try {
    saving.value = true

    // Prepare data
    const presetData = {
      ...formData.value,
      // Use defaults if fields are empty
      apiConfig: {
        ...formData.value.apiConfig,
        baseURL: formData.value.apiConfig.baseURL || getDefaultBaseURL(),
        model: formData.value.apiConfig.model || getDefaultModel()
      }
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
