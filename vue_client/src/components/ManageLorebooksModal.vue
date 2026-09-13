<template>
  <Modal title="Manage Lorebooks" maxWidth="800px" @close="$emit('close')">
    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>Loading lorebooks...</p>
    </div>

    <!-- Lorebooks Table -->
    <div v-else-if="lorebooks.length > 0">
      <p class="instruction-text">
        Select lorebooks to include in this story. Lorebook entries will be automatically injected
        when their keywords are detected.
      </p>
      <DataTable
        :columns="columns"
        :data="lorebooks"
        default-sort="name"
        row-key="id"
        row-clickable
        @row-click="toggleLorebook($event.id)"
      >
        <!-- Checkbox column -->
        <template #cell-selected="{ row }">
          <div class="checkbox-cell">
            <input
              type="checkbox"
              :checked="isLorebookSelected(row.id)"
              @change="toggleLorebook(row.id)"
              :disabled="actionInProgress === row.id"
            />
          </div>
        </template>
      </DataTable>
    </div>

    <!-- Empty State -->
    <div v-else class="empty-state">
      <i class="fas fa-book-open"></i>
      <p>No lorebooks available</p>
    </div>
  </Modal>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import Modal from './Modal.vue';
import DataTable from './DataTable.vue';
import { lorebooksAPI, storiesAPI } from '../services/api';
import { useToast } from '../composables/useToast';

const props = defineProps({
  story: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['close', 'updated']);

const toast = useToast();
const loading = ref(true);
const lorebooks = ref([]);
const actionInProgress = ref(null);

const columns = [
  {
    key: 'selected',
    label: '',
    sortable: false,
    cellClass: 'checkbox-cell',
    headerClass: 'checkbox-col',
    noRowClick: true,
  },
  {
    key: 'name',
    label: 'Name',
    sortable: true,
    cellClass: 'name-cell',
    format: (value) => value || 'Untitled Lorebook',
  },
  {
    key: 'description',
    label: 'Description',
    sortable: true,
    cellClass: 'description-cell',
  },
  {
    key: 'entryCount',
    label: 'Entries',
    sortable: true,
    cellClass: 'count-cell',
    format: (value) => value || 0,
  },
];

onMounted(async () => {
  await loadLorebooks();
});

async function loadLorebooks() {
  try {
    loading.value = true;
    const { lorebooks: allLorebooks } = await lorebooksAPI.list();
    lorebooks.value = allLorebooks || [];
  } catch (error) {
    console.error('Failed to load lorebooks:', error);
    toast.error('Failed to load lorebooks: ' + error.message);
  } finally {
    loading.value = false;
  }
}

function isLorebookSelected(lorebookId) {
  return props.story.lorebookIds?.includes(lorebookId) || false;
}

async function toggleLorebook(lorebookId) {
  if (actionInProgress.value) return;

  try {
    actionInProgress.value = lorebookId;

    if (isLorebookSelected(lorebookId)) {
      // Remove lorebook
      await storiesAPI.removeLorebookFromStory(props.story.id, lorebookId);
      toast.success('Lorebook removed from story');
    } else {
      // Add lorebook
      await storiesAPI.addLorebookToStory(props.story.id, lorebookId);
      toast.success('Lorebook added to story');
    }

    emit('updated');
  } catch (error) {
    console.error('Failed to toggle lorebook:', error);
    toast.error('Failed to update lorebook: ' + error.message);
  } finally {
    actionInProgress.value = null;
  }
}
</script>

<style scoped>
.instruction-text {
  margin: 0 0 1.5rem 0;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  border-left: 3px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  color: var(--text-secondary);
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--border-color);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-state {
  text-align: center;
  padding: 3rem;
  color: var(--text-secondary);
}

.empty-state i {
  font-size: 3rem;
  margin-bottom: 1rem;
  display: block;
}

.checkbox-col {
  width: 40px;
}

.checkbox-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.checkbox-cell input[type='checkbox'] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.checkbox-cell input[type='checkbox']:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>
