<template>
  <div class="library">
    <div v-if="loading" class="loading">Loading library...</div>

    <div v-else-if="items.length === 0" class="empty-state">
      <i class="fas fa-book"></i>
      <p>No stories yet. Start your first one!</p>
      <button type="button" class="btn btn-primary" @click="openNew">
        <i class="fas fa-plus"></i> New story
      </button>
    </div>

    <template v-else>
      <section v-if="hero" class="hero" aria-labelledby="hero-title">
        <div class="hero-cover">
          <StoryCover
            :item="hero"
            :cast="castOf(hero)"
            :show-menu="false"
            :hover-actions="false"
            @open="$emit('open-story', hero.id)"
          />
        </div>
        <div class="hero-details">
          <p class="eyebrow">Pick up where you left off</p>
          <h2 id="hero-title" class="hero-title">{{ hero.title }}</h2>
          <div v-if="heroCast.length" class="hero-cast">
            <AvatarStack :characters="heroCast" :size="32" />
            <span>{{ joinNames(heroCast.map((c) => c.name)) }}</span>
          </div>
          <p v-if="hero.source.description" class="hero-description">
            {{ hero.source.description }}
          </p>
          <div class="hero-meta">
            <span v-if="hero.continuityName" class="continuity-name">
              <i class="fas fa-layer-group"></i> {{ hero.continuityName }}
            </span>
            <span>{{ hero.wordCount.toLocaleString() }} words</span>
            <span>Edited {{ timeAgo(hero.modified) }}</span>
          </div>
          <div class="hero-actions">
            <button type="button" class="btn btn-primary" @click="$emit('open-story', hero.id)">
              <i class="fas fa-pen-nib"></i> Continue writing
            </button>
            <button type="button" class="btn btn-secondary" @click="$emit('new-from', hero.source)">
              <i class="fas fa-file-circle-plus"></i> New story with this setup
            </button>
            <button
              type="button"
              class="btn btn-secondary btn-icon"
              :aria-label="`More actions for ${hero.title}`"
              @click="menuItem = hero"
            >
              <i class="fas fa-ellipsis"></i>
            </button>
          </div>
        </div>
        <aside v-if="setupRows.length" class="setups" aria-labelledby="setups-title">
          <h2 id="setups-title">Start from a recent setup</h2>
          <p>Same cast, persona, preset and perspective</p>
          <button
            v-for="setup in setupRows"
            :key="setup.key"
            type="button"
            class="setup-row"
            :aria-label="setup.label"
            @click="$emit('new-from', setup.story)"
          >
            <span class="setup-avatars"><AvatarStack :characters="setup.cast" :size="34" /></span>
            <span class="setup-text">
              <span class="setup-names">{{ setup.names }}</span>
              <span class="setup-sub">{{ setup.sub }}</span>
            </span>
            <span class="setup-plus"><i class="fas fa-plus"></i></span>
          </button>
        </aside>
      </section>

      <section v-if="hero" class="continue-card" aria-label="Continue writing">
        <div class="continue-thumb">
          <StoryCover :item="hero" :cast="castOf(hero)" mini />
        </div>
        <div class="continue-text">
          <span class="eyebrow">Continue</span>
          <span class="continue-title">{{ hero.title }}</span>
          <span class="continue-meta">{{ continueMeta }}</span>
        </div>
        <button
          type="button"
          class="continue-btn"
          :aria-label="`Continue writing ${hero.title}`"
          @click="$emit('open-story', hero.id)"
        >
          <i class="fas fa-pen-nib"></i>
        </button>
      </section>

      <section class="shelf" aria-labelledby="shelf-title">
        <div class="shelf-header">
          <h2 id="shelf-title">
            Library <span class="shelf-count">{{ countLabel }}</span>
          </h2>
          <div class="shelf-controls">
            <div v-if="chatsEnabled" class="segmented" role="group" aria-label="Show">
              <button
                v-for="option in LIBRARY_TYPES"
                :key="option.key"
                type="button"
                :aria-pressed="type === option.key"
                @click="type = option.key"
              >
                {{ option.label }}
              </button>
            </div>
            <label class="sort">
              <span class="sort-label">Sort</span>
              <select v-model="sort" aria-label="Sort">
                <option v-for="option in LIBRARY_SORTS" :key="option.key" :value="option.key">
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>
        </div>

        <div
          v-if="filters.continuities.length || filters.characters.length"
          class="chips"
          role="group"
          aria-label="Filter by Continuity or character"
        >
          <button type="button" class="chip" :aria-pressed="!filter" @click="filter = null">
            All
          </button>
          <button
            v-for="continuity in filters.continuities"
            :key="continuity.id"
            type="button"
            class="chip"
            :aria-pressed="isFilter('continuity', continuity.id)"
            @click="toggleFilter('continuity', continuity.id)"
          >
            <span class="chip-swatch" :style="{ background: continuity.color }"></span>
            <span class="chip-continuity">{{ continuity.name }}</span>
            <span class="chip-count">{{ continuity.count }}</span>
          </button>
          <span
            v-if="filters.continuities.length && filters.characters.length"
            class="chip-divider"
            aria-hidden="true"
          ></span>
          <button
            v-for="entry in filters.characters"
            :key="entry.id"
            type="button"
            class="chip chip-character"
            :aria-pressed="isFilter('character', entry.id)"
            @click="toggleFilter('character', entry.id)"
          >
            <AvatarStack :characters="[charactersById.get(entry.id)]" :size="28" />
            <span>{{ entry.name }}</span>
            <span class="chip-count">{{ entry.count }}</span>
          </button>
        </div>

        <div class="shelf-grid">
          <button type="button" class="new-tile" @click="openNew">
            <span class="new-tile-icon"><i class="fas fa-plus"></i></span>
            <span class="new-tile-title">New story</span>
            <span class="new-tile-sub">Blank, or from a recent setup</span>
          </button>
          <template v-for="item in visibleItems" :key="item.key">
            <StoryCover
              v-if="item.kind === 'story'"
              :item="item"
              :cast="castOf(item)"
              @open="$emit('open-story', item.id)"
              @menu="menuItem = item"
              @new-from="$emit('new-from', item.source)"
            />
            <ChatCard
              v-else
              :item="item"
              :cast="castOf(item)"
              @open="$emit('open-chat', item.id)"
              @menu="menuItem = item"
            />
          </template>
        </div>

        <p v-if="visibleItems.length === 0" class="no-match">
          Nothing matches.
          <button type="button" class="link-btn" @click="clearFilters">Show everything</button>
        </p>
      </section>
    </template>

    <ItemSheet
      v-if="menuItem"
      :item="menuItem"
      :characters-by-id="charactersById"
      :presets="presets"
      :default-preset-id="defaultPresetId"
      @close="menuItem = null"
      @open="runItemAction('open')"
      @new-from="runItemAction('new-from')"
      @edit="runItemAction('edit')"
      @duplicate="runItemAction('duplicate')"
      @delete="runItemAction('delete')"
    />

    <NewSheet
      v-if="showNew"
      :setups="setupRows"
      :characters="characters"
      :chats-enabled="chatsEnabled"
      @close="showNew = false"
      @blank="finishNew('new-blank')"
      @character="finishNew('new-with-character', $event)"
      @chat="finishNew('new-chat')"
      @setup="finishNew('new-from', $event)"
    />
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import StoryCover from './StoryCover.vue';
import ChatCard from './ChatCard.vue';
import AvatarStack from './AvatarStack.vue';
import ItemSheet from './ItemSheet.vue';
import NewSheet from './NewSheet.vue';
import {
  LIBRARY_SORTS,
  LIBRARY_TYPES,
  buildLibraryItems,
  castLine,
  filterLibraryItems,
  libraryFilters,
  recentSetups,
  sortLibraryItems,
  timeAgo,
} from '../../composables/library.js';
import { joinNames } from '../../../../shared/story-titles.js';
import { describePerspective } from '../../../../shared/perspective.js';

const props = defineProps({
  stories: { type: Array, default: () => [] },
  chats: { type: Array, default: () => [] },
  characters: { type: Array, default: () => [] },
  continuities: { type: Array, default: () => [] },
  presets: { type: Array, default: () => [] },
  defaultPresetId: { type: String, default: null },
  chatsEnabled: { type: Boolean, default: false },
  // The header's search text
  query: { type: String, default: '' },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits([
  'open-story',
  'open-chat',
  'edit-story',
  'new-from',
  'duplicate',
  'delete-story',
  'delete-chat',
  'new-blank',
  'new-with-character',
  'new-chat',
]);

// Sort and Stories/Chats choice, remembered per browser
const PREFS_KEY = 'writers-guild-library';

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {};
  } catch {
    return {};
  }
}

const prefs = readPrefs();
const sort = ref(LIBRARY_SORTS.some((s) => s.key === prefs.sort) ? prefs.sort : 'modified');
const type = ref(LIBRARY_TYPES.some((t) => t.key === prefs.type) ? prefs.type : 'all');
const filter = ref(null);
const menuItem = ref(null);
const showNew = ref(false);

watch([sort, type], () => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: sort.value, type: type.value }));
  } catch {
    // Storage unavailable: the choice lasts until reload.
  }
});

const charactersById = computed(() => new Map(props.characters.map((c) => [c.id, c])));

const items = computed(() =>
  buildLibraryItems({
    stories: props.stories,
    chats: props.chatsEnabled ? props.chats : [],
    continuities: props.continuities,
  }),
);

const filters = computed(() => libraryFilters(items.value, charactersById.value));

// A filter whose Continuity or character left the shelf no longer applies.
watch(filters, ({ continuities, characters }) => {
  const list = filter.value?.kind === 'continuity' ? continuities : characters;
  if (filter.value && !list.some((entry) => entry.id === filter.value.id)) filter.value = null;
});

const visibleItems = computed(() =>
  sortLibraryItems(
    filterLibraryItems(items.value, {
      type: props.chatsEnabled ? type.value : 'all',
      filter: filter.value,
      query: props.query,
      charactersById: charactersById.value,
    }),
    sort.value,
  ),
);

const hero = computed(() => items.value.find((item) => item.kind === 'story') ?? null);
const heroCast = computed(() => (hero.value ? castOf(hero.value) : []));

const continueMeta = computed(() => {
  const names = castLine(heroCast.value.map((c) => c.name));
  return [hero.value.continuityName || names, timeAgo(hero.value.modified)]
    .filter(Boolean)
    .join(' · ');
});

const countOf = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const countLabel = computed(() => {
  const stories = countOf(props.stories.length, 'story', 'stories');
  return props.chatsEnabled
    ? `${stories} · ${countOf(props.chats.length, 'chat', 'chats')}`
    : stories;
});

const continuityNames = computed(() => new Map(props.continuities.map((c) => [c.id, c.name])));

const setupRows = computed(() =>
  recentSetups(props.stories).map(({ story, count }) => {
    const cast = story.characterIds.map((id) => charactersById.value.get(id)).filter(Boolean);
    const names = castLine(cast.map((c) => c.name));
    const preset = props.presets.find((p) => p.id === story.configPresetId);
    const perspective = describePerspective({
      mode: story.perspective,
      tense: story.perspectiveTense,
    });
    return {
      key: story.id,
      story,
      cast,
      names,
      sub: capitalize(
        [continuityNames.value.get(story.continuityId), preset?.name, perspective]
          .filter(Boolean)
          .join(' · '),
      ),
      used:
        count > 1
          ? `${story.title} and ${count - 1} more · ${timeAgo(story.modified)}`
          : `${story.title} · ${timeAgo(story.modified)}`,
      label: `New story with ${names}`,
    };
  }),
);

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function castOf(item) {
  const ids = item.characterIds.length
    ? item.characterIds
    : [item.personaCharacterId].filter(Boolean);
  return ids.map((id) => charactersById.value.get(id)).filter(Boolean);
}

function isFilter(kind, id) {
  return filter.value?.kind === kind && filter.value.id === id;
}

function toggleFilter(kind, id) {
  filter.value = isFilter(kind, id) ? null : { kind, id };
}

function clearFilters() {
  filter.value = null;
  type.value = 'all';
}

function openNew() {
  showNew.value = true;
}

function finishNew(event, payload) {
  showNew.value = false;
  emit(event, payload);
}

function runItemAction(action) {
  const item = menuItem.value;
  menuItem.value = null;
  const isStory = item.kind === 'story';
  if (action === 'open') emit(isStory ? 'open-story' : 'open-chat', item.id);
  else if (action === 'new-from') emit('new-from', item.source);
  else if (action === 'edit') emit('edit-story', item.id);
  else if (action === 'duplicate') emit('duplicate', item.source);
  else if (action === 'delete') emit(isStory ? 'delete-story' : 'delete-chat', item.source);
}

defineExpose({ openNew });
</script>

<style scoped>
.library {
  display: flex;
  flex-direction: column;
  gap: 3rem;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
}

.eyebrow {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent-primary);
}

/* Pick up where you left off */
.hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2rem;
}

.hero-cover {
  flex: 0 0 200px;
  width: 200px;
}

.hero-details {
  flex: 1 1 340px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.hero-title {
  margin: 0;
  font-family: var(--font-display);
  font-size: 2.25rem;
  line-height: 1.1;
  font-weight: 600;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}

.hero-cast {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.hero-description {
  margin: 0;
  max-width: 60ch;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.hero-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.continuity-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-primary);
  font-family: var(--font-display);
  font-style: italic;
  font-size: 0.875rem;
}

.continuity-name i {
  font-size: 0.75em;
  font-style: normal;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 4px;
}

.hero-actions .btn {
  height: 44px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9375rem;
  font-weight: 600;
}

.btn-icon {
  width: 44px;
  padding: 0;
  justify-content: center;
}

.setups {
  flex: 1 1 320px;
  max-width: 420px;
  box-sizing: border-box;
  padding: 1rem 0.75rem 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
}

.setups h2 {
  margin: 0 0.5rem;
  font-size: 1rem;
  font-weight: 600;
}

.setups p {
  margin: 2px 0.5rem 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.setup-row {
  min-height: 60px;
  padding: 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  display: flex;
  align-items: center;
  gap: 12px;
}

.setup-row:hover {
  background: var(--bg-secondary);
}

.setup-avatars {
  width: 76px;
  flex: none;
  display: flex;
}

.setup-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.setup-names,
.setup-sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.setup-names {
  font-size: 0.875rem;
  font-weight: 600;
}

.setup-sub {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.setup-plus {
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 50%;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8125rem;
}

/* The phone's Continue card stands in for the hero */
.continue-card {
  display: none;
  align-items: center;
  gap: 14px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  background: var(--bg-primary);
}

.continue-thumb {
  flex: 0 0 56px;
  width: 56px;
}

.continue-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.continue-text .eyebrow {
  font-size: 0.6875rem;
}

.continue-title,
.continue-meta {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.continue-title {
  font-family: var(--font-display);
  font-size: 1.0625rem;
  line-height: 1.25;
  font-weight: 600;
}

.continue-meta {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.continue-btn {
  width: 48px;
  height: 48px;
  flex: none;
  border: none;
  border-radius: 50%;
  background: var(--accent-primary);
  color: #fff;
  font-size: 1.125rem;
}

/* The shelf */
.shelf {
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
}

.shelf-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px 24px;
}

.shelf-header h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.625rem;
  line-height: 1.2;
  font-weight: 600;
}

.shelf-count {
  font-family: var(--font-ui);
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.shelf-controls {
  margin-left: auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
}

.segmented {
  display: flex;
  padding: 3px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
}

.segmented button {
  height: 34px;
  padding: 0 14px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
}

.segmented button[aria-pressed='true'] {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-weight: 600;
}

.sort {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.sort select {
  height: 40px;
  padding: 0 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
  font-size: 0.875rem;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.chip {
  height: 40px;
  padding: 0 16px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 0.875rem;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  flex: none;
}

.chip:has(.chip-swatch) {
  padding-left: 10px;
  padding-right: 14px;
}

.chip-character {
  padding: 0 14px 0 5px;
}

.chip[aria-pressed='true'] {
  border-color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
  font-weight: 600;
}

.chip-swatch {
  width: 16px;
  height: 22px;
  flex: none;
  border-radius: 3px;
  box-shadow: inset 3px 0 0 rgba(0, 0, 0, 0.25);
}

.chip-continuity {
  font-family: var(--font-display);
  font-style: italic;
}

.chip-count {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  font-weight: 400;
}

.chip-divider {
  width: 1px;
  height: 24px;
  margin: 0 4px;
  background: var(--border-color);
  flex: none;
}

.shelf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(170px, calc(50% - 10px)), 1fr));
  gap: 2rem 1.25rem;
  margin-top: 0.5rem;
}

.new-tile {
  aspect-ratio: 2 / 3;
  box-sizing: border-box;
  padding: 1rem;
  border: 2px dashed var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
}

.new-tile:hover {
  border-color: var(--accent-primary);
}

.new-tile-icon {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
}

.new-tile-title {
  font-size: 0.9375rem;
  font-weight: 600;
  color: var(--text-primary);
}

.new-tile-sub {
  font-size: 0.8125rem;
}

.no-match {
  color: var(--text-secondary);
}

.link-btn {
  border: none;
  background: none;
  padding: 0;
  color: var(--accent-primary);
  font-weight: 600;
}

@media (max-width: 720px) {
  .library {
    gap: 1.25rem;
  }

  .hero {
    display: none;
  }

  .continue-card {
    display: flex;
  }

  .shelf-header h2 {
    font-size: 1.25rem;
  }

  .shelf-controls {
    margin-left: 0;
    width: 100%;
    flex-wrap: nowrap;
    justify-content: space-between;
  }

  .segmented button {
    padding: 0 11px;
  }

  .sort-label {
    display: none;
  }

  .chips {
    flex-wrap: nowrap;
    overflow-x: auto;
    margin: 0 -1rem;
    padding: 0 1rem 2px;
    scrollbar-width: none;
  }

  .chips::-webkit-scrollbar {
    display: none;
  }

  .shelf-grid {
    gap: 1.5rem 0.875rem;
  }

  /* The New button floats over the shelf instead */
  .new-tile {
    display: none;
  }
}
</style>
