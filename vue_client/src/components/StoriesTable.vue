<template>
  <DataTable
    :columns="columns"
    :data="stories"
    default-sort="modified"
    row-key="id"
  >
    <!-- Avatar column -->
    <template #cell-avatar="{ row }">
      <CharacterAvatar :characters="getStoryCharacters(row)" />
    </template>

    <!-- Actions column -->
    <template #cell-actions="{ row }">
      <div class="actions-cell">
        <button class="btn btn-small btn-primary" @click="$emit('open', row.id)">
          <i class="fas fa-folder-open"></i> Open
        </button>
        <button class="btn btn-small btn-secondary" @click="$emit('delete', row)">
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
  stories: {
    type: Array,
    required: true
  },
  characters: {
    type: Array,
    default: () => []
  }
})

defineEmits(['open', 'delete'])

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
    key: 'created',
    label: 'Created',
    sortable: true,
    cellClass: 'date-cell',
    format: (value) => new Date(value).toLocaleDateString()
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

function getStoryCharacters(story) {
  const characters = []

  // Add all characters from characterIds
  if (story.characterIds && story.characterIds.length > 0) {
    for (const charId of story.characterIds) {
      const character = props.characters.find(c => c.id === charId)
      if (character && !characters.find(c => c.id === character.id)) {
        characters.push(character)
      }
    }
  }

  // Add persona character if it exists and isn't already included
  if (story.personaCharacterId) {
    const personaChar = props.characters.find(c => c.id === story.personaCharacterId)
    if (personaChar && !characters.find(c => c.id === personaChar.id)) {
      characters.push(personaChar)
    }
  }

  return characters
}
</script>