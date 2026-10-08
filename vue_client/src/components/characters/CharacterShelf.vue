<template>
  <div class="characters">
    <div v-if="loading" class="loading">Loading characters...</div>

    <div v-else-if="items.length === 0" class="empty-state">
      <i class="fas fa-users"></i>
      <p>No characters yet. Bring in your first one!</p>
      <div class="empty-actions">
        <button type="button" class="btn btn-primary" @click="$emit('create')">
          <i class="fas fa-plus"></i> Create
        </button>
        <button type="button" class="btn btn-secondary" @click="$emit('generate')">
          <i class="fas fa-wand-magic-sparkles"></i> Generate
        </button>
        <button type="button" class="btn btn-secondary" @click="$emit('import')">
          <i class="fas fa-download"></i> Import
        </button>
      </div>
    </div>

    <section v-else class="shelf" aria-labelledby="characters-title">
      <div class="shelf-header">
        <h2 id="characters-title">
          Cast <span class="shelf-count">{{ countLabel }}</span>
        </h2>
        <div class="shelf-controls">
          <label class="sort">
            <span class="sort-label">Sort</span>
            <select v-model="sort" aria-label="Sort">
              <option v-for="option in CHARACTER_SORTS" :key="option.key" :value="option.key">
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>
      </div>

      <ScrollShadows
        v-if="filters.continuities.length"
        class="chips-scroll"
        hide-scrollbar
        edge="fade"
      >
        <div class="chips" role="group" aria-label="Filter by Continuity">
          <button type="button" class="chip" :aria-pressed="!filter" @click="filter = null">
            All
          </button>
          <button
            v-if="hasMoreFilters"
            type="button"
            class="chip chip-more"
            aria-haspopup="dialog"
            @click="showFilters = true"
          >
            <i class="fas fa-magnifying-glass"></i> All filters
          </button>
          <button
            v-for="chip in chips"
            :key="chip.id"
            type="button"
            class="chip"
            :aria-pressed="isFilter(chip.id)"
            @click="toggleFilter(chip.id)"
          >
            <span class="chip-swatch" :style="{ background: chip.color }"></span>
            <span class="chip-continuity">{{ chip.name }}</span>
            <span class="chip-count">{{ chip.count }}</span>
          </button>
        </div>
      </ScrollShadows>

      <div class="shelf-grid">
        <button type="button" class="new-tile" @click="openNew">
          <span class="new-tile-icon"><i class="fas fa-plus"></i></span>
          <span class="new-tile-title">New character</span>
          <span class="new-tile-sub">Create, generate or import</span>
        </button>
        <CharacterTile
          v-for="item in visibleItems"
          :key="item.id"
          :item="item"
          @new-story="$emit('new-story', item.id)"
          @continue="$emit('open-story', item.latestStory.id)"
          @menu="menuId = item.id"
        />
      </div>

      <p v-if="visibleItems.length === 0" class="no-match">
        Nothing matches.
        <button type="button" class="link-btn" @click="filter = null">Show everyone</button>
      </p>
    </section>

    <CharacterSheet
      v-if="menuItem"
      :item="menuItem"
      :characters-by-id="charactersById"
      @close="menuId = null"
      @new-story="runAction('new-story')"
      @open-story="runAction('open-story', $event)"
      @open-chat="runAction('open-chat', $event)"
      @show-all="runAction('show-in-library')"
      @edit="runAction('edit')"
      @delete="runAction('delete')"
    />

    <FilterSheet
      v-if="showFilters"
      title="Filter characters"
      placeholder="Search Continuities"
      :continuities="filters.continuities"
      :active="filter"
      @close="showFilters = false"
      @pick="pickFilter"
    />

    <ChoiceSheet
      v-if="showNew"
      title="Add a character"
      :options="NEW_OPTIONS"
      @close="showNew = false"
      @pick="finishNew"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import CharacterTile from './CharacterTile.vue';
import CharacterSheet from './CharacterSheet.vue';
import ChoiceSheet from '../library/ChoiceSheet.vue';
import FilterSheet from '../library/FilterSheet.vue';
import ScrollShadows from '../ScrollShadows.vue';
import {
  CHARACTER_SORTS,
  buildCharacterItems,
  characterFilters,
  filterCharacterItems,
  sortCharacterItems,
} from '../../composables/characters.js';

const props = defineProps({
  characters: { type: Array, default: () => [] },
  stories: { type: Array, default: () => [] },
  chats: { type: Array, default: () => [] },
  continuities: { type: Array, default: () => [] },
  chatsEnabled: { type: Boolean, default: false },
  // The header's search text
  query: { type: String, default: '' },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits([
  'new-story',
  'open-story',
  'open-chat',
  'edit',
  'delete',
  'show-in-library',
  'create',
  'generate',
  'import',
]);

const NEW_OPTIONS = [
  {
    key: 'create',
    icon: 'fas fa-plus',
    title: 'Create',
    sub: 'Write their card yourself',
    dashed: true,
  },
  {
    key: 'generate',
    icon: 'fas fa-wand-magic-sparkles',
    title: 'Generate',
    sub: 'Describe them, and the AI writes the card',
  },
  {
    key: 'import',
    icon: 'fas fa-download',
    title: 'Import',
    sub: 'From a character card file or a link',
  },
];

// Sort, remembered per browser
const PREFS_KEY = 'writers-guild-characters';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {};
  } catch {
    return {};
  }
}

const prefs = readPrefs();
const sort = ref(CHARACTER_SORTS.some((s) => s.key === prefs.sort) ? prefs.sort : 'active');
const filter = ref(null);
const menuId = ref(null);
const showNew = ref(false);
const showFilters = ref(false);

// The chip row holds the most recently active few; All filters lists the rest.
const CHIP_CONTINUITIES = 8;

watch(sort, () => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: sort.value }));
  } catch {
    // Storage unavailable: the choice lasts until reload.
  }
});

const charactersById = computed(() => new Map(props.characters.map((c) => [c.id, c])));

const items = computed(() =>
  sortCharacterItems(
    buildCharacterItems({
      characters: props.characters,
      stories: props.stories,
      chats: props.chatsEnabled ? props.chats : [],
      continuities: props.continuities,
    }),
    'active',
  ),
);

// Looked up by id, so the open sheet follows its character through a reload
const menuItem = computed(() => items.value.find((item) => item.id === menuId.value) ?? null);

const filters = computed(() => characterFilters(items.value));

// A filter whose Continuity left the shelf no longer applies.
watch(filters, ({ continuities }) => {
  if (filter.value && !continuities.some((entry) => entry.id === filter.value.id)) {
    filter.value = null;
  }
});

const chips = computed(() => {
  const all = filters.value.continuities;
  const entries = all.slice(0, CHIP_CONTINUITIES);
  // A filter picked from All filters stays in reach, first in the row.
  const active = filter.value && all.find((entry) => entry.id === filter.value.id);
  if (active && !entries.includes(active)) entries.unshift(active);
  return entries;
});

const hasMoreFilters = computed(() => filters.value.continuities.length > CHIP_CONTINUITIES);

const visibleItems = computed(() =>
  sortCharacterItems(
    filterCharacterItems(items.value, { filter: filter.value, query: props.query }),
    sort.value,
  ),
);

const countLabel = computed(() => {
  const n = props.characters.length;
  return `${n} ${n === 1 ? 'character' : 'characters'}`;
});

function isFilter(id) {
  return filter.value?.id === id;
}

function toggleFilter(id) {
  filter.value = isFilter(id) ? null : { kind: 'continuity', id };
}

function pickFilter(picked) {
  filter.value = picked;
  showFilters.value = false;
}

function openNew() {
  showNew.value = true;
}

function finishNew(event) {
  showNew.value = false;
  emit(event);
}

function runAction(action, payload) {
  const item = menuItem.value;
  menuId.value = null;
  if (action === 'open-story' || action === 'open-chat') emit(action, payload);
  else if (action === 'delete') emit('delete', item.source);
  else emit(action, item.id);
}

defineExpose({ openNew });
</script>

<style scoped src="../library/shelf.css"></style>

<style scoped>
.characters {
  display: flex;
  flex-direction: column;
}

/* The cards are taller than a story's cover, so the New tile takes their row's height */
.new-tile {
  aspect-ratio: auto;
}

.empty-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
}

/* With only the sort to hold, the controls stay beside the heading */
@media (max-width: 900px) {
  .shelf-header {
    flex-wrap: nowrap;
    align-items: center;
  }

  .shelf-controls {
    width: auto;
    margin-left: auto;
  }
}
</style>
