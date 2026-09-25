<template>
  <article class="turn" :class="{ 'from-user': block.record?.source === 'user' }">
    <div v-if="editing" class="turn-editor">
      <textarea
        ref="editorRef"
        v-model="draft"
        class="turn-textarea"
        :rows="editorRows"
        aria-label="Edit this passage"
        @keydown.meta.enter.prevent="save"
        @keydown.ctrl.enter.prevent="save"
        @keydown.esc="cancel"
      ></textarea>
      <div class="editor-actions">
        <button class="btn btn-secondary btn-small" @click="cancel">Cancel</button>
        <button class="btn btn-primary btn-small" :disabled="!draft.trim()" @click="save">
          <i class="fas fa-check"></i> Save
        </button>
      </div>
    </div>

    <div v-else class="prose" v-html="html"></div>

    <div v-if="!editing" class="turn-actions" :class="{ 'is-busy': busy }">
      <button class="icon-btn" title="Edit" :disabled="busy" @click="startEdit">
        <i class="fas fa-pen"></i>
      </button>
      <button
        v-if="canRegenerate"
        class="icon-btn"
        title="Write another version"
        :disabled="busy"
        @click="$emit('regenerate', block)"
      >
        <i class="fas fa-rotate-right"></i>
      </button>
      <button class="icon-btn" title="Delete" :disabled="busy" @click="$emit('delete', block)">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  </article>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue';
import { renderProse } from '../../composables/bureau/renderProse';

const props = defineProps({
  /** A block of the story, from splitPassages. */
  block: { type: Object, required: true },
  busy: { type: Boolean, default: false },
  canRegenerate: { type: Boolean, default: false },
});

const emit = defineEmits(['save', 'regenerate', 'delete']);

const editing = ref(false);
const draft = ref('');
const editorRef = ref(null);

const html = computed(() => renderProse(props.block.text));
const editorRows = computed(() => Math.min(20, Math.max(3, Math.ceil(draft.value.length / 70))));

function startEdit() {
  draft.value = props.block.text;
  editing.value = true;
  nextTick(() => editorRef.value?.focus());
}

function cancel() {
  editing.value = false;
}

function save() {
  const text = draft.value.trim();
  if (!text) return;
  editing.value = false;
  if (text !== props.block.text) {
    emit('save', props.block, text);
  }
}
</script>

<style scoped>
.turn {
  position: relative;
}

.prose :deep(p) {
  margin: 0 0 1em;
}

.prose :deep(.story-image) {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  height: auto;
  margin: 1rem auto;
  border-radius: 8px;
  object-fit: contain;
}

.from-user .prose {
  border-left: 2px solid var(--border-color);
  padding-left: 1rem;
  margin-left: -1rem;
}

.turn-actions {
  position: absolute;
  top: -1.75rem;
  right: 0;
  display: flex;
  align-items: center;
  gap: 0.125rem;
  padding: 0.125rem;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: var(--shadow);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
  z-index: 2;
}

.turn:hover .turn-actions,
.turn:focus-within .turn-actions {
  opacity: 1;
  pointer-events: auto;
}

.turn-actions.is-busy {
  display: none;
}

.turn-actions .icon-btn {
  font-size: 0.8rem;
  min-width: 1.75rem;
  padding: 0.25rem !important;
}

.turn-editor {
  margin: 0 0 1em;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.turn-textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 0.75rem;
  font: inherit;
  line-height: 1.7;
  color: var(--text-primary);
  background-color: var(--bg-tertiary);
  border: 1px solid var(--accent-primary);
  border-radius: 6px;
  resize: vertical;
  outline: none;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

@media (hover: none) {
  .turn-actions {
    position: static;
    opacity: 0.6;
    pointer-events: auto;
    justify-content: flex-end;
    width: max-content;
    margin: -0.5rem 0 1rem auto;
    box-shadow: none;
  }
}
</style>
