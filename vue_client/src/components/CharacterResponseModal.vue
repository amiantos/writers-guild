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
          <div
            v-for="char in characters"
            :key="char.id"
            class="character-card"
            @click="$emit('select', char.id)"
          >
            <div class="character-avatar">
              <img v-if="char.imageUrl" :src="char.imageUrl" :alt="char.name">
              <div v-else class="character-initial">
                {{ char.name.charAt(0).toUpperCase() }}
              </div>
            </div>
            <div class="character-name">{{ char.name }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
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
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 1rem;
}

.character-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.character-card:hover {
  background-color: var(--bg-secondary);
  border-color: var(--accent-primary);
  transform: translateY(-2px);
}

.character-avatar {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  overflow: hidden;
  background-color: var(--bg-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.character-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.character-initial {
  font-size: 2rem;
  font-weight: 600;
  color: var(--accent-primary);
}

.character-name {
  text-align: center;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
  word-break: break-word;
}
</style>
