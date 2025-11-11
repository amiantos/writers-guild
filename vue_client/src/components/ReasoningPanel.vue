<template>
  <div class="reasoning-panel">
    <div class="reasoning-header">
      <h3>Model Reasoning</h3>
      <button class="icon-btn" @click="$emit('close')">
        <i class="fas fa-xmark"></i>
      </button>
    </div>
    <div ref="contentRef" class="reasoning-content">
      <div v-if="!reasoning" class="reasoning-empty">
        Thinking...
      </div>
      <div v-else class="reasoning-text" v-html="formattedReasoning"></div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'

const props = defineProps({
  reasoning: {
    type: String,
    default: ''
  }
})

defineEmits(['close'])

const contentRef = ref(null)

const formattedReasoning = computed(() => {
  if (!props.reasoning) return ''

  // Convert markdown-style formatting to HTML
  let formatted = props.reasoning
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Convert line breaks
    .replace(/\n/g, '<br>')
    // Bold text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic text
    .replace(/\*(.*?)\*/g, '<em>$1</em>')

  return formatted
})

// Auto-scroll when reasoning updates
watch(() => props.reasoning, async () => {
  await nextTick()
  if (contentRef.value) {
    contentRef.value.scrollTop = contentRef.value.scrollHeight
  }
})
</script>

<style scoped>
.reasoning-panel {
  display: flex;
  flex-direction: column;
  background-color: var(--bg-tertiary);
  border-bottom: 2px solid var(--accent-primary);
  height: 300px;
  flex-shrink: 0;
}

.reasoning-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 2rem;
  border-bottom: 1px solid var(--border-color);
}

.reasoning-header h3 {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
}

.reasoning-content {
  flex: 1;
  padding: 1rem 2rem;
  overflow-y: auto;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', 'Fira Mono', 'Roboto Mono', 'Courier New', monospace;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text-secondary);
  background-color: var(--bg-primary);
}

.reasoning-empty {
  text-align: center;
  color: var(--text-secondary);
  font-style: italic;
}

.reasoning-text {
  white-space: pre-wrap;
  word-wrap: break-word;
}

.reasoning-text :deep(strong) {
  color: var(--text-primary);
  font-weight: 600;
}

.reasoning-text :deep(em) {
  color: var(--accent-primary);
  font-style: italic;
}
</style>
