<template>
  <BottomSheet labelledby="new-sheet-title" @close="$emit('close')">
    <div class="new-head">
      <button
        v-if="pickingCharacter"
        type="button"
        class="icon-only"
        aria-label="Back"
        @click="pickingCharacter = false"
      >
        <i class="fas fa-arrow-left"></i>
      </button>
      <h2 id="new-sheet-title">
        {{ pickingCharacter ? 'Pick a character' : 'Start something new' }}
      </h2>
      <button type="button" class="icon-only" aria-label="Close" @click="$emit('close')">
        <i class="fas fa-xmark"></i>
      </button>
    </div>

    <template v-if="!pickingCharacter">
      <button type="button" class="new-row" @click="$emit('blank')">
        <span class="row-icon dashed"><i class="fas fa-plus"></i></span>
        <span class="row-text">
          <span class="row-title">Blank story</span>
          <span class="row-sub">Choose the cast and setup yourself</span>
        </span>
        <i class="fas fa-chevron-right row-chevron"></i>
      </button>
      <button
        v-if="characters.length"
        type="button"
        class="new-row"
        @click="pickingCharacter = true"
      >
        <span class="row-icon"><i class="fas fa-user"></i></span>
        <span class="row-text">
          <span class="row-title">Start with a character</span>
          <span class="row-sub">Pick from your library, then a greeting</span>
        </span>
        <i class="fas fa-chevron-right row-chevron"></i>
      </button>
      <button v-if="chatsEnabled" type="button" class="new-row" @click="$emit('chat')">
        <span class="row-icon"><i class="fas fa-comment"></i></span>
        <span class="row-text">
          <span class="row-title">New chat</span>
          <span class="row-sub">Text back and forth with your characters</span>
        </span>
        <i class="fas fa-chevron-right row-chevron"></i>
      </button>

      <template v-if="setups.length">
        <h3>New story from a recent setup</h3>
        <button
          v-for="setup in setups"
          :key="setup.key"
          type="button"
          class="new-row"
          :aria-label="setup.label"
          @click="$emit('setup', setup.story)"
        >
          <span class="row-avatars"><AvatarStack :characters="setup.cast" :size="36" /></span>
          <span class="row-text">
            <span class="row-title">{{ setup.names }}</span>
            <span class="row-sub">{{ setup.sub }}</span>
            <span class="row-sub">{{ setup.used }}</span>
          </span>
          <i class="fas fa-chevron-right row-chevron"></i>
        </button>
      </template>
    </template>

    <template v-else>
      <input
        v-model="characterQuery"
        type="search"
        class="character-search"
        placeholder="Search characters"
        aria-label="Search characters"
      />
      <div class="character-list">
        <button
          v-for="character in matchingCharacters"
          :key="character.id"
          type="button"
          class="new-row"
          @click="$emit('character', character.id)"
        >
          <span class="row-avatars"><AvatarStack :characters="[character]" :size="40" /></span>
          <span class="row-text">
            <span class="row-title">{{ character.name }}</span>
          </span>
          <i class="fas fa-chevron-right row-chevron"></i>
        </button>
        <p v-if="matchingCharacters.length === 0" class="no-match">No characters match.</p>
      </div>
    </template>
  </BottomSheet>
</template>

<script setup>
import { computed, ref } from 'vue';
import BottomSheet from './BottomSheet.vue';
import AvatarStack from './AvatarStack.vue';

const props = defineProps({
  // Rows from LibraryView's recent setups
  setups: { type: Array, default: () => [] },
  characters: { type: Array, default: () => [] },
  chatsEnabled: { type: Boolean, default: false },
});

defineEmits(['close', 'blank', 'character', 'chat', 'setup']);

const pickingCharacter = ref(false);
const characterQuery = ref('');

const matchingCharacters = computed(() => {
  const needle = characterQuery.value.trim().toLowerCase();
  const sorted = props.characters.toSorted((a, b) => (a.name || '').localeCompare(b.name || ''));
  return needle ? sorted.filter((c) => c.name?.toLowerCase().includes(needle)) : sorted;
});
</script>

<style scoped>
.new-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-bottom: 6px;
}

.new-head h2 {
  flex: 1;
  margin: 0 0 0 4px;
  font-family: var(--font-display);
  font-size: 1.375rem;
  line-height: 1.2;
  font-weight: 600;
}

.icon-only {
  width: 44px;
  height: 44px;
  flex: none;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1.125rem;
}

h3 {
  margin: 14px 8px 4px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.new-row {
  width: 100%;
  min-height: 64px;
  padding: 10px 8px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  display: flex;
  align-items: center;
  gap: 14px;
}

.new-row:hover {
  background: var(--bg-tertiary);
}

.row-icon {
  width: 44px;
  height: 44px;
  flex: none;
  box-sizing: border-box;
  border-radius: 10px;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.125rem;
}

.row-icon.dashed {
  background: transparent;
  border: 2px dashed var(--border-color);
}

.row-avatars {
  flex: none;
  display: flex;
}

.row-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.row-title,
.row-sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-title {
  font-size: 0.9375rem;
  font-weight: 600;
}

.row-sub {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.row-chevron {
  flex: none;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.character-search {
  width: 100%;
  box-sizing: border-box;
  height: 44px;
  margin: 4px 0 8px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
}

.no-match {
  padding: 1rem 8px;
  color: var(--text-secondary);
}
</style>
