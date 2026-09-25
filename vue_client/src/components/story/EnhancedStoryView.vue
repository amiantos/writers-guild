<template>
  <main ref="readingRef" class="story-reading">
    <div class="story-column">
      <p v-if="blocks.length === 0 && !pending" class="story-empty">
        This story hasn't started. Write the opening yourself, open with a character's greeting, or
        press Start Story and the model will set the scene.
      </p>

      <template v-for="(block, index) in blocks" :key="block.key">
        <PassageSeam :passage="block.record" />
        <PassageBlock
          :block="block"
          :busy="busy"
          :can-regenerate="canRegenerate(block, index)"
          @save="(target, text) => $emit('save', target, text)"
          @regenerate="$emit('regenerate', $event)"
          @delete="$emit('delete', $event)"
        />
      </template>

      <div v-if="pending" ref="pendingRef">
        <PassageSeam
          :live="pending"
          :live-reasoning="reasoning"
          :open-on-reasoning="showReasoning"
        />
        <article class="pending-turn">
          <div v-if="pending.text" class="prose" v-html="renderProse(pending.text)"></div>
          <p v-else class="pending-placeholder">{{ pending.status }}</p>
        </article>
      </div>
    </div>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { splitPassages } from '../../composables/storyPassages';
import { renderProse } from '../../composables/bureau/renderProse';
import { followScroll } from '../../composables/bureau/followScroll';
import PassageSeam from './PassageSeam.vue';
import PassageBlock from './PassageBlock.vue';

const props = defineProps({
  content: { type: String, default: '' },
  /** The record of the story's passages. */
  passages: { type: Array, default: () => [] },
  /**
   * The passage being written ({ start, text, status, action, characterName, instruction }):
   * where it starts in the content, and what's streamed in so far.
   */
  pending: { type: Object, default: null },
  /** The live reasoning of the passage being written. */
  reasoning: { type: String, default: '' },
  /** Open the live seam when reasoning streams in, from the Show reasoning panel setting. */
  showReasoning: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
});

defineEmits(['save', 'regenerate', 'delete']);

// Reading-area events that mean the reader has taken over scrolling from a generation.
const READER_SCROLL_EVENTS = ['wheel', 'touchmove', 'pointerdown', 'keydown'];

// What another version can be written for: the same request, sent again.
const REGENERABLE_ACTIONS = new Set(['continue', 'character', 'instruction']);

const readingRef = ref(null);
const pendingRef = ref(null);

// The story up to the passage being written, which shows on its own below it.
const settledContent = computed(() =>
  props.pending ? props.content.slice(0, props.pending.start) : props.content,
);
const blocks = computed(() => splitPassages(settledContent.value, props.passages));

/**
 * Only the last passage can be written again, since story mode writes at the end. A story starter
 * can, while it's all there is, since it writes the whole story.
 */
function canRegenerate(block, index) {
  const record = block.record;
  if (index !== blocks.value.length - 1 || record?.source !== 'generated') return false;
  return (
    REGENERABLE_ACTIONS.has(record.action) ||
    (record.action === 'starter' && blocks.value.length === 1)
  );
}

// ==================== Scrolling ====================

function isNearBottom() {
  const element = readingRef.value;
  return !element || element.scrollHeight - element.scrollTop - element.clientHeight < 200;
}

async function scrollToEnd() {
  await nextTick();
  if (readingRef.value) {
    readingRef.value.scrollTop = readingRef.value.scrollHeight;
  }
}

/**
 * Follow the passage as it streams in, until its seam reaches the top of the reading area (see
 * followScroll). Returns whether to keep following.
 */
async function followPending() {
  await nextTick();
  const container = readingRef.value;
  const anchor = pendingRef.value;
  if (!container || !anchor) return true;

  const { scrollTop, following } = followScroll({
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
    anchorTop:
      anchor.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop,
  });
  container.scrollTop = scrollTop;
  return following;
}

let following = false;
const stopFollowing = () => {
  following = false;
};

function listenForReader(listen) {
  for (const type of READER_SCROLL_EVENTS) {
    if (listen) {
      readingRef.value?.addEventListener(type, stopFollowing, { passive: true });
    } else {
      readingRef.value?.removeEventListener(type, stopFollowing);
    }
  }
}

// Follow a new passage only if the reader was already at the end, and only until they scroll.
watch(
  () => Boolean(props.pending),
  (isPending) => {
    following = isPending && isNearBottom();
    listenForReader(isPending);
    if (following) followPending();
  },
);

watch([() => props.pending?.text, () => props.reasoning], async () => {
  if (following && !(await followPending())) following = false;
});

onMounted(scrollToEnd);
onBeforeUnmount(() => listenForReader(false));

defineExpose({ scrollToEnd });
</script>

<style scoped>
.story-reading {
  flex: 1;
  overflow-y: auto;
  background-color: var(--bg-primary);
  box-shadow: var(--shadow);
}

.story-column {
  max-width: 700px;
  margin: 0 auto;
  padding: 2rem 2rem 3rem;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 1rem;
  line-height: 1.8;
  color: var(--text-primary);
}

.story-empty {
  color: var(--text-secondary);
  font-style: italic;
  text-align: center;
  margin: 3rem 0;
}

.pending-turn .prose :deep(p) {
  margin: 0 0 1em;
}

.pending-turn .prose :deep(.story-image) {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  height: auto;
  margin: 1rem auto;
  border-radius: 8px;
  object-fit: contain;
}

.pending-placeholder {
  margin: 0;
  color: var(--text-secondary);
  font-style: italic;
}

@media (max-width: 700px) {
  .story-column {
    padding: 1.25rem 1rem 2rem;
  }
}
</style>
