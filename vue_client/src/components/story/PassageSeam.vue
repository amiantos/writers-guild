<template>
  <div class="turn-seam" :class="{ open, live: Boolean(live) }">
    <button class="seam-toggle" :aria-expanded="open" @click="open = !open">
      <span class="seam-line"></span>
      <span class="seam-label">
        <span v-if="live" class="pulse" aria-hidden="true"></span>
        {{ label }}
      </span>
      <span class="seam-line"></span>
    </button>

    <div v-if="open" class="seam-panel">
      <p v-if="meta" class="seam-meta">{{ meta }}</p>
      <div v-if="instruction" class="seam-block">
        <div class="block-label">Your instruction</div>
        <pre class="block-text">{{ instruction }}</pre>
      </div>
      <template v-if="live || passage?.source === 'generated'">
        <div v-if="reasoning" class="seam-block">
          <div class="block-label">Reasoning</div>
          <pre ref="reasoningRef" class="block-text">{{ reasoning }}</pre>
        </div>
        <p v-else-if="live" class="seam-meta">
          Nothing to show yet. Reasoning streams in here when the model thinks before writing.
        </p>
        <p v-else class="seam-meta">The model didn't share any reasoning for this passage.</p>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { formatDateTime } from '../../composables/bureau/format';

const props = defineProps({
  /** The record of the passage below; absent while it's being written. */
  passage: { type: Object, default: null },
  /** Live progress ({ status, action, characterName, instruction }) while the passage is written. */
  live: { type: Object, default: null },
  /** The live reasoning, while the passage below is being written. */
  liveReasoning: { type: String, default: '' },
  /** Open as soon as reasoning streams in, as the reasoning panel does when it's turned on. */
  openOnReasoning: { type: Boolean, default: false },
});

const ACTION_LABELS = {
  starter: 'Started the story',
  continue: 'Continued the story',
  character: 'Continued for a character',
  instruction: 'Followed your instruction',
  rewrite: 'Rewrote the story in third person',
  greeting: 'A greeting',
  write: 'Written by you',
};

const open = ref(false);
const reasoningRef = ref(null);

const source = computed(() => props.live ?? props.passage ?? {});
const reasoning = computed(() => (props.live ? props.liveReasoning : props.passage?.reasoning));
const instruction = computed(() => source.value.instruction ?? '');

const label = computed(() => {
  if (props.live) return props.live.status;
  if (props.passage?.source === 'generated') return 'How this was written';
  return props.passage?.action === 'greeting' ? 'Greeting' : 'Written by you';
});

const meta = computed(() => {
  const { action, characterName, created, edited } = source.value;
  const parts = [];
  if (action === 'character' && characterName) {
    parts.push(`Continued for ${characterName}`);
  } else if (action === 'greeting' && characterName) {
    parts.push(`${characterName}'s greeting`);
  } else if (ACTION_LABELS[action]) {
    parts.push(ACTION_LABELS[action]);
  }
  if (created && !props.live) parts.push(formatDateTime(created));
  if (edited) parts.push(props.passage?.source === 'generated' ? 'edited afterward' : 'edited');
  return parts.join(' · ');
});

// While a passage is written, the label carries the live status; close once it's done.
watch(
  () => Boolean(props.live),
  (isLive) => {
    if (!isLive) open.value = false;
  },
);

watch(
  () => props.liveReasoning,
  async (text) => {
    if (!props.live || !text) return;
    if (props.openOnReasoning) open.value = true;
    // Follow streaming reasoning to its end.
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
  margin: 0.25rem 0 1rem;
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
