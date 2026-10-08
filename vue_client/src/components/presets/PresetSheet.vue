<template>
  <BottomSheet labelledby="preset-sheet-title" @close="$emit('close')">
    <div class="sheet-head">
      <span class="sheet-icon"><i :class="['fas', item.icon]"></i></span>
      <div class="sheet-heading">
        <h2 id="preset-sheet-title">{{ item.name }}</h2>
        <p>
          {{ item.providerName }} · <span class="model">{{ item.model }}</span>
        </p>
      </div>
      <button type="button" class="sheet-close" aria-label="Close" @click="$emit('close')">
        <i class="fas fa-xmark"></i>
      </button>
    </div>

    <p v-if="details" class="details">{{ details }}</p>

    <div class="sheet-primary">
      <button type="button" class="btn btn-primary" @click="$emit('edit')">
        <i class="fas fa-pen"></i> Edit preset
      </button>
    </div>

    <div class="sheet-list">
      <p v-if="item.isDefault" class="is-default">
        <i class="fas fa-star"></i> The default preset, for stories without their own
      </p>
      <button v-else type="button" @click="$emit('set-default')">
        <i class="far fa-star"></i> Make this the default
      </button>
      <button type="button" @click="$emit('duplicate')">
        <i class="fas fa-copy"></i> Duplicate preset
      </button>
      <button
        type="button"
        class="danger"
        :disabled="item.isDefault"
        :aria-describedby="item.isDefault ? 'preset-delete-hint' : undefined"
        @click="$emit('delete')"
      >
        <i class="fas fa-trash"></i>
        <span class="delete-text">
          Delete preset
          <span v-if="item.isDefault" id="preset-delete-hint" class="hint">
            Make another preset the default first
          </span>
        </span>
      </button>
    </div>
  </BottomSheet>
</template>

<script setup>
import { computed } from 'vue';
import BottomSheet from '../library/BottomSheet.vue';
import { usageLine } from '../../composables/presets.js';

const props = defineProps({
  // An item from groupPresets()
  item: { type: Object, required: true },
});

defineEmits(['close', 'edit', 'set-default', 'duplicate', 'delete']);

const details = computed(() =>
  [props.item.settings, usageLine(props.item)].filter(Boolean).join(' · '),
);
</script>

<style scoped>
.sheet-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.sheet-icon {
  width: 48px;
  height: 48px;
  flex: none;
  border-radius: 12px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 1.125rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sheet-heading {
  flex: 1;
  min-width: 0;
}

.sheet-heading h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.3rem;
  line-height: 1.2;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.sheet-heading p {
  margin: 4px 0 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.model {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.sheet-close {
  flex: none;
  align-self: flex-start;
  width: 44px;
  height: 44px;
  margin: -6px -8px 0 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1.25rem;
}

.details {
  margin: 14px 0 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.sheet-primary {
  display: flex;
  flex-direction: column;
  margin-top: 18px;
}

.sheet-primary .btn {
  height: 48px;
  font-size: 1rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.sheet-list {
  display: flex;
  flex-direction: column;
  margin-top: 12px;
}

.sheet-list button,
.is-default {
  min-height: 48px;
  margin: 0;
  padding: 0 4px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.9375rem;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 14px;
}

.sheet-list i,
.is-default i {
  width: 20px;
  flex: none;
  text-align: center;
}

.is-default {
  color: var(--text-secondary);
}

.is-default i {
  color: var(--accent-primary);
}

.sheet-list .danger {
  color: var(--danger);
}

.sheet-list button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.delete-text {
  display: flex;
  flex-direction: column;
}

.hint {
  font-size: 0.78rem;
  color: var(--text-secondary);
}
</style>
