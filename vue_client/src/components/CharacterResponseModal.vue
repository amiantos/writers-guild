<template>
  <Modal title="Select Character" @close="$emit('close')">
    <p class="instruction-text">
      Which character should respond?
    </p>

    <div v-if="characters.length === 0" class="empty-state">
      <i class="fas fa-user"></i>
      <p>No characters in this story</p>
    </div>

    <div v-else class="character-grid">
      <CharacterCard
        v-for="char in characters"
        :key="char.id"
        :character="char"
        :clickable="true"
        @click="$emit('select', char.id)"
      />
    </div>
  </Modal>
</template>

<script setup>
import Modal from './Modal.vue'
import CharacterCard from './CharacterCard.vue'

defineProps({
  characters: {
    type: Array,
    default: () => []
  }
})

defineEmits(['close', 'select'])
</script>

<style scoped>
.instruction-text {
  margin: 0 0 1.5rem 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
  text-align: center;
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
}

.empty-state i {
  font-size: 3rem;
  margin-bottom: 1rem;
  display: block;
}

.character-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1rem;
}
</style>
