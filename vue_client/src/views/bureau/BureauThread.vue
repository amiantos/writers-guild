<template>
  <div class="bureau-thread-page">
    <header class="thread-header">
      <div class="header-left">
        <button class="btn btn-secondary btn-small back-button" @click="backToBureau">
          <i class="fas fa-arrow-left"></i>
          <span class="back-label">{{ bureau?.name || 'Bureau' }}</span>
        </button>
        <img
          v-if="castMember?.libraryCharacterId && !brokenAvatar"
          class="thread-avatar"
          :src="`/api/characters/${castMember.libraryCharacterId}/thumbnail`"
          alt=""
          @error="brokenAvatar = true"
        />
        <h1 class="thread-title">{{ castMember?.name || 'Messages' }}</h1>
      </div>
      <div class="header-right">
        <button
          v-if="castMember"
          class="icon-btn"
          :title="`${castMember.name}'s profile`"
          @click="showProfile = true"
        >
          <i class="fas fa-id-card"></i>
        </button>
        <button
          v-if="bureau?.hasApiKey && hasUnarchived"
          class="btn btn-secondary btn-small"
          :disabled="archiving || sending"
          title="The Archivist reads the messages it hasn't read yet into memory"
          @click="commitToMemory"
        >
          <i class="fas fa-brain"></i>
          <span class="action-label">{{ archiving ? 'Committing...' : 'Commit to memory' }}</span>
        </button>
        <template v-if="bureau">
          <span class="thread-clock" title="Bureau time">
            <i class="fas fa-clock"></i> {{ formatDateTime(bureau.bureauTime, bureau.timezone) }}
          </span>
          <TimePassesControl :bureau="bureau" :disabled="sending" @updated="bureau = $event" />
        </template>
      </div>
    </header>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>Loading messages...</p>
    </div>

    <div v-else-if="loadError" class="loading-container">
      <p>{{ loadError }}</p>
      <button class="btn btn-secondary" @click="backToBureau">Back to the Bureau</button>
    </div>

    <template v-else>
      <main ref="listRef" class="thread-reading">
        <div class="thread-column">
          <p v-if="messages.length === 0 && !pending" class="thread-empty">
            Nothing yet. Write to {{ castMember.name }}, or let them write first.
          </p>

          <section v-for="session in sessions" :key="session.messages[0].id" class="thread-session">
            <div class="session-time">{{ formatDateTime(session.startTime, bureau.timezone) }}</div>
            <template v-for="(message, index) in session.messages" :key="message.id">
              <TurnSeam
                v-if="startsReply(session.messages, index)"
                :bureau-id="bureauId"
                :turn="message"
              />
              <MessageBubble
                :message="message"
                :busy="sending"
                @save="saveMessage"
                @delete="deleteMessage"
              />
            </template>
          </section>

          <div v-if="pending" class="thread-session">
            <TurnSeam :bureau-id="bureauId" :live="pending" />
            <div v-for="(part, index) in pendingParts" :key="index" class="pending-bubble">
              {{ part }}
            </div>
            <p v-if="pendingParts.length === 0" class="pending-bubble typing">
              {{ pending.status }}
            </p>
          </div>
        </div>
      </main>

      <div class="thread-composer">
        <p v-if="!hasPersona" class="composer-warning">
          <i class="fas fa-user"></i> Choose a reader's character in the Bureau's cast to write to
          {{ castMember.name }}.
        </p>
        <p v-else-if="!bureau.hasApiKey" class="composer-warning">
          <i class="fas fa-key"></i> This Bureau has no API key. Add one in the Bureau's settings
          for {{ castMember.name }} to reply.
        </p>
        <div class="composer-row">
          <textarea
            ref="inputRef"
            v-model="text"
            class="composer-input"
            rows="2"
            :disabled="sending || !canWrite"
            :placeholder="`Message ${castMember.name}...`"
            :aria-label="`Message ${castMember.name}`"
            @keydown="handleKeydown"
          ></textarea>
          <div class="composer-actions">
            <template v-if="!sending">
              <button
                class="btn btn-secondary"
                :title="`Let ${castMember.name} write without a new message from you`"
                :disabled="!canWrite"
                @click="nudge"
              >
                <i class="fas fa-comment-dots"></i>
                <span class="action-label">Let them write</span>
              </button>
              <button
                class="btn btn-primary"
                title="Send (Enter). Shift + Enter starts a new line."
                :disabled="!canWrite || !text.trim()"
                @click="send"
              >
                <i class="fas fa-paper-plane"></i> Send
              </button>
            </template>
            <button v-else class="btn btn-danger" @click="stop">
              <i class="fas fa-stop"></i> Stop
            </button>
          </div>
        </div>
      </div>
    </template>

    <ProfileModal
      v-if="showProfile"
      :bureau-id="bureauId"
      :cast-id="castId"
      :has-api-key="Boolean(bureau?.hasApiKey)"
      @close="showProfile = false"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { bureausAPI, bureauThreadsAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { setPageTitle } from '../../router';
import { formatDateTime } from '../../composables/bureau/format';
import { describeArchive } from '../../composables/bureau/memories';
import { groupSessions, splitReply } from '../../composables/bureau/messages';
import TurnSeam from '../../components/bureau/TurnSeam.vue';
import MessageBubble from '../../components/bureau/MessageBubble.vue';
import TimePassesControl from '../../components/bureau/TimePassesControl.vue';
import ProfileModal from '../../components/bureau/ProfileModal.vue';

const props = defineProps({
  bureauId: { type: String, required: true },
  castId: { type: String, required: true },
});

const router = useRouter();
const toast = useToast();
const { confirm } = useConfirm();

const bureau = ref(null);
const castMember = ref(null);
const thread = ref(null);
const messages = ref([]);
const archiving = ref(false);
const hasPersona = ref(false);
const loading = ref(true);
const loadError = ref('');

const text = ref('');
const sending = ref(false);
const pending = ref(null);
let abortController = null;

const listRef = ref(null);
const inputRef = ref(null);
const brokenAvatar = ref(false);
const showProfile = ref(false);

const sessions = computed(() => groupSessions(messages.value));
const pendingParts = computed(() => (pending.value ? splitReply(pending.value.content) : []));
const canWrite = computed(() => hasPersona.value && Boolean(bureau.value?.hasApiKey));
// Messages the Archivist hasn't read yet.
const hasUnarchived = computed(() =>
  messages.value.some((message) => message.position > (thread.value?.archivedThrough ?? -1)),
);

/** Whether a message starts a reply, so its seam shows how the reply was written. */
function startsReply(sessionMessages, index) {
  const message = sessionMessages[index];
  if (message.source !== 'generated') return false;
  const previous = sessionMessages[index - 1];
  return !previous || previous.source !== 'generated' || previous.runId !== message.runId;
}

// ==================== Loading ====================

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const [threadData, castData] = await Promise.all([
      bureauThreadsAPI.get(props.bureauId, props.castId),
      bureausAPI.listCast(props.bureauId),
    ]);
    bureau.value = threadData.bureau;
    castMember.value = threadData.castMember;
    thread.value = threadData.thread;
    messages.value = threadData.messages;
    hasPersona.value = castData.cast.some((member) => member.isPersona);
    setPageTitle(`Messages with ${castMember.value.name}`);
  } catch (error) {
    console.error('Failed to load messages:', error);
    loadError.value =
      error.status === 404
        ? 'This cast member is no longer in the Bureau.'
        : `Failed to load: ${error.message}`;
  } finally {
    loading.value = false;
  }
  scrollToEnd();
}

async function refreshThread() {
  try {
    const data = await bureauThreadsAPI.get(props.bureauId, props.castId);
    bureau.value = data.bureau;
    thread.value = data.thread;
    messages.value = data.messages;
  } catch (error) {
    toast.error('Failed to refresh messages: ' + error.message);
  }
}

async function commitToMemory() {
  if (archiving.value) return;
  archiving.value = true;
  try {
    const { thread: updated, archive } = await bureauThreadsAPI.archive(
      props.bureauId,
      props.castId,
    );
    thread.value = updated;
    toast.success(describeArchive(archive));
  } catch (error) {
    toast.error('Failed to commit to memory: ' + error.message);
  } finally {
    archiving.value = false;
  }
}

async function scrollToEnd() {
  await nextTick();
  if (listRef.value) {
    listRef.value.scrollTop = listRef.value.scrollHeight;
  }
}

// ==================== Writing ====================

/**
 * Stream a reply. `start` receives the abort signal and returns the event
 * stream. The thread is reloaded afterward so it matches what was saved.
 */
async function runReply(start, { composerText = '' } = {}) {
  if (sending.value) return;

  abortController = new AbortController();
  sending.value = true;
  pending.value = { status: 'Writing...', content: '', reasoning: '', runId: null };
  let messageSaved = false;
  let stopped = false;

  try {
    for await (const event of start(abortController.signal)) {
      if (event.type === 'message') {
        messageSaved = true;
        messages.value = [...messages.value, event.message];
      } else if (event.type === 'run') {
        pending.value.runId = event.runId;
      } else if (event.type === 'stage') {
        pending.value.status =
          event.stage === 'catching-up'
            ? `Catching up with ${castMember.value.name}...`
            : 'Writing...';
      } else if (event.type === 'reasoning') {
        pending.value.reasoning += event.text;
        pending.value.status = 'Thinking...';
      } else if (event.type === 'content') {
        pending.value.content += event.text;
        pending.value.status = 'Writing...';
      }
      scrollToEnd();
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      stopped = true;
      toast.info('Stopped. Anything already written was kept.');
    } else {
      console.error('Reply failed:', error);
      toast.error('The reply failed: ' + error.message);
      // Nothing was saved, so give the reader their words back.
      if (!messageSaved && composerText) {
        text.value = composerText;
      }
    }
  } finally {
    sending.value = false;
    pending.value = null;
    abortController = null;
  }

  await refreshThread();
  scrollToEnd();
  if (stopped) {
    // The server saves the partial reply once it notices the disconnect.
    setTimeout(refreshThread, 1000);
  }
}

function send() {
  const message = text.value.trim();
  if (!message || !canWrite.value || sending.value) return;
  text.value = '';
  runReply((signal) => bureauThreadsAPI.send(props.bureauId, props.castId, message, signal), {
    composerText: message,
  });
}

function nudge() {
  if (!canWrite.value) return;
  runReply((signal) => bureauThreadsAPI.reply(props.bureauId, props.castId, signal));
}

function stop() {
  abortController?.abort();
}

function handleKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}

// ==================== Messages ====================

async function saveMessage(message, content) {
  try {
    const { message: updated } = await bureauThreadsAPI.editMessage(
      props.bureauId,
      props.castId,
      message.id,
      content,
    );
    messages.value = messages.value.map((item) => (item.id === updated.id ? updated : item));
  } catch (error) {
    toast.error('Failed to save the edit: ' + error.message);
  }
}

async function deleteMessage(message) {
  const confirmed = await confirm({
    message: 'Delete this message?',
    confirmText: 'Delete',
    variant: 'danger',
  });
  if (!confirmed) return;

  try {
    await bureauThreadsAPI.deleteMessage(props.bureauId, props.castId, message.id);
    messages.value = messages.value.filter((item) => item.id !== message.id);
  } catch (error) {
    toast.error('Failed to delete: ' + error.message);
  }
}

function backToBureau() {
  router.push({ name: 'bureau', params: { bureauId: props.bureauId } });
}

onMounted(load);
onBeforeUnmount(() => {
  abortController?.abort();
});
</script>

<style scoped src="../../components/bureau/bureau-ui.css"></style>

<style scoped>
.bureau-thread-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background-color: var(--bg-secondary);
}

.thread-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background-color: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  box-shadow: var(--shadow);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.thread-avatar {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  object-fit: cover;
}

.thread-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.thread-clock {
  font-size: 0.8rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 1rem;
  color: var(--text-secondary);
}

.thread-reading {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.thread-column {
  max-width: 760px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.thread-empty {
  color: var(--text-secondary);
  text-align: center;
}

.thread-session {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.session-time {
  align-self: center;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.pending-bubble {
  align-self: flex-start;
  max-width: min(36rem, 80%);
  margin: 0;
  padding: 0.5rem 0.875rem;
  border-radius: 1rem;
  border-bottom-left-radius: 0.25rem;
  line-height: 1.45;
  white-space: pre-wrap;
  background-color: var(--bg-primary);
  border: 1px dashed var(--border-color);
}

.pending-bubble.typing {
  color: var(--text-secondary);
  font-style: italic;
}

.thread-composer {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem 1rem;
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
}

.composer-warning {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  font-size: 0.85rem;
  color: var(--warning);
}

.composer-row {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  display: flex;
  align-items: flex-end;
  gap: 0.625rem;
}

.composer-input {
  flex: 1;
  box-sizing: border-box;
  padding: 0.625rem 0.875rem;
  font: inherit;
  line-height: 1.5;
  color: var(--text-primary);
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  resize: vertical;
  outline: none;
}

.composer-input:focus {
  border-color: var(--accent-primary);
}

.composer-actions {
  display: flex;
  gap: 0.5rem;
}

@media (max-width: 700px) {
  .thread-header,
  .thread-reading,
  .thread-composer {
    padding-left: 0.75rem;
    padding-right: 0.75rem;
  }

  .back-label,
  .action-label {
    display: none;
  }

  .composer-row {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
