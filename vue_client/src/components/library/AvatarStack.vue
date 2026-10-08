<template>
  <span class="avatar-stack" :style="{ '--size': `${size}px` }" aria-hidden="true">
    <span
      v-for="(character, index) in shown"
      :key="character.id"
      class="stack-avatar"
      :style="{
        zIndex: shown.length - index,
        background: avatarUrl(character) ? null : placeholderColor(character.name),
      }"
    >
      <img v-if="avatarUrl(character)" :src="avatarUrl(character)" alt="" loading="lazy" />
      <span v-else>{{ (character.name || '?').charAt(0).toUpperCase() }}</span>
    </span>
  </span>
</template>

<script setup>
import { computed } from 'vue';
import { avatarUrl, placeholderColor } from '../../composables/library.js';

const props = defineProps({
  characters: { type: Array, required: true },
  size: { type: Number, default: 32 },
  max: { type: Number, default: 3 },
});

const shown = computed(() => props.characters.slice(0, props.max));
</script>

<style scoped>
.avatar-stack {
  display: inline-flex;
  flex: none;
}

.stack-avatar {
  position: relative;
  width: var(--size);
  height: var(--size);
  box-sizing: border-box;
  border-radius: 50%;
  overflow: hidden;
  /* A ring in the background color keeps overlapping faces apart */
  border: 2px solid var(--stack-ring, var(--bg-secondary));
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: calc(var(--size) * 0.42);
  font-weight: 600;
}

.stack-avatar + .stack-avatar {
  margin-left: calc(var(--size) * -0.55);
}

.stack-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
}
</style>
