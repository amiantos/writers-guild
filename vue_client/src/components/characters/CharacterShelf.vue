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
        v-if="filters.continuities.length || filters.tags.length"
        class="chips-scroll"
        hide-scrollbar
        edge="fade"
      >
        <div class="chips" role="group" aria-label="Filter by Continuity or tag">
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
          <template v-for="chip in chips" :key="`${chip.kind}:${chip.id}`">
            <span v-if="chip.dividerBefore" class="chip-divider" aria-hidden="true"></span>
            <button
              type="button"
              class="chip"
              :aria-pressed="isFilter(chip.kind, chip.id)"
              @click="toggleFilter(chip.kind, chip.id)"
            >
              <span
                v-if="chip.kind === 'continuity'"
                class="chip-swatch"
                :style="{ background: chip.color }"
              ></span>
              <span :class="{ 'chip-continuity': chip.kind === 'continuity' }">
                {{ chip.name }}
              </span>
              <span class="chip-count">{{ chip.count }}</span>
            </button>
          </template>
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
      @filter-tag="filterByTag"
      @edit="runAction('edit')"
      @delete="runAction('delete')"
    />

    <FilterSheet
      v-if="showFilters"
      title="Filter characters"
      placeholder="Search Continuities and tags"
      :continuities="filters.continuities"
      :tags="filters.tags"
      :active="filter"
      @close="showFilters = false"
      @pick="pickFilter"
    />

    <NewCharacterSheet
      v-if="showNew"
      @close="showNew = false"
      @create="finishNew('create')"
      @generate="finishNew('generate')"
      @import="finishNew('import')"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import CharacterTile from './CharacterTile.vue';
import CharacterSheet from './CharacterSheet.vue';
import NewCharacterSheet from './NewCharacterSheet.vue';
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

// The chip row holds the first few; All filters lists the rest.
const CHIP_CONTINUITIES = 6;
const CHIP_TAGS = 12;

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

// A filter whose Continuity or tag left the shelf no longer applies.
watch(filters, ({ continuities, tags }) => {
  const list = filter.value?.kind === 'continuity' ? continuities : tags;
  if (filter.value && !list.some((entry) => entry.id === filter.value.id)) filter.value = null;
});

const chips = computed(() => {
  const entries = [
    ...filters.value.continuities
      .slice(0, CHIP_CONTINUITIES)
      .map((c) => ({ ...c, kind: 'continuity' })),
    ...filters.value.tags.slice(0, CHIP_TAGS).map((t) => ({ ...t, kind: 'tag' })),
  ];
  // A filter picked from All filters or a character's sheet stays in reach, first in the row.
  const active = filter.value;
  if (active && !entries.some((e) => e.kind === active.kind && e.id === active.id)) {
    const list = active.kind === 'continuity' ? filters.value.continuities : filters.value.tags;
    const entry = list.find((e) => e.id === active.id);
    if (entry) entries.unshift({ ...entry, kind: active.kind });
  }
  return entries.map((entry, index) => ({
    ...entry,
    dividerBefore: index > 0 && entry.kind !== entries[index - 1].kind,
  }));
});

const hasMoreFilters = computed(
  () =>
    filters.value.continuities.length > CHIP_CONTINUITIES || filters.value.tags.length > CHIP_TAGS,
);

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

function isFilter(kind, id) {
  return filter.value?.kind === kind && filter.value.id === id;
}

function toggleFilter(kind, id) {
  filter.value = isFilter(kind, id) ? null : { kind, id };
}

function pickFilter(picked) {
  filter.value = picked;
  showFilters.value = false;
}

function filterByTag(id) {
  menuId.value = null;
  filter.value = { kind: 'tag', id };
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
