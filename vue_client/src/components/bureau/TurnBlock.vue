<template>
  <article class="turn" :class="[`turn-${turn.kind}`, `from-${turn.source}`]">
    <div v-if="turn.kind === 'scene_break'" class="scene-break" role="separator">
      <span aria-hidden="true">⁂</span>
    </div>

    <div v-else-if="editing" class="turn-editor">
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

    <div v-else-if="turn.kind === 'direction'" class="direction-note">
      <i class="fas fa-compass"></i>
      <span>{{ turn.content }}</span>
    </div>

    <div v-else class="prose" v-html="html"></div>

    <div v-if="!editing" class="turn-actions" :class="{ 'is-busy': busy }">
      <div v-if="turn.variants.length > 1" class="variant-switcher">
        <button
          class="icon-btn"
          title="Previous version"
          :disabled="busy || variantIndex <= 0"
          @click="stepVariant(-1)"
        >
          <i class="fas fa-chevron-left"></i>
        </button>
        <span class="variant-count">{{ variantIndex + 1 }} / {{ turn.variants.length }}</span>
        <button
          class="icon-btn"
          title="Next version"
          :disabled="busy || variantIndex >= turn.variants.length - 1"
          @click="stepVariant(1)"
        >
          <i class="fas fa-chevron-right"></i>
        </button>
      </div>
      <button
        v-if="turn.kind !== 'scene_break'"
        class="icon-btn"
        title="Edit"
        :disabled="busy"
        @click="startEdit"
      >
        <i class="fas fa-pen"></i>
      </button>
      <button
        v-if="turn.source === 'generated' && canRegenerate"
        class="icon-btn"
        title="Write another version"
        :disabled="busy"
        @click="$emit('regenerate', turn)"
      >
        <i class="fas fa-rotate-right"></i>
      </button>
      <button class="icon-btn" title="Delete" :disabled="busy" @click="$emit('delete', turn)">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  </article>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue';
import { renderProse } from '../../composables/bureau/renderProse';

const props = defineProps({
  turn: { type: Object, required: true },
  /** Text to show instead of the turn's own, while a new version streams in. */
  overrideContent: { type: String, default: null },
  busy: { type: Boolean, default: false },
  canRegenerate: { type: Boolean, default: false },
});

const emit = defineEmits(['save', 'regenerate', 'delete', 'select-variant']);

const editing = ref(false);
const draft = ref('');
const editorRef = ref(null);

const html = computed(() => renderProse(props.overrideContent ?? props.turn.content));
const variantIndex = computed(() =>
  props.turn.variants.findIndex((variant) => variant.id === props.turn.activeVariantId),
);
const editorRows = computed(() => Math.min(20, Math.max(3, Math.ceil(draft.value.length / 70))));

function startEdit() {
  draft.value = props.turn.content;
  editing.value = true;
  nextTick(() => editorRef.value?.focus());
}

function cancel() {
  editing.value = false;
}

function save() {
  const content = draft.value.trim();
  if (!content) return;
  editing.value = false;
  if (content !== props.turn.content) {
    emit('save', props.turn, content);
  }
}

function stepVariant(delta) {
  const variant = props.turn.variants[variantIndex.value + delta];
  if (variant) {
    emit('select-variant', props.turn, variant.id);
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

.from-user.turn-prose .prose {
  border-left: 2px solid var(--border-color);
  padding-left: 1rem;
  margin-left: -1rem;
}

.direction-note {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0 0 1em;
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-secondary);
  background-color: var(--bg-secondary);
  border-radius: 6px;
}

.scene-break {
  text-align: center;
  margin: 0.5rem 0 1.5rem;
  color: var(--text-secondary);
  letter-spacing: 0.5em;
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

.variant-switcher {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  padding-right: 0.25rem;
  margin-right: 0.125rem;
  border-right: 1px solid var(--border-color);
}

.variant-count {
  font-size: 0.75rem;
  color: var(--text-secondary);
  min-width: 2.5rem;
  text-align: center;
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
