<template>
  <div class="lorebook-cover" :class="{ mini }" :style="{ '--cover-color': item.color }">
    <div class="cover-frame">
      <template v-if="!mini">
        <span class="cover-kicker">Lorebook</span>
        <span class="cover-rule" aria-hidden="true"></span>
        <span class="cover-name">{{ item.name }}</span>
        <span class="cover-rule" aria-hidden="true"></span>
        <span v-if="byline" class="cover-byline">{{ byline }}</span>
        <span class="cover-foot">
          <AvatarStack v-if="item.characters.length" :characters="item.characters" :size="22" />
          <span class="cover-meta">{{ meta }}</span>
        </span>
      </template>
      <i v-else class="fas fa-book-open cover-icon" aria-hidden="true"></i>
    </div>
    <span class="cover-spine"></span>

    <!-- The whole cover opens the lorebook; the menu sits above it -->
    <RouterLink
      v-if="!mini"
      :to="{ name: 'lorebook-detail', params: { lorebookId: item.id } }"
      class="cover-open"
      :aria-label="`Open ${item.name}`"
    ></RouterLink>

    <button
      v-if="!mini"
      type="button"
      class="cover-menu"
      :aria-label="`More actions for ${item.name}`"
      @click="$emit('menu')"
    >
      <span><i class="fas fa-ellipsis"></i></span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import AvatarStack from '../library/AvatarStack.vue';
import { castLine, timeAgo } from '../../composables/library.js';
import { entryLine } from '../../composables/lorebooks.js';

const props = defineProps({
  // A card from buildLorebookItems()
  item: { type: Object, required: true },
  // A thumbnail: the color and a book, for sheets
  mini: { type: Boolean, default: false },
});

defineEmits(['menu']);

// Like a book's author: the characters it's linked to, or else how many stories it's in
const byline = computed(() => {
  const { characters, stories } = props.item;
  if (characters.length) return castLine(characters.map((c) => c.name));
  if (stories.length) return `In ${stories.length === 1 ? '1 story' : `${stories.length} stories`}`;
  return '';
});

const meta = computed(() =>
  [entryLine(props.item.entryCount), props.item.modified && timeAgo(props.item.modified)]
    .filter(Boolean)
    .join(' · '),
);
</script>

<style scoped>
.lorebook-cover {
  --gilt: rgba(246, 239, 230, 0.32);
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 3;
  container-type: inline-size;
  overflow: hidden;
  border-radius: 6px;
  background:
    linear-gradient(160deg, rgba(255, 255, 255, 0.07), transparent 45%, rgba(0, 0, 0, 0.18)),
    var(--cover-color, #2f3a3a);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.3),
    0 8px 18px rgba(0, 0, 0, 0.22);
  color: #f6efe6;
}

.lorebook-cover:has(.cover-open:focus-visible) {
  outline: 3px solid var(--accent-primary);
  outline-offset: 3px;
}

.lorebook-cover.mini {
  border-radius: 4px;
}

/* A thin inset border, as on a cloth-bound book, holding the type */
.cover-frame {
  position: absolute;
  inset: 7cqw 7cqw 7cqw 10cqw;
  box-sizing: border-box;
  padding: 9cqw 7cqw 6cqw;
  border: 1px solid var(--gilt);
  border-radius: 2px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5cqw;
  text-align: center;
  min-height: 0;
}

.mini .cover-frame {
  inset: 5px 5px 5px 8px;
  padding: 0;
  justify-content: center;
}

.cover-icon {
  font-size: 1.125rem;
  color: rgba(246, 239, 230, 0.8);
}

.cover-kicker {
  flex: none;
  font-size: clamp(9px, 5cqw, 12px);
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(246, 239, 230, 0.7);
}

.cover-rule {
  flex: none;
  width: 30%;
  height: 1px;
  background: var(--gilt);
}

.cover-name {
  flex: none;
  max-width: 100%;
  font-family: var(--font-display);
  font-size: clamp(15px, 11cqw, 28px);
  /* Room inside the clamp's clip for Literata's descenders and overhanging serifs, as on a
     story's cover */
  line-height: 1.3;
  padding-bottom: 0.12em;
  padding-inline: 0.06em;
  font-weight: 600;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.cover-byline {
  flex: none;
  max-width: 100%;
  font-family: var(--font-display);
  font-style: italic;
  font-size: clamp(11px, 6.4cqw, 15px);
  line-height: 1.35;
  padding-bottom: 0.12em;
  color: rgba(246, 239, 230, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cover-foot {
  --stack-ring: var(--cover-color);
  margin-top: auto;
  flex: none;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4cqw;
}

.cover-meta {
  max-width: 100%;
  font-size: clamp(9px, 5cqw, 12px);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(246, 239, 230, 0.72);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cover-spine {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 5px;
  background: rgba(0, 0, 0, 0.22);
  pointer-events: none;
}

.cover-open {
  position: absolute;
  inset: 0;
  z-index: 1;
}

.cover-open:focus-visible {
  outline: none;
}

.cover-menu {
  position: absolute;
  z-index: 2;
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
  background: rgba(14, 11, 9, 0.45);
  color: #f6efe6;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cover-menu:hover span {
  background: rgba(14, 11, 9, 0.75);
}
</style>
