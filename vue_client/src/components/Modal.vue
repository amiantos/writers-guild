<template>
  <div class="modal-overlay" @click.self="handleClose">
    <div class="modal-content" :style="contentStyle">
      <div v-if="!hideHeader" class="modal-header">
        <slot name="header">
          <h2>{{ title }}</h2>
        </slot>
        <button v-if="!hideCloseButton" class="close-btn" @click="handleClose">
          <i class="fas fa-xmark"></i>
        </button>
      </div>

      <div class="modal-body">
        <slot></slot>
      </div>

      <div v-if="hasFooter" class="modal-footer">
        <slot name="footer"></slot>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, useSlots } from 'vue'

const props = defineProps({
  title: {
    type: String,
    default: ''
  },
  maxWidth: {
    type: String,
    default: '600px'
  },
  maxHeight: {
    type: String,
    default: '80vh'
  },
  hideHeader: {
    type: Boolean,
    default: false
  },
  hideCloseButton: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close'])

const slots = useSlots()

const hasFooter = computed(() => {
  return !!slots.footer
})

const contentStyle = computed(() => {
  return {
    maxWidth: props.maxWidth,
    maxHeight: props.maxHeight
  }
})

function handleClose() {
  emit('close')
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background-color: var(--bg-secondary);
  border-radius: 8px;
  width: 90%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.close-btn:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-color);
}
</style>
