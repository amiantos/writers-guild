<template>
  <Modal
    :title="choosing ? 'Rewrite the greeting?' : 'Open with a greeting'"
    max-width="640px"
    @close="$emit('close')"
  >
    <div v-if="choosing" class="rewrite-prompt">
      <p class="prompt-message">Rewrite {{ current.name }}'s greeting for this chapter?</p>
      <p class="help-text">
        The Writer rewrites it in third person, past tense, as story mode does, with everything a
        passage gets: the cast's cards, the world, what everyone remembers, and the chapter's time.
        Keep it as written to use the card's text as it is.
      </p>
      <p v-if="!hasApiKey" class="notice">
        <i class="fas fa-key"></i> Rewriting needs an API key in the Bureau's settings or on the
        Bureaus tab.
      </p>
    </div>

    <div v-else-if="loading" class="loading">Loading greetings...</div>
    <p v-else-if="loadError" class="empty-hint">{{ loadError }}</p>
    <p v-else-if="greetings.length === 0" class="empty-hint">
      No one in this chapter has a greeting on their card.
    </p>

    <div v-else class="greeting-picker">
      <div class="greeting-heading">
        <span class="greeting-name">{{ current.name }}</span>
        <span class="persona-tag">{{ current.label }}</span>
      </div>
      <div class="greeting-text" v-html="html"></div>
      <div class="greeting-nav">
        <button class="btn btn-secondary btn-small" :disabled="index === 0" @click="index -= 1">
          <i class="fas fa-chevron-left"></i> Previous
        </button>
        <span class="greeting-count">{{ index + 1 }} / {{ greetings.length }}</span>
        <button
          class="btn btn-secondary btn-small"
          :disabled="index === greetings.length - 1"
          @click="index += 1"
        >
          Next <i class="fas fa-chevron-right"></i>
        </button>
      </div>
    </div>

    <template #footer>
      <template v-if="choosing">
        <button class="btn btn-secondary" :disabled="adding" @click="choosing = false">Back</button>
        <button class="btn btn-secondary" :disabled="adding" @click="keep">
          {{ adding ? 'Adding...' : 'Keep as written' }}
        </button>
        <button class="btn btn-primary" :disabled="!hasApiKey || adding" @click="rewrite">
          <i class="fas fa-repeat"></i> Rewrite
        </button>
      </template>
      <template v-else>
        <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
        <button class="btn btn-primary" :disabled="!current" @click="choosing = true">
          <i class="fas fa-check"></i> Use this greeting
        </button>
      </template>
    </template>
  </Modal>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Modal from '../Modal.vue';
import { bureauStoriesAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import { renderProse } from '../../composables/bureau/renderProse';

const props = defineProps({
  bureauId: { type: String, required: true },
  storyId: { type: String, required: true },
  /** Rewriting a greeting needs the Bureau's API key. */
  hasApiKey: { type: Boolean, default: true },
});

const emit = defineEmits(['close', 'added', 'rewrite']);
const toast = useToast();

const greetings = ref([]);
const index = ref(0);
const loading = ref(true);
const loadError = ref('');
// Whether the reader has picked a greeting and is deciding whether to rewrite it.
const choosing = ref(false);
const adding = ref(false);

const current = computed(() => greetings.value[index.value] ?? null);
const html = computed(() => renderProse(current.value?.content ?? ''));

onMounted(async () => {
  try {
    ({ greetings: greetings.value } = await bureauStoriesAPI.listGreetings(
      props.bureauId,
      props.storyId,
    ));
  } catch (error) {
    loadError.value = `Failed to load greetings: ${error.message}`;
  } finally {
    loading.value = false;
  }
});

// Both use the text as shown, since a macro such as {{random}} picks again each time greetings load.
function rewrite() {
  if (!current.value || !props.hasApiKey) return;
  emit('rewrite', { castId: current.value.castId, content: current.value.content });
}

async function keep() {
  if (!current.value || adding.value) return;
  adding.value = true;
  try {
    const { turn } = await bureauStoriesAPI.addGreeting(
      props.bureauId,
      props.storyId,
      current.value.content,
    );
    emit('added', turn);
  } catch (error) {
    toast.error('Failed to add the greeting: ' + error.message);
  } finally {
    adding.value = false;
  }
}
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.rewrite-prompt {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.prompt-message {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 500;
  color: var(--text-primary);
}

.greeting-picker {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.greeting-heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.greeting-name {
  font-weight: 600;
}

.greeting-text {
  max-height: 50vh;
  overflow-y: auto;
  padding: 1rem 1.25rem;
  line-height: 1.7;
  color: var(--text-primary);
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.greeting-text :deep(p) {
  margin: 0 0 1em;
}

.greeting-text :deep(p:last-child) {
  margin-bottom: 0;
}

.greeting-text :deep(.story-image) {
  display: block;
  max-width: 100%;
  max-height: 40vh;
  height: auto;
  margin: 0.75rem auto;
  border-radius: 8px;
  object-fit: contain;
}

.greeting-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.greeting-count {
  font-size: 0.85rem;
  color: var(--text-secondary);
}
</style>
