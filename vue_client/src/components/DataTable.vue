<template>
  <div class="table-container">
    <table class="data-table">
      <thead>
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            :class="[
              column.headerClass,
              { sortable: column.sortable }
            ]"
            @click="column.sortable ? sortBy(column.key) : null"
          >
            <slot :name="`header-${column.key}`" :column="column">
              {{ column.label }}
              <span v-if="column.sortable && sortColumn === column.key">
                {{ sortAsc ? '▲' : '▼' }}
              </span>
            </slot>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in sortedData"
          :key="row[rowKey]"
          class="data-row"
        >
          <td
            v-for="column in columns"
            :key="column.key"
            :class="column.cellClass"
          >
            <slot
              :name="`cell-${column.key}`"
              :row="row"
              :value="getCellValue(row, column.key)"
            >
              {{ formatCell(row, column) }}
            </slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  columns: {
    type: Array,
    required: true
    // columns: [
    //   { key: 'name', label: 'Name', sortable: true },
    //   { key: 'actions', label: 'Actions', sortable: false }
    // ]
  },
  data: {
    type: Array,
    required: true
  },
  rowKey: {
    type: String,
    default: 'id'
  },
  defaultSort: {
    type: String,
    default: null
  },
  defaultSortAsc: {
    type: Boolean,
    default: false
  }
})

const sortColumn = ref(props.defaultSort || props.columns.find(c => c.sortable)?.key)
const sortAsc = ref(props.defaultSortAsc)

// Cache for sort values to avoid recomputation during sorting
let sortValueCache = new WeakMap()
let lastSortColumn = null

// Invalidate cache when data changes
watch(() => props.data, () => {
  sortValueCache = new WeakMap()
}, { flush: 'sync' })

// Get cached sort value for a row
function getCachedSortValue(row, key) {
  if (!sortValueCache.has(row)) {
    sortValueCache.set(row, {})
  }
  const cache = sortValueCache.get(row)
  if (!(key in cache)) {
    cache[key] = getCellValue(row, key)
  }
  return cache[key]
}

const sortedData = computed(() => {
  if (!sortColumn.value) return props.data

  // Clear value cache if sort column changed
  if (lastSortColumn !== sortColumn.value) {
    sortValueCache = new WeakMap()
    lastSortColumn = sortColumn.value
  }

  const sorted = [...props.data]
  const column = props.columns.find(c => c.key === sortColumn.value)
  const currentSortCol = sortColumn.value
  const ascending = sortAsc.value

  sorted.sort((a, b) => {
    // Use custom sort function if provided
    if (column?.sortFn) {
      return column.sortFn(a, b, ascending)
    }

    let aVal = getCachedSortValue(a, currentSortCol)
    let bVal = getCachedSortValue(b, currentSortCol)

    // Handle null/undefined - push to end
    if (aVal == null && bVal == null) return 0
    if (aVal == null) return 1
    if (bVal == null) return -1

    // Default sorting logic
    if (typeof aVal === 'string') {
      aVal = aVal.toLowerCase()
      bVal = (bVal || '').toLowerCase()
      return ascending ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }

    // Handle dates
    if (aVal instanceof Date || (typeof aVal === 'string' && !isNaN(Date.parse(aVal)))) {
      aVal = new Date(aVal).getTime()
      bVal = new Date(bVal).getTime()
      return ascending ? aVal - bVal : bVal - aVal
    }

    // Handle numbers
    if (typeof aVal === 'number') {
      return ascending ? aVal - bVal : bVal - aVal
    }

    return 0
  })

  return sorted
})

function sortBy(columnKey) {
  if (sortColumn.value === columnKey) {
    sortAsc.value = !sortAsc.value
  } else {
    sortColumn.value = columnKey
    sortAsc.value = false
  }
}

function getCellValue(row, key) {
  // Support nested keys like 'user.name'
  return key.split('.').reduce((obj, k) => obj?.[k], row)
}

function formatCell(row, column) {
  const value = getCellValue(row, column.key)

  // Use custom formatter if provided
  if (column.format) {
    return column.format(value, row)
  }

  // Default formatting
  if (value === null || value === undefined) {
    return column.defaultValue || ''
  }

  return value
}
</script>

<style scoped>
.table-container {
  overflow-x: auto;
  border-radius: 4px;
  border: 1px solid var(--border-color);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  background-color: var(--bg-primary);
}

.data-table th {
  padding: 0.75rem 1rem;
  text-align: left;
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
  background-color: var(--bg-secondary);
  border-bottom: 2px solid var(--border-color);
  position: sticky;
  top: 0;
  z-index: 10;
}

.sortable {
  cursor: pointer;
  user-select: none;
}

.sortable:hover {
  background-color: var(--bg-tertiary);
}

.data-row {
  border-bottom: 1px solid var(--border-color);
  transition: background-color 0.15s;
}

.data-row:hover {
  background-color: var(--bg-secondary);
}

.data-table td {
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
}

/* Common cell styles */
.avatar-col {
  width: 50px;
  padding: 0.75rem 0.5rem;
}

.avatar-cell {
  padding: 0.5rem;
  width: 50px;
}

.title-cell,
.name-cell {
  font-weight: 500;
  color: var(--text-primary);
}

.date-cell {
  color: var(--text-secondary);
  white-space: nowrap;
}

.description-cell {
  color: var(--text-secondary);
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count-cell {
  color: var(--text-secondary);
  text-align: center;
}

.wordcount-cell {
  color: var(--text-secondary);
  white-space: nowrap;
  text-align: right;
}

.text-right {
  text-align: right;
}

.actions-col {
  min-width: 200px;
}

</style>
