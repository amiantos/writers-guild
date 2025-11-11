<template>
  <div class="character-avatar" :class="{ empty: !character?.imageUrl }">
    <img v-if="character?.imageUrl" :src="character.imageUrl" :alt="character.name" />
    <i v-else class="fas fa-user"></i>
  </div>
</template>

<script setup>
defineProps({
  character: {
    type: Object,
    default: null
  }
})
</script>

<style scoped>
.character-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background-color: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--border-color);
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
  font-size: 0.875rem;
}
</style>
