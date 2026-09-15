<template>
  <li
    class="fact"
    :class="[`is-${fact.status}`, { 'is-replaced': isReplaced, 'needs-review': fact.needsReview }]"
  >
    <div v-if="editing" class="fact-editor">
      <textarea
        ref="editorRef"
        v-model="draft"
        class="textarea-input"
        rows="2"
        aria-label="Edit this fact"
        @keydown.meta.enter.prevent="save"
        @keydown.ctrl.enter.prevent="save"
        @keydown.esc="editing = false"
      ></textarea>
      <div class="editor-actions">
        <button class="btn btn-secondary btn-small" @click="editing = false">Cancel</button>
        <button class="btn btn-primary btn-small" :disabled="!draft.trim() || busy" @click="save">
          <i class="fas fa-check"></i>
          {{ fact.status === 'proposed' ? 'Accept with edits' : 'Save' }}
        </button>
      </div>
    </div>
    <p v-else class="fact-content">{{ fact.content }}</p>

    <template v-if="!editing">
      <p v-if="fact.replacesContent" class="fact-detail">
        {{ replacesLabel }}: {{ fact.replacesContent }}
      </p>
      <p v-if="fact.rationale" class="fact-detail fact-rationale">{{ fact.rationale }}</p>
    </template>

    <div class="fact-footer">
      <div class="fact-meta">
        <span
          v-if="fact.needsReview"
          class="review-badge"
          title="A passage or message this fact came from was changed or deleted"
        >
          <i class="fas fa-triangle-exclamation"></i> Check this
        </span>
        <span v-if="fact.status === 'proposed'" class="meta-tag">Waiting for review</span>
        <span v-else-if="fact.status === 'rejected'" class="meta-tag">Rejected</span>
        <span v-else-if="isReplaced" class="meta-tag">Replaced by a later fact</span>
        <span v-if="edited" class="meta-tag" :title="`Proposed as: ${fact.proposedContent}`">
          Edited
        </span>
        <RouterLink v-if="sourceLink" class="source" :to="sourceLink">
          <i class="fas fa-book-open"></i> {{ fact.sourceTitle }}
        </RouterLink>
        <span v-else-if="fact.sourceType === 'correspondence'" class="source">
          <i class="fas fa-comments"></i> Messages · {{ formatDate(fact.worldTime) }}
        </span>
        <span v-else-if="fact.sourceType === 'manual'" class="source">
          <i class="fas fa-pen-nib"></i> Written by you
        </span>
      </div>

      <div v-if="!editing" class="fact-actions">
        <template v-if="fact.status === 'proposed'">
          <button
            class="btn btn-primary btn-small"
            :disabled="busy"
            @click="$emit('update', fact, { status: 'accepted' })"
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
            @click="$emit('update', fact, { status: 'rejected' })"
          >
            <i class="fas fa-xmark"></i>
          </button>
        </template>
        <template v-else-if="fact.status === 'accepted'">
          <button
            v-if="fact.needsReview"
            class="icon-btn"
            title="It's still right"
            :disabled="busy"
            @click="$emit('update', fact, { needsReview: false })"
          >
            <i class="fas fa-check"></i>
          </button>
          <button
            v-if="!isReplaced"
            class="icon-btn"
            title="Edit"
            :disabled="busy"
            @click="startEdit"
          >
            <i class="fas fa-pen"></i>
          </button>
          <button
            v-if="fact.sourceType !== 'manual'"
            class="icon-btn"
            title="Undo: reject this change"
            :disabled="busy"
            @click="$emit('update', fact, { status: 'rejected' })"
          >
            <i class="fas fa-rotate-left"></i>
          </button>
        </template>
        <button
          v-else
          class="icon-btn"
          title="Accept after all"
          :disabled="busy"
          @click="$emit('update', fact, { status: 'accepted' })"
        >
          <i class="fas fa-check"></i>
        </button>
        <button class="icon-btn" title="Delete" :disabled="busy" @click="$emit('remove', fact)">
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
  fact: { type: Object, required: true },
  bureauId: { type: String, required: true },
  busy: { type: Boolean, default: false },
});

const emit = defineEmits(['update', 'remove']);

const editing = ref(false);
const draft = ref('');
const editorRef = ref(null);

const isReplaced = computed(
  () => props.fact.status === 'accepted' && props.fact.replacedBy !== null,
);

const edited = computed(
  () => props.fact.sourceType !== 'manual' && props.fact.content !== props.fact.proposedContent,
);

const replacesLabel = computed(
  () =>
    ({ proposed: 'Would replace', accepted: 'Replaced', rejected: 'Would have replaced' })[
      props.fact.status
    ],
);

// A fact from a chapter links to the first passage it came from.
const sourceLink = computed(() => {
  const { fact } = props;
  if (fact.sourceType !== 'story' || !fact.sourceTitle) return null;
  return {
    name: 'bureau-story',
    params: { bureauId: props.bureauId, storyId: fact.sourceId },
    query: fact.sourceTurnIds.length > 0 ? { turn: fact.sourceTurnIds[0] } : {},
  };
});

function startEdit() {
  draft.value = props.fact.content;
  editing.value = true;
  nextTick(() => editorRef.value?.focus());
}

function save() {
  const content = draft.value.trim();
  if (!content) return;
  editing.value = false;
  if (props.fact.status === 'proposed') {
    emit('update', props.fact, { content, status: 'accepted' });
  } else if (content !== props.fact.content) {
    emit('update', props.fact, { content });
  }
}
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.fact {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.625rem 0.75rem;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.fact.is-proposed {
  border-left: 3px solid var(--accent-primary);
}

.fact.is-rejected .fact-content,
.fact.is-replaced .fact-content {
  color: var(--text-secondary);
  text-decoration: line-through;
}

.fact.needs-review {
  border-color: var(--warning-color, #d49b2a);
}

.fact-content {
  margin: 0;
  line-height: 1.5;
  white-space: pre-wrap;
}

.fact-detail {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.fact-rationale {
  font-style: italic;
}

.fact-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.fact-meta {
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

.fact-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
}

.fact-actions .icon-btn {
  font-size: 0.8rem;
  min-width: 1.75rem;
  padding: 0.25rem !important;
}

.fact-editor {
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
