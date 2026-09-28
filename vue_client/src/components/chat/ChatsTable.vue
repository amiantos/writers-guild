<template>
  <DataTable
    :columns="columns"
    :data="chats"
    default-sort="modified"
    row-key="id"
    row-clickable
    @row-click="$emit('open', $event.id)"
  >
    <!-- Avatar column -->
    <template #cell-avatar="{ row }">
      <CharacterAvatar :characters="getChatCharacters(row)" />
    </template>

    <!-- Title column, with the last message under it -->
    <template #cell-title="{ row }">
      <div class="chat-title">{{ row.title || 'Untitled Chat' }}</div>
      <div v-if="row.lastMessage" class="chat-preview">
        {{ row.lastMessage.senderName }}: {{ row.lastMessage.content }}
      </div>
    </template>

    <!-- Actions column -->
    <template #cell-actions="{ row }">
      <div class="actions-cell">
        <button class="btn btn-small btn-primary" @click="$emit('open', row.id)">
          <i class="fas fa-folder-open"></i> Open
        </button>
        <button
          class="btn btn-small btn-secondary"
          title="Delete chat"
          @click="$emit('delete', row)"
        >
          <i class="fas fa-trash"></i>
        </button>
      </div>
    </template>
  </DataTable>
</template>

<script setup>
import DataTable from '../DataTable.vue';
import CharacterAvatar from '../CharacterAvatar.vue';

const props = defineProps({
  chats: {
    type: Array,
    required: true,
  },
  characters: {
    type: Array,
    default: () => [],
  },
});

defineEmits(['open', 'delete']);

const columns = [
  {
    key: 'avatar',
    label: '',
    sortable: false,
    headerClass: 'avatar-col',
    cellClass: 'avatar-cell',
  },
  {
    key: 'title',
    label: 'Title',
    sortable: true,
    cellClass: 'title-cell',
  },
  {
    key: 'created',
    label: 'Created',
    sortable: true,
    cellClass: 'date-cell',
    format: (value) => new Date(value).toLocaleDateString(),
  },
  {
    key: 'modified',
    label: 'Modified',
    sortable: true,
    cellClass: 'date-cell',
    format: (value, row) => new Date(value || row.created).toLocaleDateString(),
  },
  {
    key: 'messageCount',
    label: 'Messages',
    sortable: true,
    headerClass: 'text-right',
    cellClass: 'wordcount-cell',
    format: (value) => (value || 0).toLocaleString(),
  },
  {
    key: 'actions',
    label: 'Actions',
    sortable: false,
    headerClass: 'actions-col',
    noRowClick: true,
  },
];

function getChatCharacters(chat) {
  const ids = [...chat.characterIds];
  if (chat.personaCharacterId && !ids.includes(chat.personaCharacterId)) {
    ids.push(chat.personaCharacterId);
  }
  return ids.map((id) => props.characters.find((character) => character.id === id)).filter(Boolean);
}
</script>

<style scoped>
.chat-title {
  font-weight: 500;
}

.chat-preview {
  margin-top: 0.125rem;
  max-width: 28rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
