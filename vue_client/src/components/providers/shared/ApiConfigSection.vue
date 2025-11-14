<template>
  <div class="api-config-section">
    <!-- API Key Input -->
    <div class="form-group">
      <label :for="`apiKey-${providerId}`">
        API Key {{ required ? '*' : '' }}
      </label>
      <input
        :id="`apiKey-${providerId}`"
        :value="modelValue.apiKey"
        @input="updateApiKey"
        type="password"
        class="text-input"
        :placeholder="placeholder"
      />
      <small v-if="helpText" class="help-text">{{ helpText }}</small>
    </div>

    <!-- Advanced API Config (Base URL) -->
    <div v-if="showAdvanced" class="form-group">
      <label :for="`baseURL-${providerId}`">Base URL</label>
      <input
        :id="`baseURL-${providerId}`"
        :value="modelValue.baseURL"
        @input="updateBaseURL"
        type="text"
        class="text-input"
        :placeholder="baseURLPlaceholder"
      />
      <small class="help-text">Leave empty to use default</small>
    </div>

    <!-- Additional API Config Slot -->
    <slot name="additional-config"></slot>

    <!-- Advanced Toggle Button -->
    <button
      type="button"
      class="btn-link"
      @click="toggleAdvanced"
    >
      {{ showAdvanced ? 'Hide' : 'Show' }} Advanced API Options
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  modelValue: {
    type: Object,
    required: true
  },
  providerId: {
    type: String,
    required: true
  },
  placeholder: {
    type: String,
    default: ''
  },
  helpText: {
    type: String,
    default: ''
  },
  baseURLPlaceholder: {
    type: String,
    required: true
  },
  required: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['update:modelValue'])

const showAdvanced = ref(false)

function updateApiKey(event) {
  emit('update:modelValue', {
    ...props.modelValue,
    apiKey: event.target.value
  })
}

function updateBaseURL(event) {
  emit('update:modelValue', {
    ...props.modelValue,
    baseURL: event.target.value
  })
}

function toggleAdvanced() {
  showAdvanced.value = !showAdvanced.value
}
</script>

<style scoped>
.api-config-section {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
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

.text-input {
  width: 100%;
  padding: 0.6rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.95rem;
  font-family: inherit;
}

.text-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.help-text {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.btn-link {
  background: none;
  border: none;
  color: var(--accent-primary);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0.5rem 0;
  text-decoration: underline;
  align-self: flex-start;
}

.btn-link:hover {
  opacity: 0.8;
}
</style>
