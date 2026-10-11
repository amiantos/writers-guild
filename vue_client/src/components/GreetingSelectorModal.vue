<template>
  <Modal title="Select Greeting" @close="$emit('close')">
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

      <div ref="displayRef" class="greeting-display" v-html="renderedGreeting"></div>

      <div class="carousel-controls">
        <button class="btn btn-secondary" :disabled="currentIndex === 0" @click="prevGreeting">
          <i class="fas fa-chevron-left"></i> Previous
        </button>

        <div class="greeting-counter">{{ currentIndex + 1 }} / {{ greetings.length }}</div>

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
  </Modal>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import Modal from './Modal.vue';
import { renderProse } from '../composables/renderProse';

const props = defineProps({
  story: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['close', 'select']);

const loading = ref(true);
const characters = ref([]);
const greetings = ref([]);
const currentIndex = ref(0);
const displayRef = ref(null);

const currentGreeting = computed(() => {
  return greetings.value[currentIndex.value]?.greeting || '';
});

// Hidden notes are shown, set apart, so they can be weighed when choosing a greeting.
const renderedGreeting = computed(() =>
  renderProse(currentGreeting.value, { showHiddenNotes: true }),
);

// Start each greeting from its top rather than wherever the last one was scrolled to.
watch(currentIndex, () => {
  if (displayRef.value) displayRef.value.scrollTop = 0;
});

const currentCharacter = computed(() => {
  return greetings.value[currentIndex.value]?.character || null;
});

const currentLabel = computed(() => {
  return greetings.value[currentIndex.value]?.label || '';
});

onMounted(async () => {
  await loadGreetings();
});

async function loadGreetings() {
  try {
    // Load all characters from the story
    const characterIds = props.story.characterIds || [];

    if (characterIds.length === 0) {
      loading.value = false;
      return;
    }

    // Flatten all greetings with character info
    const allGreetings = [];
    for (const characterId of characterIds) {
      try {
        // Get processed greetings from server (with placeholders replaced)
        const response = await fetch(
          `/api/stories/${props.story.id}/characters/${characterId}/greetings`,
        );
        const { greetings: processedGreetings } = await response.json();

        // Add all processed greetings to the list
        processedGreetings.forEach((greeting) => {
          allGreetings.push({
            character: {
              id: characterId,
              name: greeting.characterName,
            },
            greeting: greeting.content, // Already processed server-side
            label: greeting.label,
            isAlternate: greeting.index > 0,
          });
        });
      } catch (error) {
        console.error(`Failed to load character ${characterId}:`, error);
      }
    }

    greetings.value = allGreetings;
  } catch (error) {
    console.error('Failed to load greetings:', error);
  } finally {
    loading.value = false;
  }
}

function prevGreeting() {
  if (currentIndex.value > 0) {
    currentIndex.value--;
  }
}

function nextGreeting() {
  if (currentIndex.value < greetings.value.length - 1) {
    currentIndex.value++;
  }
}

function selectCurrent() {
  emit('select', currentGreeting.value);
}
</script>

<style scoped>
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
  max-height: 50vh;
  overflow-y: auto;
  line-height: 1.6;
  color: var(--text-primary);
}

.greeting-display :deep(p) {
  margin: 0 0 1em;
}

.greeting-display :deep(p:last-child) {
  margin-bottom: 0;
}

.greeting-display :deep(.story-image) {
  display: block;
  max-width: 100%;
  max-height: 40vh;
  height: auto;
  margin: 1rem auto;
  border-radius: 8px;
  object-fit: contain;
}

.greeting-display :deep(.hidden-note) {
  margin: 0 0.125em;
  padding: 0.125rem 0.375rem;
  font-size: 0.875em;
  color: var(--text-secondary);
  background-color: var(--bg-secondary);
  border: 1px dashed var(--border-color);
  border-radius: 4px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
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
