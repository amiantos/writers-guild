<template>
  <div class="chat-page">
    <header class="chat-header">
      <div class="header-left">
        <button class="btn btn-secondary btn-small" @click="backToChats">
          <i class="fas fa-arrow-left"></i>
          <span class="action-label">Chats</span>
        </button>
        <div class="header-avatars">
          <template v-for="character in chatCharacters.slice(0, 3)" :key="character.id">
            <img
              v-if="character.thumbnailUrl"
              class="avatar"
              :src="character.thumbnailUrl"
              :alt="character.name"
            />
            <span v-else class="avatar avatar-placeholder"><i class="fas fa-user"></i></span>
          </template>
        </div>
        <h1 class="chat-title">{{ chat?.title || 'Chat' }}</h1>
      </div>
      <div v-if="chat" class="header-right">
        <button
          v-if="lastPrompt"
          class="icon-btn"
          title="View the last prompt sent"
          @click="showPrompt = true"
        >
          <i class="fas fa-code"></i>
        </button>
        <button class="btn btn-secondary btn-small" :disabled="sending" @click="showSetup = true">
          <i class="fas fa-sliders"></i>
          <span class="action-label">Edit chat</span>
        </button>
      </div>
    </header>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>Loading chat...</p>
    </div>

    <div v-else-if="loadError" class="loading-container">
      <p>{{ loadError }}</p>
      <button class="btn btn-secondary" @click="backToChats">Back to Chats</button>
    </div>

    <template v-else>
      <main ref="listRef" class="chat-reading">
        <div class="chat-column">
          <button
            class="scenario-card"
            :class="{ empty: !chat.scenario }"
            :disabled="sending"
            title="Edit the scenario"
            @click="showSetup = true"
          >
            <span class="scenario-label"><i class="fas fa-clapperboard"></i> Scenario</span>
            <span class="scenario-text">{{
              scenarioText || 'No scenario yet. Describe one to set the scene.'
            }}</span>
          </button>

          <p v-if="turns.length === 0 && !pending" class="chat-empty">
            Nothing yet. Send the first message, or let {{ speakerLabel }} write first.
          </p>

          <section
            v-for="(turn, index) in visibleTurns"
            :key="turn.id"
            class="turn"
            :class="turn.source === 'user' ? 'from-user' : 'from-character'"
          >
            <div v-if="showsSender(visibleTurns, index, isGroup)" class="sender">
              {{ senderName(turn) }}
            </div>
            <ChatBubble
              v-for="(message, messageIndex) in turn.messages"
              :key="`${turn.id}-${turn.activeSwipe}-${messageIndex}`"
              :content="message"
              :from-user="turn.source === 'user'"
              :busy="sending"
              @save="saveMessage(turn, messageIndex, $event)"
              @delete="deleteMessage(turn, messageIndex)"
            />
            <div v-if="turn.source === 'character'" class="turn-tools">
              <template v-if="turn.swipes.length > 1">
                <button
                  class="icon-btn"
                  title="Previous version"
                  :disabled="sending || turn.activeSwipe === 0"
                  @click="setSwipe(turn, turn.activeSwipe - 1)"
                >
                  <i class="fas fa-chevron-left"></i>
                </button>
                <span class="swipe-count">{{ turn.activeSwipe + 1 }}/{{ turn.swipes.length }}</span>
                <button
                  class="icon-btn"
                  title="Next version"
                  :disabled="sending || turn.activeSwipe === turn.swipes.length - 1"
                  @click="setSwipe(turn, turn.activeSwipe + 1)"
                >
                  <i class="fas fa-chevron-right"></i>
                </button>
              </template>
              <button
                v-if="turn.id === lastTurn?.id"
                class="icon-btn"
                title="Write another version of this reply"
                :disabled="sending"
                @click="regenerate(turn)"
              >
                <i class="fas fa-rotate-right"></i>
              </button>
              <button
                v-if="showReasoning && turn.swipes[turn.activeSwipe]?.reasoning"
                class="icon-btn"
                :class="{ active: openReasoning.has(turn.id) }"
                title="Show the model's reasoning"
                @click="toggleReasoning(turn.id)"
              >
                <i class="fas fa-brain"></i>
              </button>
            </div>
            <pre v-if="showReasoning && openReasoning.has(turn.id)" class="reasoning">{{
              turn.swipes[turn.activeSwipe]?.reasoning
            }}</pre>
          </section>

          <section v-if="pending" class="turn from-character">
            <div v-if="isGroup && pending.speakerName" class="sender">
              {{ pending.speakerName }}
            </div>
            <pre v-if="showReasoning && pending.reasoning" class="reasoning live">{{
              pending.reasoning
            }}</pre>
            <div v-for="(part, index) in pendingParts" :key="index" class="pending-bubble">
              {{ part }}
            </div>
            <p v-if="pendingParts.length === 0" class="pending-bubble typing">
              {{ pending.status }}
            </p>
          </section>
        </div>
      </main>

      <div class="chat-composer">
        <p v-if="chatCharacters.length === 0" class="composer-warning">
          <i class="fas fa-user-plus"></i> This chat has no characters. Add one in Edit chat.
        </p>
        <div class="composer-row">
          <textarea
            ref="inputRef"
            v-model="text"
            class="composer-input"
            rows="2"
            :disabled="sending || !canWrite"
            :placeholder="isGroup ? 'Message the group...' : `Message ${speakerLabel}...`"
            aria-label="Message"
            @keydown="handleKeydown"
          ></textarea>
          <div class="composer-actions">
            <select
              v-if="isGroup"
              v-model="replyFrom"
              class="select-input reply-from"
              :disabled="sending"
              aria-label="Who replies"
              title="Who replies. Auto picks someone you named, or whoever spoke last."
            >
              <option :value="null">Auto</option>
              <option v-for="character in chatCharacters" :key="character.id" :value="character.id">
                {{ character.name }}
              </option>
            </select>
            <template v-if="!sending">
              <button
                class="btn btn-secondary"
                :title="`Let ${speakerLabel} write without a new message from you`"
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

    <ChatSetupModal v-if="showSetup" :chat="chat" @close="showSetup = false" @saved="handleSaved" />
    <ViewPromptModal
      v-if="showPrompt"
      :system-prompt="lastPrompt?.system"
      :user-prompt="lastPrompt?.user"
      @close="showPrompt = false"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { chatsAPI } from '../services/chatsApi';
import { settingsAPI } from '../services/api';
import { useDataCache } from '../composables/useDataCache';
import { useToast } from '../composables/useToast';
import { useConfirm } from '../composables/useConfirm';
import { setPageTitle } from '../router';
import { describeQueue, showsSender, splitReply } from '../composables/chatMessages';
import ChatBubble from '../components/chat/ChatBubble.vue';
import ChatSetupModal from '../components/chat/ChatSetupModal.vue';
import ViewPromptModal from '../components/ViewPromptModal.vue';

const props = defineProps({
  chatId: { type: String, required: true },
});

const router = useRouter();
const toast = useToast();
const { confirm } = useConfirm();
const { characters, loadCharacters } = useDataCache();

const chat = ref(null);
const turns = ref([]);
const loading = ref(true);
const loadError = ref('');
const showReasoning = ref(false);
const openReasoning = reactive(new Set());

const text = ref('');
const replyFrom = ref(null);
const sending = ref(false);
const pending = ref(null);
const lastPrompt = ref(null);
let abortController = null;

const listRef = ref(null);
const inputRef = ref(null);
const showSetup = ref(false);
const showPrompt = ref(false);

const chatCharacters = computed(() =>
  (chat.value?.characterIds ?? [])
    .map((id) => characters.value.find((character) => character.id === id))
    .filter(Boolean),
);
const isGroup = computed(() => (chat.value?.characterIds.length ?? 0) > 1);
const canWrite = computed(() => (chat.value?.characterIds.length ?? 0) > 0);
const lastTurn = computed(() => turns.value.at(-1) ?? null);
// While a reply is regenerated, the version it replaces is hidden.
const visibleTurns = computed(() =>
  pending.value?.regenerating
    ? turns.value.filter((turn) => turn.id !== pending.value.regenerating)
    : turns.value,
);
const pendingParts = computed(() => (pending.value ? splitReply(pending.value.content) : []));
const speakerLabel = computed(() => {
  if (replyFrom.value) {
    return chatCharacters.value.find((character) => character.id === replyFrom.value)?.name;
  }
  return isGroup.value ? 'someone' : (chatCharacters.value[0]?.name ?? 'them');
});

const personaName = computed(
  () =>
    characters.value.find((character) => character.id === chat.value?.personaCharacterId)?.name ??
    'User',
);
// The scenario as replies read it. In a group, {{char}} is whoever's replying, so it stays.
const scenarioText = computed(() => {
  let scenario = (chat.value?.scenario ?? '').replace(/\{\{user\}\}/gi, personaName.value);
  if (!isGroup.value && chatCharacters.value[0]) {
    scenario = scenario.replace(/\{\{char\}\}/gi, chatCharacters.value[0].name);
  }
  return scenario;
});

function senderName(turn) {
  return (
    characters.value.find((character) => character.id === turn.characterId)?.name ?? turn.senderName
  );
}

// ==================== Loading ====================

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const [data, settingsData] = await Promise.all([
      chatsAPI.get(props.chatId),
      settingsAPI.get().catch(() => ({ settings: {} })),
      loadCharacters(),
    ]);
    chat.value = data.chat;
    turns.value = data.turns;
    showReasoning.value = Boolean(settingsData.settings?.showReasoning);
    setPageTitle(chat.value.title);
  } catch (error) {
    loadError.value =
      error.status === 404 ? 'This chat no longer exists.' : `Failed to load: ${error.message}`;
  } finally {
    loading.value = false;
  }
  scrollToEnd();
}

async function refresh() {
  try {
    const data = await chatsAPI.get(props.chatId);
    chat.value = data.chat;
    turns.value = data.turns;
  } catch (error) {
    toast.error(`Failed to refresh the chat: ${error.message}`);
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
 * Stream a reply. `start` receives the abort signal and returns the event stream. The chat is
 * reloaded afterward so it matches what the server saved.
 */
async function runReply(start, { composerText = '', regenerating = null } = {}) {
  if (sending.value) return;

  abortController = new AbortController();
  sending.value = true;
  pending.value = {
    status: 'Typing...',
    content: '',
    reasoning: '',
    speakerName: '',
    regenerating,
  };
  let messageSaved = false;
  let stopped = false;

  try {
    for await (const event of start(abortController.signal)) {
      if (event.type === 'turn') {
        messageSaved = true;
        turns.value = [...turns.value, event.turn];
      } else if (event.type === 'speaker') {
        pending.value.speakerName = event.name;
        pending.value.status = `${event.name} is typing...`;
      } else if (event.type === 'prompt') {
        lastPrompt.value = { system: event.system, user: event.user };
      } else if (event.type === 'queue') {
        pending.value.status = describeQueue(event);
      } else if (event.type === 'reasoning') {
        pending.value.reasoning += event.text;
        pending.value.status = 'Thinking...';
      } else if (event.type === 'content') {
        pending.value.content += event.text;
      } else if (event.type === 'done') {
        if (event.chat) chat.value = event.chat;
      }
      scrollToEnd();
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      stopped = true;
      toast.info('Stopped. Anything already written was kept.');
    } else {
      toast.error(`The reply failed: ${error.message}`);
      // Nothing was saved, so give the user their words back.
      if (!messageSaved && composerText) {
        text.value = composerText;
      }
    }
  } finally {
    sending.value = false;
    pending.value = null;
    abortController = null;
  }

  await refresh();
  scrollToEnd();
  if (stopped) {
    // The server saves the partial reply once it notices the disconnect.
    setTimeout(refresh, 1000);
  }
  inputRef.value?.focus();
}

function send() {
  const message = text.value.trim();
  if (!message || !canWrite.value || sending.value) return;
  text.value = '';
  runReply(
    (signal) => chatsAPI.send(props.chatId, message, { characterId: replyFrom.value, signal }),
    { composerText: message },
  );
}

function nudge() {
  if (!canWrite.value) return;
  runReply((signal) => chatsAPI.reply(props.chatId, { characterId: replyFrom.value, signal }));
}

function regenerate(turn) {
  runReply((signal) => chatsAPI.regenerate(props.chatId, turn.id, { signal }), {
    regenerating: turn.id,
  });
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

function replaceTurn(updated) {
  turns.value = turns.value.map((turn) => (turn.id === updated.id ? updated : turn));
}

async function setSwipe(turn, index) {
  try {
    const { turn: updated } = await chatsAPI.setSwipe(props.chatId, turn.id, index);
    replaceTurn(updated);
  } catch (error) {
    toast.error(`Failed to switch versions: ${error.message}`);
  }
}

async function saveMessage(turn, index, content) {
  try {
    const { turn: updated } = await chatsAPI.editMessage(props.chatId, turn.id, index, content);
    replaceTurn(updated);
  } catch (error) {
    toast.error(`Failed to save the edit: ${error.message}`);
  }
}

async function deleteMessage(turn, index) {
  const confirmed = await confirm({
    message: 'Delete this message?',
    confirmText: 'Delete',
    variant: 'danger',
  });
  if (!confirmed) return;

  try {
    const { turn: updated } = await chatsAPI.deleteMessage(props.chatId, turn.id, index);
    if (updated) {
      replaceTurn(updated);
    } else {
      turns.value = turns.value.filter((item) => item.id !== turn.id);
    }
  } catch (error) {
    toast.error(`Failed to delete: ${error.message}`);
  }
}

function toggleReasoning(turnId) {
  if (openReasoning.has(turnId)) {
    openReasoning.delete(turnId);
  } else {
    openReasoning.add(turnId);
  }
}

// ==================== Setup ====================

function handleSaved(updated) {
  chat.value = updated;
  showSetup.value = false;
  if (replyFrom.value && !updated.characterIds.includes(replyFrom.value)) {
    replyFrom.value = null;
  }
  setPageTitle(updated.title);
}

function backToChats() {
  router.push({ name: 'home' });
}

onMounted(load);
onBeforeUnmount(() => {
  abortController?.abort();
});
</script>

<style scoped src="../components/chat/chat-ui.css"></style>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background-color: var(--bg-secondary);
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1.5rem;
  background-color: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  box-shadow: var(--shadow);
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.header-avatars {
  display: flex;
  flex-shrink: 0;
}

.header-avatars .avatar {
  width: 2.25rem;
  height: 2.25rem;
  border: 2px solid var(--bg-primary);
}

.header-avatars .avatar + .avatar {
  margin-left: -0.75rem;
}

.chat-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.chat-reading {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.chat-column {
  max-width: 760px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.scenario-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 100%;
  padding: 0.75rem 1rem;
  text-align: left;
  font: inherit;
  color: var(--text-primary);
  background-color: var(--bg-primary);
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  cursor: pointer;
}

.scenario-card:hover:not(:disabled) {
  border-color: var(--accent-primary);
}

.scenario-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.scenario-text {
  font-size: 0.9rem;
  line-height: 1.5;
  white-space: pre-wrap;
}

.scenario-card.empty .scenario-text {
  color: var(--text-secondary);
  font-style: italic;
}

.chat-empty {
  color: var(--text-secondary);
  text-align: center;
}

.turn {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
}

.sender {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  padding-left: 0.5rem;
}

.turn-tools {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.turn-tools .icon-btn.active {
  color: var(--accent-primary);
}

.swipe-count {
  min-width: 2.25rem;
  text-align: center;
}

.reasoning {
  max-width: min(36rem, 80%);
  max-height: 16rem;
  overflow-y: auto;
  margin: 0;
  padding: 0.5rem 0.75rem;
  font-family: inherit;
  font-size: 0.8rem;
  line-height: 1.45;
  white-space: pre-wrap;
  color: var(--text-secondary);
  background-color: var(--bg-tertiary);
  border-radius: 6px;
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

.chat-composer {
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
  align-items: center;
  gap: 0.5rem;
}

.reply-from {
  width: auto;
  max-width: 10rem;
}

@media (max-width: 700px) {
  .chat-header,
  .chat-reading,
  .chat-composer {
    padding-left: 0.75rem;
    padding-right: 0.75rem;
  }

  .action-label {
    display: none;
  }

  .composer-row {
    flex-direction: column;
    align-items: stretch;
  }

  .composer-actions {
    justify-content: flex-end;
  }
}
</style>
