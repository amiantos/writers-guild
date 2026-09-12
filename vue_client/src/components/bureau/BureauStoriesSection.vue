<template>
  <section class="edit-section">
    <div class="section-header">
      <h2><i class="fas fa-book-open"></i> Stories</h2>
      <button
        class="btn btn-primary btn-small"
        :disabled="cast.length === 0"
        :title="cast.length === 0 ? 'Add someone to the cast first' : ''"
        @click="showStart = true"
      >
        <i class="fas fa-plus"></i> Start a story
      </button>
    </div>

    <div class="section-content">
      <p class="bureau-clock">
        <i class="fas fa-clock"></i> Bureau time:
        <strong>{{ formatDateTime(bureau.bureauTime, bureau.timezone) }}</strong>
      </p>

      <div v-if="loading" class="loading">Loading stories...</div>
      <p v-else-if="stories.length === 0" class="empty-hint">
        No stories yet. Starting one asks when it takes place.
      </p>
      <ul v-else class="story-list">
        <li v-for="story in newestFirst" :key="story.id">
          <button class="story-row" @click="$emit('open', story)">
            <span class="story-title">{{ story.title }}</span>
            <span class="story-status" :class="story.status">
              {{ story.status === 'active' ? 'In progress' : 'Ended' }}
            </span>
            <span class="story-detail">
              {{ formatDateTime(story.startTime, bureau.timezone) }} · {{ story.turnCount }}
              {{ story.turnCount === 1 ? 'turn' : 'turns' }}
            </span>
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
import { formatDateTime } from '../../composables/bureau/format';
import StartStoryModal from './StartStoryModal.vue';

const props = defineProps({
  bureau: { type: Object, required: true },
  cast: { type: Array, required: true },
});

const emit = defineEmits(['open']);
const toast = useToast();

const stories = ref([]);
const loading = ref(true);
const showStart = ref(false);

const newestFirst = computed(() => stories.value.toReversed());

async function loadStories() {
  loading.value = true;
  try {
    const data = await bureauStoriesAPI.list(props.bureau.id);
    stories.value = data.stories;
  } catch (error) {
    console.error('Failed to load stories:', error);
    toast.error('Failed to load stories: ' + error.message);
  } finally {
    loading.value = false;
  }
}

function handleStarted(story) {
  showStart.value = false;
  emit('open', story);
}

onMounted(loadStories);
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.bureau-clock {
  margin: 0;
  display: flex;
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

.story-row {
  width: 100%;
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
</style>
