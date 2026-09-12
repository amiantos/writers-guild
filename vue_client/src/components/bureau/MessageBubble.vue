<template>
  <div class="bubble-row" :class="message.source === 'user' ? 'from-reader' : 'from-character'">
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
      <div class="bubble">
        {{ message.content }}
        <span v-if="message.edited" class="bubble-edited">edited</span>
      </div>
      <div class="bubble-actions">
        <button class="icon-btn" title="Edit this message" :disabled="busy" @click="startEdit">
          <i class="fas fa-pen"></i>
        </button>
        <button
          class="icon-btn"
          title="Delete this message"
          :disabled="busy"
          @click="$emit('delete', message)"
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
  message: { type: Object, required: true },
  /** Disables editing while a reply is being written. */
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['save', 'delete']);

const editing = ref(false);
const draft = ref('');
const editRef = ref(null);

function startEdit() {
  draft.value = props.message.content;
  editing.value = true;
  nextTick(() => editRef.value?.focus());
}

function save() {
  const content = draft.value.trim();
  if (!content) return;
  editing.value = false;
  if (content !== props.message.content) {
    emit('save', props.message, content);
  }
}
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.bubble-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.bubble-row.from-reader {
  flex-direction: row-reverse;
}

.bubble {
  max-width: min(36rem, 80%);
  padding: 0.5rem 0.875rem;
  border-radius: 1rem;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.from-character .bubble {
  background-color: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-bottom-left-radius: 0.25rem;
}

.from-reader .bubble {
  background-color: var(--accent-primary);
  color: var(--text-on-accent, #fff);
  border-bottom-right-radius: 0.25rem;
}

.bubble.editing {
  width: min(36rem, 80%);
  background-color: var(--bg-primary);
  border: 1px solid var(--accent-primary);
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
  gap: 0.375rem;
}

.bubble-edited {
  margin-left: 0.375rem;
  font-size: 0.7rem;
  opacity: 0.7;
}

.bubble-actions {
  display: flex;
  opacity: 0;
  transition: opacity 0.15s;
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
