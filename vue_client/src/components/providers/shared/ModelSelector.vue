<template>
  <div class="model-selector">
    <h4 class="subsection-title">Model Selection</h4>
    <p v-if="description" class="section-description">{{ description }}</p>

    <!-- Fetch Button and Actions -->
    <div class="model-actions">
      <button
        type="button"
        class="btn btn-secondary btn-small"
        @click="$emit('fetch')"
        :disabled="loading || !canFetch"
      >
        <i :class="loading ? 'fas fa-spinner fa-spin' : 'fas fa-sync'"></i>
        {{ loading ? 'Loading...' : 'Fetch Available Models' }}
      </button>

      <!-- Additional Actions Slot -->
      <slot name="actions"></slot>

      <div v-if="!canFetch && requiresApiKey" class="help-text inline-help">
        Enter your API key above to fetch models
      </div>
    </div>

    <!-- Error Message -->
    <div v-if="error" class="error-message">
      {{ error }}
    </div>

    <!-- Models Display -->
    <div v-if="models.length > 0">
      <!-- Currently Selected Model -->
      <div class="selected-model-display">
        <span class="label">Selected Model:</span>
        <span class="value">{{ selectedModel || 'None' }}</span>
      </div>

      <!-- Custom Controls Slot (for filtering, sorting, etc.) -->
      <slot name="controls"></slot>

      <!-- Models List -->
      <div class="models-list" :class="listClass">
        <slot name="models" :models="models" :select="handleSelect" :is-selected="isSelected">
          <!-- Default Model Item Rendering -->
          <div
            v-for="model in models"
            :key="model.id"
            class="model-item"
            :class="{ 'model-selected': isSelected(model.id) }"
            @click="handleSelect(model)"
          >
            <div class="model-header">
              <span class="model-name">{{ model.name || model.id }}</span>
            </div>
            <div class="model-details">
              <span class="model-badge">{{ formatContext(model.contextLength) }}</span>
            </div>
            <div v-if="model.description" class="model-description">
              {{ model.description }}
            </div>
          </div>
        </slot>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else-if="!loading" class="help-text">
      <slot name="empty-state">
        {{ emptyStateText }}
      </slot>
    </div>
  </div>
</template>

<script setup>
const props = defineProps({
  models: {
    type: Array,
    default: () => []
  },
  selectedModel: {
    type: String,
    default: ''
  },
  loading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: null
  },
  description: {
    type: String,
    default: ''
  },
  emptyStateText: {
    type: String,
    default: 'Click "Fetch Available Models" to see available models.'
  },
  canFetch: {
    type: Boolean,
    default: true
  },
  requiresApiKey: {
    type: Boolean,
    default: true
  },
  listClass: {
    type: String,
    default: ''
  },
  formatContext: {
    type: Function,
    default: (length) => {
      if (!length) return 'Unknown'
      if (length >= 1000000) {
        return `${(length / 1000000).toFixed(1)}M context`
      } else if (length >= 1000) {
        return `${(length / 1000).toFixed(0)}k context`
      }
      return `${length} tokens`
    }
  }
})

const emit = defineEmits(['fetch', 'select'])

function handleSelect(model) {
  emit('select', model)
}

function isSelected(modelId) {
  return props.selectedModel === modelId
}
</script>

<style scoped>
.model-selector {
  margin-top: 0.5rem;
}

.subsection-title {
  margin: 1rem 0 0.5rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.section-description {
  margin: 0 0 1rem 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.model-actions {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  align-items: center;
}

.btn {
  padding: 0.6rem 1.2rem;
  border: none;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--bg-quaternary);
}

.btn-small {
  padding: 0.5rem 0.9rem;
  font-size: 0.85rem;
}

.help-text {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.inline-help {
  display: inline;
  margin-left: 0.5rem;
  margin-top: 0;
}

.error-message {
  padding: 0.75rem;
  background-color: #fee;
  border: 1px solid #fcc;
  border-radius: 4px;
  color: #c33;
  font-size: 0.9rem;
  margin-bottom: 1rem;
}

.selected-model-display {
  padding: 0.75rem;
  background-color: var(--bg-quaternary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}

.selected-model-display .label {
  font-weight: 600;
  color: var(--text-secondary);
  margin-right: 0.5rem;
}

.selected-model-display .value {
  color: var(--accent-primary);
  font-weight: 500;
}

.models-list {
  max-height: 400px;
  overflow-y: auto;
  padding: 0.5rem;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

.model-item {
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 0.5rem;
}

.model-item:hover {
  background-color: var(--bg-quaternary);
  border-color: var(--accent-primary);
}

.model-item.model-selected {
  background-color: var(--bg-quaternary);
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px var(--accent-primary);
}

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.model-name {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.95rem;
}

.model-details {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.4rem;
}

.model-badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  background-color: var(--bg-secondary);
  color: var(--text-secondary);
  border-radius: 10px;
  font-size: 0.75rem;
  font-weight: 500;
  border: 1px solid var(--border-color);
}

.model-description {
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.4;
  margin-top: 0.3rem;
}

.fa-spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
