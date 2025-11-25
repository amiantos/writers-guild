# Writers Guild Vue Client

A Vue 3 reimplementation of the Writers Guild client, demonstrating component-based architecture and modern frontend patterns.

## Setup

```bash
cd vue_client
npm install
```

## Development

Start the dev server (requires the backend server running on port 8000):

```bash
# Terminal 1: Start the backend
cd ..
npm start

# Terminal 2: Start Vue dev server
cd vue_client
npm run dev
```

The Vue app will run on http://localhost:5173 and proxy API requests to the backend on port 8000.

## Build for Production

```bash
npm run build
```

The built files will be in the `dist/` folder.

## Project Structure

```
vue_client/
├── src/
│   ├── components/        # Reusable UI components
│   │   ├── DataTable.vue          # ⭐ Generic sortable table
│   │   ├── CharacterAvatar.vue    # Reusable avatar display
│   │   ├── StoriesTable.vue       # Stories-specific config
│   │   └── CharactersTable.vue    # Characters-specific config
│   ├── views/            # Page-level components
│   │   └── LandingPage.vue
│   ├── services/         # API clients and business logic
│   │   └── api.js
│   ├── App.vue          # Root component
│   ├── main.js          # Application entry point
│   └── style.css        # Global styles
├── index.html           # HTML template
├── vite.config.js       # Vite configuration
└── package.json
```

## Key Features Demonstrated

### Component Reusability - The Power of Vue

**Generic `DataTable` Component:**
The crown jewel! One reusable table component handles ALL tables:

```vue
<!-- Use for Stories -->
<DataTable :columns="storyColumns" :data="stories" default-sort="modified">
  <template #cell-avatar="{ row }">
    <CharacterAvatar :character="getFirstCharacter(row)" />
  </template>
</DataTable>

<!-- Use for Characters -->
<DataTable :columns="characterColumns" :data="characters" default-sort="created">
  <template #cell-avatar="{ row }">
    <CharacterAvatar :character="row" />
  </template>
</DataTable>
```

**Benefits:**
- ✅ **ONE component** for all sortable tables
- ✅ All columns sortable by default (just set `sortable: true`)
- ✅ Custom cell rendering via slots
- ✅ Built-in date/number formatting
- ✅ No duplicated sorting logic
- ✅ Add a new table type in minutes

**Component Hierarchy:**
- `DataTable.vue` - Generic, reusable table with sorting (100 lines)
- `StoriesTable.vue` - Stories-specific configuration (45 lines)
- `CharactersTable.vue` - Characters-specific configuration (50 lines)
- `CharacterAvatar.vue` - Reusable avatar (20 lines)

Compare this to the vanilla JS where each table was 150+ lines with duplicated sorting logic!

### Reactive State Management
- Automatic UI updates when data changes
- No manual DOM manipulation required
- Clean separation of data and presentation

### Modern Patterns
- Composition API with `<script setup>`
- Props and emits for component communication
- Slots for flexible custom rendering
- Computed properties for derived state

## Comparison with Vanilla JS Client

**Before (Vanilla JS):**
```javascript
// Manual DOM manipulation
container.innerHTML = stories.map(story => `...`).join('')

// Manual event listener management
document.querySelectorAll('.btn').forEach(btn => {
  btn.addEventListener('click', handler)
})

// State sync across multiple places
this.renderStories()
this.renderCharacters()
this.attachListeners()  // Remember to reattach!
```

**After (Vue):**
```vue
<template>
  <!-- Declarative rendering -->
  <StoriesTable
    :stories="stories"
    @delete="deleteStory"
  />
</template>

<script setup>
// Reactive state
const stories = ref([])

// Automatic UI updates
async function deleteStory(id) {
  await api.delete(id)
  stories.value = stories.value.filter(s => s.id !== id)
  // UI automatically updates!
}
</script>
```

## Benefits of Vue Approach

1. **Less Code**: ~50% less code for the same functionality
2. **No Event Listener Management**: Vue handles attachment/detachment automatically
3. **Component Reusability**: `StoriesTable` can be used in modals, pages, anywhere
4. **Maintainability**: Logic grouped by feature, not by operation type
5. **Type Safety Ready**: Easy to add TypeScript later
6. **Better DX**: Hot module replacement, component inspector tools

## Next Steps

To complete the migration:
- [ ] Add Vue Router for story editor route
- [ ] Implement story editor component
- [ ] Add character/lorebook management modals
- [ ] Integrate with existing backend auth
- [ ] Add state management (Pinia) if needed
