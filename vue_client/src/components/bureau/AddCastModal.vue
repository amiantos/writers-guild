<template>
  <Modal title="Add to the cast" max-width="560px" @close="$emit('close')">
    <div class="form">
      <input
        v-model="search"
        type="search"
        class="text-input"
        placeholder="Search your library..."
        aria-label="Search your library"
      />
      <label class="checkbox-label">
        <input v-model="asPersona" type="checkbox" />
        Add as the reader's character
      </label>

      <div v-if="loading" class="loading">Loading characters...</div>
      <p v-else-if="available.length === 0" class="empty-hint">
        {{
          characters.length === 0
            ? 'Your library has no characters yet.'
            : 'Everyone in your library is already in the cast.'
        }}
      </p>
      <ul v-else class="library-list">
        <li v-for="character in filtered" :key="character.id">
          <button class="library-row" :disabled="addingId !== null" @click="add(character)">
            <img
              v-if="character.thumbnailUrl || character.imageUrl"
              class="cast-avatar"
              :src="character.thumbnailUrl || character.imageUrl"
              alt=""
            />
            <div v-else class="cast-avatar placeholder"><i class="fas fa-user"></i></div>
            <span class="character-name">{{ character.name }}</span>
            <span v-if="addingId === character.id" class="adding">Adding...</span>
            <i v-else class="fas fa-plus add-icon"></i>
          </button>
        </li>
      </ul>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Done</button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Modal from '../Modal.vue';
import { charactersAPI } from '../../services/api';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';

const props = defineProps({
  bureauId: { type: String, required: true },
  cast: { type: Array, required: true },
});

const emit = defineEmits(['close', 'added']);
const toast = useToast();

const characters = ref([]);
const loading = ref(true);
const search = ref('');
const asPersona = ref(false);
const addingId = ref(null);

const available = computed(() => {
  const inCast = new Set(props.cast.map((member) => member.libraryCharacterId));
  return characters.value.filter((character) => !inCast.has(character.id));
});

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return available.value;
  return available.value.filter((character) => character.name.toLowerCase().includes(query));
});

async function add(character) {
  addingId.value = character.id;
  try {
    const result = await bureausAPI.addCast(props.bureauId, character.id, asPersona.value);
    asPersona.value = false;
    emit('added', result);
  } catch (error) {
    console.error('Failed to add to the cast:', error);
    toast.error('Failed to add to the cast: ' + error.message);
  } finally {
    addingId.value = null;
  }
}

onMounted(async () => {
  try {
    const data = await charactersAPI.list();
    characters.value = data.characters;
  } catch (error) {
    toast.error('Failed to load your library: ' + error.message);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.library-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 50vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.library-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  text-align: left;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.library-row:hover:not(:disabled) {
  border-color: var(--accent-primary);
}

.library-row:disabled {
  cursor: default;
  opacity: 0.7;
}

.character-name {
  flex: 1;
  font-weight: 600;
}

.adding {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.add-icon {
  color: var(--text-secondary);
}
</style>
