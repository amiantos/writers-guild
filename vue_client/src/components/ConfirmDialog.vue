<template>
  <div class="confirm-overlay">
    <div class="confirm-dialog" :class="`confirm-${variant}`">
      <div class="confirm-icon">
        <i v-if="variant === 'danger'" class="fas fa-trash-can"></i>
        <i v-else-if="variant === 'warning'" class="fas fa-triangle-exclamation"></i>
        <i v-else class="fas fa-circle-question"></i>
      </div>

      <div class="confirm-message">
        {{ message }}
      </div>

      <div class="confirm-actions">
        <button
          class="btn btn-secondary"
          @click="handleCancel"
          ref="cancelButton"
        >
          {{ cancelText }}
        </button>
        <button
          :class="confirmButtonClass"
          @click="handleConfirm"
        >
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'

const props = defineProps({
  message: {
    type: String,
    required: true
  },
  confirmText: {
    type: String,
    default: 'Confirm'
  },
  cancelText: {
    type: String,
    default: 'Cancel'
  },
  variant: {
    type: String,
    default: 'default',
    validator: (value) => ['default', 'danger', 'warning'].includes(value)
  }
})

const emit = defineEmits(['confirm', 'cancel'])

const cancelButton = ref(null)

const confirmButtonClass = computed(() => {
  const classes = ['btn']
  if (props.variant === 'danger') {
    classes.push('btn-danger')
  } else if (props.variant === 'warning') {
    classes.push('btn-warning')
  } else {
    classes.push('btn-primary')
  }
  return classes.join(' ')
})

function handleConfirm() {
  emit('confirm')
}

function handleCancel() {
  emit('cancel')
}

// Focus cancel button on mount (safer default for destructive actions)
onMounted(() => {
  cancelButton.value?.focus()
})
</script>

<style scoped>
.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.75);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
  animation: fadeIn 0.15s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.confirm-dialog {
  background-color: var(--bg-secondary);
  border-radius: 12px;
  padding: 2rem;
  max-width: 450px;
  width: 90%;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  animation: slideUp 0.2s ease-out;
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.confirm-icon {
  text-align: center;
  margin-bottom: 1.5rem;
}

.confirm-icon i {
  font-size: 3rem;
}

.confirm-default .confirm-icon i {
  color: var(--accent-primary);
}

.confirm-danger .confirm-icon i {
  color: var(--danger);
}

.confirm-warning .confirm-icon i {
  color: var(--warning);
}

.confirm-message {
  text-align: center;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--text-primary);
  margin-bottom: 2rem;
  white-space: pre-wrap;
}

.confirm-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
}

.confirm-actions button {
  min-width: 100px;
  padding: 0.75rem 1.5rem;
}
</style>
