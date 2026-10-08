<template>
  <BottomSheet labelledby="lorebook-sheet-title" @close="$emit('close')">
    <div class="sheet-head">
      <div class="sheet-thumb">
        <LorebookCover :item="item" mini />
      </div>
      <div class="sheet-heading">
        <h2 id="lorebook-sheet-title">{{ item.name }}</h2>
        <p>{{ meta }}</p>
      </div>
      <button type="button" class="sheet-close" aria-label="Close" @click="$emit('close')">
        <i class="fas fa-xmark"></i>
      </button>
    </div>

    <p v-if="item.description" class="description">{{ item.description }}</p>

    <div class="sheet-primary">
      <button type="button" class="btn btn-primary" @click="$emit('open')">
        <i class="fas fa-book-open"></i> Open lorebook
      </button>
    </div>

    <h3>Used by</h3>
    <p v-if="!item.characters.length && !item.stories.length" class="unused">
      No character or story uses this lorebook yet.
    </p>
    <div v-if="item.characters.length" class="people">
      <RouterLink
        v-for="character in item.characters"
        :key="character.id"
        :to="{ name: 'character-detail', params: { characterId: character.id } }"
        class="person"
        :title="`Open ${character.name}`"
      >
        <AvatarStack :characters="[character]" :size="26" />
        <span class="ellipsis">{{ character.name }}</span>
      </RouterLink>
    </div>
    <div v-if="item.stories.length" class="stories">
      <button
        v-for="story in item.stories"
        :key="story.id"
        type="button"
        class="story"
        @click="$emit('open-story', story.id)"
      >
        <span class="story-thumb">
          <StoryCover :item="storyCard(story)" :cast="castOf(story)" mini />
        </span>
        <span class="story-text">
          <span class="story-title">{{ story.title || 'Untitled Story' }}</span>
          <span class="story-meta">
            {{ shortCount(story.wordCount || 0) }} words · {{ timeAgo(story.modified) }}
          </span>
        </span>
        <i class="fas fa-chevron-right story-chevron"></i>
      </button>
    </div>

    <div class="sheet-list">
      <button type="button" class="danger" @click="$emit('delete')">
        <i class="fas fa-trash"></i> Delete lorebook
      </button>
    </div>
  </BottomSheet>
</template>

<script setup>
import { computed } from 'vue';
import BottomSheet from '../library/BottomSheet.vue';
import StoryCover from '../library/StoryCover.vue';
import AvatarStack from '../library/AvatarStack.vue';
import LorebookCover from './LorebookCover.vue';
import { buildLibraryItems, shortCount, timeAgo } from '../../composables/library.js';
import { entryLine } from '../../composables/lorebooks.js';

const props = defineProps({
  // A card from buildLorebookItems()
  item: { type: Object, required: true },
  charactersById: { type: Map, required: true },
  continuities: { type: Array, default: () => [] },
});

defineEmits(['close', 'open', 'open-story', 'delete']);

const meta = computed(() => {
  const parts = [entryLine(props.item.entryCount)];
  if (props.item.modified) parts.push(`Edited ${timeAgo(props.item.modified)}`);
  return parts.join(' · ');
});

// The stories as the library's cards, so their thumbnails match their covers there
const storyCards = computed(
  () =>
    new Map(
      buildLibraryItems({ stories: props.item.stories, continuities: props.continuities }).map(
        (card) => [card.id, card],
      ),
    ),
);

function storyCard(story) {
  return storyCards.value.get(story.id);
}

function castOf(story) {
  return (story.characterIds ?? []).map((id) => props.charactersById.get(id)).filter(Boolean);
}
</script>

<style scoped>
.sheet-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.sheet-thumb {
  flex: 0 0 48px;
  width: 48px;
}

.sheet-heading {
  flex: 1;
  min-width: 0;
}

.sheet-heading h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.3rem;
  line-height: 1.2;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.sheet-heading p {
  margin: 4px 0 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.sheet-close {
  flex: none;
  align-self: flex-start;
  width: 44px;
  height: 44px;
  margin: -6px -8px 0 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1.25rem;
}

.description {
  margin: 14px 0 0;
  font-size: 0.875rem;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-line;
  display: -webkit-box;
  -webkit-line-clamp: 6;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.sheet-primary {
  display: flex;
  flex-direction: column;
  margin-top: 18px;
}

.sheet-primary .btn {
  height: 48px;
  font-size: 1rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

h3 {
  margin: 22px 0 8px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.unused {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.people {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.person {
  --stack-ring: var(--bg-tertiary);
  max-width: 100%;
  min-height: 34px;
  box-sizing: border-box;
  padding: 0 12px 0 4px;
  border-radius: 999px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.person:hover {
  color: var(--accent-primary);
}

.person:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stories {
  display: flex;
  flex-direction: column;
  margin: 6px -8px 0;
  max-height: 300px;
  overflow-y: auto;
}

.story {
  min-height: 60px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  display: flex;
  align-items: center;
  gap: 12px;
}

.story:hover {
  background: var(--bg-tertiary);
}

.story-thumb {
  flex: 0 0 32px;
  width: 32px;
}

.story-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.story-title,
.story-meta {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.story-title {
  font-family: var(--font-display);
  font-size: 0.9375rem;
  line-height: 1.35;
  /* Room inside the clip for Literata's descenders and overhanging serifs */
  padding-bottom: 0.12em;
  padding-inline: 0.06em;
  margin-inline: -0.06em;
  font-weight: 600;
}

.story-meta {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.story-chevron {
  flex: none;
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.sheet-list {
  display: flex;
  flex-direction: column;
  margin-top: 16px;
  border-top: 1px solid var(--border-color);
  padding-top: 6px;
}

.sheet-list button {
  height: 48px;
  padding: 0 4px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.9375rem;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 14px;
}

.sheet-list button i {
  width: 20px;
  text-align: center;
}

.sheet-list .danger {
  color: var(--danger);
}
</style>
