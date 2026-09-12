<template>
  <li class="memory" :class="{ 'is-pinned': memory.pinned, 'needs-review': memory.needsReview }">
    <div v-if="editing" class="memory-editor">
      <textarea
        ref="editorRef"
        v-model="draft"
        class="textarea-input"
        rows="3"
        aria-label="Edit this memory"
        @keydown.meta.enter.prevent="save"
        @keydown.ctrl.enter.prevent="save"
        @keydown.esc="editing = false"
      ></textarea>
      <div class="editor-actions">
        <button class="btn btn-secondary btn-small" @click="editing = false">Cancel</button>
        <button class="btn btn-primary btn-small" :disabled="!draft.trim() || busy" @click="save">
          <i class="fas fa-check"></i> Save
        </button>
      </div>
    </div>
    <p v-else class="memory-content">{{ memory.content }}</p>

    <div class="memory-footer">
      <div class="memory-meta">
        <span
          v-if="memory.needsReview"
          class="review-badge"
          title="A passage this memory came from was changed or deleted"
        >
          <i class="fas fa-triangle-exclamation"></i> Check this
        </span>
        <span v-if="memory.pinned" class="meta-tag"><i class="fas fa-thumbtack"></i> Pinned</span>
        <span v-if="memory.supersededBy" class="meta-tag">Replaced by a newer memory</span>
        <span v-else-if="memory.retired" class="meta-tag">Retired</span>

        <select
          v-if="memory.layer === 'knowledge' && isCurrent"
          class="importance-select"
          :value="memory.importance"
          :disabled="busy"
          aria-label="Importance"
          title="More important memories are kept in the prompt first"
          @change="changeImportance"
        >
          <option v-for="level in IMPORTANCE_LEVELS" :key="level.value" :value="level.value">
            {{ level.label }}
          </option>
        </select>

        <RouterLink v-if="sourceLink" class="source" :to="sourceLink">
          <i class="fas fa-book-open"></i> {{ memory.sourceTitle }}
        </RouterLink>
        <span v-else-if="memory.sourceType === 'manual'" class="source">
          <i class="fas fa-pen-nib"></i> Written by you
        </span>
      </div>

      <div v-if="!editing" class="memory-actions">
        <button
          v-if="memory.needsReview"
          class="icon-btn"
          title="It's still right"
          :disabled="busy"
          @click="$emit('update', memory, { needsReview: false })"
        >
          <i class="fas fa-check"></i>
        </button>
        <template v-if="isCurrent">
          <button
            v-if="memory.layer === 'knowledge'"
            class="icon-btn"
            :class="{ active: memory.pinned }"
            :title="memory.pinned ? 'Unpin' : 'Pin: always include it in the prompt'"
            :disabled="busy"
            @click="$emit('update', memory, { pinned: !memory.pinned })"
          >
            <i class="fas fa-thumbtack"></i>
          </button>
          <button class="icon-btn" title="Edit" :disabled="busy" @click="startEdit">
            <i class="fas fa-pen"></i>
          </button>
          <button
            class="icon-btn"
            title="Retire: the character stops remembering it"
            :disabled="busy"
            @click="$emit('update', memory, { retired: true })"
          >
            <i class="fas fa-box-archive"></i>
          </button>
        </template>
        <button
          v-else
          class="icon-btn"
          :title="
            memory.supersededBy
              ? 'Restore this version, retiring the one that replaced it'
              : 'Restore'
          "
          :disabled="busy"
          @click="$emit('update', memory, { retired: false })"
        >
          <i class="fas fa-rotate-left"></i>
        </button>
        <button class="icon-btn" title="Delete" :disabled="busy" @click="$emit('remove', memory)">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  </li>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue';
import { IMPORTANCE_LEVELS } from '../../composables/bureau/memories';

const props = defineProps({
  memory: { type: Object, required: true },
  bureauId: { type: String, required: true },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['update', 'remove']);

const editing = ref(false);
const draft = ref('');
const editorRef = ref(null);

const isCurrent = computed(() => !props.memory.retired && props.memory.supersededBy === null);

// Story memories link to the first passage they came from.
const sourceLink = computed(() => {
  const { memory } = props;
  if (memory.sourceType !== 'story' || !memory.sourceTitle) return null;
  return {
    name: 'bureau-story',
    params: { bureauId: props.bureauId, storyId: memory.sourceId },
    query: memory.sourceTurnIds.length > 0 ? { turn: memory.sourceTurnIds[0] } : {},
  };
});

function changeImportance(event) {
  const importance = Number(event.target.value);
  // Keep showing the saved importance; the new one arrives with the updated memory, and a
  // failed save leaves nothing stale behind.
  event.target.value = String(props.memory.importance);
  emit('update', props.memory, { importance });
}

function startEdit() {
  draft.value = props.memory.content;
  editing.value = true;
  nextTick(() => editorRef.value?.focus());
}

function save() {
  const content = draft.value.trim();
  if (!content) return;
  editing.value = false;
  if (content !== props.memory.content) {
    emit('update', props.memory, { content });
  }
}
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.memory {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.625rem 0.75rem;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.memory.is-pinned {
  border-left: 3px solid var(--accent-primary);
}

.memory.needs-review {
  border-color: var(--warning-color, #d49b2a);
}

.memory-content {
  margin: 0;
  line-height: 1.5;
  white-space: pre-wrap;
}

.memory-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.memory-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.375rem 0.75rem;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.review-badge {
  color: var(--warning-color, #d49b2a);
  font-weight: 600;
}

.meta-tag {
  font-weight: 600;
}

.importance-select {
  font-size: 0.78rem;
  padding: 0.0625rem 0.25rem;
  color: var(--text-secondary);
  background-color: transparent;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color-scheme: light dark;
}

.source {
  color: var(--text-secondary);
  text-decoration: none;
}

a.source:hover {
  color: var(--accent-primary);
  text-decoration: underline;
}

.memory-actions {
  display: flex;
  gap: 0.125rem;
  margin-left: auto;
}

.memory-actions .icon-btn {
  font-size: 0.8rem;
  min-width: 1.75rem;
  padding: 0.25rem !important;
}

.memory-actions .icon-btn.active {
  color: var(--accent-primary);
}

.memory-editor {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
