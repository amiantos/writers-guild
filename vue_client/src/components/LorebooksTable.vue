<template>
  <DataTable
    :columns="columns"
    :data="lorebooks"
    default-sort="name"
    row-key="id"
  >
    <!-- Actions column -->
    <template #cell-actions="{ row }">
      <div class="actions-cell">
        <button class="btn btn-small btn-primary" @click="$emit('edit', row.id)">
          <i class="fas fa-edit"></i> Edit
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

defineProps({
  lorebooks: {
    type: Array,
    required: true
  }
})

defineEmits(['edit', 'delete'])

const columns = [
  {
    key: 'name',
    label: 'Name',
    sortable: true,
    cellClass: 'name-cell',
    format: (value) => value || 'Untitled Lorebook'
  },
  {
    key: 'description',
    label: 'Description',
    sortable: true,
    cellClass: 'description-cell'
  },
  {
    key: 'entryCount',
    label: 'Entries',
    sortable: true,
    cellClass: 'count-cell',
    format: (value) => value || 0
  },
  {
    key: 'actions',
    label: 'Actions',
    sortable: false,
    headerClass: 'actions-col'
  }
]
</script>

<!-- No styles needed - all styles are in DataTable.vue -->
