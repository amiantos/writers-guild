<template>
  <BottomSheet labelledby="choice-sheet-title" @close="$emit('close')">
    <div class="new-head">
      <h2 id="choice-sheet-title">{{ title }}</h2>
      <button type="button" class="icon-only" aria-label="Close" @click="$emit('close')">
        <i class="fas fa-xmark"></i>
      </button>
    </div>

    <button
      v-for="option in options"
      :key="option.key"
      type="button"
      class="new-row"
      @click="$emit('pick', option.key)"
    >
      <span class="row-icon" :class="{ dashed: option.dashed }"><i :class="option.icon"></i></span>
      <span class="row-text">
        <span class="row-title">{{ option.title }}</span>
        <span class="row-sub">{{ option.sub }}</span>
      </span>
      <i class="fas fa-chevron-right row-chevron"></i>
    </button>
  </BottomSheet>
</template>

<script setup>
import BottomSheet from './BottomSheet.vue';

// A sheet of a few ways to do one thing, such as add a character: each a row that names it.
defineProps({
  title: { type: String, required: true },
  // [{key, icon, title, sub, dashed?}]; a dashed icon marks the one that starts from nothing
  options: { type: Array, required: true },
});

defineEmits(['close', 'pick']);
</script>

<style scoped>
.new-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-bottom: 6px;
}

.new-head h2 {
  flex: 1;
  margin: 0 0 0 4px;
  font-family: var(--font-display);
  font-size: 1.375rem;
  line-height: 1.2;
  font-weight: 600;
}

.icon-only {
  width: 44px;
  height: 44px;
  flex: none;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1.125rem;
}

.new-row {
  width: 100%;
  min-height: 64px;
  padding: 10px 8px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  display: flex;
  align-items: center;
  gap: 14px;
}

.new-row:hover {
  background: var(--bg-tertiary);
}

.row-icon {
  width: 44px;
  height: 44px;
  flex: none;
  box-sizing: border-box;
  border-radius: 10px;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.125rem;
}

.row-icon.dashed {
  background: transparent;
  border: 2px dashed var(--border-color);
}

.row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.row-title {
  font-size: 0.9375rem;
  font-weight: 600;
}

.row-sub {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.row-chevron {
  flex: none;
  color: var(--text-secondary);
  font-size: 0.875rem;
}
</style>
