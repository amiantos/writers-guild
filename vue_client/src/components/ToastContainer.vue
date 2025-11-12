<template>
  <div class="toast-container" aria-live="polite" aria-atomic="false">
    <transition-group name="toast" tag="div">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast"
        :class="`toast-${toast.type}`"
        role="status"
        :aria-live="toast.type === 'error' ? 'assertive' : 'polite'"
      >
        <i :class="getIcon(toast.type)" class="toast-icon"></i>
        <span class="toast-message">{{ toast.message }}</span>
        <button
          class="toast-close"
          @click="removeToast(toast.id)"
          aria-label="Close notification"
        >
          <i class="fas fa-times"></i>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<script setup>
import { useToast } from '../composables/useToast'

const { toasts, remove } = useToast()

function getIcon(type) {
  const icons = {
    success: 'fas fa-check-circle',
    error: 'fas fa-exclamation-circle',
    info: 'fas fa-info-circle',
    warning: 'fas fa-exclamation-triangle'
  }
  return icons[type] || icons.info
}

function removeToast(id) {
  remove(id)
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 2rem;
  right: 2rem;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  pointer-events: none;
}

.toast {
  pointer-events: auto;
  min-width: 300px;
  max-width: 500px;
  padding: 1rem 1.25rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.9rem;
  font-weight: 500;
  backdrop-filter: blur(10px);
  margin-bottom: 0.75rem;
}

.toast:last-child {
  margin-bottom: 0;
}

.toast-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.toast-message {
  flex: 1;
  line-height: 1.4;
}

.toast-close {
  background: none;
  border: none;
  color: inherit;
  opacity: 0.7;
  cursor: pointer;
  padding: 0.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: opacity 0.2s;
}

.toast-close:hover {
  opacity: 1;
}

.toast-close i {
  font-size: 1rem;
}

/* Toast Types */
.toast-success {
  background-color: #28a745;
  color: white;
}

.toast-error {
  background-color: #dc3545;
  color: white;
}

.toast-info {
  background-color: #17a2b8;
  color: white;
}

.toast-warning {
  background-color: #ffc107;
  color: #000;
}

/* Animations */
.toast-enter-active {
  animation: toast-in 0.3s ease-out;
}

.toast-leave-active {
  animation: toast-out 0.3s ease-in;
}

@keyframes toast-in {
  from {
    transform: translateX(120%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes toast-out {
  from {
    transform: translateX(0) scale(1);
    opacity: 1;
  }
  to {
    transform: translateX(120%) scale(0.8);
    opacity: 0;
  }
}

/* Reduce motion for accessibility */
@media (prefers-reduced-motion: reduce) {
  .toast-enter-active,
  .toast-leave-active {
    animation: none;
    transition: opacity 0.2s;
  }

  @keyframes toast-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes toast-out {
    from { opacity: 1; }
    to { opacity: 0; }
  }
}

/* Mobile responsiveness */
@media (max-width: 640px) {
  .toast-container {
    left: 1rem;
    right: 1rem;
    top: 1rem;
  }

  .toast {
    min-width: unset;
    max-width: unset;
  }
}
</style>
