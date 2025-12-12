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
          <i class="fas fa-circle-info"></i> Details
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
import { computed } from 'vue'
import DataTable from './DataTable.vue'
import CharacterAvatar from './CharacterAvatar.vue'
import { useDataCache } from '../composables/useDataCache'

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

// Use centralized memoized story counts for O(1) lookup
const { getStoryCount: getCachedStoryCount, storyCountsByCharacter } = useDataCache()

// Memoize story counts for sorting - computed once, reused for all rows
const storyCountMap = computed(() => {
  // If using cache, return its pre-computed map
  if (storyCountsByCharacter.value.size > 0) {
    return storyCountsByCharacter.value
  }
  // Fallback: compute from props.stories if cache not populated
  const counts = new Map()
  for (const story of props.stories) {
    if (story.characterIds) {
      for (const charId of story.characterIds) {
        counts.set(charId, (counts.get(charId) || 0) + 1)
      }
    }
    if (story.personaCharacterId && !story.characterIds?.includes(story.personaCharacterId)) {
      counts.set(story.personaCharacterId, (counts.get(story.personaCharacterId) || 0) + 1)
    }
  }
  return counts
})

function getStoryCount(characterId) {
  return storyCountMap.value.get(characterId) || 0
}

function sortByStoryCount(aCharacter, bCharacter, asc) {
  const aCount = storyCountMap.value.get(aCharacter.id) || 0
  const bCount = storyCountMap.value.get(bCharacter.id) || 0
  return asc ? aCount - bCount : bCount - aCount
}

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
    sortFn: sortByStoryCount
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
</script>
