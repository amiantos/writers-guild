<template>
  <div class="chats-tab">
    <div class="tab-header">
      <h2><i class="fas fa-comments"></i> All Chats</h2>
      <button class="btn btn-primary" @click="showCreate = true">
        <i class="fas fa-plus"></i> New Chat
      </button>
    </div>

    <p class="tab-intro">
      <span class="experimental-badge">Experimental</span>
      Text with your characters, one on one or in a group. Describe a scenario to set the scene.
    </p>

    <div v-if="loading" class="loading">Loading chats...</div>

    <div v-else-if="chats.length === 0" class="empty-state">
      <i class="fas fa-comments"></i>
      <p>No chats yet. Start one with any of your characters.</p>
    </div>

    <ul v-else class="chat-list">
      <li v-for="chat in chats" :key="chat.id">
        <div
          class="chat-row"
          role="button"
          tabindex="0"
          @click="openChat(chat)"
          @keydown.enter="openChat(chat)"
        >
          <div class="chat-avatars">
            <template v-for="character in chatCharacters(chat).slice(0, 3)" :key="character.id">
              <img
                v-if="character.thumbnailUrl"
                class="avatar"
                :src="character.thumbnailUrl"
                :alt="character.name"
              />
              <span v-else class="avatar avatar-placeholder" :title="character.name">
                <i class="fas fa-user"></i>
              </span>
            </template>
          </div>
          <div class="chat-summary">
            <div class="chat-title-row">
              <span class="chat-title">{{ chat.title }}</span>
              <span class="chat-date">{{ formatDate(chat.modified) }}</span>
            </div>
            <p class="chat-preview">
              <template v-if="chat.lastMessage">
                <strong>{{ chat.lastMessage.senderName }}:</strong> {{ chat.lastMessage.content }}
              </template>
              <em v-else>No messages yet</em>
            </p>
          </div>
          <button
            class="icon-btn"
            title="Delete chat"
            aria-label="Delete chat"
            @click.stop="deleteChat(chat)"
          >
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </li>
    </ul>

    <ChatSetupModal v-if="showCreate" @close="showCreate = false" @saved="handleCreated" />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { chatsAPI } from '../../services/chatsApi';
import { useDataCache } from '../../composables/useDataCache';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import ChatSetupModal from './ChatSetupModal.vue';

const router = useRouter();
const toast = useToast();
const { confirm } = useConfirm();
const { characters, loadCharacters } = useDataCache();

const chats = ref([]);
const loading = ref(true);
const showCreate = ref(false);

function chatCharacters(chat) {
  return chat.characterIds
    .map((id) => characters.value.find((character) => character.id === id))
    .filter(Boolean);
}

function formatDate(value) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleDateString();
}

async function load() {
  loading.value = true;
  try {
    const [{ chats: list }] = await Promise.all([chatsAPI.list(), loadCharacters()]);
    chats.value = list;
  } catch (error) {
    toast.error(`Failed to load chats: ${error.message}`);
  } finally {
    loading.value = false;
  }
}

function openChat(chat) {
  router.push({ name: 'chat', params: { chatId: chat.id } });
}

function handleCreated(chat) {
  showCreate.value = false;
  openChat(chat);
}

async function deleteChat(chat) {
  const confirmed = await confirm({
    message: `Delete "${chat.title}" and all its messages? This cannot be undone.`,
    confirmText: 'Delete Chat',
    variant: 'danger',
  });
  if (!confirmed) return;
  try {
    await chatsAPI.delete(chat.id);
    chats.value = chats.value.filter((item) => item.id !== chat.id);
    toast.success('Chat deleted');
  } catch (error) {
    toast.error(`Failed to delete the chat: ${error.message}`);
  }
}

onMounted(load);
</script>

<style scoped src="./chat-ui.css"></style>

<style scoped>
.tab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.tab-header h2 {
  margin: 0;
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tab-intro {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 1.5rem;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
}

.chat-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.chat-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s;
}

.chat-row:hover,
.chat-row:focus-visible {
  border-color: var(--accent-primary);
  outline: none;
}

.chat-avatars {
  display: flex;
  flex-shrink: 0;
  min-width: 2.75rem;
}

.chat-avatars .avatar {
  width: 2.75rem;
  height: 2.75rem;
  border: 2px solid var(--bg-primary);
}

.chat-avatars .avatar + .avatar {
  margin-left: -1rem;
}

.chat-summary {
  flex: 1;
  min-width: 0;
}

.chat-title-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.chat-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-date {
  flex-shrink: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.chat-preview {
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 600px) {
  .tab-header {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
