<template>
  <div class="character-tile" :class="{ mini }" :style="{ '--cover-color': item.color }">
    <div class="tile-art" :style="url ? null : { background: placeholderColor(item.name) }">
      <img v-if="url" :src="url" alt="" loading="lazy" />
      <span v-else class="tile-initial">{{ item.name.charAt(0).toUpperCase() }}</span>

      <!-- New story and Continue, over the art alone, for a pointer -->
      <div v-if="!mini" class="tile-hover">
        <button type="button" class="hover-btn primary" @click="$emit('new-story')">
          <i class="fas fa-file-circle-plus"></i> New story
        </button>
        <button
          v-if="item.latestStory"
          type="button"
          class="hover-btn"
          :title="`Continue ${item.latestStory.title}`"
          @click="$emit('continue')"
        >
          <i class="fas fa-pen-nib"></i> Continue
        </button>
      </div>
    </div>
    <div v-if="!mini" class="tile-band">
      <span class="tile-name">{{ item.name }}</span>
      <span class="tile-counts">{{ appearanceLine(item) }}</span>
      <span class="tile-meta">{{ meta }}</span>
    </div>

    <!-- The whole card opens the character's page; the hover buttons and menu sit above it -->
    <RouterLink
      v-if="!mini"
      :to="{ name: 'character-detail', params: { characterId: item.id } }"
      class="tile-open"
      :aria-label="`Open ${item.name}`"
    ></RouterLink>

    <button
      v-if="!mini"
      type="button"
      class="tile-menu"
      :aria-label="`More actions for ${item.name}`"
      @click="$emit('menu')"
    >
      <span><i class="fas fa-ellipsis"></i></span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { placeholderColor, portraitUrl, timeAgo } from '../../composables/library.js';
import { appearanceLine } from '../../composables/characters.js';

const props = defineProps({
  // A card from buildCharacterItems()
  item: { type: Object, required: true },
  // A thumbnail: the portrait only, for sheets
  mini: { type: Boolean, default: false },
});

defineEmits(['new-story', 'continue', 'menu']);

const url = computed(() => portraitUrl(props.item.source));

// When they were last in a story or chat, else when they joined the library
const meta = computed(() => {
  if (props.item.lastActive) return `Active ${timeAgo(props.item.lastActive)}`;
  return props.item.created ? `Added ${timeAgo(props.item.created)}` : '';
});
</script>

<style scoped>
.character-tile {
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

.character-tile:has(.tile-open:focus-visible) {
  outline: 3px solid var(--accent-primary);
  outline-offset: 3px;
}

.character-tile.mini {
  border-radius: 4px;
}

.tile-open {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.tile-open:focus-visible {
  outline: none;
}

/* Above the card's open link, so the hover buttons can be clicked; the art itself lets clicks
   through to open the character */
.tile-art {
  position: relative;
  z-index: 2;
  pointer-events: none;
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tile-art img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  display: block;
}

.tile-initial {
  font-family: var(--font-display);
  font-size: clamp(24px, 34cqw, 96px);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
}

.tile-band {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px 12px;
}

.tile-name {
  font-family: var(--font-display);
  font-size: clamp(13px, 9cqw, 24px);
  /* Room inside the clamp's clip for Literata's descenders and overhanging serifs, as on a
     story's cover */
  line-height: 1.35;
  padding-bottom: 0.12em;
  padding-inline: 0.06em;
  margin-inline: -0.06em;
  font-weight: 600;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.tile-counts,
.tile-meta {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tile-counts {
  font-size: clamp(11px, 6.2cqw, 14px);
  color: rgba(246, 239, 230, 0.82);
}

.tile-meta {
  font-size: clamp(10px, 5.2cqw, 12px);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(246, 239, 230, 0.72);
}

/* Over the art alone, above the card's open link; its own buttons take clicks, the rest falls
   through to open the character */
.tile-hover {
  display: none;
  position: absolute;
  inset: 0;
  /* Clear of the menu button in the corner */
  padding: 44px 14px 12px;
  background: rgba(14, 11, 9, 0.62);
  flex-direction: column;
  justify-content: center;
  gap: 8px;
}

@media (hover: hover) {
  .character-tile:hover .tile-hover,
  .character-tile:focus-within .tile-hover {
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

.tile-menu {
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

.tile-menu span {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(14, 11, 9, 0.55);
  color: #f6efe6;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tile-menu:hover span {
  background: rgba(14, 11, 9, 0.8);
}
</style>
