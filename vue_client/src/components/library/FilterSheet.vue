<template>
  <BottomSheet labelledby="filter-sheet-title" @close="$emit('close')">
    <div class="filter-head">
      <h2 id="filter-sheet-title">{{ title }}</h2>
      <button type="button" class="icon-only" aria-label="Close" @click="$emit('close')">
        <i class="fas fa-xmark"></i>
      </button>
    </div>

    <input
      ref="search"
      v-model="query"
      type="search"
      class="filter-search"
      :placeholder="placeholder"
      :aria-label="placeholder"
    />

    <div class="filter-lists">
      <template v-if="matchingContinuities.length">
        <h3>Continuities</h3>
        <button
          v-for="continuity in matchingContinuities"
          :key="continuity.id"
          type="button"
          class="filter-row"
          :aria-pressed="isActive('continuity', continuity.id)"
          @click="$emit('pick', { kind: 'continuity', id: continuity.id })"
        >
          <span class="swatch" :style="{ background: continuity.color }"></span>
          <span class="row-name continuity-name">{{ continuity.name }}</span>
          <span class="row-count">{{ continuity.count }}</span>
        </button>
      </template>

      <template v-if="matchingCharacters.length">
        <h3>Characters</h3>
        <button
          v-for="entry in matchingCharacters"
          :key="entry.id"
          type="button"
          class="filter-row"
          :aria-pressed="isActive('character', entry.id)"
          @click="$emit('pick', { kind: 'character', id: entry.id })"
        >
          <AvatarStack :characters="[charactersById.get(entry.id)]" :size="32" />
          <span class="row-name">{{ entry.name }}</span>
          <span class="row-count">{{ entry.count }}</span>
        </button>
      </template>

      <template v-if="matchingTags.length">
        <h3>Tags</h3>
        <button
          v-for="tag in matchingTags"
          :key="tag.id"
          type="button"
          class="filter-row"
          :aria-pressed="isActive('tag', tag.id)"
          @click="$emit('pick', { kind: 'tag', id: tag.id })"
        >
          <span class="tag-icon"><i class="fas fa-tag"></i></span>
          <span class="row-name">{{ tag.name }}</span>
          <span class="row-count">{{ tag.count }}</span>
        </button>
      </template>

      <p
        v-if="!matchingContinuities.length && !matchingCharacters.length && !matchingTags.length"
        class="no-match"
      >
        Nothing matches.
      </p>
    </div>
  </BottomSheet>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import BottomSheet from './BottomSheet.vue';
import AvatarStack from './AvatarStack.vue';

const props = defineProps({
  // From libraryFilters() or characterFilters(): every Continuity, character and tag on the
  // shelf, with counts
  continuities: { type: Array, default: () => [] },
  characters: { type: Array, default: () => [] },
  tags: { type: Array, default: () => [] },
  charactersById: { type: Map, default: () => new Map() },
  title: { type: String, default: 'Filter the library' },
  placeholder: { type: String, default: 'Search Continuities and characters' },
  // The filter in use, {kind, id}, or null
  active: { type: Object, default: null },
});

defineEmits(['close', 'pick']);

const query = ref('');
const search = ref(null);

const matches = (name) => name.toLowerCase().includes(query.value.trim().toLowerCase());

// Alphabetical here, unlike the chips, since this is where a name is looked up.
const byName = (a, b) => a.name.localeCompare(b.name);
const matchingContinuities = computed(() =>
  props.continuities.filter((c) => matches(c.name)).toSorted(byName),
);
const matchingCharacters = computed(() =>
  props.characters.filter((c) => matches(c.name)).toSorted(byName),
);
const matchingTags = computed(() => props.tags.filter((t) => matches(t.name)).toSorted(byName));

function isActive(kind, id) {
  return props.active?.kind === kind && props.active.id === id;
}

onMounted(() => {
  // A phone's keyboard would cover the list; let the person tap into the field there.
  if (window.matchMedia?.('(hover: hover)').matches) search.value?.focus();
});
</script>

<style scoped>
.filter-head {
  display: flex;
  align-items: center;
  padding-bottom: 6px;
}

.filter-head h2 {
  flex: 1;
  margin: 0 0 0 4px;
  font-family: var(--font-display);
  font-size: 1.375rem;
  line-height: 1.2;
  font-weight: 600;
}

.icon-only {
  width: 44px;
  height: 44px;
  flex: none;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1.125rem;
}

.filter-search {
  width: 100%;
  box-sizing: border-box;
  height: 44px;
  margin: 4px 0 8px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
}

.filter-lists {
  max-height: min(60dvh, 520px);
  overflow-y: auto;
}

h3 {
  margin: 12px 8px 4px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.filter-row {
  width: 100%;
  min-height: 48px;
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

.filter-row:hover {
  background: var(--bg-tertiary);
}

.filter-row[aria-pressed='true'] {
  background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
  font-weight: 600;
}

.swatch {
  width: 22px;
  height: 30px;
  margin: 0 5px;
  flex: none;
  border-radius: 3px;
  box-shadow: inset 3px 0 0 rgba(0, 0, 0, 0.25);
}

.tag-icon {
  width: 32px;
  flex: none;
  text-align: center;
  color: var(--text-secondary);
}

.row-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.continuity-name {
  font-family: var(--font-display);
  font-style: italic;
}

.row-count {
  flex: none;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.no-match {
  padding: 1rem 8px;
  color: var(--text-secondary);
}
</style>
