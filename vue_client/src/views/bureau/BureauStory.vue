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
          aria-label="Chapter title"
          @keydown.enter="saveTitle"
          @keydown.esc="editingTitle = false"
          @blur="saveTitle"
        />
        <h1 v-else class="story-title" title="Rename this chapter" @click="startTitleEdit">
          {{ story?.title || 'Chapter' }}
        </h1>
        <span v-if="story?.status === 'ended'" class="status-badge">Ended</span>
      </div>
      <div class="header-right">
        <span
          v-if="story"
          class="story-time"
          :title="`The chapter began ${formatDateTime(story.startTime, bureau?.timezone)}`"
        >
          <i class="fas fa-clock"></i> {{ formatDateTime(chapterTime, bureau?.timezone) }}
        </span>
        <button
          class="icon-btn"
          title="Show a character's avatar"
          :disabled="!story || cast.length === 0 || avatarWindows.length >= MAX_AVATAR_WINDOWS"
          @click="addAvatarWindow"
        >
          <i class="fas fa-image"></i>
        </button>
        <button
          class="icon-btn"
          title="Who's in this chapter"
          :disabled="!story"
          @click="showCast = true"
        >
          <i class="fas fa-users"></i>
        </button>
        <button
          class="icon-btn"
          :class="{ 'has-scenario': Boolean(story?.scenario) }"
          :title="story?.scenario ? 'Edit chapter (has a scenario)' : 'Edit chapter'"
          :disabled="!story"
          @click="showEditChapter = true"
        >
          <i class="fas fa-pencil"></i>
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
          <i class="fas fa-flag-checkered"></i> End chapter
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>Loading chapter...</p>
    </div>

    <div v-else-if="loadError" class="loading-container">
      <p>{{ loadError }}</p>
      <button class="btn btn-secondary" @click="backToBureau">Back to the Bureau</button>
    </div>

    <template v-else>
      <main ref="readingRef" class="story-reading">
        <div class="story-column">
          <p v-if="turns.length === 0 && !pending" class="story-empty">
            This chapter hasn't started. Write the opening yourself, open with a character's
            greeting, give the Writer a direction, or press Start and the Writer will set the scene.
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
              :time-zone="bureau.timezone"
              :override-content="pending?.regenerateTurnId === turn.id ? pending.content : null"
              :busy="generating"
              :can-regenerate="story.status === 'active' && bureau.hasApiKey"
              @save="saveTurn"
              @regenerate="regenerate"
              @delete="deleteTurn"
              @select-variant="selectVariant"
            />
          </template>

          <div v-if="pending && !pending.regenerateTurnId" ref="pendingRef">
            <TurnSeam :bureau-id="bureauId" :live="pending" />
            <article class="pending-turn">
              <div v-if="pending.content" class="prose" v-html="renderProse(pending.content)"></div>
              <p v-else class="pending-placeholder">{{ pending.status }}</p>
            </article>
          </div>
        </div>
      </main>

      <StoryComposer
        v-if="story.status === 'active'"
        ref="composerRef"
        :generating="generating"
        :has-api-key="bureau.hasApiKey"
        :can-use-greeting="!hasProse"
        :empty="!hasProse"
        :can-continue-for-character="hasProse && chapterCharacters.length > 0"
        @generate="generate"
        @character="continueForCharacter"
        @greeting="showGreetings = true"
        @scene-break="addSceneBreak"
        @time-passes="showTimePasses = true"
        @stop="stop"
      />
      <div v-else class="ended-bar">
        This chapter has ended. Start the next one from
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
    <TimePassesPicker
      v-if="showTimePasses"
      :from="chapterTime"
      :time-zone="bureau.timezone"
      :passing="passingTime"
      :intro="`The chapter's time is ${formatDateTime(chapterTime, bureau.timezone)}. Time passes from there, and Bureau time moves up with it unless it's already later.`"
      pick-help="Later than the chapter's time."
      @pass="passTimeInChapter"
      @close="showTimePasses = false"
    />
    <StoryCastModal
      v-if="showCast"
      :bureau-id="bureauId"
      :story="story"
      :cast="cast"
      :has-api-key="bureau.hasApiKey"
      :readonly="story.status !== 'active'"
      @close="showCast = false"
      @updated="handleStoryUpdated"
      @cast-added="castAdded"
      @profile="profileCastId = $event.id"
    />
    <EditChapterModal
      v-if="showEditChapter"
      :bureau-id="bureauId"
      :story="story"
      @close="showEditChapter = false"
      @updated="chapterEdited"
    />
    <ProfileModal
      v-if="profileCastId"
      :bureau-id="bureauId"
      :cast-id="profileCastId"
      :has-api-key="bureau.hasApiKey"
      @close="profileCastId = null"
    />
    <CharacterResponseModal
      v-if="showCharacterPicker"
      :characters="chapterCharacters"
      @close="showCharacterPicker = false"
      @select="generateForCharacter"
    />
    <GreetingPickerModal
      v-if="showGreetings"
      :bureau-id="bureauId"
      :story-id="storyId"
      :has-api-key="bureau.hasApiKey"
      @close="showGreetings = false"
      @added="handleGreetingAdded"
      @rewrite="rewriteGreeting"
    />

    <FloatingAvatarWindow
      v-for="win in avatarWindows"
      :key="win.id"
      :window-id="win.id"
      :characters="avatarCharacters"
      :initial-character-id="win.castId"
      :initial-position="{ x: win.x, y: win.y }"
      :initial-size="{ width: win.width, height: win.height }"
      @close="closeAvatarWindow(win.id)"
      @update="updateAvatarWindow"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { bureausAPI, bureauStoriesAPI } from '../../services/bureauApi';
import { charactersAPI } from '../../services/api';
import { describeArchive } from '../../composables/bureau/memories';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { setPageTitle } from '../../router';
import { renderProse } from '../../composables/bureau/renderProse';
import { followScroll } from '../../composables/bureau/followScroll';
import { formatDateTime } from '../../composables/bureau/format';
import {
  MAX_AVATAR_WINDOWS,
  newAvatarWindow,
  windowCharacters,
} from '../../composables/bureau/avatarWindows';
import TurnBlock from '../../components/bureau/TurnBlock.vue';
import TurnSeam from '../../components/bureau/TurnSeam.vue';
import StoryComposer from '../../components/bureau/StoryComposer.vue';
import EndStoryModal from '../../components/bureau/EndStoryModal.vue';
import StoryCastModal from '../../components/bureau/StoryCastModal.vue';
import EditChapterModal from '../../components/bureau/EditChapterModal.vue';
import ProfileModal from '../../components/bureau/ProfileModal.vue';
import TimePassesPicker from '../../components/bureau/TimePassesPicker.vue';
import GreetingPickerModal from '../../components/bureau/GreetingPickerModal.vue';
import CharacterResponseModal from '../../components/CharacterResponseModal.vue';
import FloatingAvatarWindow from '../../components/FloatingAvatarWindow.vue';

const props = defineProps({
  bureauId: { type: String, required: true },
  storyId: { type: String, required: true },
});

const HIGHLIGHT_DURATION = 2500;

// Reading-area events that mean the reader has taken over scrolling from a generation.
const READER_SCROLL_EVENTS = ['wheel', 'touchmove', 'pointerdown', 'keydown'];

const STAGE_LABELS = {
  writing: 'Writing...',
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
// The chapter's title and scenario, as story mode's Edit Story.
const showEditChapter = ref(false);
// The cast member whose profile is open, from "Who's in this chapter".
const profileCastId = ref(null);
const showGreetings = ref(false);
// Picking who Continue for Character writes for.
const showCharacterPicker = ref(false);
const showTimePasses = ref(false);
const passingTime = ref(false);
const editingTitle = ref(false);
const titleDraft = ref('');
const titleInput = ref(null);
const readingRef = ref(null);
// The passage being written, while it streams in.
const pendingRef = ref(null);
const composerRef = ref(null);
const archiving = ref(false);
const reverting = ref(false);
const highlightTurnId = ref(null);
// Portraits floating over the chapter. The Bureau keeps them, so they carry over between chapters.
const avatarWindows = ref([]);
// Library characters by id, for portraits in the windows and the character picker, loaded once
// one of them opens.
const libraryCharacters = ref(new Map());
let libraryCharactersRequested = false;
let saveWindowsTimer = null;

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

// The chapter's time: when time last passed in it, or when it began.
const chapterTime = computed(
  () =>
    turns.value.findLast((turn) => turn.kind === 'time_passes')?.bureauTime ??
    story.value?.startTime ??
    null,
);

// A greeting opens a chapter, so it's offered only until the chapter has prose.
const hasProse = computed(() => turns.value.some((turn) => turn.kind === 'prose'));

const avatarCharacters = computed(() =>
  windowCharacters(cast.value, story.value?.castIds ?? [], libraryCharacters.value),
);

// Who Continue for Character can write for: the chapter's characters, as in story mode, where the
// reader's character isn't one of the story's characters.
const chapterCharacters = computed(() =>
  avatarCharacters.value.filter(
    (character) =>
      story.value?.castIds.includes(character.id) && !castById.value[character.id]?.isPersona,
  ),
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
    avatarWindows.value = bureauData.bureau.avatarWindows ?? [];
    if (avatarWindows.value.length > 0) loadLibraryCharacters();
    setPageTitle(story.value.title);
  } catch (error) {
    console.error('Failed to load story:', error);
    loadError.value =
      error.status === 404 ? 'This chapter no longer exists.' : `Failed to load: ${error.message}`;
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
    toast.error('Failed to refresh the chapter: ' + error.message);
  }
}

/**
 * Someone added from "Who's in this chapter" is new to the Bureau's cast. Adding one can also fail
 * to reach the library, or attach the character's lorebook to the whole Bureau, as the cast section
 * reports on the Bureau page.
 */
async function castAdded({ castMember, savedToLibrary, libraryError, attachedLorebookId }) {
  if (libraryError) {
    toast.error(
      `${castMember.name} joined the cast as a draft, but saving to your library failed: ${libraryError}`,
    );
  } else {
    toast.success(
      savedToLibrary
        ? `${castMember.name} joined the cast and your library`
        : `${castMember.name} joined the cast`,
    );
  }
  if (attachedLorebookId) {
    toast.info(`Attached ${castMember.name}'s lorebook to this Bureau`);
  }
  try {
    cast.value = (await bureausAPI.listCast(props.bureauId)).cast;
  } catch (error) {
    toast.error('Failed to refresh the cast: ' + error.message);
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

/**
 * Follow a passage as it streams in, until its seam reaches the top of the reading area (see
 * followScroll). A regeneration starts at the seam above the turn it replaces. Returns whether to
 * keep following.
 */
async function followGeneration(regenerateTurnId) {
  await nextTick();
  const container = readingRef.value;
  const block = regenerateTurnId
    ? container?.querySelector(`[data-turn-id="${regenerateTurnId}"]`)
    : pendingRef.value;
  const anchor = regenerateTurnId ? (block?.previousElementSibling ?? block) : block;
  if (!container || !anchor) return true;

  const { scrollTop, following } = followScroll({
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
    anchorTop:
      anchor.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop,
  });
  container.scrollTop = scrollTop;
  return following;
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
    runId: null,
    regenerateTurnId,
  };
  let readerTurnSaved = false;
  let stopped = false;

  // Follow the new passage only if the reader was already at the end, and only until they scroll.
  let following = isNearBottom();
  const reading = readingRef.value;
  const stopFollowing = () => {
    following = false;
  };
  for (const type of READER_SCROLL_EVENTS) {
    reading?.addEventListener(type, stopFollowing, { passive: true });
  }

  try {
    for await (const event of start(abortController.signal)) {
      if (event.type === 'turn') {
        readerTurnSaved = true;
        turns.value = [...turns.value, event.turn];
      } else if (event.type === 'run') {
        pending.value.runId = event.runId;
      } else if (event.type === 'stage') {
        pending.value.status = STAGE_LABELS[event.stage] ?? pending.value.status;
      } else if (event.type === 'reasoning') {
        pending.value.reasoning += event.text;
        pending.value.status = 'Thinking...';
      } else if (event.type === 'content') {
        pending.value.content += event.text;
        pending.value.status = 'Writing...';
      }
      if (following && !(await followGeneration(regenerateTurnId))) following = false;
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
    for (const type of READER_SCROLL_EVENTS) {
      reading?.removeEventListener(type, stopFollowing);
    }
    abortController = null;
  }

  // Swap the passage being written for the saved turn in one update, keeping the reader's place, so
  // the page doesn't jump when the stream ends.
  const scrollTop = readingRef.value?.scrollTop ?? 0;
  await refreshStory();
  generating.value = false;
  pending.value = null;
  await nextTick();
  if (readingRef.value) readingRef.value.scrollTop = scrollTop;
  if (stopped) {
    // The server saves the partial text once it notices the disconnect.
    setTimeout(refreshStory, 1000);
  }
}

function generate({ action, text }) {
  runStream(
    (signal) => bureauStoriesAPI.generate(props.bureauId, props.storyId, { action, text }, signal),
    { composerText: text },
  );
}

// As in story mode, one character is written for straight away, and several are picked from.
function continueForCharacter() {
  if (chapterCharacters.value.length === 1) {
    generateForCharacter(chapterCharacters.value[0].id);
    return;
  }
  loadLibraryCharacters();
  showCharacterPicker.value = true;
}

function generateForCharacter(castId) {
  showCharacterPicker.value = false;
  runStream((signal) =>
    bureauStoriesAPI.generate(
      props.bureauId,
      props.storyId,
      { action: 'character', castId },
      signal,
    ),
  );
}

// The Writer rewrites a picked greeting as the chapter's opening, streaming in like any passage.
function rewriteGreeting({ castId, content }) {
  showGreetings.value = false;
  runStream((signal) =>
    bureauStoriesAPI.generate(
      props.bureauId,
      props.storyId,
      { action: 'greeting', castId, text: content },
      signal,
    ),
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

// Time passing marks the chapter and moves Bureau time with it.
async function passTimeInChapter(move) {
  if (passingTime.value) return;
  passingTime.value = true;
  try {
    const { turn, bureau: updated } = await bureauStoriesAPI.addTurn(
      props.bureauId,
      props.storyId,
      { kind: 'time_passes', ...move },
    );
    bureau.value = updated;
    turns.value = [...turns.value, turn];
    showTimePasses.value = false;
    scrollToEnd();
  } catch (error) {
    toast.error('Failed to let time pass: ' + error.message);
  } finally {
    passingTime.value = false;
  }
}

const DELETED_KIND_LABELS = { scene_break: 'scene break', time_passes: 'time skip' };

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
    message:
      turn.kind === 'time_passes'
        ? 'Delete this time skip? Bureau time stays where it is.'
        : `Delete this ${DELETED_KIND_LABELS[turn.kind] ?? 'passage'}${versions}?`,
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

function handleGreetingAdded(turn) {
  showGreetings.value = false;
  turns.value = [...turns.value, turn];
  scrollToEnd();
}

// ==================== Avatar windows ====================

const SAVE_WINDOWS_DELAY = 500;

async function loadLibraryCharacters() {
  if (libraryCharactersRequested) return;
  libraryCharactersRequested = true;
  try {
    const { characters } = await charactersAPI.list();
    libraryCharacters.value = new Map(characters.map((character) => [character.id, character]));
  } catch (error) {
    // Portraits are left out for now, and the next window or picker opened tries again.
    libraryCharactersRequested = false;
    console.error('Failed to load portraits:', error);
  }
}

function addAvatarWindow() {
  const win = newAvatarWindow({
    cast: cast.value,
    chapterCastIds: story.value?.castIds ?? [],
    windows: avatarWindows.value,
  });
  if (!win) return;
  avatarWindows.value = [...avatarWindows.value, win];
  loadLibraryCharacters();
  saveAvatarWindows();
}

function closeAvatarWindow(windowId) {
  avatarWindows.value = avatarWindows.value.filter((win) => win.id !== windowId);
  saveAvatarWindows();
}

// A window moved, changed size, or switched characters.
function updateAvatarWindow({ windowId, characterId, x, y, width, height }) {
  avatarWindows.value = avatarWindows.value.map((win) =>
    win.id === windowId
      ? { id: win.id, castId: characterId ?? win.castId, x, y, width, height }
      : win,
  );
  saveAvatarWindows();
}

// Saved after a short pause, so a burst of changes, such as every window fitting a smaller
// browser, is saved once.
function saveAvatarWindows() {
  clearTimeout(saveWindowsTimer);
  saveWindowsTimer = setTimeout(sendAvatarWindows, SAVE_WINDOWS_DELAY);
}

async function sendAvatarWindows() {
  saveWindowsTimer = null;
  try {
    await bureausAPI.updateAvatarWindows(props.bureauId, avatarWindows.value);
  } catch (error) {
    toast.error('Failed to save the avatar windows: ' + error.message);
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
    toast.error('Failed to rename the chapter: ' + error.message);
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
    toast.error(`The chapter ended, but committing it to memory failed: ${archiveError}`);
  } else {
    toast.success(archive ? `Chapter ended. ${describeArchive(archive)}` : 'Chapter ended');
  }
}

function handleStoryUpdated(updated) {
  showCast.value = false;
  story.value = updated;
}

function chapterEdited(updated) {
  showEditChapter.value = false;
  story.value = updated;
  setPageTitle(updated.title);
}

function backToBureau() {
  router.push({ name: 'bureau', params: { bureauId: props.bureauId } });
}

onMounted(load);
onBeforeUnmount(() => {
  abortController?.abort();
  // Save a window that just changed instead of dropping it.
  if (saveWindowsTimer) {
    clearTimeout(saveWindowsTimer);
    sendAvatarWindows();
  }
});
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

/* The chapter has a scenario. */
.icon-btn.has-scenario {
  color: var(--accent-primary);
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

.pending-turn .prose :deep(.story-image) {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  height: auto;
  margin: 1rem auto;
  border-radius: 8px;
  object-fit: contain;
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
