<template>
  <DataTable
    :columns="columns"
    :data="presets"
    default-sort="name"
    row-key="id"
  >
    <!-- Provider column -->
    <template #cell-provider="{ row }">
      <span class="provider-badge">
        {{ getProviderDisplayName(row.provider) }}
      </span>
    </template>

    <!-- Actions column -->
    <template #cell-actions="{ row }">
      <div class="actions-cell">
        <button
          class="btn btn-small btn-secondary"
          @click="$emit('set-default', row.id)"
          :title="row.id === defaultPresetId ? 'Current default preset' : 'Set as default preset'"
        >
          <i :class="row.id === defaultPresetId ? 'fas fa-check' : 'fas fa-star'"></i>
          Set Default
        </button>
        <button
          class="btn btn-small btn-secondary"
          @click="$emit('edit', row.id)"
        >
          <i class="fas fa-edit"></i> Edit
        </button>
        <button
          class="btn btn-small btn-secondary"
          @click="$emit('duplicate', row.id)"
        >
          <i class="fas fa-copy"></i> Duplicate
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

const props = defineProps({
  presets: {
    type: Array,
    required: true
  },
  defaultPresetId: {
    type: String,
    default: null
  }
})

defineEmits(['edit', 'duplicate', 'delete', 'set-default'])

function getProviderDisplayName(provider) {
  const names = {
    deepseek: 'DeepSeek',
    aihorde: 'AI Horde',
    openai: 'OpenAI',
    anthropic: 'Claude',
    openrouter: 'OpenRouter'
  }
  return names[provider] || provider
}

const columns = [
  {
    key: 'name',
    label: 'Name',
    sortable: true,
    cellClass: 'name-cell'
  },
  {
    key: 'provider',
    label: 'Provider',
    sortable: true,
    cellClass: 'provider-cell'
  },
  {
    key: 'actions',
    label: 'Actions',
    sortable: false,
    headerClass: 'actions-col-wide'
  }
]
</script>

<style scoped>
.provider-badge {
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.actions-col-wide {
  min-width: 400px;
}
</style>
