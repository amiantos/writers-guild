<template>
  <div class="chat-card" :style="item.color ? { '--chat-art': item.color } : null">
    <button
      type="button"
      class="chat-face"
      :aria-label="`Open chat ${item.title}`"
      @click="$emit('open')"
    >
      <span class="chat-art" :class="`cast-${avatars.length}`">
        <span v-for="avatar in avatars" :key="avatar.key" class="chat-avatar" :style="avatar.style">
          <img v-if="avatar.url" :src="avatar.url" alt="" loading="lazy" />
          <span v-else>{{ avatar.initial }}</span>
        </span>
        <span v-if="more > 0" class="chat-avatar more">+{{ more }}</span>
        <i v-if="avatars.length === 0" class="fas fa-comments chat-empty"></i>
      </span>
      <span class="chat-body">
        <span class="chat-heading">
          <span class="chat-title">{{ item.title }}</span>
          <span v-if="item.continuityName" class="chat-continuity">
            <i class="fas fa-layer-group"></i>
            <span>{{ item.continuityName }}</span>
          </span>
        </span>
        <span v-if="item.lastMessage" class="chat-bubble">
          <strong>{{ item.lastMessage.senderName }}:</strong> {{ item.lastMessage.content }}
        </span>
        <span v-else class="chat-bubble empty">No messages yet</span>
        <span class="chat-meta">{{ meta }}</span>
      </span>
    </button>

    <span class="chat-badge"><i class="fas fa-comment"></i> Chat</span>

    <div v-if="hoverActions" class="chat-hover">
      <button type="button" class="hover-btn" @click="$emit('open')">
        <i class="fas fa-comment"></i> Open chat
      </button>
    </div>

    <button
      v-if="showMenu"
      type="button"
      class="chat-menu"
      :aria-label="`More actions for chat ${item.title}`"
      @click="$emit('menu')"
    >
      <span><i class="fas fa-ellipsis"></i></span>
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { avatarUrl, placeholderColor, timeAgo } from '../../composables/library.js';

const props = defineProps({
  // A chat card from buildLibraryItems()
  item: { type: Object, required: true },
  // The chat's characters, in order
  cast: { type: Array, default: () => [] },
  showMenu: { type: Boolean, default: true },
  hoverActions: { type: Boolean, default: true },
});

defineEmits(['open', 'menu']);

const avatars = computed(() => {
  const shown = props.cast.slice(0, 3);
  return shown.map((character, index) => ({
    key: character.id,
    url: avatarUrl(character),
    initial: (character.name || '?').charAt(0).toUpperCase(),
    style: {
      zIndex: shown.length - index,
      ...(avatarUrl(character) ? {} : { background: placeholderColor(character.name) }),
    },
  }));
});

const more = computed(() => Math.max(0, props.cast.length - 3));

const meta = computed(() => {
  const count = props.item.messageCount ?? 0;
  return `${count.toLocaleString()} ${count === 1 ? 'message' : 'messages'} · ${timeAgo(props.item.modified)}`;
});
</script>

<style scoped>
.chat-card {
  --chat-art: #31363f;
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 3;
  container-type: inline-size;
  color: #eef0f3;
}

.chat-face {
  all: unset;
  box-sizing: border-box;
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  cursor: pointer;
  border-radius: 14px;
  background: #262a31;
  border: 1px solid #3a404a;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.3),
    0 8px 18px rgba(0, 0, 0, 0.22);
}

.chat-face:focus-visible {
  outline: 3px solid var(--accent-primary);
  outline-offset: 3px;
}

.chat-art {
  isolation: isolate;
  flex: 0 0 46%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--chat-art);
}

.chat-avatar {
  --size: 31cqw;
  position: relative;
  flex: none;
  width: var(--size);
  height: var(--size);
  box-sizing: border-box;
  border-radius: 50%;
  overflow: hidden;
  border: 3px solid var(--chat-art);
  background: #454b56;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-display);
  font-size: calc(var(--size) * 0.42);
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
}

.chat-avatar + .chat-avatar {
  margin-left: calc(var(--size) * -0.28);
}

.cast-1 .chat-avatar {
  --size: 46cqw;
}

.cast-2 .chat-avatar {
  --size: 38cqw;
}

.chat-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
}

.chat-avatar.more {
  font-family: inherit;
  font-size: 9cqw;
}

.chat-empty {
  font-size: 18cqw;
  color: rgba(238, 240, 243, 0.35);
}

.chat-body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 12px;
}

.chat-heading {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.chat-title,
.chat-continuity span,
.chat-meta {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-title {
  font-size: clamp(12px, 7.6cqw, 18px);
  line-height: 1.25;
  font-weight: 600;
}

.chat-continuity {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-family: var(--font-display);
  font-style: italic;
  font-size: clamp(11px, 6.2cqw, 14px);
  color: rgba(238, 240, 243, 0.86);
}

.chat-continuity i {
  flex: none;
  font-size: 0.8em;
  font-style: normal;
}

.chat-bubble {
  padding: 7px 10px;
  border-radius: 12px 12px 12px 4px;
  background: rgba(255, 255, 255, 0.08);
  font-size: clamp(11px, 6.4cqw, 15px);
  line-height: 1.35;
  color: #d3d7dd;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.chat-bubble strong {
  color: #eef0f3;
  font-weight: 600;
}

.chat-bubble.empty {
  font-style: italic;
}

.chat-meta {
  margin-top: auto;
  font-size: clamp(10px, 5.2cqw, 12px);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(238, 240, 243, 0.68);
}

.chat-badge {
  z-index: 3;
  position: absolute;
  top: 9px;
  left: 9px;
  height: 24px;
  padding: 0 9px 0 7px;
  border-radius: 12px;
  background: rgba(10, 12, 15, 0.6);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  display: flex;
  align-items: center;
  gap: 5px;
  pointer-events: none;
}

.chat-hover {
  display: none;
  z-index: 2;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 46%;
  box-sizing: border-box;
  /* Clear of the menu button in the corner */
  padding: 40px 14px 8px;
  border-radius: 14px 14px 0 0;
  background: rgba(10, 12, 15, 0.62);
  align-items: center;
  justify-content: center;
}

@media (hover: hover) {
  .chat-card:hover .chat-hover,
  .chat-card:focus-within .chat-hover {
    display: flex;
  }
}

.hover-btn {
  flex: 1;
  height: 38px;
  border: none;
  border-radius: 8px;
  background: var(--accent-primary);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.hover-btn:hover {
  filter: brightness(1.1);
}

.chat-menu {
  z-index: 3;
  position: absolute;
  top: 2px;
  right: 2px;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-menu span {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: rgba(10, 12, 15, 0.6);
  color: #eef0f3;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-menu:hover span {
  background: rgba(10, 12, 15, 0.85);
}
</style>
