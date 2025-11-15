<template>
  <Modal
    title="Choose AI Provider"
    maxWidth="600px"
    @close="$emit('close')"
  >
    <div class="provider-selection">
      <p class="selection-description">
        Select an AI provider for your new configuration preset. Each provider has its own capabilities, pricing, and features.
        The preset will be locked to this provider and pre-filled with sensible defaults.
      </p>

      <div class="providers-grid">
        <button
          v-for="(info, key) in providers"
          :key="key"
          class="provider-card"
          :class="{ 'selected': selectedProvider === key }"
          @click="selectProvider(key)"
        >
          <div class="provider-icon">
            <i :class="`fas ${info.icon}`"></i>
          </div>
          <div class="provider-info">
            <h3 class="provider-name">{{ info.name }}</h3>
            <p class="provider-description">{{ info.description }}</p>
          </div>
          <div v-if="selectedProvider === key" class="check-icon">
            <i class="fas fa-check-circle"></i>
          </div>
        </button>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">
        Cancel
      </button>
      <button
        class="btn btn-primary"
        :disabled="!selectedProvider"
        @click="confirmSelection"
      >
        <i class="fas fa-arrow-right"></i>
        Continue
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref } from 'vue'
import Modal from './Modal.vue'
import { PROVIDERS } from '../config/providerDefaults'

const emit = defineEmits(['close', 'select'])

const providers = PROVIDERS
const selectedProvider = ref(null)

function selectProvider(provider) {
  selectedProvider.value = provider
}

function confirmSelection() {
  if (selectedProvider.value) {
    emit('select', selectedProvider.value)
  }
}
</script>

<style scoped>
.provider-selection {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.selection-description {
  margin: 0;
  font-size: 0.95rem;
  color: var(--text-secondary);
  line-height: 1.6;
}

.providers-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

.provider-card {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  background-color: var(--bg-tertiary);
  border: 2px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.provider-card:hover {
  background-color: var(--bg-quaternary);
  border-color: var(--accent-primary);
  transform: translateY(-1px);
}

.provider-card.selected {
  background-color: var(--bg-quaternary);
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px rgba(var(--accent-primary-rgb), 0.2);
}

.provider-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--accent-primary);
  color: white;
  border-radius: 8px;
  font-size: 1.5rem;
}

.provider-info {
  flex: 1;
  min-width: 0;
}

.provider-name {
  margin: 0 0 0.25rem 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.provider-description {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.check-icon {
  flex-shrink: 0;
  color: var(--accent-primary);
  font-size: 1.5rem;
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
