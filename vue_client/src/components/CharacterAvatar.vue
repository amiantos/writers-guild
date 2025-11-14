<template>
  <!-- Multi-character mode -->
  <div v-if="isMultiMode" class="character-avatar-group">
    <!-- Show empty avatar if no characters -->
    <div
      v-if="displayedCharacters.length === 0"
      class="character-avatar stacked empty"
    >
      <i class="fas fa-user"></i>
    </div>
    <!-- Show character avatars -->
    <div
      v-for="(char, index) in displayedCharacters"
      :key="char?.id || index"
      class="character-avatar stacked"
      :class="{ empty: !getImageUrl(char) }"
      :style="{ zIndex: displayedCharacters.length - index }"
      :title="char?.name || 'Unknown'"
    >
      <img v-if="getImageUrl(char)" :src="getImageUrl(char)" :alt="char.name" />
      <i v-else class="fas fa-user"></i>
    </div>
    <div
      v-if="remainingCount > 0"
      class="character-avatar stacked overflow-indicator"
      :title="`+${remainingCount} more`"
    >
      <span>+{{ remainingCount }}</span>
    </div>
  </div>

  <!-- Single character mode -->
  <div v-else class="character-avatar" :class="{ empty: !getImageUrl(singleCharacter) }">
    <img v-if="getImageUrl(singleCharacter)" :src="getImageUrl(singleCharacter)" :alt="singleCharacter?.name" />
    <i v-else class="fas fa-user"></i>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  // Single character (legacy mode)
  character: {
    type: Object,
    default: null
  },
  // Multiple characters (new mode)
  characters: {
    type: Array,
    default: null
  },
  // Maximum number of avatars to show before using +X indicator
  maxDisplay: {
    type: Number,
    default: 3
  }
})

const isMultiMode = computed(() => {
  return props.characters !== null && Array.isArray(props.characters)
})

const singleCharacter = computed(() => {
  return props.character
})

const displayedCharacters = computed(() => {
  if (!isMultiMode.value) return []
  return props.characters.slice(0, props.maxDisplay)
})

const remainingCount = computed(() => {
  if (!isMultiMode.value) return 0
  const total = props.characters.length
  return Math.max(0, total - props.maxDisplay)
})

// Prefer thumbnailUrl for avatars, fall back to imageUrl
function getImageUrl(character) {
  if (!character) return null
  return character.thumbnailUrl || character.imageUrl || null
}
</script>

<style scoped>
.character-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background-color: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--bg-primary);
  overflow: hidden;
  flex-shrink: 0;
}

.character-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
}

.character-avatar.empty {
  background-color: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 1rem;
}

/* Multi-character mode styles */
.character-avatar-group {
  display: flex;
  align-items: center;
  position: relative;
  height: 48px;
}

.character-avatar.stacked {
  width: 48px;
  height: 48px;
  border: 2px solid var(--bg-primary);
  margin-left: -18px;
  position: relative;
  transition: transform 0.2s ease;
}

.character-avatar.stacked:first-child {
  margin-left: 0;
}

.character-avatar.stacked:hover {
  transform: translateY(-2px);
  z-index: 1000 !important;
}

.character-avatar.stacked.overflow-indicator {
  background-color: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: default;
}

.character-avatar.stacked.overflow-indicator span {
  user-select: none;
}
</style>
