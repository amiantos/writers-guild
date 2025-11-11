# Vanilla JS vs Vue: Side-by-Side Comparison

## Table Implementation

### Vanilla JS Approach (Before)

**Two separate table implementations with duplicated logic:**

```javascript
// client/js/landing.js - Stories Table (~80 lines)
renderAllStoriesTable() {
  const sortedStories = this.getSortedStories(); // Custom sort logic

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th><button class="sort-btn" data-sort="name">Title</button></th>
          <th><button class="sort-btn" data-sort="created">Created</button></th>
          <!-- ... -->
        </tr>
      </thead>
      <tbody>
        ${sortedStories.map(story => `
          <tr>
            <td>${story.title}</td>
            <!-- ... -->
            <td>
              <button class="btn" data-story-id="${story.id}">Open</button>
              <button class="btn" data-story-id="${story.id}">Delete</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Manually attach event listeners
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      this.storySortBy = e.currentTarget.dataset.sort;
      this.renderAllStoriesTable(); // Re-render
      this.attachEventListeners(); // Re-attach ALL listeners!
    });
  });

  document.querySelectorAll('.table-open-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      this.openStory(e.currentTarget.dataset.storyId);
    });
  });

  document.querySelectorAll('.table-delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      await this.deleteStory(e.currentTarget.dataset.storyId);
    });
  });
}

// Separate sorting logic (~30 lines)
getSortedStories() {
  const sorted = [...this.stories];
  sorted.sort((a, b) => {
    let aVal, bVal;
    switch (this.storySortBy) {
      case 'name':
        aVal = (a.title || 'Untitled').toLowerCase();
        bVal = (b.title || 'Untitled').toLowerCase();
        return aVal.localeCompare(bVal);
      case 'created':
        return new Date(b.created) - new Date(a.created);
      // ... more cases
    }
  });
  return sorted;
}

// Character table: DUPLICATE all of the above (~80 more lines)
renderCharacterLibrary() {
  // ... same pattern repeated
}
```

**Total: ~200 lines for two tables + sorting + event management**

---

### Vue Approach (After)

**One generic table component, reused for both:**

```vue
<!-- DataTable.vue - Generic reusable table (~100 lines) -->
<template>
  <table>
    <thead>
      <tr>
        <th
          v-for="column in columns"
          :class="{ sortable: column.sortable }"
          @click="column.sortable ? sortBy(column.key) : null"
        >
          {{ column.label }}
          <span v-if="sortColumn === column.key">
            {{ sortAsc ? '▲' : '▼' }}
          </span>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="row in sortedData" :key="row[rowKey]">
        <td v-for="column in columns">
          <slot :name="`cell-${column.key}`" :row="row" :value="row[column.key]">
            {{ formatCell(row, column) }}
          </slot>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<script setup>
const sortedData = computed(() => {
  const sorted = [...props.data]
  // Generic sorting for ANY column, ANY data type
  sorted.sort((a, b) => {
    const aVal = getCellValue(a, sortColumn.value)
    const bVal = getCellValue(b, sortColumn.value)

    if (typeof aVal === 'string') {
      return sortAsc.value ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
    }
    if (aVal instanceof Date || !isNaN(Date.parse(aVal))) {
      return sortAsc.value ? new Date(aVal) - new Date(bVal) : new Date(bVal) - new Date(aVal)
    }
    return sortAsc.value ? aVal - bVal : bVal - aVal
  })
  return sorted
})
</script>
```

**Use for Stories (~45 lines):**
```vue
<!-- StoriesTable.vue -->
<template>
  <DataTable :columns="columns" :data="stories" default-sort="modified">
    <template #cell-actions="{ row }">
      <button @click="$emit('open', row.id)">Open</button>
      <button @click="$emit('delete', row)">Delete</button>
    </template>
  </DataTable>
</template>

<script setup>
const columns = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'created', label: 'Created', sortable: true,
    format: (v) => new Date(v).toLocaleDateString() },
  { key: 'modified', label: 'Modified', sortable: true },
  { key: 'wordCount', label: 'Words', sortable: true,
    format: (v) => v.toLocaleString() },
  { key: 'actions', label: 'Actions', sortable: false }
]
</script>
```

**Use for Characters (~50 lines):**
```vue
<!-- CharactersTable.vue -->
<template>
  <DataTable :columns="columns" :data="characters" default-sort="created">
    <template #cell-actions="{ row }">
      <button @click="$emit('new-story', row.id)">New Story</button>
      <button @click="$emit('edit', row.id)">Edit</button>
      <button @click="$emit('delete', row)">Delete</button>
    </template>
  </DataTable>
</template>

<script setup>
const columns = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'created', label: 'Created', sortable: true },
  { key: 'totalWords', label: 'Words', sortable: true },
  { key: 'actions', label: 'Actions', sortable: false }
]
</script>
```

**Total: ~195 lines total (100 generic + 45 stories + 50 characters)**
- **Reusable for ANY future table**
- **No event listener management**
- **No duplicated sorting logic**

---

## Event Handling

### Vanilla JS
```javascript
// Must re-attach listeners after EVERY render
document.querySelectorAll('.btn').forEach(btn => {
  btn.addEventListener('click', handler)
})

// Easy to forget, causes bugs
renderTable()
// Oops! Forgot to call attachEventListeners()
// Now buttons don't work!
```

### Vue
```vue
<!-- Events always work, automatically managed -->
<button @click="handleClick">Click Me</button>
```

---

## State Management

### Vanilla JS
```javascript
// Update data
this.stories.push(newStory)

// Manually update ALL places that show this data
this.renderStories()
this.renderCharacters()
this.updateCounts()
this.attachEventListeners() // Don't forget!
```

### Vue
```javascript
// Update data - UI updates automatically everywhere
stories.value.push(newStory)
// That's it! All components showing stories auto-update
```

---

## Adding a New Table

### Vanilla JS
**Estimate: 2-3 hours**
1. Copy existing table code (~150 lines)
2. Modify HTML template strings
3. Write new sorting logic
4. Add event listeners
5. Handle re-rendering
6. Debug listener issues
7. Test sorting

### Vue
**Estimate: 15 minutes**
1. Define columns array (10 lines)
2. Use `<DataTable>` (5 lines)
3. Done! Sorting, formatting, events all work

```vue
<template>
  <DataTable :columns="myColumns" :data="myData" />
</template>

<script setup>
const myColumns = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'name', label: 'Name', sortable: true },
]
</script>
```

---

## Code Metrics

| Metric | Vanilla JS | Vue | Improvement |
|--------|-----------|-----|-------------|
| Lines of code (2 tables) | ~200 | ~195 | Similar |
| Lines for 3rd table | +150 | +15 | **90% less** |
| Sorting logic duplication | 2× | 1× | **50% less** |
| Event listener code | ~50 lines | 0 lines | **100% less** |
| Bug-prone re-renders | Many | None | **∞ better** |
| Maintainability | 😰 | 😊 | **Much better** |

---

## Real-World Benefits

**Vanilla JS Issues We Had:**
1. ✗ Forgetting to reattach listeners after sort → buttons stop working
2. ✗ Duplicated sorting logic between tables
3. ✗ Manual state synchronization
4. ✗ String concatenation for templates (hard to read)
5. ✗ Adding new table = copy/paste nightmare

**Vue Advantages:**
1. ✓ Events always work (Vue manages listeners)
2. ✓ One sorting implementation for all tables
3. ✓ Reactive state (update once, reflects everywhere)
4. ✓ Readable template syntax
5. ✓ Adding new table = configure columns only

---

## Conclusion

Vue doesn't just make code shorter—it makes it:
- **More maintainable** (DRY principle actually works)
- **Less bug-prone** (no manual event/state management)
- **Faster to develop** (reusable components)
- **Easier to understand** (declarative > imperative)

The `DataTable` component alone justifies the migration. Any future table is now ~10 lines of configuration.
