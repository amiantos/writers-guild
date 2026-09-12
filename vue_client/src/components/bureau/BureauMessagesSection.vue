<template>
  <section class="edit-section">
    <div class="section-header">
      <h2><i class="fas fa-comments"></i> Messages</h2>
    </div>

    <div class="section-content">
      <div v-if="loading" class="loading">Loading messages...</div>
      <p v-else-if="!personaId" class="empty-hint">
        Choose a reader's character in the cast to write to the others between stories.
      </p>
      <p v-else-if="correspondents.length === 0" class="empty-hint">
        Add someone else to the cast to write to them.
      </p>
      <ul v-else class="thread-list">
        <li v-for="{ castMember, thread } in correspondents" :key="castMember.id">
          <button class="thread-row" @click="$emit('open', castMember)">
            <span class="thread-name">{{ castMember.name }}</span>
            <span v-if="thread?.lastMessage" class="thread-time">
              {{ formatDateTime(thread.lastMessage.bureauTime, bureau.timezone) }}
            </span>
            <span class="thread-preview">{{ preview(thread) }}</span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup>
import { onMounted, ref, watch } from 'vue';
import { bureauThreadsAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import { formatDateTime } from '../../composables/bureau/format';

const PREVIEW_CHARACTERS = 120;

const props = defineProps({
  bureau: { type: Object, required: true },
  /** The cast, so the list follows changes to who is in it and who the reader is. */
  cast: { type: Array, required: true },
});

defineEmits(['open']);
const toast = useToast();

const correspondents = ref([]);
const personaId = ref(null);
const loading = ref(true);

function preview(thread) {
  const last = thread?.lastMessage;
  if (!last) return 'No messages yet';
  const content =
    last.content.length > PREVIEW_CHARACTERS
      ? `${last.content.slice(0, PREVIEW_CHARACTERS).trimEnd()}…`
      : last.content;
  return last.source === 'user' ? `You: ${content}` : content;
}

async function load() {
  try {
    const data = await bureauThreadsAPI.list(props.bureau.id);
    correspondents.value = data.correspondents;
    personaId.value = data.personaId;
  } catch (error) {
    toast.error('Failed to load messages: ' + error.message);
  } finally {
    loading.value = false;
  }
}

watch(() => props.cast, load);
onMounted(load);
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.thread-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.thread-row {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.25rem 1rem;
  padding: 0.75rem 1rem;
  text-align: left;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  transition: border-color 0.2s;
}

.thread-row:hover,
.thread-row:focus-visible {
  border-color: var(--accent-primary);
  outline: none;
}

.thread-name {
  font-weight: 600;
}

.thread-time {
  font-size: 0.75rem;
  color: var(--text-secondary);
  align-self: center;
}

.thread-preview {
  grid-column: 1 / -1;
  font-size: 0.85rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
