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

    <!-- Character name overlay (clickable to cycle) -->
    <div v-if="currentCharacter" class="character-info-overlay">
      <button
        v-if="characters.length > 1"
        class="character-name-btn"
        @click="cycleCharacter"
        title="Click to switch character"
      >
        {{ currentCharacter.name }}
      </button>
      <span v-else class="character-name">{{ currentCharacter.name }}</span>
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
  windowId: {
    type: String,
    required: true
  },
  initialCharacterId: {
    type: String,
    default: null
  },
  initialPosition: {
    type: Object,
    default: () => ({ x: 20, y: 100 })
  },
  initialSize: {
    type: Object,
    default: () => ({ width: 300, height: 400 })
  }
})

const emit = defineEmits(['close', 'update'])

// Minimum visible pixels when window is partially off-screen
const MIN_VISIBLE_PIXELS = 100

const windowRef = ref(null)
const showControls = ref(false)

// Window position and size
const position = ref({ ...props.initialPosition })
const size = ref({ ...props.initialSize })

// Character selection
const selectedCharacterId = ref(props.initialCharacterId || (props.characters[0]?.id ?? null))

// Computed properties
const currentIndex = computed(() => {
  const index = props.characters.findIndex(c => c.id === selectedCharacterId.value)
  return index >= 0 ? index : 0
})

const currentCharacter = computed(() => {
  return props.characters[currentIndex.value] || props.characters[0] || null
})

// Cycle to next character
function cycleCharacter() {
  if (props.characters.length <= 1) return
  const newIndex = (currentIndex.value + 1) % props.characters.length
  selectedCharacterId.value = props.characters[newIndex].id
  emitUpdate()
}

// Dragging state
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })

// Resizing state
const isResizing = ref(false)
const resizeStart = ref({ x: 0, y: 0, width: 0, height: 0 })

// Emit update to parent for server sync
function emitUpdate() {
  emit('update', {
    windowId: props.windowId,
    characterId: selectedCharacterId.value,
    x: position.value.x,
    y: position.value.y,
    width: size.value.width,
    height: size.value.height
  })
}

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
  if (isDragging.value || isResizing.value) {
    isDragging.value = false
    isResizing.value = false
    emitUpdate()
  }
}

// Ensure window is within viewport bounds
function ensureWithinViewport() {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const padding = 20

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

  // Ensure window is not too far off-screen
  if (x + width < padding) {
    x = padding - width + MIN_VISIBLE_PIXELS
    changed = true
  }
  if (x > viewportWidth - padding) {
    x = viewportWidth - padding - MIN_VISIBLE_PIXELS
    changed = true
  }
  if (y + height < padding) {
    y = padding
    changed = true
  }
  if (y > viewportHeight - padding) {
    y = viewportHeight - padding - MIN_VISIBLE_PIXELS
    changed = true
  }
  if (x < 0 && x + width <= padding) {
    x = padding
    changed = true
  }
  if (y < 0 && y + height <= padding) {
    y = padding
    changed = true
  }

  if (changed) {
    size.value = { width, height }
    position.value = { x, y }
    emitUpdate()
  }
}

function onWindowResize() {
  ensureWithinViewport()
}

onMounted(() => {
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  window.addEventListener('resize', onWindowResize)
  ensureWithinViewport()
})

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
  window.removeEventListener('resize', onWindowResize)
})

// Watch for character list changes - use computed IDs to avoid deep watch performance issues
const characterIds = computed(() => props.characters.map(c => c.id))
watch(characterIds, () => {
  if (props.characters.length > 0 && !props.characters.some(c => c.id === selectedCharacterId.value)) {
    selectedCharacterId.value = props.characters[0].id
    emitUpdate()
  } else if (props.characters.length === 0) {
    selectedCharacterId.value = null
    emitUpdate()
  }
})
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

.character-info-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  padding: 0.5rem 0.75rem;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  border-top-right-radius: 8px;
  max-width: 100%;
}

.character-name {
  font-size: 0.875rem;
  font-weight: 600;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.character-name-btn {
  background: transparent;
  border: none;
  font-size: 0.875rem;
  font-weight: 600;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  padding: 0;
  transition: opacity 0.2s;
}

.character-name-btn:hover {
  opacity: 0.8;
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
