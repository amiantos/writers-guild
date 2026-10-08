<template>
  <BottomSheet labelledby="item-sheet-title" @close="$emit('close')">
    <div class="sheet-head">
      <div class="sheet-thumb">
        <StoryCover v-if="isStory" :item="item" :cast="cast" mini />
        <span v-else class="chat-thumb" :style="item.color ? { background: item.color } : null">
          <i class="fas fa-comments"></i>
        </span>
      </div>
      <div class="sheet-heading">
        <h2 id="item-sheet-title">{{ item.title }}</h2>
        <p>{{ meta }}</p>
      </div>
      <button type="button" class="sheet-close" aria-label="Close" @click="$emit('close')">
        <i class="fas fa-xmark"></i>
      </button>
    </div>

    <div class="sheet-primary">
      <button type="button" class="btn btn-primary" @click="$emit('open')">
        <i :class="isStory ? 'fas fa-pen-nib' : 'fas fa-comment'"></i>
        {{ isStory ? 'Continue writing' : 'Open chat' }}
      </button>
      <button v-if="isStory" type="button" class="btn btn-secondary" @click="$emit('new-from')">
        <i class="fas fa-file-circle-plus"></i> New story with this setup
      </button>
    </div>

    <div class="setup-header">
      <h3>Setup</h3>
      <button v-if="isStory" type="button" class="setup-edit" @click="$emit('edit')">Edit</button>
    </div>
    <dl class="setup">
      <div>
        <dt>Cast</dt>
        <dd class="people">
          <RouterLink
            v-for="character in cast"
            :key="character.id"
            :to="characterRoute(character)"
            class="person"
            :title="`Open ${character.name}`"
          >
            <AvatarStack :characters="[character]" :size="26" />
            <span class="ellipsis">{{ character.name }}</span>
          </RouterLink>
          <span v-if="!cast.length" class="muted">No characters</span>
        </dd>
      </div>
      <div v-if="persona">
        <dt>Persona</dt>
        <dd class="people">
          <RouterLink :to="characterRoute(persona)" class="person" :title="`Open ${persona.name}`">
            <AvatarStack :characters="[persona]" :size="26" />
            <span class="ellipsis">{{ persona.name }}</span>
          </RouterLink>
        </dd>
      </div>
      <div>
        <dt>Preset</dt>
        <dd>{{ presetName }}</dd>
      </div>
      <div v-if="isStory">
        <dt>Perspective</dt>
        <dd>{{ perspective }}</dd>
      </div>
      <div>
        <dt>Continuity</dt>
        <dd>
          <template v-if="item.continuityName">
            <span class="swatch" :style="{ background: item.color }"></span>
            {{ item.continuityName }}
          </template>
          <span v-else class="muted">None</span>
        </dd>
      </div>
    </dl>

    <div class="sheet-list">
      <button v-if="isStory" type="button" @click="$emit('duplicate')">
        <i class="fas fa-copy"></i> Duplicate story
      </button>
      <button type="button" class="danger" @click="$emit('delete')">
        <i class="fas fa-trash"></i> Delete {{ isStory ? 'story' : 'chat' }}
      </button>
    </div>
  </BottomSheet>
</template>

<script setup>
import { computed } from 'vue';
import { describePerspective } from '../../../../shared/perspective.js';
import BottomSheet from './BottomSheet.vue';
import StoryCover from './StoryCover.vue';
import AvatarStack from './AvatarStack.vue';
import { timeAgo } from '../../composables/library.js';

const props = defineProps({
  // A card from buildLibraryItems()
  item: { type: Object, required: true },
  charactersById: { type: Map, required: true },
  presets: { type: Array, default: () => [] },
  defaultPresetId: { type: String, default: null },
});

defineEmits(['close', 'open', 'new-from', 'edit', 'duplicate', 'delete']);

const isStory = computed(() => props.item.kind === 'story');

const cast = computed(() =>
  props.item.characterIds.map((id) => props.charactersById.get(id)).filter(Boolean),
);

function characterRoute(character) {
  return { name: 'character-detail', params: { characterId: character.id } };
}

const persona = computed(() => props.charactersById.get(props.item.personaCharacterId) ?? null);

const presetName = computed(() => {
  const id = props.item.source.configPresetId;
  const preset = props.presets.find((p) => p.id === (id || props.defaultPresetId));
  if (!preset) return 'None';
  if (id || /default/i.test(preset.name)) return preset.name;
  return `${preset.name} (default)`;
});

const perspective = computed(() => {
  const story = props.item.source;
  const text = describePerspective({
    mode: story.perspective,
    tense: story.perspectiveTense,
    characterName: props.charactersById.get(story.perspectiveCharacterId)?.name,
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
});

const meta = computed(() => {
  const ago = timeAgo(props.item.modified);
  if (isStory.value) return `${(props.item.wordCount ?? 0).toLocaleString()} words · Edited ${ago}`;
  const count = props.item.messageCount ?? 0;
  return `${count.toLocaleString()} ${count === 1 ? 'message' : 'messages'} · Active ${ago}`;
});
</script>

<style scoped>
.sheet-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.sheet-thumb {
  flex: 0 0 60px;
  width: 60px;
}

.chat-thumb {
  width: 60px;
  height: 60px;
  border-radius: 14px;
  background: #31363f;
  color: #eef0f3;
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.sheet-heading {
  flex: 1;
  min-width: 0;
}

.sheet-heading h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.3rem;
  line-height: 1.2;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.sheet-heading p {
  margin: 4px 0 0;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.sheet-close {
  flex: none;
  align-self: flex-start;
  width: 44px;
  height: 44px;
  margin: -6px -8px 0 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1.25rem;
}

.sheet-primary {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
}

.sheet-primary .btn {
  height: 48px;
  font-size: 1rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.setup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20px;
}

.setup-header h3 {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.setup-edit {
  min-height: 36px;
  padding: 0 0 0 12px;
  border: none;
  background: none;
  color: var(--accent-primary);
  font-size: 0.875rem;
  font-weight: 600;
}

.setup {
  margin: 6px 0 0;
}

.setup > div {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  border-bottom: 1px solid var(--border-color);
}

.setup dt {
  flex: 0 0 96px;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.setup dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.875rem;
  font-weight: 500;
}

/* The cast and persona link to their character pages */
.setup dd.people {
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px 0;
}

.person {
  --stack-ring: var(--bg-tertiary);
  max-width: 100%;
  min-height: 34px;
  box-sizing: border-box;
  padding: 0 12px 0 4px;
  border-radius: 999px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.person:hover {
  color: var(--accent-primary);
}

.person:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.swatch {
  width: 14px;
  height: 18px;
  flex: none;
  border-radius: 3px;
  box-shadow: inset 3px 0 0 rgba(0, 0, 0, 0.25);
}

.muted {
  color: var(--text-secondary);
  font-weight: 400;
}

.sheet-list {
  display: flex;
  flex-direction: column;
  margin-top: 10px;
}

.sheet-list button {
  height: 48px;
  padding: 0 4px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 0.9375rem;
  text-align: left;
  display: flex;
  align-items: center;
  gap: 14px;
}

.sheet-list button i {
  width: 20px;
  text-align: center;
}

.sheet-list .danger {
  color: var(--danger);
}
</style>
