<template>
  <section class="edit-section">
    <div class="section-header">
      <h2><i class="fas fa-book"></i> World</h2>
    </div>

    <div class="section-content">
      <p class="help-text">
        Attached lorebooks give the Writer entries whose keywords appear in the story, as in story
        mode.
      </p>

      <div v-if="loading" class="loading">Loading lorebooks...</div>
      <template v-else>
        <ul v-if="attached.length > 0" class="lore-list">
          <li v-for="lorebook in attached" :key="lorebook.id" class="lore-row">
            <i class="fas fa-book lore-icon"></i>
            <span class="lore-name">{{
              lorebook.missing ? 'Deleted lorebook' : lorebook.name
            }}</span>
            <span v-if="lorebook.missing" class="missing">No longer in your library</span>
            <span v-else class="lore-count">{{ lorebook.entryCount }} entries</span>
            <button
              class="icon-btn"
              title="Detach from this Bureau"
              :disabled="busy"
              @click="detach(lorebook)"
            >
              <i class="fas fa-xmark"></i>
            </button>
          </li>
        </ul>
        <p v-else class="empty-hint">No lorebooks attached.</p>

        <div v-if="attachable.length > 0" class="attach-row">
          <select v-model="selectedId" class="select-input" aria-label="Lorebook to attach">
            <option value="">Attach a lorebook...</option>
            <option v-for="lorebook in attachable" :key="lorebook.id" :value="lorebook.id">
              {{ lorebook.name }}
            </option>
          </select>
          <button
            class="btn btn-secondary btn-small"
            :disabled="!selectedId || busy"
            @click="attach"
          >
            Attach
          </button>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { lorebooksAPI } from '../../services/api';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';

const props = defineProps({
  bureauId: { type: String, required: true },
});

const toast = useToast();

const attached = ref([]);
const library = ref([]);
const loading = ref(true);
const busy = ref(false);
const selectedId = ref('');

const attachable = computed(() => {
  const attachedIds = new Set(attached.value.map((lorebook) => lorebook.id));
  return library.value.filter((lorebook) => !attachedIds.has(lorebook.id));
});

async function attach() {
  busy.value = true;
  try {
    const data = await bureausAPI.attachLorebook(props.bureauId, selectedId.value);
    attached.value = data.lorebooks;
    selectedId.value = '';
  } catch (error) {
    toast.error('Failed to attach lorebook: ' + error.message);
  } finally {
    busy.value = false;
  }
}

async function detach(lorebook) {
  busy.value = true;
  try {
    const data = await bureausAPI.detachLorebook(props.bureauId, lorebook.id);
    attached.value = data.lorebooks;
  } catch (error) {
    toast.error('Failed to detach lorebook: ' + error.message);
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    const [attachedData, libraryData] = await Promise.all([
      bureausAPI.listLorebooks(props.bureauId),
      lorebooksAPI.list(),
    ]);
    attached.value = attachedData.lorebooks;
    library.value = libraryData.lorebooks;
  } catch (error) {
    toast.error('Failed to load lorebooks: ' + error.message);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.lore-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.lore-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.375rem 0.5rem 0.375rem 0.875rem;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.lore-icon {
  color: var(--text-secondary);
}

.lore-name {
  flex: 1;
  font-weight: 600;
}

.lore-count,
.missing {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.missing {
  color: var(--warning);
}

.attach-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
</style>
