<template>
  <div class="story-cover" :class="{ mini }" :style="{ '--cover-color': item.color }">
    <div class="cover-art" :class="`cast-${tiles.length}`">
      <span v-for="tile in tiles" :key="tile.key" class="cover-tile" :style="tile.style">
        <img v-if="tile.url" :src="tile.url" alt="" loading="lazy" />
        <span v-else class="tile-initial">{{ tile.initial }}</span>
        <span v-if="tile.more" class="tile-more">+{{ tile.more }}</span>
      </span>
      <span v-if="tiles.length === 0" class="cover-letter">{{ item.title.charAt(0) }}</span>

      <!-- Continue and New from setup, over the art alone, for a pointer -->
      <div v-if="!mini && hoverActions" class="cover-hover">
        <button type="button" class="hover-btn primary" @click="$emit('open')">
          <i class="fas fa-pen-nib"></i> Continue
        </button>
        <button type="button" class="hover-btn" @click="$emit('new-from')">
          <i class="fas fa-file-circle-plus"></i> New from setup
        </button>
      </div>
    </div>
    <div v-if="!mini" class="cover-band">
      <span class="cover-title">{{ item.title }}</span>
      <span v-if="item.continuityName" class="cover-continuity">
        <i class="fas fa-layer-group"></i>
        <span>{{ item.continuityName }}</span>
      </span>
      <span v-else-if="names" class="cover-cast">{{ names }}</span>
      <span class="cover-meta">{{ meta }}</span>
    </div>
    <span class="cover-spine"></span>

    <!-- The whole cover opens the story; the hover buttons and menu sit above it -->
    <button
      v-if="!mini"
      type="button"
      class="cover-open"
      :aria-label="`Open ${item.title}`"
      @click="$emit('open')"
    ></button>

    <button
      v-if="!mini && showMenu"
      type="button"
      class="cover-menu"
      :aria-label="`More actions for ${item.title}`"
      @click="$emit('menu')"
    >
      <span><i class="fas fa-ellipsis"></i></span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { castLine, placeholderColor, portraitUrl, timeAgo } from '../../composables/library.js';

const props = defineProps({
  // A card from buildLibraryItems()
  item: { type: Object, required: true },
  // The story's characters, in order
  cast: { type: Array, default: () => [] },
  // A thumbnail: art only, for sheets and the Continue card
  mini: { type: Boolean, default: false },
  showMenu: { type: Boolean, default: true },
  hoverActions: { type: Boolean, default: true },
});

defineEmits(['open', 'menu', 'new-from']);

// Up to four portraits; past four, the last tile counts the rest.
const tiles = computed(() => {
  const shown = props.cast.slice(0, 4);
  return shown.map((character, index) => ({
    key: character.id,
    url: portraitUrl(character),
    initial: (character.name || '?').charAt(0).toUpperCase(),
    style: portraitUrl(character) ? null : { background: placeholderColor(character.name) },
    more: props.cast.length > 4 && index === 3 ? props.cast.length - 3 : 0,
  }));
});

const names = computed(() => castLine(props.cast.map((c) => c.name)));

const meta = computed(
  () => `${(props.item.wordCount ?? 0).toLocaleString()} words · ${timeAgo(props.item.modified)}`,
);
</script>

<style scoped>
.story-cover {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 3;
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 6px;
  background: var(--cover-color, #2f3a3a);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.3),
    0 8px 18px rgba(0, 0, 0, 0.22);
  color: #f6efe6;
}

.story-cover:has(.cover-open:focus-visible) {
  outline: 3px solid var(--accent-primary);
  outline-offset: 3px;
}

.story-cover.mini {
  border-radius: 4px;
}

.cover-open {
  position: absolute;
  inset: 0;
  z-index: 1;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}

.cover-open:focus-visible {
  outline: none;
}

.cover-art {
  position: relative;
  isolation: isolate;
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  gap: 2px;
  grid-template-columns: 1fr;
  grid-template-rows: 1fr;
}

.mini .cover-art {
  margin-bottom: 9px;
}

.cover-art.cast-2 {
  grid-template-columns: 1fr 1fr;
}

.cover-art.cast-3,
.cover-art.cast-4 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.cover-art.cast-3 .cover-tile:first-child {
  grid-row: span 2;
}

.cover-tile {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-tile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  display: block;
}

.tile-initial {
  font-family: var(--font-display);
  font-size: clamp(16px, 18cqw, 56px);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.tile-more {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(12, 10, 8, 0.55);
  color: #fff;
  font-size: clamp(14px, 11cqw, 26px);
  font-weight: 600;
}

.cover-letter {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: clamp(32px, 40cqw, 110px);
  font-weight: 600;
  color: rgba(246, 239, 230, 0.28);
}

.cover-band {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px 12px 14px;
}

.cover-title {
  font-family: var(--font-display);
  font-size: clamp(13px, 9cqw, 24px);
  line-height: 1.18;
  font-weight: 600;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.cover-cast,
.cover-continuity span,
.cover-meta {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cover-cast {
  font-size: clamp(11px, 6.2cqw, 14px);
  color: rgba(246, 239, 230, 0.82);
}

.cover-continuity {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-family: var(--font-display);
  font-style: italic;
  font-size: clamp(11px, 6.4cqw, 15px);
  color: rgba(246, 239, 230, 0.9);
}

.cover-continuity i {
  flex: none;
  font-size: 0.8em;
  font-style: normal;
}

.cover-meta {
  font-size: clamp(10px, 5.2cqw, 12px);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(246, 239, 230, 0.72);
}

.cover-spine {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 5px;
  background: rgba(0, 0, 0, 0.2);
  pointer-events: none;
}

/* Over the art alone, above the cover's open button; its own buttons take clicks, the rest
   falls through to open the story */
.cover-hover {
  display: none;
  position: absolute;
  inset: 0;
  z-index: 2;
  padding: 0 14px;
  background: rgba(14, 11, 9, 0.62);
  pointer-events: none;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
}

@media (hover: hover) {
  .story-cover:hover .cover-hover,
  .story-cover:focus-within .cover-hover {
    display: flex;
  }
}

.hover-btn {
  pointer-events: auto;
  height: 38px;
  border: 1px solid rgba(246, 239, 230, 0.55);
  border-radius: 8px;
  background: rgba(14, 11, 9, 0.35);
  color: #f6efe6;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.hover-btn.primary {
  border: none;
  background: var(--accent-primary);
  color: #fff;
}

.hover-btn:hover {
  filter: brightness(1.1);
}

.cover-menu {
  position: absolute;
  z-index: 3;
  top: 2px;
  right: 2px;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-menu span {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(14, 11, 9, 0.55);
  color: #f6efe6;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-menu:hover span {
  background: rgba(14, 11, 9, 0.8);
}
</style>
