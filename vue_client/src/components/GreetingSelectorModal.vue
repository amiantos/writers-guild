<template>
  <div class="modal-overlay" @click.self="$emit('close')">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Select Greeting</h2>
        <button class="close-btn" @click="$emit('close')">
          <i class="fas fa-xmark"></i>
        </button>
      </div>
      <div class="modal-body">
        <div v-if="loading" class="loading">Loading greetings...</div>

        <div v-else-if="greetings.length === 0" class="empty-state">
          <i class="fas fa-message"></i>
          <p>No greetings available. Add characters with greetings to this story.</p>
        </div>

        <div v-else class="greeting-carousel">
          <div class="character-name">
            <i class="fas fa-user"></i>
            {{ currentCharacter?.name || 'Unknown' }}
            <span v-if="currentLabel" class="greeting-label"> - {{ currentLabel }}</span>
          </div>

          <div class="greeting-display">
            {{ currentGreeting }}
          </div>

          <div class="carousel-controls">
            <button
              class="btn btn-secondary"
              :disabled="currentIndex === 0"
              @click="prevGreeting"
            >
              <i class="fas fa-chevron-left"></i> Previous
            </button>

            <div class="greeting-counter">
              {{ currentIndex + 1 }} / {{ greetings.length }}
            </div>

            <button
              class="btn btn-secondary"
              :disabled="currentIndex === greetings.length - 1"
              @click="nextGreeting"
            >
              Next <i class="fas fa-chevron-right"></i>
            </button>
          </div>

          <button class="btn btn-primary full-width" @click="selectCurrent">
            <i class="fas fa-check"></i> Use This Greeting
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { charactersAPI } from '../services/api'

const props = defineProps({
  story: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['close', 'select'])

const loading = ref(true)
const characters = ref([])
const greetings = ref([])
const currentIndex = ref(0)

const currentGreeting = computed(() => {
  return greetings.value[currentIndex.value]?.greeting || ''
})

const currentCharacter = computed(() => {
  return greetings.value[currentIndex.value]?.character || null
})

const currentLabel = computed(() => {
  return greetings.value[currentIndex.value]?.label || ''
})

onMounted(async () => {
  await loadGreetings()
})

async function loadGreetings() {
  try {
    // Load all characters from the story
    const characterIds = props.story.characterIds || []

    if (characterIds.length === 0) {
      loading.value = false
      return
    }

    // Flatten all greetings with character info
    const allGreetings = []
    for (const characterId of characterIds) {
      try {
        // Get processed greetings from server (with placeholders replaced)
        const response = await fetch(`/api/stories/${props.story.id}/characters/${characterId}/greetings`)
        const { greetings: processedGreetings } = await response.json()

        // Add all processed greetings to the list
        processedGreetings.forEach(greeting => {
          allGreetings.push({
            character: {
              id: characterId,
              name: greeting.characterName
            },
            greeting: greeting.content, // Already processed server-side
            label: greeting.label,
            isAlternate: greeting.index > 0
          })
        })
      } catch (error) {
        console.error(`Failed to load character ${characterId}:`, error)
      }
    }

    greetings.value = allGreetings
  } catch (error) {
    console.error('Failed to load greetings:', error)
  } finally {
    loading.value = false
  }
}

function prevGreeting() {
  if (currentIndex.value > 0) {
    currentIndex.value--
  }
}

function nextGreeting() {
  if (currentIndex.value < greetings.value.length - 1) {
    currentIndex.value++
  }
}

function selectCurrent() {
  emit('select', currentGreeting.value)
}
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

.loading {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
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

.greeting-carousel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.character-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.greeting-label {
  font-size: 0.875rem;
  font-weight: 400;
  color: var(--text-secondary);
}

.greeting-display {
  padding: 1.5rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  min-height: 150px;
  max-height: 300px;
  overflow-y: auto;
  white-space: pre-wrap;
  line-height: 1.6;
  color: var(--text-primary);
}

.carousel-controls {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.greeting-counter {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.full-width {
  width: 100%;
}
</style>
