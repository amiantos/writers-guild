<template>
  <Modal :title="`What ${member.name} remembers`" max-width="680px" @close="$emit('close')">
    <div class="form memory-browser">
      <input
        v-model="query"
        type="search"
        class="text-input"
        :placeholder="`Search ${member.name}'s memories...`"
        aria-label="Search memories"
      />

      <div v-if="!searching" class="tabs" role="tablist">
        <button
          v-for="option in tabs"
          :key="option.key"
          role="tab"
          class="tab"
          :class="{ active: tab === option.key }"
          :aria-selected="tab === option.key"
          @click="tab = option.key"
        >
          {{ option.label }} <span class="tab-count">{{ option.count }}</span>
        </button>
      </div>

      <div v-if="loading" class="loading">Loading memories...</div>
      <template v-else>
        <form v-if="!searching && tab === 'knowledge'" class="add-memory" @submit.prevent="add">
          <textarea
            v-model="draft"
            class="textarea-input"
            rows="2"
            :placeholder="`Something ${member.name} already knows, such as backstory`"
            aria-label="New memory"
            @keydown.meta.enter.prevent="add"
            @keydown.ctrl.enter.prevent="add"
          ></textarea>
          <div class="add-row">
            <select
              v-model.number="draftImportance"
              class="select-input importance"
              aria-label="Importance of the new memory"
            >
              <option v-for="level in IMPORTANCE_LEVELS" :key="level.value" :value="level.value">
                {{ level.label }}
              </option>
            </select>
            <button
              type="submit"
              class="btn btn-primary btn-small"
              :disabled="!draft.trim() || adding"
            >
              <i class="fas fa-plus"></i> {{ adding ? 'Adding...' : 'Add memory' }}
            </button>
          </div>
        </form>

        <p v-if="shown.length === 0" class="empty-hint">{{ emptyText }}</p>
        <ul v-else class="memory-list">
          <MemoryItem
            v-for="memory in shown"
            :key="memory.id"
            :memory="memory"
            :bureau-id="bureauId"
            :busy="busyId === memory.id"
            @update="update"
            @remove="remove"
          />
        </ul>
      </template>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Done</button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Modal from '../Modal.vue';
import MemoryItem from './MemoryItem.vue';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { DEFAULT_IMPORTANCE, IMPORTANCE_LEVELS } from '../../composables/bureau/memories';

const SEARCH_DELAY = 250;

const props = defineProps({
  bureauId: { type: String, required: true },
  /** The cast member whose memories to show. */
  member: { type: Object, required: true },
});

const emit = defineEmits(['close', 'changed']);
const toast = useToast();
const { confirm } = useConfirm();

const current = ref([]);
const retired = ref([]);
const results = ref([]);
const loading = ref(true);
const tab = ref('knowledge');
const query = ref('');
const busyId = ref(null);
const draft = ref('');
const draftImportance = ref(DEFAULT_IMPORTANCE);
const adding = ref(false);

const knowledge = computed(() => current.value.filter((memory) => memory.layer === 'knowledge'));
const episodes = computed(() => current.value.filter((memory) => memory.layer === 'episode'));
const searching = computed(() => query.value.trim().length > 0);

const tabs = computed(() => [
  { key: 'knowledge', label: 'What they know', count: knowledge.value.length },
  { key: 'episodes', label: 'What happened', count: episodes.value.length },
  { key: 'retired', label: 'Retired', count: retired.value.length },
]);

const shown = computed(() => {
  if (searching.value) return results.value;
  return { knowledge: knowledge.value, episodes: episodes.value, retired: retired.value }[
    tab.value
  ];
});

const emptyText = computed(() => {
  const { name } = props.member;
  if (searching.value) return 'No memories match.';
  if (tab.value === 'knowledge') {
    return `Nothing yet. ${name} learns things as stories are committed to memory. You can also add what ${name} already knows.`;
  }
  if (tab.value === 'episodes') {
    return `No stories yet. When a story is committed to memory, ${name}'s account of it is kept here.`;
  }
  return 'Nothing retired. Memories you retire, and ones replaced by newer versions, are kept here.';
});

async function loadLists() {
  const [currentData, retiredData] = await Promise.all([
    bureausAPI.listMemories(props.bureauId, props.member.id),
    bureausAPI.listMemories(props.bureauId, props.member.id, { status: 'retired' }),
  ]);
  current.value = currentData.memories;
  retired.value = retiredData.memories;
}

async function search(text) {
  try {
    const { memories } = await bureausAPI.listMemories(props.bureauId, props.member.id, {
      q: text,
    });
    // Ignore answers to searches the reader has already typed past.
    if (query.value.trim() === text) {
      results.value = memories;
    }
  } catch (error) {
    toast.error('Search failed: ' + error.message);
  }
}

let searchTimer = null;
watch(query, (value) => {
  clearTimeout(searchTimer);
  const text = value.trim();
  if (!text) {
    results.value = [];
    return;
  }
  searchTimer = setTimeout(() => search(text), SEARCH_DELAY);
});

/** Reload after a change, which can move memories between lists. */
async function refresh() {
  await loadLists();
  if (searching.value) {
    await search(query.value.trim());
  }
  emit('changed');
}

async function add() {
  const content = draft.value.trim();
  if (!content || adding.value) return;
  adding.value = true;
  try {
    await bureausAPI.addMemory(props.bureauId, props.member.id, {
      content,
      importance: draftImportance.value,
    });
    draft.value = '';
    draftImportance.value = DEFAULT_IMPORTANCE;
    await refresh();
  } catch (error) {
    toast.error('Failed to add the memory: ' + error.message);
  } finally {
    adding.value = false;
  }
}

async function update(memory, updates) {
  busyId.value = memory.id;
  try {
    await bureausAPI.updateMemory(props.bureauId, memory.id, updates);
    await refresh();
  } catch (error) {
    toast.error('Failed to update the memory: ' + error.message);
  } finally {
    busyId.value = null;
  }
}

async function remove(memory) {
  const confirmed = await confirm({
    message:
      'Delete this memory for good?\n\nIf it replaced an older memory, the older one becomes current again. To keep a record of it, retire it instead.',
    confirmText: 'Delete',
    variant: 'danger',
  });
  if (!confirmed) return;

  busyId.value = memory.id;
  try {
    await bureausAPI.removeMemory(props.bureauId, memory.id);
    await refresh();
  } catch (error) {
    toast.error('Failed to delete the memory: ' + error.message);
  } finally {
    busyId.value = null;
  }
}

onMounted(async () => {
  try {
    await loadLists();
  } catch (error) {
    toast.error('Failed to load memories: ' + error.message);
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => clearTimeout(searchTimer));
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--border-color);
}

.tab {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
}

.tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-primary);
  font-weight: 600;
}

.tab-count {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.add-memory {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.add-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.add-row .importance {
  width: auto;
}

.memory-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 50vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
</style>
