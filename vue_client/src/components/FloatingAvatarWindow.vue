<template>
  <div
    ref="windowRef"
    class="floating-avatar-window"
    :style="windowStyle"
    @mouseenter="showClose = true"
    @mouseleave="showClose = false"
  >
    <button
      v-if="showClose"
      class="close-btn"
      @click="$emit('close')"
      title="Close"
    >
      <i class="fas fa-times"></i>
    </button>

    <img
      v-if="character?.imageUrl"
      :src="character.imageUrl"
      :alt="character.name"
      class="avatar-image"
      draggable="false"
    />
    <div v-else class="no-image">
      <i class="fas fa-user"></i>
      <p>No avatar</p>
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
  character: {
    type: Object,
    required: true
  }
})

defineEmits(['close'])

const STORAGE_KEY = 'ursceal-floating-avatar'

const windowRef = ref(null)
const showClose = ref(false)

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

onMounted(() => {
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
})

onUnmounted(() => {
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
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
