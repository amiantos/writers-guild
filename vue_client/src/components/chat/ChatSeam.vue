<template>
  <div class="turn-seam" :class="{ open, live: Boolean(live) }">
    <button class="seam-toggle" :aria-expanded="open" @click="open = !open">
      <span class="seam-line"></span>
      <span class="seam-label">
        <span v-if="live" class="pulse" aria-hidden="true"></span>
        {{ live ? live.status : 'How this was written' }}
      </span>
      <span class="seam-line"></span>
    </button>

    <div v-if="open" class="seam-panel">
      <div v-if="reasoning" class="seam-block">
        <div class="block-label">Reasoning</div>
        <pre ref="reasoningRef" class="block-text">{{ reasoning }}</pre>
      </div>
      <p v-else-if="live" class="seam-meta">
        Nothing to show yet. Reasoning streams in here when the model thinks before replying.
      </p>
      <p v-else class="seam-meta">The model didn't share any reasoning for this reply.</p>
    </div>
  </div>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue';

const props = defineProps({
  /** The reasoning of the reply below, as saved with its shown version. */
  reasoning: { type: String, default: '' },
  /** Live progress ({ status }) while the reply below is being written. */
  live: { type: Object, default: null },
});

const open = ref(false);
const reasoningRef = ref(null);

// While a reply is written, the label carries the live status; close once it's done.
watch(
  () => Boolean(props.live),
  (isLive) => {
    if (!isLive) open.value = false;
  },
);

// Follow streaming reasoning to its end.
watch(
  () => props.reasoning,
  async () => {
    if (!props.live) return;
    await nextTick();
    if (reasoningRef.value) {
      reasoningRef.value.scrollTop = reasoningRef.value.scrollHeight;
    }
  },
);
</script>

<style scoped>
.turn-seam {
  margin: 0.125rem 0;
  font-size: 0.8rem;
  line-height: 1.4;
}

.seam-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.375rem 0;
  background: none;
  border: none;
  color: var(--text-secondary);
  font: inherit;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s;
}

.turn-seam:hover .seam-toggle,
.seam-toggle:focus-visible,
.turn-seam.open .seam-toggle,
.turn-seam.live .seam-toggle {
  opacity: 1;
  outline: none;
}

.seam-line {
  flex: 1;
  height: 1px;
  background-color: var(--border-color);
}

.seam-label {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  white-space: nowrap;
}

.pulse {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background-color: var(--accent-primary);
  animation: seam-pulse 1.2s ease-in-out infinite;
}

@keyframes seam-pulse {
  50% {
    opacity: 0.3;
  }
}

.seam-panel {
  margin: 0.25rem 0 0.75rem;
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
}

.seam-meta {
  margin: 0;
  color: var(--text-secondary);
}

.block-label {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

.block-text {
  margin: 0.25rem 0 0;
  max-height: 320px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-secondary);
}

@media (hover: none) {
  .seam-toggle {
    opacity: 0.45;
  }
}
</style>
