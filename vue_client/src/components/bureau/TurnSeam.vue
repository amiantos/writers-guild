<template>
  <div class="turn-seam" :class="{ open, live: Boolean(live) }">
    <button class="seam-toggle" :aria-expanded="open" @click="toggle">
      <span class="seam-line"></span>
      <span class="seam-label">
        <span v-if="live" class="pulse" aria-hidden="true"></span>
        {{ label }}
      </span>
      <span class="seam-line"></span>
    </button>

    <div v-if="open" class="seam-panel">
      <template v-if="live">
        <div v-if="live.reasoning" class="seam-block">
          <div class="block-label">Reasoning</div>
          <pre class="block-text">{{ live.reasoning }}</pre>
        </div>
        <p v-else class="seam-meta">
          Nothing to show yet. Reasoning streams in here when thinking mode is on.
        </p>
      </template>

      <p v-else-if="turn && turn.source === 'user'" class="seam-meta">{{ readerMeta }}</p>

      <template v-else-if="turn">
        <p v-if="loadingRun" class="seam-meta">Loading how this was written...</p>
        <p v-else-if="runError" class="seam-error">{{ runError }}</p>
        <template v-else-if="run">
          <p class="seam-meta">{{ runMeta }}</p>
          <section v-for="step in run.steps" :key="step.id" class="seam-step">
            <header class="step-header">
              <span class="step-role">{{ stepLabel(step) }}</span>
              <span v-if="step.durationMs !== null">{{ formatDuration(step.durationMs) }}</span>
              <span v-if="step.usage">{{ formatUsage(step.usage) }}</span>
            </header>
            <p v-if="step.error" class="seam-error">{{ step.error }}</p>
            <p v-if="stepSettings(step)" class="seam-meta">{{ stepSettings(step) }}</p>
            <details v-if="step.reasoning" class="seam-details" open>
              <summary>Reasoning</summary>
              <pre class="block-text">{{ step.reasoning }}</pre>
            </details>
            <details v-if="step.request?.messages?.length" class="seam-details">
              <summary>Prompt</summary>
              <div
                v-for="(message, index) in step.request.messages"
                :key="index"
                class="seam-block"
              >
                <div class="block-label">{{ message.role }}</div>
                <pre class="block-text">{{ message.content }}</pre>
              </div>
            </details>
          </section>
        </template>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import { bureausAPI } from '../../services/bureauApi';
import { formatDateTime, formatDuration, formatUsage } from '../../composables/bureau/format';

const props = defineProps({
  bureauId: { type: String, required: true },
  /** The turn below this seam; absent for a turn still being written. */
  turn: { type: Object, default: null },
  castById: { type: Object, default: () => ({}) },
  /** Live progress ({ status, reasoning }) while the turn below is being written. */
  live: { type: Object, default: null },
});

const STATUS_LABELS = {
  completed: 'Written',
  cancelled: 'Stopped early',
  failed: 'Failed',
  running: 'Still writing',
};

const open = ref(false);
const run = ref(null);
const loadingRun = ref(false);
const runError = ref('');

const authorName = computed(() => props.castById[props.turn?.authorCastId]?.name ?? null);

const label = computed(() => {
  if (props.live) return props.live.status;
  if (!props.turn) return '';
  if (props.turn.source === 'generated') return 'How this was written';
  if (props.turn.kind === 'direction') return 'Your direction';
  if (props.turn.kind === 'scene_break') return 'Scene break';
  return authorName.value ? `Written by ${authorName.value}` : 'Written by you';
});

const readerMeta = computed(() => {
  const parts = [label.value, formatDateTime(props.turn.created)];
  if (props.turn.edited) parts.push('edited');
  return parts.join(' · ');
});

const runMeta = computed(() => {
  const parts = [
    STATUS_LABELS[run.value.status] ?? run.value.status,
    formatDateTime(run.value.started),
  ];
  if (authorName.value) parts.push(`centered on ${authorName.value}`);
  if (props.turn.edited) parts.push('edited afterward');
  return parts.join(' · ');
});

function stepLabel(step) {
  const role = step.role.charAt(0).toUpperCase() + step.role.slice(1);
  return step.kind === 'tool' ? `${role} · ${step.request?.name ?? 'tool'}` : role;
}

function stepSettings(step) {
  const request = step.request;
  if (step.kind !== 'model' || !request?.model) return '';
  const mode = request.thinking
    ? `thinking (${request.reasoningEffort} effort)`
    : `temperature ${request.temperature}`;
  return `${request.model} · ${mode} · up to ${request.maxTokens} tokens`;
}

async function loadRun() {
  if (!props.turn?.runId) {
    runError.value = 'There is no record of how this was written.';
    return;
  }
  loadingRun.value = true;
  runError.value = '';
  try {
    const data = await bureausAPI.getRun(props.bureauId, props.turn.runId);
    run.value = data.run;
  } catch (error) {
    runError.value = `Couldn't load the record: ${error.message}`;
  } finally {
    loadingRun.value = false;
  }
}

function toggle() {
  open.value = !open.value;
  if (open.value && !props.live && props.turn?.source === 'generated' && !run.value) {
    loadRun();
  }
}

// While a turn is written, the label carries the live status; close once it's done.
watch(
  () => Boolean(props.live),
  (isLive) => {
    if (!isLive) open.value = false;
  },
);

// A different version has a different run.
watch(
  () => props.turn?.runId,
  () => {
    run.value = null;
    if (open.value && !props.live && props.turn?.source === 'generated') {
      loadRun();
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

.seam-error {
  margin: 0;
  color: var(--danger);
}

.seam-step {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-color);
}

.step-header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  color: var(--text-secondary);
}

.step-role {
  font-weight: 600;
  color: var(--text-primary);
}

.seam-details summary {
  cursor: pointer;
  color: var(--text-secondary);
  font-weight: 600;
}

.seam-block {
  margin-top: 0.375rem;
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
