<template>
  <div id="app">
    <RouterView />
    <ToastContainer />
    <ConfirmDialog
      v-if="isConfirmVisible"
      :message="confirmConfig.message"
      :confirmText="confirmConfig.confirmText"
      :cancelText="confirmConfig.cancelText"
      :variant="confirmConfig.variant"
      @confirm="handleConfirm"
      @cancel="handleCancel"
    />
  </div>
</template>

<script setup>
import ToastContainer from './components/ToastContainer.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { useConfirm } from './composables/useConfirm'

const { isVisible: isConfirmVisible, config: confirmConfig, handleConfirm, handleCancel } = useConfirm()
</script>

<style scoped>
/* No app-level styles needed, router views handle their own layouts */
</style>
