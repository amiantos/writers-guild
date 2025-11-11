<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Select Character</h2>
        <button class="close-btn" @click="$emit('close')">
          <i class="fas fa-xmark"></i>
        </button>
      </div>
      <div class="modal-body">
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
      </div>
    </div>
  </div>
</template>

<script setup>
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
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background-color: var(--bg-secondary);
  border-radius: 8px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
}

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
