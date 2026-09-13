<template>
  <li class="arc-note" :class="[`is-${note.status}`, { 'needs-review': note.needsReview }]">
    <div v-if="editing" class="note-editor">
      <textarea
        ref="editorRef"
        v-model="draft"
        class="textarea-input"
        rows="3"
        aria-label="Edit this arc note"
        @keydown.meta.enter.prevent="save"
        @keydown.ctrl.enter.prevent="save"
        @keydown.esc="editing = false"
      ></textarea>
      <div class="editor-actions">
        <button class="btn btn-secondary btn-small" @click="editing = false">Cancel</button>
        <button class="btn btn-primary btn-small" :disabled="!draft.trim() || busy" @click="save">
          <i class="fas fa-check"></i>
          {{ note.status === 'proposed' ? 'Accept with edits' : 'Save' }}
        </button>
      </div>
    </div>
    <p v-else class="note-content">{{ note.content }}</p>

    <p v-if="note.rationale && !editing" class="note-rationale">{{ note.rationale }}</p>

    <div class="note-footer">
      <div class="note-meta">
        <span
          v-if="note.needsReview"
          class="review-badge"
          title="A passage this note came from was changed or deleted"
        >
          <i class="fas fa-triangle-exclamation"></i> Check this
        </span>
        <span v-if="note.status === 'proposed'" class="meta-tag">Waiting for review</span>
        <span v-else-if="note.status === 'rejected'" class="meta-tag">Rejected</span>
        <span v-if="edited" class="meta-tag" :title="`Proposed as: ${note.proposedContent}`">
          Edited
        </span>
        <RouterLink v-if="sourceLink" class="source" :to="sourceLink">
          <template v-if="note.sourceType === 'correspondence'">
            <i class="fas fa-comments"></i> Messages · {{ formatDate(note.worldTime) }}
          </template>
          <template v-else><i class="fas fa-book-open"></i> {{ note.sourceTitle }}</template>
        </RouterLink>
        <span v-else-if="note.sourceType === 'manual'" class="source">
          <i class="fas fa-pen-nib"></i> Written by you
        </span>
      </div>

      <div v-if="!editing" class="note-actions">
        <template v-if="note.status === 'proposed'">
          <button
            class="btn btn-primary btn-small"
            :disabled="busy"
            @click="$emit('update', note, { status: 'accepted' })"
          >
            <i class="fas fa-check"></i> Accept
          </button>
          <button class="icon-btn" title="Edit, then accept" :disabled="busy" @click="startEdit">
            <i class="fas fa-pen"></i>
          </button>
          <button
            class="icon-btn"
            title="Reject"
            :disabled="busy"
            @click="$emit('update', note, { status: 'rejected' })"
          >
            <i class="fas fa-xmark"></i>
          </button>
        </template>
        <template v-else-if="note.status === 'accepted'">
          <button
            v-if="note.needsReview"
            class="icon-btn"
            title="It's still right"
            :disabled="busy"
            @click="$emit('update', note, { needsReview: false })"
          >
            <i class="fas fa-check"></i>
          </button>
          <button class="icon-btn" title="Edit" :disabled="busy" @click="startEdit">
            <i class="fas fa-pen"></i>
          </button>
          <button
            class="icon-btn"
            title="Undo: reject this change"
            :disabled="busy"
            @click="$emit('update', note, { status: 'rejected' })"
          >
            <i class="fas fa-rotate-left"></i>
          </button>
        </template>
        <button
          v-else
          class="icon-btn"
          title="Accept after all"
          :disabled="busy"
          @click="$emit('update', note, { status: 'accepted' })"
        >
          <i class="fas fa-check"></i>
        </button>
        <button class="icon-btn" title="Delete" :disabled="busy" @click="$emit('remove', note)">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </div>
  </li>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue';
import { formatDate } from '../../composables/bureau/format';

const props = defineProps({
  note: { type: Object, required: true },
  bureauId: { type: String, required: true },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['update', 'remove']);

const editing = ref(false);
const draft = ref('');
const editorRef = ref(null);

const edited = computed(
  () => props.note.sourceType !== 'manual' && props.note.content !== props.note.proposedContent,
);

// Notes from a story link to the first passage they came from, and notes from messages to the thread.
const sourceLink = computed(() => {
  const { note } = props;
  if (note.sourceType === 'correspondence') {
    return {
      name: 'bureau-thread',
      params: { bureauId: props.bureauId, castId: note.castMemberId },
    };
  }
  if (note.sourceType !== 'story' || !note.sourceTitle) return null;
  return {
    name: 'bureau-story',
    params: { bureauId: props.bureauId, storyId: note.sourceId },
    query: note.sourceTurnIds.length > 0 ? { turn: note.sourceTurnIds[0] } : {},
  };
});

function startEdit() {
  draft.value = props.note.content;
  editing.value = true;
  nextTick(() => editorRef.value?.focus());
}

function save() {
  const content = draft.value.trim();
  if (!content) return;
  editing.value = false;
  if (props.note.status === 'proposed') {
    emit('update', props.note, { content, status: 'accepted' });
  } else if (content !== props.note.content) {
    emit('update', props.note, { content });
  }
}
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.arc-note {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.625rem 0.75rem;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.arc-note.is-proposed {
  border-left: 3px solid var(--accent-primary);
}

.arc-note.is-rejected .note-content {
  color: var(--text-secondary);
  text-decoration: line-through;
}

.arc-note.needs-review {
  border-color: var(--warning-color, #d49b2a);
}

.note-content {
  margin: 0;
  line-height: 1.5;
  white-space: pre-wrap;
}

.note-rationale {
  margin: 0;
  font-size: 0.82rem;
  font-style: italic;
  color: var(--text-secondary);
}

.note-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.note-meta {
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

.source {
  color: var(--text-secondary);
  text-decoration: none;
}

a.source:hover {
  color: var(--accent-primary);
  text-decoration: underline;
}

.note-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
}

.note-actions .icon-btn {
  font-size: 0.8rem;
  min-width: 1.75rem;
  padding: 0.25rem !important;
}

.note-editor {
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
