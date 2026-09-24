<template>
  <Modal
    :title="chat ? 'Edit Chat' : 'New Chat'"
    max-width="640px"
    :close-on-overlay-click="false"
    @close="$emit('close')"
  >
    <div class="form">
      <div class="form-group">
        <span class="group-label">Who's in the chat? *</span>
        <input
          v-if="characters.length > 8"
          v-model="search"
          type="search"
          class="text-input"
          placeholder="Search characters..."
          aria-label="Search characters"
        />
        <p v-if="loadingCharacters" class="help-text">Loading characters...</p>
        <p v-else-if="characters.length === 0" class="help-text">
          Your character library is empty. Create or import a character first.
        </p>
        <div v-else class="character-list">
          <label
            v-for="character in visibleCharacters"
            :key="character.id"
            class="character-option"
            :class="{ selected: characterIds.includes(character.id) }"
          >
            <input
              type="checkbox"
              :checked="characterIds.includes(character.id)"
              :disabled="character.id === personaCharacterId"
              @change="toggleCharacter(character.id)"
            />
            <img
              v-if="character.thumbnailUrl"
              class="avatar"
              :src="character.thumbnailUrl"
              alt=""
            />
            <span v-else class="avatar avatar-placeholder"><i class="fas fa-user"></i></span>
            <span class="character-name">{{ character.name }}</span>
            <span v-if="character.id === personaCharacterId" class="persona-note">You</span>
          </label>
        </div>
        <p class="help-text">Pick more than one for a group chat.</p>
      </div>

      <div class="form-group">
        <label for="chatPersona">You're texting as</label>
        <select id="chatPersona" v-model="personaCharacterId" class="select-input">
          <option :value="null">No persona ("User")</option>
          <option v-for="character in personaOptions" :key="character.id" :value="character.id">
            {{ character.name }}
          </option>
        </select>
      </div>

      <div class="form-group">
        <label for="chatScenario">Describe this scenario</label>
        <textarea
          id="chatScenario"
          v-model="scenario"
          class="textarea-input"
          rows="4"
          :maxlength="8000"
          placeholder="Set the scene for the texts: where everyone is, what time it is, what's going on. For example: It's nearly midnight on a Tuesday. Bradley is traveling for work and texts Layla while she's at home."
        ></textarea>
        <p class="help-text">
          Optional. Sent with every reply, so characters know the situation they're texting in.
          <code v-text="'{{user}}'"></code> and <code v-text="'{{char}}'"></code> work here.
        </p>
      </div>

      <div class="form-group">
        <label for="chatTitle">Title</label>
        <input
          id="chatTitle"
          v-model="title"
          type="text"
          class="text-input"
          maxlength="200"
          :placeholder="chat ? '' : 'Named after the characters if left empty'"
          @keydown.enter.prevent
        />
      </div>

      <div v-if="lorebooks.length > 0" class="form-group">
        <span class="group-label">Lorebooks</span>
        <div class="lorebook-list">
          <label v-for="lorebook in lorebooks" :key="lorebook.id" class="checkbox-label">
            <input
              type="checkbox"
              :checked="lorebookIds.includes(lorebook.id)"
              @change="toggleLorebook(lorebook.id)"
            />
            {{ lorebook.name }}
          </label>
        </div>
      </div>

      <div class="form-group">
        <label for="chatPreset">Preset</label>
        <select id="chatPreset" v-model="configPresetId" class="select-input">
          <option :value="null">Default preset</option>
          <option v-for="preset in presets" :key="preset.id" :value="preset.id">
            {{ preset.name }}
          </option>
        </select>
        <p class="help-text">
          The provider, model, and prompts replies use. Chat prompts are under Chat Templates in
          each preset.
        </p>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="!canSave" @click="save">
        <i :class="chat ? 'fas fa-save' : 'fas fa-comments'"></i>
        {{ saving ? 'Saving...' : chat ? 'Save' : 'Start Chat' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import Modal from '../Modal.vue';
import { chatsAPI } from '../../services/chatsApi';
import { settingsAPI } from '../../services/api';
import { useDataCache } from '../../composables/useDataCache';
import { useToast } from '../../composables/useToast';

const props = defineProps({
  /** The chat to edit; omit to create one. */
  chat: { type: Object, default: null },
  /** Characters to start a new chat with. */
  initialCharacterIds: { type: Array, default: () => [] },
});

const emit = defineEmits(['close', 'saved']);

const toast = useToast();
const {
  characters,
  lorebooks,
  presets,
  loadingCharacters,
  loadCharacters,
  loadLorebooks,
  loadPresets,
} = useDataCache();

const title = ref(props.chat?.title ?? '');
const scenario = ref(props.chat?.scenario ?? '');
const characterIds = ref([...(props.chat?.characterIds ?? props.initialCharacterIds)]);
const personaCharacterId = ref(props.chat?.personaCharacterId ?? null);
const lorebookIds = ref([...(props.chat?.lorebookIds ?? [])]);
const configPresetId = ref(props.chat?.configPresetId ?? null);
const search = ref('');
const saving = ref(false);

const visibleCharacters = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return characters.value;
  return characters.value.filter(
    (character) =>
      characterIds.value.includes(character.id) || character.name.toLowerCase().includes(query),
  );
});

const personaOptions = computed(() =>
  characters.value.filter((character) => !characterIds.value.includes(character.id)),
);

const canSave = computed(() => characterIds.value.length > 0 && !saving.value);

function toggleCharacter(id) {
  characterIds.value = characterIds.value.includes(id)
    ? characterIds.value.filter((item) => item !== id)
    : [...characterIds.value, id];
}

function toggleLorebook(id) {
  lorebookIds.value = lorebookIds.value.includes(id)
    ? lorebookIds.value.filter((item) => item !== id)
    : [...lorebookIds.value, id];
}

async function save() {
  if (!canSave.value) return;
  saving.value = true;
  const fields = {
    title: title.value.trim(),
    scenario: scenario.value.trim(),
    characterIds: characterIds.value,
    personaCharacterId: personaCharacterId.value,
    lorebookIds: lorebookIds.value,
    configPresetId: configPresetId.value,
  };
  try {
    const { chat } = props.chat
      ? await chatsAPI.update(props.chat.id, fields)
      : await chatsAPI.create(fields);
    emit('saved', chat);
  } catch (error) {
    toast.error(`Failed to save the chat: ${error.message}`);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadCharacters(), loadLorebooks(), loadPresets()]);
  // A new chat starts with the default persona, as a new story does.
  if (!props.chat && personaCharacterId.value === null) {
    try {
      const { settings } = await settingsAPI.get();
      const persona = settings?.defaultPersonaId;
      if (persona && !characterIds.value.includes(persona)) {
        personaCharacterId.value = persona;
      }
    } catch {
      // No default persona then.
    }
  }
});
</script>

<style scoped src="./chat-ui.css"></style>

<style scoped>
.character-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: 0.375rem;
  max-height: 16rem;
  overflow-y: auto;
  padding: 0.125rem;
}

.character-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
  min-width: 0;
}

.character-option.selected {
  border-color: var(--accent-primary);
  background-color: var(--bg-tertiary);
}

.character-option input {
  accent-color: var(--accent-primary);
  margin: 0;
}

.character-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9rem;
}

.persona-note {
  font-size: 0.7rem;
  color: var(--text-secondary);
}

.lorebook-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

code {
  background-color: var(--bg-tertiary);
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
  font-size: 0.85em;
}
</style>
