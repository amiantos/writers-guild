<template>
  <section class="edit-section">
    <div class="section-header">
      <h2><i class="fas fa-book-open"></i> Chapters</h2>
      <button
        class="btn btn-primary btn-small"
        :disabled="cast.length === 0"
        :title="cast.length === 0 ? 'Add someone to the cast first' : ''"
        @click="showStart = true"
      >
        <i class="fas fa-plus"></i> Start a chapter
      </button>
    </div>

    <div class="section-content">
      <div class="bureau-clock">
        <i class="fas fa-clock"></i> Bureau time:
        <strong>{{ formatDateTime(bureau.bureauTime, bureau.timezone) }}</strong>
        <TimePassesControl :bureau="bureau" @updated="$emit('updated', $event)" />
      </div>

      <div v-if="loading" class="loading">Loading chapters...</div>
      <p v-else-if="stories.length === 0" class="empty-hint">
        No chapters yet. Starting one asks when it takes place.
      </p>
      <ul v-else class="story-list">
        <li v-for="story in newestFirst" :key="story.id" class="story-item">
          <button class="story-row" @click="$emit('open', story)">
            <span class="story-title">{{ story.title }}</span>
            <span class="story-status" :class="story.status">
              {{ story.status === 'active' ? 'In progress' : 'Ended' }}
            </span>
            <span class="story-detail">
              {{ formatDateTime(story.startTime, bureau.timezone) }} · {{ story.turnCount }}
              {{ story.turnCount === 1 ? 'turn' : 'turns' }}
            </span>
            <span v-if="story.summary" class="story-summary">{{ story.summary }}</span>
            <span v-if="story.summary && story.summaryNeedsReview" class="summary-review">
              <i class="fas fa-triangle-exclamation"></i> A passage changed after this summary was
              written. You can check it with Edit chapter, the pencil in the chapter's header.
            </span>
          </button>
          <button
            class="icon-btn"
            :title="`Delete ${story.title}`"
            :disabled="deletingId !== null"
            @click="deleteStory(story)"
          >
            <i class="fas fa-trash"></i>
          </button>
        </li>
      </ul>
    </div>

    <StartStoryModal
      v-if="showStart"
      :bureau="bureau"
      :cast="cast"
      :story-count="stories.length"
      @close="showStart = false"
      @started="handleStarted"
    />
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { bureauStoriesAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { formatDateTime } from '../../composables/bureau/format';
import StartStoryModal from './StartStoryModal.vue';
import TimePassesControl from './TimePassesControl.vue';

const props = defineProps({
  bureau: { type: Object, required: true },
  cast: { type: Array, required: true },
});

const emit = defineEmits(['open', 'updated', 'deleted']);
const toast = useToast();
const { confirm } = useConfirm();

const stories = ref([]);
const loading = ref(true);
const showStart = ref(false);
const deletingId = ref(null);

const newestFirst = computed(() => stories.value.toReversed());

async function loadStories() {
  loading.value = true;
  try {
    const data = await bureauStoriesAPI.list(props.bureau.id);
    stories.value = data.stories;
  } catch (error) {
    console.error('Failed to load stories:', error);
    toast.error('Failed to load chapters: ' + error.message);
  } finally {
    loading.value = false;
  }
}

function handleStarted(story) {
  showStart.value = false;
  emit('open', story);
}

async function deleteStory(story) {
  const confirmed = await confirm({
    message: `Delete "${story.title}"?\n\nIts passages are deleted, along with the memories and arc notes recorded from them. Bureau time stays where it is. This cannot be undone.`,
    confirmText: 'Delete chapter',
    variant: 'danger',
  });
  if (!confirmed) return;

  deletingId.value = story.id;
  try {
    await bureauStoriesAPI.remove(props.bureau.id, story.id);
    stories.value = stories.value.filter((item) => item.id !== story.id);
    toast.success(`Deleted ${story.title}`);
    emit('deleted', story);
  } catch (error) {
    toast.error('Failed to delete the chapter: ' + error.message);
  } finally {
    deletingId.value = null;
  }
}

onMounted(loadStories);
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.bureau-clock {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.bureau-clock strong {
  color: var(--text-primary);
  font-weight: 600;
}

.story-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.story-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.story-row {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.25rem 1rem;
  padding: 0.75rem 1rem;
  text-align: left;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  transition: border-color 0.2s;
}

.story-row:hover,
.story-row:focus-visible {
  border-color: var(--accent-primary);
  outline: none;
}

.story-title {
  font-weight: 600;
}

.story-status {
  font-size: 0.75rem;
  font-weight: 600;
  align-self: center;
}

.story-status.active {
  color: var(--accent-primary);
}

.story-status.ended {
  color: var(--text-secondary);
}

.story-detail {
  grid-column: 1 / -1;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.summary-review {
  grid-column: 1 / -1;
  font-size: 0.8rem;
  color: var(--warning);
}

.story-summary {
  grid-column: 1 / -1;
  font-size: 0.85rem;
  line-height: 1.45;
  color: var(--text-secondary);
  /* The whole summary, keeping any paragraph breaks in it. */
  white-space: pre-line;
}
</style>
