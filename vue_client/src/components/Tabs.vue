<template>
  <div class="tabs-container">
    <!-- Tab headers -->
    <div class="tabs-header">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="['tab-button', { active: modelValue === tab.key }]"
        @click="$emit('update:modelValue', tab.key)"
      >
        <i v-if="tab.icon" :class="tab.icon"></i>
        {{ tab.label }}
      </button>
    </div>

    <!-- Tab content -->
    <div class="tabs-content">
      <slot :name="`tab-${modelValue}`"></slot>
    </div>
  </div>
</template>

<script setup>
defineProps({
  tabs: {
    type: Array,
    required: true
    // tabs: [
    //   { key: 'stories', label: 'Stories', icon: 'fas fa-book' },
    //   { key: 'characters', label: 'Characters', icon: 'fas fa-users' }
    // ]
  },
  modelValue: {
    type: String,
    required: true
  }
})

defineEmits(['update:modelValue'])
</script>

<style scoped>
.tabs-container {
  background-color: var(--bg-secondary);
  border-radius: 8px;
  overflow: hidden;
}

.tabs-header {
  display: flex;
  gap: 0;
  background-color: var(--bg-tertiary);
  border-radius: 100px;
  overflow:hidden;
}

.tab-button {
  flex: 1;
  padding: 1rem 1.5rem;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border-bottom: 3px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.tab-button:hover {
  background-color: var(--bg-primary);
  color: var(--text-primary);
}

.tab-button.active {
  background-color: var(--bg-primary);
  color: var(--accent-primary);
  border-bottom-color: var(--accent-primary);
}

.tab-button i {
  font-size: 1rem;
}

.tabs-content {
  padding: 1.5rem;
}
</style>
