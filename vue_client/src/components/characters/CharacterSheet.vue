<template>
  <BottomSheet labelledby="character-sheet-title" @close="$emit('close')">
    <div class="sheet-head">
      <div class="sheet-thumb">
        <CharacterTile :item="item" mini />
      </div>
      <div class="sheet-heading">
        <h2 id="character-sheet-title">{{ item.name }}</h2>
        <p>{{ meta }}</p>
      </div>
      <button type="button" class="sheet-close" aria-label="Close" @click="$emit('close')">
        <i class="fas fa-xmark"></i>
      </button>
    </div>

    <div class="sheet-primary">
      <button type="button" class="btn btn-primary" @click="$emit('new-story')">
        <i class="fas fa-file-circle-plus"></i> New story with {{ item.name }}
      </button>
    </div>

    <template v-if="item.appearances.length">
      <div class="section-head">
        <h3>Appears in</h3>
        <button
          v-if="item.appearances.length > SHOWN"
          type="button"
          class="see-all"
          @click="$emit('show-all')"
        >
          See all {{ item.appearances.length }}
        </button>
      </div>
      <div class="appearances">
        <button
          v-for="appearance in shownAppearances"
          :key="appearance.key"
          type="button"
          class="appearance"
          @click="$emit(appearance.kind === 'story' ? 'open-story' : 'open-chat', appearance.id)"
        >
          <span class="appearance-thumb">
            <StoryCover
              v-if="appearance.kind === 'story'"
              :item="appearance"
              :cast="castOf(appearance)"
              mini
            />
            <span
              v-else
              class="chat-thumb"
              :style="appearance.color ? { background: appearance.color } : null"
            >
              <i class="fas fa-comments"></i>
            </span>
          </span>
          <span class="appearance-text">
            <span class="appearance-title">{{ appearance.title }}</span>
            <span class="appearance-meta">{{ appearanceMeta(appearance) }}</span>
          </span>
          <i class="fas fa-chevron-right appearance-chevron"></i>
        </button>
      </div>
    </template>

    <template v-if="item.tags.length">
      <h3 class="tags-title">Tags</h3>
      <div class="tags">
        <button
          v-for="tag in item.tags"
          :key="tag"
          type="button"
          class="tag"
          :aria-label="`Show characters tagged ${tag}`"
          @click="$emit('filter-tag', tagKey(tag))"
        >
          {{ tag }}
        </button>
      </div>
    </template>

    <div class="sheet-list">
      <button type="button" @click="$emit('edit')">
        <i class="fas fa-user-pen"></i> Character details
      </button>
      <button type="button" class="danger" @click="$emit('delete')">
        <i class="fas fa-trash"></i> Delete character
      </button>
    </div>
  </BottomSheet>
</template>

<script setup>
import { computed } from 'vue';
import BottomSheet from '../library/BottomSheet.vue';
import StoryCover from '../library/StoryCover.vue';
import CharacterTile from './CharacterTile.vue';
import { appearanceLine, tagKey } from '../../composables/characters.js';
import { shortCount, timeAgo } from '../../composables/library.js';

const props = defineProps({
  // A card from buildCharacterItems()
  item: { type: Object, required: true },
  charactersById: { type: Map, required: true },
});

defineEmits([
  'close',
  'new-story',
  'open-story',
  'open-chat',
  'show-all',
  'filter-tag',
  'edit',
  'delete',
]);

// The most recent few; See all opens the rest on the home page's shelf.
const SHOWN = 5;

const shownAppearances = computed(() => props.item.appearances.slice(0, SHOWN));

const meta = computed(() => {
  const parts = [appearanceLine(props.item)];
  if (props.item.wordCount) parts.push(`${props.item.wordCount.toLocaleString()} words`);
  if (props.item.created) parts.push(`Added ${timeAgo(props.item.created)}`);
  return parts.join(' · ');
});

function castOf(appearance) {
  return appearance.characterIds.map((id) => props.charactersById.get(id)).filter(Boolean);
}

function appearanceMeta(appearance) {
  const parts = [];
  if (appearance.continuityName) parts.push(appearance.continuityName);
  if (appearance.kind === 'story') parts.push(`${shortCount(appearance.wordCount ?? 0)} words`);
  else parts.push('Chat');
  if (appearance.personaCharacterId === props.item.id) parts.push('as persona');
  parts.push(timeAgo(appearance.modified));
  return parts.join(' · ');
}
</script>

<style scoped>
.sheet-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.sheet-thumb {
  flex: 0 0 60px;
  width: 60px;
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

.sheet-primary {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

h3 {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 36px;
  margin-top: 20px;
}

.see-all {
  min-height: 36px;
  padding: 0 0 0 12px;
  border: none;
  background: none;
  color: var(--accent-primary);
  font-size: 0.875rem;
  font-weight: 600;
}

.appearances {
  display: flex;
  flex-direction: column;
  margin: 4px -8px 0;
}

.appearance {
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

.appearance:hover {
  background: var(--bg-tertiary);
}

.appearance-thumb {
  flex: 0 0 32px;
  width: 32px;
}

.chat-thumb {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: #31363f;
  color: #eef0f3;
  font-size: 0.875rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.appearance-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.appearance-title,
.appearance-meta {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.appearance-title {
  font-family: var(--font-display);
  font-size: 0.9375rem;
  line-height: 1.35;
  /* Room inside the clip for Literata's descenders and overhanging serifs */
  padding-bottom: 0.12em;
  padding-inline: 0.06em;
  margin-inline: -0.06em;
  font-weight: 600;
}

.appearance-meta {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.appearance-chevron {
  flex: none;
  color: var(--text-secondary);
  font-size: 0.8125rem;
}

.tags-title {
  margin-top: 20px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.tag {
  min-height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: 999px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 0.8125rem;
}

.tag:hover {
  color: var(--accent-primary);
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
