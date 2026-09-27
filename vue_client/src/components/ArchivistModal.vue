<template>
  <Modal title="Archivist" max-width="760px" @close="close">
    <p v-if="loading" class="archivist-hint">Loading suggestions...</p>
    <template v-else>
      <p v-if="running" class="archivist-hint">
        <i class="fas fa-spinner fa-spin"></i> The Archivist is reading this {{ kind }}...
      </p>
      <p v-else-if="suggestions.length === 0" class="archivist-hint">
        {{
          hasRun
            ? `Nothing to change: the cards already match this ${kind}.`
            : `The Archivist reads this ${kind} and suggests edits to its characters' descriptions and personalities, for lasting changes like a new relationship or goal. Nothing changes until you accept it, and accepted edits can be restored from each card's History.`
        }}
      </p>

      <section v-for="group in groups" :key="group.characterId" class="character-group">
        <h3>{{ group.name }}</h3>
        <article
          v-for="suggestion in group.suggestions"
          :key="suggestion.id"
          class="suggestion"
          :class="{
            'is-accepted': decisions[suggestion.id] === true,
            'is-rejected': decisions[suggestion.id] === false,
          }"
        >
          <header class="suggestion-header">
            <span class="meta-tag">{{ FIELD_LABELS[suggestion.field] }}</span>
            <span v-if="suggestion.stale" class="stale-tag">
              The card changed and this no longer fits
            </span>
          </header>

          <div class="suggestion-edit">
            <template v-if="suggestion.find">
              <del>{{ suggestion.find }}</del>
              <i class="fas fa-arrow-right edit-arrow"></i>
            </template>
            <span v-else class="edit-add">Add:</span>
            <textarea
              v-if="editing[suggestion.id] !== undefined"
              v-model="editing[suggestion.id]"
              class="edit-text"
              rows="3"
            ></textarea>
            <ins v-else>{{ replacementFor(suggestion) }}</ins>
          </div>

          <p v-if="suggestion.rationale" class="suggestion-why">{{ suggestion.rationale }}</p>
          <blockquote v-if="suggestion.quote" class="suggestion-quote">
            {{ suggestion.quote }}
          </blockquote>

          <div class="suggestion-actions">
            <button
              class="btn btn-small"
              :class="decisions[suggestion.id] === true ? 'btn-primary' : 'btn-secondary'"
              :disabled="busy || suggestion.stale"
              @click="decide(suggestion, true)"
            >
              <i class="fas fa-check"></i> Accept
            </button>
            <button
              class="btn btn-secondary btn-small"
              :disabled="busy || suggestion.stale"
              @click="toggleEdit(suggestion)"
            >
              <i class="fas fa-pencil"></i>
              {{ editing[suggestion.id] !== undefined ? 'Done' : 'Edit' }}
            </button>
            <button
              class="btn btn-small"
              :class="decisions[suggestion.id] === false ? 'btn-primary' : 'btn-secondary'"
              :disabled="busy"
              @click="decide(suggestion, false)"
            >
              <i class="fas fa-xmark"></i> Reject
            </button>
          </div>
        </article>
      </section>
    </template>

    <template #footer>
      <button class="btn btn-secondary" :disabled="loading || busy" @click="read">
        <i class="fas fa-book-open"></i>
        {{ suggestions.length > 0 || hasRun ? 'Read Again' : `Read ${KIND_LABELS[kind]}` }}
      </button>
      <button
        v-if="suggestions.length > 0"
        class="btn btn-primary"
        :disabled="busy || decidedCount === 0"
        @click="apply"
      >
        Apply {{ decidedCount }} {{ decidedCount === 1 ? 'Decision' : 'Decisions' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import Modal from './Modal.vue';
import { archivistAPI } from '../services/api';
import { useToast } from '../composables/useToast';

const props = defineProps({
  kind: {
    type: String,
    required: true,
    validator: (value) => ['story', 'chat'].includes(value),
  },
  sourceId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['close', 'applied']);

const FIELD_LABELS = { description: 'Description', personality: 'Personality' };
const KIND_LABELS = { story: 'Story', chat: 'Chat' };

const toast = useToast();
const loading = ref(true);
const running = ref(false);
const applying = ref(false);
const hasRun = ref(false);
const suggestions = ref([]);
// Suggestion id -> true to accept, false to reject; undecided ones stay waiting.
const decisions = reactive({});
// Suggestion id -> the replacement being edited, or the edited one once done.
const editing = reactive({});
const edited = reactive({});
let controller = null;
let closed = false;

const busy = computed(() => running.value || applying.value);

const groups = computed(() => {
  const byCharacter = new Map();
  for (const suggestion of suggestions.value) {
    if (!byCharacter.has(suggestion.characterId)) {
      byCharacter.set(suggestion.characterId, {
        characterId: suggestion.characterId,
        name: suggestion.characterName,
        suggestions: [],
      });
    }
    byCharacter.get(suggestion.characterId).suggestions.push(suggestion);
  }
  return [...byCharacter.values()];
});

const decidedCount = computed(
  () => suggestions.value.filter((suggestion) => decisions[suggestion.id] !== undefined).length,
);

function replacementFor(suggestion) {
  return edited[suggestion.id] ?? suggestion.replace;
}

function show(list) {
  suggestions.value = list;
  const ids = new Set(list.map((suggestion) => suggestion.id));
  for (const store of [decisions, editing, edited]) {
    for (const id of Object.keys(store)) {
      if (!ids.has(Number(id))) delete store[id];
    }
  }
}

function decide(suggestion, accept) {
  if (decisions[suggestion.id] === accept) {
    delete decisions[suggestion.id];
  } else {
    decisions[suggestion.id] = accept;
  }
}

function toggleEdit(suggestion) {
  if (editing[suggestion.id] === undefined) {
    editing[suggestion.id] = replacementFor(suggestion);
    return;
  }
  const text = editing[suggestion.id].trim();
  delete editing[suggestion.id];
  if (text && text !== suggestion.replace) {
    edited[suggestion.id] = text;
    decisions[suggestion.id] = true;
  } else {
    delete edited[suggestion.id];
  }
}

// While a read started elsewhere (another tab) is running, check back until it's done.
const POLL_MS = 3000;
let pollTimer = null;

async function load() {
  pollTimer = null;
  try {
    const response = await archivistAPI.list(props.kind, props.sourceId);
    show(response.suggestions);
    if (running.value && !response.running) hasRun.value = true;
    running.value = response.running;
    if (response.running && !closed) pollTimer = setTimeout(load, POLL_MS);
  } catch (error) {
    toast.error('Failed to load suggestions: ' + error.message);
  } finally {
    loading.value = false;
  }
}

async function read() {
  running.value = true;
  controller = new AbortController();
  try {
    const response = await archivistAPI.run(props.kind, props.sourceId, {
      signal: controller.signal,
    });
    hasRun.value = true;
    show(response.suggestions);
    if (response.added > 0) {
      toast.success(`The Archivist suggested ${response.added} new edit(s)`);
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      toast.error('The Archivist failed: ' + error.message);
    }
  } finally {
    running.value = false;
    controller = null;
  }
}

async function apply() {
  // An edit still open counts as done.
  for (const suggestion of suggestions.value) {
    if (editing[suggestion.id] !== undefined) toggleEdit(suggestion);
  }
  const list = suggestions.value
    .filter((suggestion) => decisions[suggestion.id] !== undefined)
    .map((suggestion) => ({
      id: suggestion.id,
      accept: decisions[suggestion.id],
      ...(decisions[suggestion.id] && edited[suggestion.id] !== undefined
        ? { replace: edited[suggestion.id] }
        : {}),
    }));
  applying.value = true;
  try {
    const response = await archivistAPI.review(props.kind, props.sourceId, list);
    show(response.suggestions);
    for (const id of response.stale) delete decisions[id];
    if (response.applied > 0) {
      toast.success(`Updated the cards with ${response.applied} edit(s)`);
      emit('applied');
    }
    if (response.stale.length > 0) {
      toast.error(`${response.stale.length} edit(s) no longer fit their card and were left`);
    }
  } catch (error) {
    toast.error('Failed to apply: ' + error.message);
  } finally {
    applying.value = false;
  }
}

function close() {
  emit('close');
}

onMounted(load);
onBeforeUnmount(() => {
  closed = true;
  controller?.abort();
  clearTimeout(pollTimer);
});
</script>

<style scoped>
.archivist-hint {
  color: var(--text-secondary);
  margin: 0 0 1rem;
  line-height: 1.5;
}

.character-group + .character-group {
  margin-top: 1.5rem;
}

.character-group h3 {
  margin: 0 0 0.75rem;
  font-size: 1rem;
  color: var(--text-primary);
}

.suggestion {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  background: var(--bg-secondary);
}

.suggestion + .suggestion {
  margin-top: 0.75rem;
}

.suggestion.is-accepted {
  border-color: var(--accent-primary);
}

.suggestion.is-rejected {
  opacity: 0.6;
}

.suggestion-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.stale-tag {
  font-size: 0.8rem;
  color: var(--warning);
}

.suggestion-edit {
  line-height: 1.5;
  color: var(--text-primary);
  white-space: pre-wrap;
}

.suggestion-edit del {
  color: var(--text-secondary);
}

.suggestion-edit ins {
  text-decoration: none;
  background: rgba(var(--accent-primary-rgb), 0.15);
  border-radius: 3px;
  padding: 0 2px;
}

.edit-arrow {
  margin: 0 0.4rem;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.edit-add {
  color: var(--text-secondary);
  margin-right: 0.4rem;
}

.edit-text {
  display: block;
  width: 100%;
  margin-top: 0.5rem;
  box-sizing: border-box;
}

.suggestion-why {
  margin: 0.5rem 0 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.suggestion-quote {
  margin: 0.5rem 0 0;
  padding-left: 0.75rem;
  border-left: 2px solid var(--border-color);
  font-style: italic;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.suggestion-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}
</style>
