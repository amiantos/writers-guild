<template>
  <div class="overflow-menu" :class="{ 'from-left': align === 'left' }" @click="$emit('close')">
    <button class="overflow-menu-item" @click="$emit('greeting')">
      <i class="fas fa-message"></i>
      <span>Select Greeting</span>
    </button>
    <button class="overflow-menu-item" :disabled="!canAddAvatar" @click="$emit('avatar')">
      <i class="fas fa-image"></i>
      <span>Add Character Avatar</span>
    </button>
    <button class="overflow-menu-item" @click="$emit('ideate')">
      <i class="fas fa-lightbulb"></i>
      <span>Ideate</span>
    </button>
    <button class="overflow-menu-item" @click="$emit('rewrite')">
      <i class="fas fa-repeat"></i>
      <span>Rewrite to Third Person</span>
    </button>
    <button class="overflow-menu-item" @click="$emit('clear')">
      <i class="fas fa-eraser"></i>
      <span>Clear Story</span>
    </button>
    <button class="overflow-menu-item" @click="$emit('export')">
      <i class="fas fa-download"></i>
      <span>Export TXT</span>
    </button>
    <button v-if="canViewPrompt" class="overflow-menu-item" @click="$emit('view-prompt')">
      <i class="fas fa-eye"></i>
      <span>View Last Prompt</span>
    </button>
  </div>
</template>

<script setup>
defineProps({
  canAddAvatar: { type: Boolean, default: false },
  canViewPrompt: { type: Boolean, default: false },
  /** Which edge of the button row the menu lines up with. */
  align: { type: String, default: 'right' },
});

defineEmits(['close', 'greeting', 'avatar', 'ideate', 'rewrite', 'clear', 'export', 'view-prompt']);
</script>

<style scoped>
.overflow-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 0.5rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  min-width: 200px;
}

.overflow-menu.from-left {
  left: 0;
  right: auto;
}

.overflow-menu-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s;
}

.overflow-menu-item:hover {
  background-color: var(--bg-secondary);
}

.overflow-menu-item i {
  width: 1.25rem;
  text-align: center;
}
</style>
