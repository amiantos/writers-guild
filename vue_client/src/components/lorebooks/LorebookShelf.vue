<template>
  <div class="lorebooks">
    <div v-if="loading" class="loading">Loading lorebooks...</div>

    <div v-else-if="items.length === 0" class="empty-state">
      <i class="fas fa-book-open"></i>
      <p>No lorebooks yet. Start one, or bring one in!</p>
      <div class="empty-actions">
        <button type="button" class="btn btn-primary" @click="$emit('create')">
          <i class="fas fa-plus"></i> Create
        </button>
        <button type="button" class="btn btn-secondary" @click="$emit('import')">
          <i class="fas fa-download"></i> Import
        </button>
      </div>
    </div>

    <section v-else class="shelf" aria-labelledby="lorebooks-title">
      <div class="shelf-header">
        <h2 id="lorebooks-title">
          Lorebooks <span class="shelf-count">{{ countLabel }}</span>
        </h2>
        <div class="shelf-controls">
          <label class="sort">
            <span class="sort-label">Sort</span>
            <select v-model="sort" aria-label="Sort">
              <option v-for="option in LOREBOOK_SORTS" :key="option.key" :value="option.key">
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>
      </div>

      <ScrollShadows class="chips-scroll" hide-scrollbar edge="fade">
        <div class="chips" role="group" aria-label="Show">
          <button
            v-for="option in LOREBOOK_USES"
            :key="option.key"
            type="button"
            class="chip"
            :aria-pressed="use === option.key"
            @click="use = option.key"
          >
            {{ option.label }}
            <span v-if="option.key !== 'all'" class="chip-count">{{ useCounts[option.key] }}</span>
          </button>
        </div>
      </ScrollShadows>

      <div class="shelf-grid">
        <button type="button" class="new-tile" @click="openNew">
          <span class="new-tile-icon"><i class="fas fa-plus"></i></span>
          <span class="new-tile-title">New lorebook</span>
          <span class="new-tile-sub">Start one, or import</span>
        </button>
        <LorebookCover
          v-for="item in visibleItems"
          :key="item.id"
          :item="item"
          @menu="menuId = item.id"
        />
      </div>

      <p v-if="visibleItems.length === 0" class="no-match">
        Nothing matches.
        <button type="button" class="link-btn" @click="use = 'all'">Show every lorebook</button>
      </p>
    </section>

    <LorebookSheet
      v-if="menuItem"
      :item="menuItem"
      :characters-by-id="charactersById"
      :continuities="continuities"
      @close="menuId = null"
      @open="runAction('edit')"
      @open-story="runAction('open-story', $event)"
      @delete="runAction('delete')"
    />

    <ChoiceSheet
      v-if="showNew"
      title="Add a lorebook"
      :options="NEW_OPTIONS"
      @close="showNew = false"
      @pick="finishNew"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import LorebookCover from './LorebookCover.vue';
import LorebookSheet from './LorebookSheet.vue';
import ChoiceSheet from '../library/ChoiceSheet.vue';
import ScrollShadows from '../ScrollShadows.vue';
import {
  LOREBOOK_SORTS,
  LOREBOOK_USES,
  buildLorebookItems,
  filterLorebookItems,
  lorebookUseCounts,
  sortLorebookItems,
} from '../../composables/lorebooks.js';

const props = defineProps({
  lorebooks: { type: Array, default: () => [] },
  stories: { type: Array, default: () => [] },
  characters: { type: Array, default: () => [] },
  continuities: { type: Array, default: () => [] },
  // The header's search text
  query: { type: String, default: '' },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['edit', 'open-story', 'delete', 'create', 'import']);

const NEW_OPTIONS = [
  {
    key: 'create',
    icon: 'fas fa-plus',
    title: 'Create',
    sub: 'Start an empty lorebook and write its entries',
    dashed: true,
  },
  {
    key: 'import',
    icon: 'fas fa-download',
    title: 'Import',
    sub: 'From a lorebook file or a link',
  },
];

// Sort, remembered per browser
const PREFS_KEY = 'writers-guild-lorebooks';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {};
  } catch {
    return {};
  }
}

const prefs = readPrefs();
const sort = ref(LOREBOOK_SORTS.some((s) => s.key === prefs.sort) ? prefs.sort : 'modified');
const use = ref('all');
const menuId = ref(null);
const showNew = ref(false);

watch(sort, () => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: sort.value }));
  } catch {
    // Storage unavailable: the choice lasts until reload.
  }
});

const charactersById = computed(() => new Map(props.characters.map((c) => [c.id, c])));

const items = computed(() =>
  buildLorebookItems({ lorebooks: props.lorebooks, stories: props.stories }),
);

// Looked up by id, so the open sheet follows its lorebook through a reload
const menuItem = computed(() => items.value.find((item) => item.id === menuId.value) ?? null);

const useCounts = computed(() => lorebookUseCounts(items.value));

const visibleItems = computed(() =>
  sortLorebookItems(
    filterLorebookItems(items.value, { use: use.value, query: props.query }),
    sort.value,
  ),
);

const countLabel = computed(() => {
  const n = props.lorebooks.length;
  return `${n} ${n === 1 ? 'lorebook' : 'lorebooks'}`;
});

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
  if (action === 'open-story') emit('open-story', payload);
  else if (action === 'delete') emit('delete', { ...item.source, stories: item.stories });
  else emit(action, item.id);
}

defineExpose({ openNew });
</script>

<style scoped src="../library/shelf.css"></style>

<style scoped>
.lorebooks {
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
