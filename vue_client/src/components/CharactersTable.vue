<template>
  <DataTable
    :columns="columns"
    :data="characters"
    default-sort="created"
    row-key="id"
  >
    <!-- Avatar column -->
    <template #cell-avatar="{ row }">
      <CharacterAvatar :character="row" />
    </template>

    <!-- Stories count column - computed value -->
    <template #cell-storyCount="{ row }">
      {{ getStoryCount(row.id) }}
    </template>

    <!-- Actions column -->
    <template #cell-actions="{ row }">
      <div class="actions-cell">
        <button
          class="btn btn-small btn-secondary"
          :disabled="getStoryCount(row.id) === 0"
          @click="$emit('continue', row.id)"
        >
          <i class="fas fa-play"></i> Continue
        </button>
        <button
          class="btn btn-small btn-primary"
          @click="$emit('new-story', row.id)"
        >
          <i class="fas fa-plus"></i> New Story
        </button>
        <button
          class="btn btn-small btn-secondary"
          @click="$emit('edit', row.id)"
        >
          <i class="fas fa-edit"></i> Edit
        </button>
        <button
          class="btn btn-small btn-secondary"
          @click="$emit('delete', row)"
        >
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </template>
  </DataTable>
</template>

<script setup>
import DataTable from './DataTable.vue'
import CharacterAvatar from './CharacterAvatar.vue'

const props = defineProps({
  characters: {
    type: Array,
    required: true
  },
  stories: {
    type: Array,
    default: () => []
  }
})

defineEmits(['continue', 'new-story', 'edit', 'delete'])

const columns = [
  {
    key: 'avatar',
    label: '',
    sortable: false,
    headerClass: 'avatar-col',
    cellClass: 'avatar-cell'
  },
  {
    key: 'name',
    label: 'Name',
    sortable: true,
    cellClass: 'name-cell',
    format: (value) => value || 'Unknown'
  },
  {
    key: 'created',
    label: 'Created',
    sortable: true,
    cellClass: 'date-cell',
    format: (value) => value ? new Date(value).toLocaleDateString() : 'Unknown'
  },
  {
    key: 'storyCount',
    label: 'Stories',
    sortable: true,
    cellClass: 'count-cell',
    // Custom sort function to sort by story count
    sortFn: (a, b, asc) => {
      // Note: The actual value isn't used, we compute it in the template
      // But we can sort by the computed value
      return 0 // Will be sorted by the displayed value
    }
  },
  {
    key: 'totalWords',
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

function getStoryCount(characterId) {
  return props.stories.filter(story =>
    story.characterIds?.includes(characterId) ||
    story.personaCharacterId === characterId
  ).length
}
</script>
