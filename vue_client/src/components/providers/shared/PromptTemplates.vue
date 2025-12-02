<template>
  <div>
    <section class="form-section">
      <h3 class="section-title">Prompt Templates</h3>
      <p class="section-description">
        Customize the prompts sent to the AI. Use placeholders like <code v-text="'{{char}}'"></code>,
        <code v-text="'{{instruction}}'"></code>, <code v-text="'{{storyContent}}'"></code>, etc.
        Toggle each prompt to customize or use system defaults.
      </p>

      <!-- System Prompt -->
      <div class="form-group">
        <div class="label-row">
          <label for="templateSystemPrompt">System Prompt Template</label>
          <button
            type="button"
            class="btn-toggle"
            @click="toggleCustomization('systemPrompt')"
          >
            {{ isCustomized('systemPrompt') ? 'Use Default' : 'Customize' }}
          </button>
        </div>
        <p class="field-description">
          Granular template with full control. Variables: <code v-text="'{{character.name}}'"></code>,
          <code v-text="'{{persona.description}}'"></code>, etc.
          Conditionals: <code v-text="'{{#if variable}}...{{/if}}'"></code>.
          Loops: <code v-text="'{{#each array}}...{{/each}}'"></code>.
          See default for complete reference.
        </p>
        <textarea
          v-if="isCustomized('systemPrompt')"
          id="templateSystemPrompt"
          v-model="localTemplates.systemPrompt"
          class="textarea-input"
          rows="8"
          placeholder="Enter custom system prompt template..."
        ></textarea>
        <div v-else class="default-display">
          <div class="default-label">Using System Default:</div>
          <pre class="default-content">{{ DEFAULT_TEMPLATES.systemPrompt }}</pre>
        </div>
      </div>

      <!-- Continue Template -->
      <div class="form-group">
        <div class="label-row">
          <label for="templateContinue">Continue Template</label>
          <button
            type="button"
            class="btn-toggle"
            @click="toggleCustomization('continue')"
          >
            {{ isCustomized('continue') ? 'Use Default' : 'Customize' }}
          </button>
        </div>
        <textarea
          v-if="isCustomized('continue')"
          id="templateContinue"
          v-model="localTemplates.continue"
          class="textarea-input"
          rows="3"
          placeholder="Enter custom continue template..."
        ></textarea>
        <div v-else class="default-display">
          <div class="default-label">Using System Default:</div>
          <pre class="default-content">{{ DEFAULT_TEMPLATES.continue }}</pre>
        </div>
      </div>

      <!-- Character Template -->
      <div class="form-group">
        <div class="label-row">
          <label for="templateCharacter">Character Response Template</label>
          <button
            type="button"
            class="btn-toggle"
            @click="toggleCustomization('character')"
          >
            {{ isCustomized('character') ? 'Use Default' : 'Customize' }}
          </button>
        </div>
        <textarea
          v-if="isCustomized('character')"
          id="templateCharacter"
          v-model="localTemplates.character"
          class="textarea-input"
          rows="3"
          placeholder="Enter custom character template..."
        ></textarea>
        <div v-else class="default-display">
          <div class="default-label">Using System Default:</div>
          <pre class="default-content">{{ DEFAULT_TEMPLATES.character }}</pre>
        </div>
      </div>

      <!-- Instruction Template -->
      <div class="form-group">
        <div class="label-row">
          <label for="templateInstruction">Custom Instruction Template</label>
          <button
            type="button"
            class="btn-toggle"
            @click="toggleCustomization('instruction')"
          >
            {{ isCustomized('instruction') ? 'Use Default' : 'Customize' }}
          </button>
        </div>
        <textarea
          v-if="isCustomized('instruction')"
          id="templateInstruction"
          v-model="localTemplates.instruction"
          class="textarea-input"
          rows="3"
          placeholder="Enter custom instruction template..."
        ></textarea>
        <div v-else class="default-display">
          <div class="default-label">Using System Default:</div>
          <pre class="default-content">{{ DEFAULT_TEMPLATES.instruction }}</pre>
        </div>
      </div>

      <!-- Rewrite Template -->
      <div class="form-group">
        <div class="label-row">
          <label for="templateRewrite">Rewrite to Third Person Template</label>
          <button
            type="button"
            class="btn-toggle"
            @click="toggleCustomization('rewriteThirdPerson')"
          >
            {{ isCustomized('rewriteThirdPerson') ? 'Use Default' : 'Customize' }}
          </button>
        </div>
        <textarea
          v-if="isCustomized('rewriteThirdPerson')"
          id="templateRewrite"
          v-model="localTemplates.rewriteThirdPerson"
          class="textarea-input"
          rows="4"
          placeholder="Enter custom rewrite template..."
        ></textarea>
        <div v-else class="default-display">
          <div class="default-label">Using System Default:</div>
          <pre class="default-content">{{ DEFAULT_TEMPLATES.rewriteThirdPerson }}</pre>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, reactive, ref, onMounted } from 'vue'
import { presetsAPI } from '../../../services/api'

// Default templates fetched from server (single source of truth)
const DEFAULT_TEMPLATES = ref({
  systemPrompt: '',
  continue: '',
  character: '',
  instruction: '',
  rewriteThirdPerson: ''
})

const isLoading = ref(true)

// Fetch default templates from server on mount
onMounted(async () => {
  try {
    const templates = await presetsAPI.getDefaultTemplates()
    DEFAULT_TEMPLATES.value = templates
  } catch (error) {
    console.error('Failed to load default templates:', error)
  } finally {
    isLoading.value = false
  }
})

const props = defineProps({
  modelValue: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:modelValue'])

// Helper to get templates object with defaults
const getTemplates = () => {
  const templates = props.modelValue || {}
  return {
    systemPrompt: templates.systemPrompt ?? null,
    continue: templates.continue ?? null,
    character: templates.character ?? null,
    instruction: templates.instruction ?? null,
    rewriteThirdPerson: templates.rewriteThirdPerson ?? null
  }
}

// Helper to update a single template field
const updateTemplate = (key, value) => {
  emit('update:modelValue', {
    ...getTemplates(),
    [key]: value
  })
}

// Create a reactive object with individual computed properties for each template
// Using reactive() auto-unwraps nested computed refs in templates
const localTemplates = reactive({
  systemPrompt: computed({
    get: () => getTemplates().systemPrompt,
    set: (value) => updateTemplate('systemPrompt', value)
  }),
  continue: computed({
    get: () => getTemplates().continue,
    set: (value) => updateTemplate('continue', value)
  }),
  character: computed({
    get: () => getTemplates().character,
    set: (value) => updateTemplate('character', value)
  }),
  instruction: computed({
    get: () => getTemplates().instruction,
    set: (value) => updateTemplate('instruction', value)
  }),
  rewriteThirdPerson: computed({
    get: () => getTemplates().rewriteThirdPerson,
    set: (value) => updateTemplate('rewriteThirdPerson', value)
  })
})

// Check if a prompt is customized (not null)
const isCustomized = (key) => {
  return getTemplates()[key] !== null
}

// Toggle customization for a prompt
const toggleCustomization = (key) => {
  const current = getTemplates()[key]

  if (current === null) {
    // Switching to customize: load the default template
    updateTemplate(key, DEFAULT_TEMPLATES.value[key])
  } else {
    // Switching to use default: set to null
    updateTemplate(key, null)
  }
}
</script>

<style scoped>
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

.section-description {
  margin: 0 0 1.5rem 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.section-description code,
.field-description code {
  background-color: var(--bg-tertiary);
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.85em;
  color: var(--text-primary);
}

.form-group {
  margin-bottom: 1.5rem;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.form-group label {
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
}

.field-description {
  margin: 0 0 0.5rem 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.btn-toggle {
  padding: 0.35rem 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-toggle:hover {
  background-color: var(--accent-primary);
  color: white;
  border-color: var(--accent-primary);
}

.textarea-input {
  width: 100%;
  padding: 0.6rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.9rem;
  font-family: monospace;
  resize: vertical;
}

.textarea-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.default-display {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.75rem;
}

.default-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.default-content {
  margin: 0;
  padding: 0.5rem;
  background-color: var(--bg-tertiary);
  border-radius: 3px;
  font-size: 0.85rem;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: monospace;
  line-height: 1.4;
  max-height: 300px;
  overflow-y: auto;
}
</style>
