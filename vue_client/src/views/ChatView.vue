<template>
  <div class="chat-page">
    <!-- Header -->
    <header class="editor-header">
      <div class="header-left">
        <button class="btn btn-secondary btn-small" @click="backToChats">
          <i class="fas fa-arrow-left"></i> Back
        </button>
        <h1 class="chat-title">{{ chat?.title || 'Loading...' }}</h1>
      </div>
      <div class="header-right">
        <button
          class="icon-btn"
          :disabled="!chat || sending"
          title="Manage Characters"
          @click="showManageCharacters = true"
        >
          <i class="fas fa-user"></i>
        </button>
        <button
          class="icon-btn"
          :disabled="!chat || sending"
          title="Manage Lorebooks"
          @click="showManageLorebooks = true"
        >
          <i class="fas fa-book"></i>
        </button>
        <button
          class="icon-btn"
          :disabled="!chat || sending"
          title="Edit Chat"
          @click="openEditChat(false)"
        >
          <i class="fas fa-pencil"></i>
        </button>
        <button
          class="icon-btn"
          :disabled="!chat || sending"
          title="Configuration Preset"
          @click="showPresetSelector = true"
        >
          <i class="fas fa-sliders"></i>
        </button>
        <button
          class="icon-btn"
          :disabled="!chat || sending"
          title="Delete Chat"
          @click="deleteChat"
        >
          <i class="fas fa-trash"></i>
        </button>
        <button class="icon-btn" title="Settings" @click="goToSettings">
          <i class="fas fa-cog"></i>
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

    <div v-else class="editor-content">
      <!-- Reasoning Panel -->
      <ReasoningPanel
        v-if="reasoningPanel"
        :reasoning="reasoningPanel.text"
        @close="reasoningPanel = null"
      />

      <!-- Conversation -->
      <main ref="listRef" class="chat-reading">
        <button
          class="scenario-block"
          :class="{ empty: !chat.scenario }"
          :disabled="sending"
          @click="openEditChat(true)"
        >
          <span class="scenario-label">
            <i class="fas fa-clapperboard"></i> Scenario
            <i class="fas fa-pencil scenario-edit"></i>
          </span>
          <span class="scenario-text">{{
            scenarioText || 'Describe this scenario to set the scene for the texts.'
          }}</span>
        </button>

        <div v-if="chatCharacters.length === 0" class="empty-state">
          <i class="fas fa-user-plus"></i>
          <p>Add characters to start chatting.</p>
          <button class="btn btn-primary" @click="showManageCharacters = true">
            <i class="fas fa-user"></i> Manage Characters
          </button>
        </div>

        <p v-else-if="turns.length === 0 && !pending" class="chat-empty">
          Send the first message, or let {{ nudgeName }} write first.
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
          <div v-if="turn.source === 'character' && hasTurnTools(turn)" class="turn-tools">
            <template v-if="turn.swipes.length > 1">
              <button
                class="turn-tool"
                title="Previous version"
                :disabled="sending || turn.activeSwipe === 0"
                @click="setSwipe(turn, turn.activeSwipe - 1)"
              >
                <i class="fas fa-chevron-left"></i>
              </button>
              <span class="swipe-count">{{ turn.activeSwipe + 1 }}/{{ turn.swipes.length }}</span>
              <button
                class="turn-tool"
                title="Next version"
                :disabled="sending || turn.activeSwipe === turn.swipes.length - 1"
                @click="setSwipe(turn, turn.activeSwipe + 1)"
              >
                <i class="fas fa-chevron-right"></i>
              </button>
            </template>
            <button
              v-if="turn.id === lastTurn?.id"
              class="turn-tool"
              title="Write another version of this reply"
              :disabled="sending"
              @click="regenerate(turn)"
            >
              <i class="fas fa-rotate-right"></i>
            </button>
            <button
              v-if="turnReasoning(turn)"
              class="turn-tool"
              :class="{ active: reasoningPanel?.turnId === turn.id }"
              title="Show the model's reasoning"
              @click="toggleReasoning(turn)"
            >
              <i class="fas fa-brain"></i>
            </button>
          </div>
        </section>

        <section v-if="pending" class="turn from-character">
          <div v-if="isGroup && pending.speakerName" class="sender">
            {{ pending.speakerName }}
          </div>
          <div v-for="(part, index) in pendingParts" :key="index" class="pending-bubble">
            {{ part }}
          </div>
          <div v-if="pendingParts.length === 0" class="typing-bubble" aria-label="Typing">
            <span></span><span></span><span></span>
          </div>
        </section>
      </main>

      <!-- Composer -->
      <div class="chat-composer">
        <div class="composer-inner">
          <div class="message-row">
            <textarea
              ref="inputRef"
              v-model="text"
              class="message-input"
              rows="1"
              :disabled="sending || !canWrite"
              :placeholder="messagePlaceholder"
              aria-label="Message"
              @input="resizeInput"
              @keydown="handleKeydown"
            ></textarea>
            <button
              class="btn btn-primary btn-send"
              title="Send (Enter). Shift + Enter starts a new line."
              :disabled="sending || !canWrite || !text.trim()"
              @click="send"
            >
              <i class="fas fa-paper-plane"></i> Send
            </button>
          </div>

          <!-- Generation Status -->
          <div v-if="sending" class="generating-status">
            <div class="spinner small"></div>
            <span>{{ pending?.status }}</span>
            <button class="btn btn-danger btn-sm stop-button" title="Stop" @click="stop">
              <i class="fas fa-stop"></i> Stop
            </button>
          </div>

          <!-- Toolbar -->
          <div v-else class="toolbar-main-buttons">
            <button class="btn btn-secondary" :disabled="!canWrite" @click="nudge">
              <i class="fas fa-comments"></i>
              {{ isGroup ? 'Let a Character Write' : `Let ${nudgeName} Write` }}
            </button>
            <button
              class="btn btn-secondary"
              :disabled="lastTurn?.source !== 'character'"
              @click="regenerate(lastTurn)"
            >
              <i class="fas fa-rotate-right"></i> Regenerate Reply
            </button>
            <div class="toolbar-icon-group">
              <button
                class="btn btn-secondary icon-btn"
                aria-label="More options"
                @click="showOverflowMenu = !showOverflowMenu"
              >
                <i class="fas fa-ellipsis-vertical" aria-hidden="true"></i>
              </button>
            </div>

            <!-- Overflow Menu -->
            <div v-if="showOverflowMenu" class="overflow-menu" @click="showOverflowMenu = false">
              <button class="overflow-menu-item" @click="openEditChat(true)">
                <i class="fas fa-clapperboard"></i>
                <span>Describe Scenario</span>
              </button>
              <button
                v-if="lastPrompt"
                class="overflow-menu-item"
                @click="showViewPromptModal = true"
              >
                <i class="fas fa-eye"></i>
                <span>View Last Prompt</span>
              </button>
              <button class="overflow-menu-item" :disabled="turns.length === 0" @click="clearChat">
                <i class="fas fa-eraser"></i>
                <span>Clear Chat</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modals -->
    <ManageCharactersModal
      v-if="showManageCharacters"
      :story="chat"
      noun="chat"
      :adapter="characterAdapter"
      @close="showManageCharacters = false"
    />

    <ManageLorebooksModal
      v-if="showManageLorebooks"
      :story="chat"
      noun="chat"
      :adapter="lorebookAdapter"
      @close="showManageLorebooks = false"
    />

    <EditChatModal
      v-if="showEditChat"
      :chat="chat"
      :focus-scenario="editScenarioFirst"
      @close="showEditChat = false"
      @updated="handleChatUpdated"
    />

    <StoryPresetModal
      v-if="showPresetSelector"
      :story-id="chatId"
      :current-preset-id="chat?.configPresetId"
      noun="chat"
      :save-preset="savePreset"
      @close="showPresetSelector = false"
    />

    <CharacterResponseModal
      v-if="showCharacterSelector"
      :characters="chatCharacters"
      prompt="Which character should write?"
      noun="chat"
      @close="showCharacterSelector = false"
      @select="handleCharacterSelected"
    />

    <ViewPromptModal
      v-if="showViewPromptModal"
      :system-prompt="lastPrompt?.system"
      :user-prompt="lastPrompt?.user"
      @close="showViewPromptModal = false"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { chatsAPI } from '../services/chatsApi';
import { settingsAPI } from '../services/api';
import { useDataCache } from '../composables/useDataCache';
import { useToast } from '../composables/useToast';
import { useConfirm } from '../composables/useConfirm';
import { setPageTitle } from '../router';
import { describeQueue, showsSender, splitReply } from '../composables/chatMessages';
import ChatBubble from '../components/chat/ChatBubble.vue';
import EditChatModal from '../components/chat/EditChatModal.vue';
import ReasoningPanel from '../components/ReasoningPanel.vue';
import ManageCharactersModal from '../components/ManageCharactersModal.vue';
import ManageLorebooksModal from '../components/ManageLorebooksModal.vue';
import StoryPresetModal from '../components/StoryPresetModal.vue';
import CharacterResponseModal from '../components/CharacterResponseModal.vue';
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
const shouldShowReasoning = ref(false);
// The reasoning shown in the panel: a saved reply's ({ turnId, text }) or the live one.
const reasoningPanel = ref(null);

const text = ref('');
const sending = ref(false);
const pending = ref(null);
const lastPrompt = ref(null);
let abortController = null;

const listRef = ref(null);
const inputRef = ref(null);
const showManageCharacters = ref(false);
const showManageLorebooks = ref(false);
const showEditChat = ref(false);
const editScenarioFirst = ref(false);
const showPresetSelector = ref(false);
const showCharacterSelector = ref(false);
const showViewPromptModal = ref(false);
const showOverflowMenu = ref(false);

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
const nudgeName = computed(() =>
  isGroup.value ? 'someone' : (chatCharacters.value[0]?.name ?? 'them'),
);
const messagePlaceholder = computed(() => {
  if (!canWrite.value) return 'Add a character to start chatting...';
  return isGroup.value ? 'Message the group...' : `Message ${nudgeName.value}...`;
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

function turnReasoning(turn) {
  return shouldShowReasoning.value ? turn.swipes[turn.activeSwipe]?.reasoning || '' : '';
}

function hasTurnTools(turn) {
  return turn.swipes.length > 1 || turn.id === lastTurn.value?.id || Boolean(turnReasoning(turn));
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
    shouldShowReasoning.value = Boolean(settingsData.settings?.showReasoning);
    setPageTitle(chat.value.title);
    // A new chat starts by picking who's in it, as a story starts with its greeting.
    if (chat.value.characterIds.length === 0 && turns.value.length === 0) {
      showManageCharacters.value = true;
    }
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

function resizeInput() {
  const input = inputRef.value;
  if (!input) return;
  input.style.height = 'auto';
  // scrollHeight leaves out the border, which the border-box height includes.
  const border = input.offsetHeight - input.clientHeight;
  input.style.height = `${Math.min(input.scrollHeight + border, 200)}px`;
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
  showOverflowMenu.value = false;
  pending.value = {
    status: 'Writing...',
    content: '',
    speakerName: '',
    regenerating,
  };
  // Only open when reasoning is actually received, as in story mode.
  reasoningPanel.value = null;
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
        if (shouldShowReasoning.value) {
          reasoningPanel.value = {
            turnId: null,
            text: (reasoningPanel.value?.text ?? '') + event.text,
          };
        }
        pending.value.status = `${pending.value.speakerName || 'The model'} is thinking...`;
      } else if (event.type === 'content') {
        pending.value.content += event.text;
        if (pending.value.speakerName) {
          pending.value.status = `${pending.value.speakerName} is typing...`;
        }
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
        nextTick(resizeInput);
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
  await nextTick();
  inputRef.value?.focus();
}

function send() {
  const message = text.value.trim();
  if (!message || !canWrite.value || sending.value) return;
  text.value = '';
  nextTick(resizeInput);
  runReply((signal) => chatsAPI.send(props.chatId, message, { signal }), {
    composerText: message,
  });
}

function nudge() {
  if (!canWrite.value) return;
  if (isGroup.value) {
    showCharacterSelector.value = true;
    return;
  }
  runReply((signal) => chatsAPI.reply(props.chatId, { signal }));
}

function handleCharacterSelected(characterId) {
  showCharacterSelector.value = false;
  runReply((signal) => chatsAPI.reply(props.chatId, { characterId, signal }));
}

function regenerate(turn) {
  if (!turn || turn.source !== 'character') return;
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
    if (reasoningPanel.value?.turnId === turn.id) {
      reasoningPanel.value = turnReasoning(updated)
        ? { turnId: turn.id, text: turnReasoning(updated) }
        : null;
    }
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

function toggleReasoning(turn) {
  reasoningPanel.value =
    reasoningPanel.value?.turnId === turn.id
      ? null
      : { turnId: turn.id, text: turnReasoning(turn) };
}

async function clearChat() {
  const confirmed = await confirm({
    message: 'Clear every message in this chat? Its characters and scenario stay.',
    confirmText: 'Clear Chat',
    variant: 'danger',
  });
  if (!confirmed) return;

  try {
    await chatsAPI.clear(props.chatId);
    turns.value = [];
    reasoningPanel.value = null;
    toast.success('Chat cleared');
  } catch (error) {
    toast.error(`Failed to clear the chat: ${error.message}`);
  }
}

// ==================== Setup ====================

async function updateChat(fields) {
  const { chat: updated } = await chatsAPI.update(props.chatId, fields);
  handleChatUpdated(updated);
  return updated;
}

function handleChatUpdated(updated) {
  chat.value = updated;
  setPageTitle(updated.title);
}

// The persona can't also be in the chat, so choosing one takes them out of it.
const characterAdapter = {
  addCharacter: (id) =>
    updateChat({
      characterIds: [...chat.value.characterIds, id],
      personaCharacterId:
        chat.value.personaCharacterId === id ? null : chat.value.personaCharacterId,
    }),
  removeCharacter: (id) =>
    updateChat({ characterIds: chat.value.characterIds.filter((item) => item !== id) }),
  setPersona: (id) =>
    updateChat({
      personaCharacterId: id,
      characterIds: chat.value.characterIds.filter((item) => item !== id),
    }),
};

const lorebookAdapter = {
  addLorebook: (id) => updateChat({ lorebookIds: [...chat.value.lorebookIds, id] }),
  removeLorebook: (id) =>
    updateChat({ lorebookIds: chat.value.lorebookIds.filter((item) => item !== id) }),
};

function savePreset(presetId) {
  return updateChat({ configPresetId: presetId });
}

function openEditChat(scenarioFirst) {
  editScenarioFirst.value = scenarioFirst;
  showEditChat.value = true;
}

async function deleteChat() {
  const confirmed = await confirm({
    message: `Delete chat "${chat.value.title}"? This cannot be undone.`,
    confirmText: 'Delete Chat',
    variant: 'danger',
  });
  if (!confirmed) return;

  try {
    await chatsAPI.delete(props.chatId);
    toast.success('Chat deleted successfully');
    backToChats();
  } catch (error) {
    toast.error(`Failed to delete the chat: ${error.message}`);
  }
}

function backToChats() {
  router.push({ name: 'home' });
}

function goToSettings() {
  router.push('/settings');
}

onMounted(load);
onBeforeUnmount(() => {
  abortController?.abort();
});
</script>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background-color: var(--bg-secondary);
}

/* Header, as the story editor's */
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background-color: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  box-shadow: var(--shadow);
  position: relative;
  z-index: 200;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
  min-width: 0;
}

.header-left .btn {
  flex-shrink: 0;
}

.chat-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--primary-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.header-right {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.header-right .icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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

.editor-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Conversation, in the story editor's page column */
.chat-reading {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-top: 2rem;
  padding-bottom: 2rem;
  padding-left: max(2rem, calc((100% - 700px) / 2));
  padding-right: max(2rem, calc((100% - 700px) / 2));
  background-color: var(--bg-primary);
  box-shadow: var(--shadow);
}

.scenario-block {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  width: 100%;
  padding: 0.75rem 1rem;
  text-align: left;
  font: inherit;
  color: var(--text-secondary);
  background-color: var(--bg-tertiary);
  border: none;
  border-left: 3px solid var(--accent-primary);
  cursor: pointer;
  flex-shrink: 0;
}

.scenario-block.empty {
  border-left-color: var(--border-color);
}

.scenario-block:disabled {
  cursor: default;
}

.scenario-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.scenario-edit {
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.2s;
}

.scenario-block:hover:not(:disabled) .scenario-edit,
.scenario-block:focus-visible .scenario-edit {
  opacity: 1;
}

.scenario-text {
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: pre-wrap;
}

.scenario-block:not(.empty) .scenario-text {
  color: var(--text-primary);
}

.scenario-block.empty .scenario-text {
  font-style: italic;
}

.empty-state .btn {
  margin-top: 1rem;
}

.chat-empty {
  margin: 1rem 0;
  color: var(--text-secondary);
  text-align: center;
  font-size: 0.875rem;
}

.turn {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.sender {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  padding-left: 0.75rem;
}

.turn-tools {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  padding-left: 0.25rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.turn-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.turn-tool:hover:not(:disabled) {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
}

.turn-tool:disabled {
  opacity: 0.4;
  cursor: default;
}

.turn-tool.active {
  color: var(--accent-primary);
}

.swipe-count {
  min-width: 2rem;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.pending-bubble {
  align-self: flex-start;
  max-width: min(32rem, 80%);
  padding: 0.5rem 0.875rem;
  border-radius: 1.125rem;
  border-bottom-left-radius: 0.375rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  background-color: var(--bg-tertiary);
  opacity: 0.75;
}

.typing-bubble {
  align-self: flex-start;
  display: flex;
  gap: 0.25rem;
  padding: 0.75rem 0.875rem;
  border-radius: 1.125rem;
  border-bottom-left-radius: 0.375rem;
  background-color: var(--bg-tertiary);
}

.typing-bubble span {
  width: 0.4rem;
  height: 0.4rem;
  border-radius: 50%;
  background-color: var(--text-secondary);
  animation: typing 1.2s infinite ease-in-out;
}

.typing-bubble span:nth-child(2) {
  animation-delay: 0.15s;
}

.typing-bubble span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes typing {
  0%,
  60%,
  100% {
    opacity: 0.3;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

/* Composer, as the story editor's bottom toolbar */
.chat-composer {
  padding: 1rem 2rem;
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
}

.composer-inner {
  max-width: 700px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.message-row {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
}

.message-input {
  flex: 1;
  box-sizing: border-box;
  height: 3.125rem;
  min-height: 3.125rem;
  max-height: 200px;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.5;
  color: var(--text-primary);
  background-color: var(--bg-primary);
  resize: none;
  overflow-y: auto;
}

.message-input:focus {
  outline: none;
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(139, 90, 43, 0.1);
}

.message-input:disabled {
  opacity: 0.7;
}

/* As tall as a one-line message, staying at the bottom as the message grows. */
.btn-send {
  height: 3.125rem;
  padding: 0 1.5rem;
  white-space: nowrap;
}

.toolbar-main-buttons {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  position: relative;
}

.toolbar-main-buttons .btn:not(.icon-btn) {
  flex: 1;
}

.toolbar-icon-group {
  display: flex;
  gap: 0.25rem;
  align-items: center;
}

.overflow-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 0.5rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  min-width: 200px;
}

.overflow-menu-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s;
}

.overflow-menu-item:hover:not(:disabled) {
  background-color: var(--bg-secondary);
}

.overflow-menu-item:disabled {
  opacity: 0.5;
  cursor: default;
}

.overflow-menu-item i {
  width: 1.25rem;
  text-align: center;
}

.generating-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  min-height: 2.5rem;
  color: var(--text-secondary);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--border-color);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.spinner.small {
  width: 20px;
  height: 20px;
  border-width: 3px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.stop-button {
  margin-left: auto;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .editor-header {
    padding: 0.75rem 1rem;
    gap: 0.5rem;
  }

  .header-left {
    gap: 0.5rem;
  }

  .header-right {
    gap: 0;
  }

  .header-right .icon-btn {
    min-width: 2rem;
    font-size: 1rem;
  }

  .chat-title {
    font-size: 1.125rem;
  }

  .chat-reading {
    padding: 1.25rem 1rem;
  }

  .chat-composer {
    padding: 0.75rem 1rem;
  }

  .btn-send {
    padding: 0 1rem;
  }

  .toolbar-main-buttons {
    gap: 0.5rem;
  }

  .toolbar-main-buttons .btn:not(.icon-btn) {
    font-size: 0.8rem;
    padding-left: 0.5rem;
    padding-right: 0.5rem;
  }
}
</style>
