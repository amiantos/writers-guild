import { ref } from 'vue'

// Global state for confirmation dialog
const isVisible = ref(false)
const config = ref({
  message: '',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  variant: 'default'
})
let resolveCallback = null

export function useConfirm() {
  /**
   * Show confirmation dialog and wait for user response
   * @param {Object} options - Configuration options
   * @param {string} options.message - The confirmation message to display
   * @param {string} [options.confirmText='Confirm'] - Text for the confirm button
   * @param {string} [options.cancelText='Cancel'] - Text for the cancel button
   * @param {string} [options.variant='default'] - Visual variant: 'default', 'danger', or 'warning'
   * @returns {Promise<boolean>} - Resolves to true if confirmed, false if cancelled
   */
  function confirm(options) {
    return new Promise((resolve) => {
      config.value = {
        message: options.message || '',
        confirmText: options.confirmText || 'Confirm',
        cancelText: options.cancelText || 'Cancel',
        variant: options.variant || 'default'
      }

      resolveCallback = resolve
      isVisible.value = true
    })
  }

  function handleConfirm() {
    isVisible.value = false
    if (resolveCallback) {
      resolveCallback(true)
      resolveCallback = null
    }
  }

  function handleCancel() {
    isVisible.value = false
    if (resolveCallback) {
      resolveCallback(false)
      resolveCallback = null
    }
  }

  return {
    // Methods
    confirm,
    handleConfirm,
    handleCancel,

    // State (for use in template)
    isVisible,
    config
  }
}
