<template>
  <div class="bubble-row" :class="fromUser ? 'from-user' : 'from-character'">
    <div v-if="editing" class="bubble editing">
      <textarea
        ref="editRef"
        v-model="draft"
        class="bubble-editor"
        rows="3"
        aria-label="Edit message"
        @keydown.esc="editing = false"
      ></textarea>
      <div class="bubble-edit-actions">
        <button class="btn btn-secondary btn-small" @click="editing = false">Cancel</button>
        <button class="btn btn-primary btn-small" :disabled="!draft.trim()" @click="save">
          Save
        </button>
      </div>
    </div>
    <template v-else>
      <div class="bubble">{{ content }}</div>
      <div class="bubble-actions">
        <button class="bubble-action" title="Edit this message" :disabled="busy" @click="startEdit">
          <i class="fas fa-pen"></i>
        </button>
        <button
          class="bubble-action"
          title="Delete this message"
          :disabled="busy"
          @click="$emit('delete')"
        >
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { nextTick, ref } from 'vue';

const props = defineProps({
  content: { type: String, required: true },
  fromUser: { type: Boolean, default: false },
  /** Disables editing while a reply is being written. */
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['save', 'delete']);

const editing = ref(false);
const draft = ref('');
const editRef = ref(null);

function startEdit() {
  draft.value = props.content;
  editing.value = true;
  nextTick(() => editRef.value?.focus());
}

function save() {
  const content = draft.value.trim();
  if (!content) return;
  editing.value = false;
  if (content !== props.content) {
    emit('save', content);
  }
}
</script>

<style scoped>
.bubble-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.bubble-row.from-user {
  flex-direction: row-reverse;
}

.bubble {
  max-width: min(32rem, 80%);
  padding: 0.5rem 0.875rem;
  border-radius: 1.125rem;
  font-size: 1rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.from-character .bubble {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border-bottom-left-radius: 0.375rem;
}

.from-user .bubble {
  background-color: var(--accent-primary);
  color: var(--text-on-accent, #fff);
  border-bottom-right-radius: 0.375rem;
}

.bubble.editing {
  width: min(32rem, 80%);
  padding: 0.75rem;
  border-radius: 6px;
  background-color: var(--bg-primary);
  border: 1px solid var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(139, 90, 43, 0.1);
}

.bubble-editor {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  color: var(--text-primary);
  background: none;
  border: none;
  outline: none;
  resize: vertical;
}

.bubble-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.bubble-actions {
  display: flex;
  opacity: 0;
  transition: opacity 0.2s;
}

.bubble-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.bubble-action:hover:not(:disabled) {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
}

.bubble-action:disabled {
  opacity: 0.4;
  cursor: default;
}

.bubble-row:hover .bubble-actions,
.bubble-row:focus-within .bubble-actions {
  opacity: 1;
}

@media (hover: none) {
  .bubble-actions {
    opacity: 1;
  }
}
</style>
