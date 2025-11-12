<template>
  <Modal :title="title" max-width="900px" max-height="85vh" @close="$emit('close')">
    <div v-if="loading" class="loading">
      Loading stories...
    </div>

    <div v-else-if="stories.length === 0" class="empty-state">
      <i class="fas fa-book"></i>
      <p>No stories yet with this character.</p>
    </div>

    <DataTable
      v-else
      :columns="columns"
      :data="stories"
      default-sort="modified"
      row-key="id"
    >
      <!-- Avatar column -->
      <template #cell-avatar="{ row }">
        <CharacterAvatar :character="getFirstCharacter(row)" />
      </template>

      <!-- Actions column -->
      <template #cell-actions="{ row }">
        <div class="actions-cell">
          <button class="btn btn-small btn-primary" @click="openStory(row.id)">
            <i class="fas fa-folder-open"></i> Open
          </button>
          <button class="btn btn-small btn-secondary" @click="deleteStory(row)">
            <i class="fas fa-trash"></i> Delete
          </button>
        </div>
      </template>
    </DataTable>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">
        Close
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed } from 'vue'
import Modal from './Modal.vue'
import DataTable from './DataTable.vue'
import CharacterAvatar from './CharacterAvatar.vue'

const props = defineProps({
  character: {
    type: Object,
    required: true
  },
  stories: {
    type: Array,
    default: () => []
  },
  allCharacters: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'open-story', 'delete'])

const title = computed(() => {
  return `Stories with ${props.character?.name || 'Character'}`
})

const columns = [
  {
    key: 'avatar',
    label: '',
    sortable: false,
    headerClass: 'avatar-col',
    cellClass: 'avatar-cell'
  },
  {
    key: 'title',
    label: 'Title',
    sortable: true,
    cellClass: 'title-cell',
    format: (value) => value || 'Untitled Story'
  },
  {
    key: 'modified',
    label: 'Modified',
    sortable: true,
    cellClass: 'date-cell',
    format: (value, row) => new Date(value || row.created).toLocaleDateString()
  },
  {
    key: 'wordCount',
    label: 'Words',
    sortable: true,
    headerClass: 'text-right',
    cellClass: 'wordcount-cell',
    format: (value) => (value || 0).toLocaleString()
  },
  {
    key: 'actions',
    label: 'Actions',
    sortable: false,
    headerClass: 'actions-col'
  }
]

function getFirstCharacter(story) {
  if (!story.characterIds || story.characterIds.length === 0) {
    return null
  }
  return props.allCharacters.find(c => c.id === story.characterIds[0])
}

function openStory(storyId) {
  emit('close')
  emit('open-story', storyId)
}

function deleteStory(story) {
  emit('delete', story)
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
  padding: 3rem 1rem;
  color: var(--text-secondary);
}

.empty-state i {
  font-size: 3rem;
  margin-bottom: 1rem;
  display: block;
}
</style>
