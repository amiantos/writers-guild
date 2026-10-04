<template>
  <Modal title="Archivist" max-width="760px" @close="close">
    <p v-if="loading" class="archivist-hint">Loading suggestions...</p>
    <template v-else>
      <p v-if="running" class="archivist-hint">
        <i class="fas fa-spinner fa-spin"></i> {{ readingLabel }}
      </p>
      <p v-else-if="failure" class="archivist-error" role="alert">
        <i class="fas fa-triangle-exclamation"></i> The last read failed: {{ failure }}
      </p>
      <p v-if="!running && !hasSuggestions && !failure" class="archivist-hint">
        {{ idleHint }}
      </p>

      <section v-if="continuitySuggestion" class="character-group">
        <h3>Continuity: {{ continuitySuggestion.continuityName }}</h3>
        <article
          class="suggestion"
          :class="{
            'is-accepted': continuityDecision === true,
            'is-rejected': continuityDecision === false,
          }"
        >
          <header v-if="continuitySuggestion.stale" class="suggestion-header">
            <span class="stale-tag">
              The Continuity changed since this was written. Read again for a new update.
            </span>
          </header>

          <textarea
            v-if="continuityEditing !== undefined"
            v-model="continuityEditing"
            class="edit-text"
            rows="8"
          ></textarea>
          <div v-else class="suggestion-edit">
            <template v-for="(piece, index) in continuityDiff" :key="index">
              <del v-if="piece.removed">{{ piece.text }}</del>
              <ins v-else-if="piece.added">{{ piece.text }}</ins>
              <span v-else>{{ piece.text }}</span>
            </template>
          </div>

          <p v-if="continuitySuggestion.rationale" class="suggestion-why">
            {{ continuitySuggestion.rationale }}
          </p>

          <div class="suggestion-actions">
            <button
              class="btn btn-small"
              :class="continuityDecision === true ? 'btn-primary' : 'btn-secondary'"
              :disabled="busy || continuitySuggestion.stale"
              @click="decideContinuity(true)"
            >
              <i class="fas fa-check"></i> Accept
            </button>
            <button
              class="btn btn-secondary btn-small"
              :disabled="busy || continuitySuggestion.stale"
              @click="toggleContinuityEdit"
            >
              <i class="fas fa-pencil"></i>
              {{ continuityEditing !== undefined ? 'Done' : 'Edit' }}
            </button>
            <button
              class="btn btn-small"
              :class="continuityDecision === false ? 'btn-primary' : 'btn-secondary'"
              :disabled="busy"
              @click="decideContinuity(false)"
            >
              <i class="fas fa-xmark"></i> Reject
            </button>
          </div>
        </article>
      </section>

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
      <button v-if="running" class="btn btn-secondary" :disabled="stopping" @click="stop">
        <i class="fas fa-stop"></i> Stop
      </button>
      <button v-else class="btn btn-secondary" :disabled="loading || busy" @click="read">
        <i class="fas fa-book-open"></i>
        {{ hasSuggestions || hasRun ? 'Read Again' : `Read ${KIND_LABELS[kind]}` }}
      </button>
      <button
        v-if="hasSuggestions"
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
const stopping = ref(false);
// The pass being read, as {index, count}, while a long source is read in several, and what the
// read is doing: 'continuity', 'compact' or 'cards'.
const progress = ref(null);
const stage = ref(null);
// Why the last read failed, until the next one starts.
const failure = ref(null);
const suggestions = ref([]);
// The Continuity this source is in, as {id, name}, when the Archivist updates it too.
const continuity = ref(null);
// The Continuity update waiting for review, and the reader's decision and edits to it.
const continuitySuggestion = ref(null);
const continuityDecision = ref(undefined);
const continuityEditing = ref(undefined);
const continuityEdited = ref(undefined);
// Suggestion id -> true to accept, false to reject; undecided ones stay waiting.
const decisions = reactive({});
// Suggestion id -> the replacement being edited, or the edited one once done.
const editing = reactive({});
const edited = reactive({});
let closed = false;
// The id of the newest read seen, and of the last one whose ending is already shown (or that
// came before the read this modal just started), so it isn't taken for a new one.
let latestRun = null;
let settledRun = null;
// Whether this modal asked for a read that the server hasn't been seen running yet.
let awaitingStart = false;

const busy = computed(() => running.value || applying.value);

const hasSuggestions = computed(
  () => suggestions.value.length > 0 || continuitySuggestion.value !== null,
);

const idleHint = computed(() => {
  const name = continuity.value?.name;
  if (name) {
    return hasRun.value
      ? `Nothing in this ${props.kind} to carry forward into "${name}".`
      : `This ${props.kind} is in the Continuity "${name}", so the Archivist reads it and suggests an update to the Continuity with what happened worked in, condensing it when it grows long. It also suggests additions to its characters' cards for what the ${props.kind} reveals about them, like their past, job or tastes. Nothing changes until you accept it, and accepted changes can be restored from History.`;
  }
  return hasRun.value
    ? `Nothing to change: the cards already cover what this ${props.kind} reveals.`
    : `The Archivist reads this ${props.kind} and suggests additions to its characters' descriptions and personalities for what it reveals about them, like their past, job or tastes. Nothing changes until you accept it, and accepted edits can be restored from each card's History.`;
});

/** Whether a character is part of a word, so a change isn't cut between two of them. */
function isWord(character) {
  return character !== undefined && !/\s/.test(character);
}

/**
 * The update against the Continuity as it stands: the text they share at the start and end, and
 * what changed between, cut at word boundaries so a change reads as whole words.
 */
const continuityDiff = computed(() => {
  const suggestion = continuitySuggestion.value;
  if (!suggestion) return [];
  const before = suggestion.current ?? '';
  const after = continuityEdited.value ?? suggestion.replace;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  while (isWord(after[start - 1]) && (isWord(after[start]) || isWord(before[start]))) start--;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  while (
    end > 0 &&
    isWord(after[after.length - end]) &&
    (isWord(after[after.length - end - 1]) || isWord(before[before.length - end - 1]))
  ) {
    end--;
  }
  return [
    { text: after.slice(0, start) },
    { text: before.slice(start, before.length - end), removed: true },
    { text: after.slice(start, after.length - end), added: true },
    { text: after.slice(after.length - end) },
  ].filter((piece) => piece.text);
});

const STAGE_LABELS = {
  continuity: 'for the Continuity',
  compact: 'and condensing the Continuity',
  cards: 'for the cards',
};

const readingLabel = computed(() => {
  const part = progress.value;
  const where = part && part.count > 1 ? `, part ${part.index + 1} of ${part.count}` : '';
  // A read that only reviews cards needn't say so.
  const what = continuity.value && STAGE_LABELS[stage.value] ? ` ${STAGE_LABELS[stage.value]}` : '';
  return `The Archivist is reading this ${props.kind}${what}${where}...`;
});

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
  () =>
    suggestions.value.filter((suggestion) => decisions[suggestion.id] !== undefined).length +
    (continuityDecision.value !== undefined ? 1 : 0),
);

function replacementFor(suggestion) {
  return edited[suggestion.id] ?? suggestion.replace;
}

/** Show a list's suggestions, keeping the decisions made on the ones still there. */
function show(response) {
  const list = response.suggestions ?? [];
  if (response.continuity !== undefined) continuity.value = response.continuity;
  const next = response.continuitySuggestion ?? null;
  if (next?.id !== continuitySuggestion.value?.id) {
    continuityDecision.value = undefined;
    continuityEditing.value = undefined;
    continuityEdited.value = undefined;
  }
  continuitySuggestion.value = next;
  suggestions.value = list;
  const ids = new Set(list.map((suggestion) => suggestion.id));
  for (const store of [decisions, editing, edited]) {
    for (const id of Object.keys(store)) {
      if (!ids.has(Number(id))) delete store[id];
    }
  }
}

function decide(suggestion, accept) {
  // Rejecting drops any edit made to it, so the edit can't turn it back into an accept.
  if (!accept) {
    delete editing[suggestion.id];
    delete edited[suggestion.id];
  }
  if (decisions[suggestion.id] === accept) {
    delete decisions[suggestion.id];
  } else {
    decisions[suggestion.id] = accept;
  }
}

function decideContinuity(accept) {
  if (!accept) {
    continuityEditing.value = undefined;
    continuityEdited.value = undefined;
  }
  continuityDecision.value = continuityDecision.value === accept ? undefined : accept;
}

function toggleContinuityEdit() {
  const suggestion = continuitySuggestion.value;
  if (continuityEditing.value === undefined) {
    continuityEditing.value = continuityEdited.value ?? suggestion.replace;
    return;
  }
  const text = continuityEditing.value.trim();
  continuityEditing.value = undefined;
  if (text && text !== suggestion.replace) {
    continuityEdited.value = text;
    continuityDecision.value = true;
  } else {
    continuityEdited.value = undefined;
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

// While a read is running, here or elsewhere (another tab), check back until it's done. A read
// outlives its request, so checking is how a read whose request dropped still reports back.
const POLL_MS = 3000;
let pollTimer = null;

function schedule() {
  clearTimeout(pollTimer);
  pollTimer = closed ? null : setTimeout(load, POLL_MS);
}

async function load() {
  pollTimer = null;
  try {
    const response = await archivistAPI.list(props.kind, props.sourceId);
    const run = response.run;
    const id = run?.id ?? null;
    latestRun = id;
    if (response.running && (id === null || id !== settledRun)) {
      running.value = true;
      awaitingStart = false;
      progress.value = run?.part ?? null;
      stage.value = run?.stage ?? null;
      show(response);
      schedule();
    } else if (running.value && awaitingStart && id === settledRun) {
      // The read just asked for hasn't started on the server yet.
      schedule();
    } else if (running.value) {
      finish(run, response);
    } else {
      show(response);
      // A read that failed while nobody was watching still says why.
      if (run?.error) failure.value = run.error;
    }
  } catch (error) {
    // A check that fails while a read runs is tried again, unless the source or the Archivist
    // is gone.
    if (running.value && error.status === 404) finish({ error: error.message }, null);
    else if (running.value) schedule();
    else toast.error('Failed to load suggestions: ' + error.message);
  } finally {
    loading.value = false;
  }
}

/**
 * Show how a read ended, once, whether its own answer or a later check brought the news, with the
 * list that came with it, if any.
 */
function finish(run, list) {
  if (!running.value) return;
  running.value = false;
  awaitingStart = false;
  progress.value = null;
  stage.value = null;
  clearTimeout(pollTimer);
  pollTimer = null;
  settledRun = run?.id ?? null;
  if (list) show(list);
  if (run?.cancelled) return;
  hasRun.value = true;
  if (run?.error) {
    failure.value = run.error;
    toast.error('The Archivist failed: ' + run.error);
  } else if (run?.added > 0) {
    toast.success(
      continuity.value
        ? `The Archivist made ${run.added} new suggestion(s) for "${continuity.value.name}" and its cards`
        : `The Archivist suggested ${run.added} new edit(s)`,
    );
  }
}

async function read() {
  running.value = true;
  progress.value = null;
  stage.value = null;
  failure.value = null;
  settledRun = latestRun;
  awaitingStart = true;
  schedule();
  try {
    const response = await archivistAPI.run(props.kind, props.sourceId);
    finish(response.run, response);
  } catch (error) {
    // The server's own answer says how the read ended. Anything else (a proxy or the browser
    // giving up on a long wait, or another read already running) leaves the checks to find out.
    if (error.run) finish(error.run, error.suggestions ? error : null);
    else if (!error.status || error.status >= 500 || error.status === 409) return;
    else finish({ error: error.message }, null);
  }
}

async function stop() {
  stopping.value = true;
  try {
    await archivistAPI.cancel(props.kind, props.sourceId);
  } catch (error) {
    toast.error('Failed to stop the Archivist: ' + error.message);
  } finally {
    stopping.value = false;
  }
}

async function apply() {
  // An edit still open counts as done, unless its suggestion is rejected.
  for (const suggestion of suggestions.value) {
    if (editing[suggestion.id] === undefined) continue;
    if (decisions[suggestion.id] === false) delete editing[suggestion.id];
    else toggleEdit(suggestion);
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
  if (continuityEditing.value !== undefined) {
    if (continuityDecision.value === false) continuityEditing.value = undefined;
    else toggleContinuityEdit();
  }
  const suggestion = continuitySuggestion.value;
  const continuityReview =
    suggestion && continuityDecision.value !== undefined
      ? {
          id: suggestion.id,
          accept: continuityDecision.value,
          ...(continuityDecision.value && continuityEdited.value !== undefined
            ? { replace: continuityEdited.value }
            : {}),
        }
      : undefined;
  applying.value = true;
  try {
    const response = continuityReview
      ? await archivistAPI.review(props.kind, props.sourceId, list, continuityReview)
      : await archivistAPI.review(props.kind, props.sourceId, list);
    show(response);
    for (const id of response.stale) delete decisions[id];
    if (response.continuityStale) continuityDecision.value = undefined;
    if (response.applied > 0) {
      toast.success(`Updated the cards with ${response.applied} edit(s)`);
    }
    if (response.continuityApplied) {
      toast.success(`Updated "${suggestion.continuityName}"`);
    }
    if (response.applied > 0 || response.continuityApplied) emit('applied');
    if (response.stale.length > 0) {
      toast.error(`${response.stale.length} edit(s) no longer fit their card and were left`);
    }
    if (response.continuityStale) {
      toast.error('The Continuity changed since this update was written, so it was left');
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
// Closing doesn't stop a read: it goes on, and opening this again shows how far it got.
onBeforeUnmount(() => {
  closed = true;
  clearTimeout(pollTimer);
});
</script>

<style scoped>
.archivist-hint {
  color: var(--text-secondary);
  margin: 0 0 1rem;
  line-height: 1.5;
}

.archivist-error {
  color: var(--danger);
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
