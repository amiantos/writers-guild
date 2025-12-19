<template>
  <div class="provider-config">
    <!-- Provider-specific API configuration (slot) -->
    <section class="form-section">
      <h3 class="section-title">API Configuration</h3>
      <slot name="api-config"></slot>
    </section>

    <!-- Shared: Generation Settings -->
    <GenerationSettings
      v-model="localGenerationSettings"
      :show-max-context="showMaxContext"
      :context-range="contextRange"
      :context-help-text="contextHelpText"
      :provider="provider"
      :model="model"
    />

    <!-- Shared: Advanced Sampling Settings -->
    <AdvancedSamplingSettings
      v-model="localGenerationSettings"
      :provider="provider"
      :model="model"
    />

    <!-- Shared: Lorebook Settings -->
    <LorebookSettings v-model="localLorebookSettings" />

    <!-- Shared: Prompt Templates -->
    <PromptTemplates v-model="localPromptTemplates" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import GenerationSettings from './GenerationSettings.vue'
import AdvancedSamplingSettings from './AdvancedSamplingSettings.vue'
import LorebookSettings from './LorebookSettings.vue'
import PromptTemplates from './PromptTemplates.vue'

const props = defineProps({
  config: {
    type: Object,
    required: true
  },
  showMaxContext: {
    type: Boolean,
    default: true
  },
  contextRange: {
    type: Object,
    default: () => ({ min: 32000, max: 128000 })
  },
  contextHelpText: {
    type: String,
    default: 'Context window size (32k-128k tokens). Larger = more story content but higher costs.'
  },
  provider: {
    type: String,
    required: true
  },
  model: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:config'])

// Create local computed properties for each section that syncs with parent
const localGenerationSettings = computed({
  get() {
    return props.config.generationSettings || {}
  },
  set(value) {
    emit('update:config', { ...props.config, generationSettings: value })
  }
})

const localLorebookSettings = computed({
  get() {
    return props.config.lorebookSettings || {}
  },
  set(value) {
    emit('update:config', { ...props.config, lorebookSettings: value })
  }
})

const localPromptTemplates = computed({
  get() {
    const templates = props.config.promptTemplates || {}
    // Ensure all required fields exist (default to null for system defaults)
    return {
      systemPrompt: templates.systemPrompt ?? null,
      continue: templates.continue ?? null,
      character: templates.character ?? null,
      instruction: templates.instruction ?? null,
      rewriteThirdPerson: templates.rewriteThirdPerson ?? null,
      ideate: templates.ideate ?? null
    }
  },
  set(value) {
    emit('update:config', { ...props.config, promptTemplates: value })
  }
})
</script>

<style scoped>
.provider-config {
  margin-bottom: 1rem;
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
</style>
