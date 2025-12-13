<template>
  <div
    ref="windowRef"
    class="floating-avatar-window"
    :style="windowStyle"
    @mouseenter="showControls = true"
    @mouseleave="showControls = false"
  >
    <button
      v-if="showControls"
      class="close-btn"
      @click="$emit('close')"
      title="Close"
    >
      <i class="fas fa-times"></i>
    </button>

    <img
      v-if="currentCharacter?.imageUrl"
      :src="currentCharacter.imageUrl"
      :alt="currentCharacter.name"
      class="avatar-image"
      draggable="false"
    />
    <div v-else class="no-image">
      <i class="fas fa-user"></i>
      <p>No avatar</p>
    </div>

    <!-- Character name overlay -->
    <div v-if="currentCharacter" class="character-name-overlay">
      {{ currentCharacter.name }}
    </div>

    <!-- Character navigation (when multiple characters) -->
    <div v-if="showControls && characters.length > 1" class="character-nav">
      <button
        class="nav-btn"
        @click="prevCharacter"
        title="Previous character"
      >
        <i class="fas fa-chevron-left"></i>
      </button>
      <span class="nav-indicator">{{ currentIndex + 1 }} / {{ characters.length }}</span>
      <button
        class="nav-btn"
        @click="nextCharacter"
        title="Next character"
      >
        <i class="fas fa-chevron-right"></i>
      </button>
    </div>

    <!-- Drag handle -->
    <div
      class="drag-handle"
      @mousedown="startDrag"
    ></div>

    <!-- Resize handle -->
    <div
      class="resize-handle"
      @mousedown="startResize"
    ></div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({
  characters: {
    type: Array,
    required: true
  },
  initialCharacterId: {
    type: String,
    default: null
  },
  storyId: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['close', 'character-change'])

const STORAGE_KEY = 'writers-guild-floating-avatar'
const SELECTED_CHARACTER_KEY = 'writers-guild-floating-avatar-character'

const windowRef = ref(null)
const showControls = ref(false)

// Load saved position and size from localStorage
const savedState = localStorage.getItem(STORAGE_KEY)
const defaultState = savedState ? JSON.parse(savedState) : {
  x: 20,
  y: 100,
  width: 300,
  height: 400
}

// Window position and size
const position = ref({ x: defaultState.x, y: defaultState.y })
const size = ref({ width: defaultState.width, height: defaultState.height })

// Character selection
const selectedCharacterId = ref(null)

// Initialize selected character
function initializeSelectedCharacter() {
  // First priority: initialCharacterId prop
  if (props.initialCharacterId && props.characters.some(c => c.id === props.initialCharacterId)) {
    selectedCharacterId.value = props.initialCharacterId
    return
  }

  // Second priority: saved selection for this story
  const savedSelection = localStorage.getItem(getStorageKeyForStory())
  if (savedSelection && props.characters.some(c => c.id === savedSelection)) {
    selectedCharacterId.value = savedSelection
    return
  }

  // Third priority: global saved selection
  const globalSavedSelection = localStorage.getItem(SELECTED_CHARACTER_KEY)
  if (globalSavedSelection && props.characters.some(c => c.id === globalSavedSelection)) {
    selectedCharacterId.value = globalSavedSelection
    return
  }

  // Default: first character
  if (props.characters.length > 0) {
    selectedCharacterId.value = props.characters[0].id
  }
}

function getStorageKeyForStory() {
  return props.storyId ? `${SELECTED_CHARACTER_KEY}-${props.storyId}` : SELECTED_CHARACTER_KEY
}

// Computed properties
const currentIndex = computed(() => {
  const index = props.characters.findIndex(c => c.id === selectedCharacterId.value)
  return index >= 0 ? index : 0
})

const currentCharacter = computed(() => {
  return props.characters[currentIndex.value] || props.characters[0] || null
})

// Character navigation
function prevCharacter() {
  const newIndex = (currentIndex.value - 1 + props.characters.length) % props.characters.length
  selectCharacter(props.characters[newIndex].id)
}

function nextCharacter() {
  const newIndex = (currentIndex.value + 1) % props.characters.length
  selectCharacter(props.characters[newIndex].id)
}

function selectCharacter(characterId) {
  selectedCharacterId.value = characterId

  // Save selection
  localStorage.setItem(SELECTED_CHARACTER_KEY, characterId)
  if (props.storyId) {
    localStorage.setItem(getStorageKeyForStory(), characterId)
  }

  emit('character-change', characterId)
}

// Dragging state
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })

// Resizing state
const isResizing = ref(false)
const resizeStart = ref({ x: 0, y: 0, width: 0, height: 0 })

// Save state to localStorage whenever position or size changes
watch([position, size], () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    x: position.value.x,
    y: position.value.y,
    width: size.value.width,
    height: size.value.height
  }))
}, { deep: true })

const windowStyle = computed(() => ({
  left: `${position.value.x}px`,
  top: `${position.value.y}px`,
  width: `${size.value.width}px`,
  height: `${size.value.height}px`
}))

function startDrag(e) {
  isDragging.value = true
  dragStart.value = {
    x: e.clientX - position.value.x,
    y: e.clientY - position.value.y
  }
  e.preventDefault()
}

function startResize(e) {
  isResizing.value = true
  resizeStart.value = {
    x: e.clientX,
    y: e.clientY,
    width: size.value.width,
    height: size.value.height
  }
  e.preventDefault()
}

function onMouseMove(e) {
  if (isDragging.value) {
    position.value = {
      x: e.clientX - dragStart.value.x,
      y: e.clientY - dragStart.value.y
    }
  } else if (isResizing.value) {
    const deltaX = e.clientX - resizeStart.value.x
    const deltaY = e.clientY - resizeStart.value.y

    size.value = {
      width: Math.max(200, resizeStart.value.width + deltaX),
      height: Math.max(200, resizeStart.value.height + deltaY)
    }
  }
}

function onMouseUp() {
  isDragging.value = false
  isResizing.value = false
}

// Ensure window is within viewport bounds
function ensureWithinViewport() {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const padding = 20 // Minimum visible area

  let { x, y } = position.value
  let { width, height } = size.value

  let changed = false

  // Ensure minimum size fits in viewport
  if (width > viewportWidth - padding * 2) {
    width = viewportWidth - padding * 2
    changed = true
  }
  if (height > viewportHeight - padding * 2) {
    height = viewportHeight - padding * 2
    changed = true
  }

  // Ensure window is not too far left (at least some part visible)
  if (x + width < padding) {
    x = padding - width + 100 // Keep at least 100px visible
    changed = true
  }

  // Ensure window is not too far right
  if (x > viewportWidth - padding) {
    x = viewportWidth - padding - 100 // Keep at least 100px visible
    changed = true
  }

  // Ensure window is not too far up
  if (y + height < padding) {
    y = padding
    changed = true
  }

  // Ensure window is not too far down
  if (y > viewportHeight - padding) {
    y = viewportHeight - padding - 100 // Keep at least 100px visible
    changed = true
  }

  // Adjust x to keep window more visible if partially off-screen
  if (x < 0 && x + width > padding) {
    // Window is partially off left edge - that's OK
  } else if (x < 0) {
    x = padding
    changed = true
  }

  // Adjust y similarly
  if (y < 0 && y + height > padding) {
    // Window is partially off top edge - that's OK
  } else if (y < 0) {
    y = padding
    changed = true
  }

  if (changed) {
    size.value = { width, height }
    position.value = { x, y }
  }
}

// Handle window resize
function onWindowResize() {
  ensureWithinViewport()
}

onMounted(() => {
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  window.addEventListener('resize', onWindowResize)

  // Initialize character selection
  initializeSelectedCharacter()

  // Ensure window is within viewport on mount
  ensureWithinViewport()
})

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('resize', onWindowResize)
})

// Watch for character list changes (in case characters are added/removed)
watch(() => props.characters, () => {
  if (props.characters.length > 0 && !props.characters.some(c => c.id === selectedCharacterId.value)) {
    selectedCharacterId.value = props.characters[0].id
  }
}, { deep: true })
</script>

<style scoped>
.floating-avatar-window {
  position: fixed;
  background: var(--bg-secondary);
  border: 2px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  z-index: 9999;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.7);
  border: none;
  color: white;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  transition: background 0.2s;
}

.close-btn:hover {
  background: rgba(0, 0, 0, 0.9);
}

.avatar-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
  user-select: none;
  pointer-events: none;
}

.no-image {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  color: var(--text-secondary);
}

.no-image i {
  font-size: 3rem;
}

.character-name-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 600;
  color: #ffffff;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  border-top-right-radius: 8px;
  max-width: calc(100% - 80px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.character-nav {
  position: absolute;
  bottom: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  border-top-left-radius: 8px;
}

.nav-btn {
  background: transparent;
  border: none;
  color: white;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.nav-btn:hover {
  background: rgba(255, 255, 255, 0.2);
}

.nav-indicator {
  color: white;
  font-size: 0.75rem;
  padding: 0 0.25rem;
  min-width: 40px;
  text-align: center;
}

.drag-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  cursor: move;
  z-index: 5;
}

.resize-handle {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 20px;
  height: 20px;
  cursor: nwse-resize;
  z-index: 5;
}

.resize-handle::after {
  content: '';
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 12px;
  height: 12px;
  border-right: 2px solid var(--border-color);
  border-bottom: 2px solid var(--border-color);
}
</style>
