<template>
  <div class="bureau-story-page">
    <header class="story-header">
      <div class="header-left">
        <button class="btn btn-secondary btn-small back-button" @click="backToBureau">
          <i class="fas fa-arrow-left"></i>
          <span class="back-label">{{ bureau?.name || 'Bureau' }}</span>
        </button>
        <input
          v-if="editingTitle"
          ref="titleInput"
          v-model="titleDraft"
          class="title-input"
          type="text"
          aria-label="Story title"
          @keydown.enter="saveTitle"
          @keydown.esc="editingTitle = false"
          @blur="saveTitle"
        />
        <h1 v-else class="story-title" title="Rename this story" @click="startTitleEdit">
          {{ story?.title || 'Story' }}
        </h1>
        <span v-if="story?.status === 'ended'" class="status-badge">Ended</span>
      </div>
      <div class="header-right">
        <span v-if="story" class="story-time">
          <i class="fas fa-clock"></i> {{ formatDateTime(story.startTime, bureau?.timezone) }}
        </span>
        <button
          class="icon-btn"
          title="Who's in this story"
          :disabled="!story"
          @click="showCast = true"
        >
          <i class="fas fa-users"></i>
        </button>
        <button
          v-if="bureau?.hasApiKey && hasUnarchived"
          class="btn btn-secondary btn-small header-action"
          :disabled="archiving"
          title="The Archivist reads the passages it hasn't read yet into the characters' memories"
          @click="commitToMemory"
        >
          <i class="fas fa-brain"></i>
          <span class="action-label">{{ archiving ? 'Committing...' : 'Commit to memory' }}</span>
        </button>
        <button
          v-if="story?.status === 'active'"
          class="btn btn-secondary btn-small"
          :disabled="generating"
          @click="showEnd = true"
        >
          <i class="fas fa-flag-checkered"></i> End story
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>Loading story...</p>
    </div>

    <div v-else-if="loadError" class="loading-container">
      <p>{{ loadError }}</p>
      <button class="btn btn-secondary" @click="backToBureau">Back to the Bureau</button>
    </div>

    <template v-else>
      <main ref="readingRef" class="story-reading">
        <div class="story-column">
          <p v-if="turns.length === 0 && !pending" class="story-empty">
            This story hasn't started. Write the opening yourself, give the Writer a direction, or
            press Continue and the Writer will set the scene.
          </p>

          <template v-for="turn in turns" :key="turn.id">
            <TurnSeam
              :bureau-id="bureauId"
              :turn="turn"
              :cast-by-id="castById"
              :live="pending?.regenerateTurnId === turn.id ? pending : null"
              :busy="generating || reverting"
              @revert-edit="revertEdit"
            />
            <TurnBlock
              :data-turn-id="turn.id"
              :class="{ 'is-highlighted': highlightTurnId === turn.id }"
              :turn="turn"
              :override-content="pending?.regenerateTurnId === turn.id ? pending.content : null"
              :busy="generating"
              :can-regenerate="story.status === 'active' && bureau.hasApiKey"
              @save="saveTurn"
              @regenerate="regenerate"
              @delete="deleteTurn"
              @select-variant="selectVariant"
            />
          </template>

          <template v-if="pending && !pending.regenerateTurnId">
            <TurnSeam :bureau-id="bureauId" :live="pending" />
            <article class="pending-turn">
              <div v-if="pending.content" class="prose" v-html="renderProse(pending.content)"></div>
              <p v-else class="pending-placeholder">{{ pending.status }}</p>
            </article>
          </template>
        </div>
      </main>

      <StoryComposer
        v-if="story.status === 'active'"
        ref="composerRef"
        :cast="storyCast"
        :generating="generating"
        :has-api-key="bureau.hasApiKey"
        @generate="generate"
        @scene-break="addSceneBreak"
        @stop="stop"
      />
      <div v-else class="ended-bar">
        This story has ended. Start the next one from
        <button class="link-button" @click="backToBureau">{{ bureau.name }}</button>.
      </div>
    </template>

    <EndStoryModal
      v-if="showEnd"
      :bureau="bureau"
      :story="story"
      @close="showEnd = false"
      @ended="handleEnded"
    />
    <StoryCastModal
      v-if="showCast"
      :bureau-id="bureauId"
      :story="story"
      :cast="cast"
      :readonly="story.status !== 'active'"
      @close="showCast = false"
      @updated="handleStoryUpdated"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { bureausAPI, bureauStoriesAPI } from '../../services/bureauApi';
import { describeArchive } from '../../composables/bureau/memories';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { setPageTitle } from '../../router';
import { renderProse } from '../../composables/bureau/renderProse';
import { formatDateTime } from '../../composables/bureau/format';
import TurnBlock from '../../components/bureau/TurnBlock.vue';
import TurnSeam from '../../components/bureau/TurnSeam.vue';
import StoryComposer from '../../components/bureau/StoryComposer.vue';
import EndStoryModal from '../../components/bureau/EndStoryModal.vue';
import StoryCastModal from '../../components/bureau/StoryCastModal.vue';

const props = defineProps({
  bureauId: { type: String, required: true },
  storyId: { type: String, required: true },
});

const HIGHLIGHT_DURATION = 2500;

const STAGE_LABELS = {
  directing: 'Planning the scene...',
  writing: 'Writing...',
  editing: 'Editing...',
};

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { confirm } = useConfirm();

const bureau = ref(null);
const story = ref(null);
const turns = ref([]);
const cast = ref([]);
const loading = ref(true);
const loadError = ref('');

const generating = ref(false);
const pending = ref(null);
let abortController = null;

const showEnd = ref(false);
const showCast = ref(false);
const editingTitle = ref(false);
const titleDraft = ref('');
const titleInput = ref(null);
const readingRef = ref(null);
const composerRef = ref(null);
const archiving = ref(false);
const reverting = ref(false);
const highlightTurnId = ref(null);

// Prose the Archivist hasn't read yet.
const hasUnarchived = computed(
  () =>
    Boolean(story.value) &&
    turns.value.some(
      (turn) => turn.kind === 'prose' && turn.position > story.value.archivedThrough,
    ),
);

const castById = computed(() =>
  Object.fromEntries(cast.value.map((member) => [member.id, member])),
);
const storyCast = computed(() =>
  (story.value?.castIds ?? []).map((castId) => castById.value[castId]).filter(Boolean),
);

// ==================== Loading ====================

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const [bureauData, storyData, castData] = await Promise.all([
      bureausAPI.get(props.bureauId),
      bureauStoriesAPI.get(props.bureauId, props.storyId),
      bureausAPI.listCast(props.bureauId),
    ]);
    bureau.value = bureauData.bureau;
    story.value = storyData.story;
    turns.value = storyData.turns;
    cast.value = castData.cast;
    setPageTitle(story.value.title);
  } catch (error) {
    console.error('Failed to load story:', error);
    loadError.value =
      error.status === 404 ? 'This story no longer exists.' : `Failed to load: ${error.message}`;
  } finally {
    loading.value = false;
  }
  // Memory sources link to the passage they came from.
  if (!(await revealTurn(route.query.turn))) {
    scrollToEnd();
  }
}

async function refreshStory() {
  try {
    const data = await bureauStoriesAPI.get(props.bureauId, props.storyId);
    story.value = data.story;
    turns.value = data.turns;
  } catch (error) {
    toast.error('Failed to refresh the story: ' + error.message);
  }
}

// ==================== Scrolling ====================

function isNearBottom() {
  const element = readingRef.value;
  return !element || element.scrollHeight - element.scrollTop - element.clientHeight < 200;
}

async function scrollToEnd() {
  await nextTick();
  if (readingRef.value) {
    readingRef.value.scrollTop = readingRef.value.scrollHeight;
  }
}

/** Scroll a turn into view and highlight it briefly. Returns whether the turn was found. */
async function revealTurn(turnId) {
  if (typeof turnId !== 'string' || !turns.value.some((turn) => turn.id === turnId)) {
    return false;
  }
  await nextTick();
  const element = readingRef.value?.querySelector(`[data-turn-id="${turnId}"]`);
  if (!element) return false;

  element.scrollIntoView({ block: 'center' });
  highlightTurnId.value = turnId;
  setTimeout(() => {
    if (highlightTurnId.value === turnId) highlightTurnId.value = null;
  }, HIGHLIGHT_DURATION);
  return true;
}

// ==================== Generation ====================

/**
 * Run a streaming generation. `start` receives the abort signal and returns the
 * event stream. The story is reloaded afterward so it matches what was saved.
 */
async function runStream(start, { regenerateTurnId = null, composerText = '' } = {}) {
  if (generating.value) return;

  abortController = new AbortController();
  generating.value = true;
  pending.value = {
    status: 'Starting...',
    content: '',
    reasoning: '',
    brief: null,
    runId: null,
    regenerateTurnId,
  };
  let readerTurnSaved = false;
  let stopped = false;

  try {
    for await (const event of start(abortController.signal)) {
      const follow = isNearBottom();
      if (event.type === 'turn') {
        readerTurnSaved = true;
        turns.value = [...turns.value, event.turn];
      } else if (event.type === 'run') {
        pending.value.runId = event.runId;
      } else if (event.type === 'stage') {
        pending.value.status = STAGE_LABELS[event.stage] ?? pending.value.status;
      } else if (event.type === 'brief') {
        pending.value.brief = event.brief;
      } else if (event.type === 'reasoning') {
        pending.value.reasoning += event.text;
        pending.value.status = 'Thinking...';
      } else if (event.type === 'content') {
        pending.value.content += event.text;
        pending.value.status = 'Writing...';
      }
      if (follow) scrollToEnd();
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      stopped = true;
      toast.info('Stopped. Anything already written was kept.');
    } else {
      console.error('Generation failed:', error);
      toast.error('Generation failed: ' + error.message);
      // Nothing was saved, so give the reader their words back.
      if (!readerTurnSaved && composerText) {
        composerRef.value?.restore(composerText);
      }
    }
  } finally {
    generating.value = false;
    pending.value = null;
    abortController = null;
  }

  await refreshStory();
  if (stopped) {
    // The server saves the partial text once it notices the disconnect.
    setTimeout(refreshStory, 1000);
  }
}

function generate({ action, text, leadCastId }) {
  runStream(
    (signal) =>
      bureauStoriesAPI.generate(
        props.bureauId,
        props.storyId,
        { action, text, leadCastId },
        signal,
      ),
    { composerText: text },
  );
}

function regenerate(turn) {
  runStream(
    (signal) => bureauStoriesAPI.regenerate(props.bureauId, props.storyId, turn.id, signal),
    { regenerateTurnId: turn.id },
  );
}

function stop() {
  abortController?.abort();
}

// ==================== Turns ====================

function replaceTurn(updated) {
  turns.value = turns.value.map((turn) => (turn.id === updated.id ? updated : turn));
}

async function addSceneBreak() {
  try {
    const { turn } = await bureauStoriesAPI.addTurn(props.bureauId, props.storyId, {
      kind: 'scene_break',
    });
    turns.value = [...turns.value, turn];
    scrollToEnd();
  } catch (error) {
    toast.error('Failed to add a scene break: ' + error.message);
  }
}

async function saveTurn(turn, content) {
  try {
    const { turn: updated } = await bureauStoriesAPI.editTurn(
      props.bureauId,
      props.storyId,
      turn.id,
      content,
    );
    replaceTurn(updated);
  } catch (error) {
    toast.error('Failed to save the edit: ' + error.message);
  }
}

async function deleteTurn(turn) {
  const versions = turn.variants.length > 1 ? ` and all ${turn.variants.length} versions` : '';
  const confirmed = await confirm({
    message: `Delete this ${turn.kind === 'scene_break' ? 'scene break' : 'passage'}${versions}?`,
    confirmText: 'Delete',
    variant: 'danger',
  });
  if (!confirmed) return;

  try {
    await bureauStoriesAPI.deleteTurn(props.bureauId, props.storyId, turn.id);
    turns.value = turns.value.filter((item) => item.id !== turn.id);
  } catch (error) {
    toast.error('Failed to delete: ' + error.message);
  }
}

async function revertEdit({ turn, runId, index }) {
  if (reverting.value) return;
  reverting.value = true;
  try {
    const { turn: updated } = await bureauStoriesAPI.revertEdit(
      props.bureauId,
      props.storyId,
      turn.id,
      { runId, index },
    );
    replaceTurn(updated);
  } catch (error) {
    toast.error('Failed to revert the fix: ' + error.message);
  } finally {
    reverting.value = false;
  }
}

async function selectVariant(turn, variantId) {
  try {
    const { turn: updated } = await bureauStoriesAPI.selectVariant(
      props.bureauId,
      props.storyId,
      turn.id,
      variantId,
    );
    replaceTurn(updated);
  } catch (error) {
    toast.error('Failed to switch versions: ' + error.message);
  }
}

// ==================== Story ====================

function startTitleEdit() {
  if (!story.value) return;
  titleDraft.value = story.value.title;
  editingTitle.value = true;
  nextTick(() => titleInput.value?.select());
}

async function saveTitle() {
  if (!editingTitle.value) return;
  editingTitle.value = false;

  const title = titleDraft.value.trim();
  if (!title || title === story.value.title) return;
  try {
    const { story: updated } = await bureauStoriesAPI.update(props.bureauId, props.storyId, {
      title,
    });
    story.value = updated;
    setPageTitle(updated.title);
  } catch (error) {
    toast.error('Failed to rename the story: ' + error.message);
  }
}

async function commitToMemory() {
  if (archiving.value) return;
  archiving.value = true;
  try {
    const { story: updated, archive } = await bureauStoriesAPI.archive(
      props.bureauId,
      props.storyId,
    );
    story.value = updated;
    toast.success(describeArchive(archive));
  } catch (error) {
    toast.error('Failed to commit to memory: ' + error.message);
  } finally {
    archiving.value = false;
  }
}

function handleEnded({ story: endedStory, bureau: updatedBureau, archive, archiveError }) {
  showEnd.value = false;
  story.value = endedStory;
  bureau.value = updatedBureau;
  if (archiveError) {
    toast.error(`The story ended, but committing it to memory failed: ${archiveError}`);
  } else {
    toast.success(archive ? `Story ended. ${describeArchive(archive)}` : 'Story ended');
  }
}

function handleStoryUpdated(updated) {
  showCast.value = false;
  story.value = updated;
}

function backToBureau() {
  router.push({ name: 'bureau', params: { bureauId: props.bureauId } });
}

onMounted(load);
onBeforeUnmount(() => abortController?.abort());
</script>

<style scoped src="../../components/bureau/bureau-ui.css"></style>

<style scoped>
.bureau-story-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background-color: var(--bg-secondary);
}

.story-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background-color: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  box-shadow: var(--shadow);
  position: relative;
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  min-width: 0;
}

.back-button {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  flex-shrink: 0;
  max-width: 14rem;
}

.back-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.story-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 600;
  color: var(--primary-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
}

.title-input {
  flex: 1;
  min-width: 0;
  font-size: 1.2rem;
  font-weight: 600;
  padding: 0.25rem 0.5rem;
  color: var(--text-primary);
  background-color: var(--bg-tertiary);
  border: 1px solid var(--accent-primary);
  border-radius: 4px;
  outline: none;
}

.status-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 0.0625rem 0.5rem;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.story-time {
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.loading-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-secondary);
}

.story-reading {
  flex: 1;
  overflow-y: auto;
  background-color: var(--bg-primary);
}

.story-column {
  max-width: 700px;
  margin: 0 auto;
  padding: 2rem 2rem 3rem;
  font-size: 1rem;
  line-height: 1.8;
  color: var(--text-primary);
}

.story-empty {
  color: var(--text-secondary);
  font-style: italic;
  text-align: center;
  margin: 3rem 0;
}

.header-action {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.is-highlighted {
  animation: turn-highlight 2.5s ease-out;
  border-radius: 6px;
}

@keyframes turn-highlight {
  from {
    background-color: rgba(212, 155, 42, 0.2);
  }
  to {
    background-color: transparent;
  }
}

.pending-turn .prose :deep(p) {
  margin: 0 0 1em;
}

.pending-placeholder {
  margin: 0;
  color: var(--text-secondary);
  font-style: italic;
}

.ended-bar {
  padding: 1rem 2rem;
  text-align: center;
  color: var(--text-secondary);
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
}

.link-button {
  padding: 0;
  background: none;
  border: none;
  color: var(--accent-primary);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

@media (max-width: 700px) {
  .story-header {
    padding: 0.625rem 0.75rem;
    flex-wrap: wrap;
  }

  .back-label,
  .story-time,
  .action-label {
    display: none;
  }

  .story-column {
    padding: 1.25rem 1rem 2rem;
  }
}
</style>
