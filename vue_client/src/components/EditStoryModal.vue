<template>
  <Modal
    :title="`Edit ${Noun}`"
    max-width="720px"
    max-height="90vh"
    :close-on-overlay-click="false"
    @close="$emit('close')"
  >
    <div class="edit-story-content">
      <div class="form-group">
        <label for="storyTitle">{{ Noun }} Name *</label>
        <input
          id="storyTitle"
          ref="titleInput"
          v-model="storyTitle"
          type="text"
          class="text-input title-input"
          :maxlength="isChat ? 200 : undefined"
          :placeholder="`Enter ${noun} name...`"
          @input="titleEdited = true"
          @keydown.enter.prevent
        />
      </div>

      <section class="section">
        <h3 class="section-title">Cast</h3>
        <div class="form-group">
          <label for="characterFilter">Characters</label>
          <div class="cast-grid">
            <div v-for="character in selectedCharacters" :key="character.id" class="cast-tile">
              <span class="cast-avatar">
                <img v-if="imageUrl(character)" :src="imageUrl(character)" :alt="character.name" />
                <i v-else class="fas fa-user"></i>
              </span>
              <span class="cast-name">{{ character.name }}</span>
              <button
                type="button"
                class="tile-remove"
                :aria-label="`Remove ${character.name}`"
                :title="`Remove ${character.name}`"
                @click="removeCharacter(character.id)"
              >
                <i class="fas fa-xmark"></i>
              </button>
            </div>
            <p v-if="selectedCharacters.length === 0" class="empty-note">
              No characters yet. Find one below to add them.
            </p>
          </div>
          <div class="search-picker">
            <i class="fas fa-magnifying-glass search-icon" aria-hidden="true"></i>
            <input
              id="characterFilter"
              v-model="characterFilter"
              type="text"
              class="text-input search-input"
              autocomplete="off"
              placeholder="Add a character by name or tag..."
              @keydown.enter.prevent="addFirstMatch"
              @keydown.esc.stop="characterFilter = ''"
            />
            <ul v-if="characterFilter.trim()" class="search-results">
              <li v-for="character in characterMatches" :key="character.id">
                <button type="button" class="search-result" @click="addCharacter(character.id)">
                  <span class="result-avatar">
                    <img
                      v-if="imageUrl(character)"
                      :src="imageUrl(character)"
                      :alt="character.name"
                    />
                    <i v-else class="fas fa-user"></i>
                  </span>
                  <span>{{ character.name }}</span>
                  <i class="fas fa-plus result-add" aria-hidden="true"></i>
                </button>
              </li>
              <li v-if="characterMatches.length === 0" class="search-empty">No characters match</li>
            </ul>
          </div>
        </div>
        <div class="form-group">
          <label for="storyPersona">Persona</label>
          <select id="storyPersona" v-model="personaId" class="select-input">
            <option :value="null">None</option>
            <option v-for="option in personaOptions" :key="option.id" :value="option.id">
              {{ option.name }}
            </option>
          </select>
        </div>
      </section>

      <section class="section">
        <h3 class="section-title">World</h3>
        <div class="form-group">
          <label for="lorebookSelect">Lorebooks</label>
          <div v-if="selectedLorebooks.length > 0" class="chip-list">
            <span v-for="lorebook in selectedLorebooks" :key="lorebook.id" class="chip">
              <i class="fas fa-book chip-icon" aria-hidden="true"></i>
              {{ lorebook.name }}
              <button
                type="button"
                class="chip-remove"
                :aria-label="`Remove ${lorebook.name}`"
                :title="`Remove ${lorebook.name}`"
                @click="removeLorebook(lorebook.id)"
              >
                <i class="fas fa-xmark"></i>
              </button>
            </span>
          </div>
          <select
            v-if="availableLorebooks.length > 0"
            id="lorebookSelect"
            class="select-input"
            :value="''"
            @change="addLorebook($event.target.value, $event.target)"
          >
            <option value="" disabled>Add a lorebook...</option>
            <option v-for="lorebook in availableLorebooks" :key="lorebook.id" :value="lorebook.id">
              {{ lorebook.name }}
            </option>
          </select>
          <p v-else-if="selectedLorebooks.length === 0" class="empty-note">No lorebooks yet.</p>
        </div>

        <ContinuityPicker ref="continuityPicker" :continuity-id="story.continuityId ?? null" />
      </section>

      <section class="section">
        <h3 class="section-title">{{ Noun }}</h3>
        <div class="form-group">
          <label for="storyScenario">{{ Noun }} Scenario</label>
          <textarea
            v-if="isChat"
            id="storyScenario"
            ref="scenarioInput"
            v-model="storyScenario"
            class="textarea-input"
            maxlength="8000"
            placeholder="Set the scene for the texts: where everyone is, what time it is, and what's going on. For example: It's nearly midnight on a Tuesday. {{user}} is traveling for work and texts {{char}} while she's at home."
            rows="5"
          ></textarea>
          <textarea
            v-else
            id="storyScenario"
            ref="scenarioInput"
            v-model="storyScenario"
            class="textarea-input"
            placeholder="Set a scenario for this story. This describes the initial situation, setting, or premise..."
            rows="4"
          ></textarea>
          <p v-if="isChat" class="form-help">
            Sent with every reply, so characters know the situation they're texting in.
            <code v-text="'{{user}}'"></code> and <code v-text="'{{char}}'"></code> work here.
          </p>
          <p v-else class="form-help">
            When set, the story scenario replaces character-specific scenarios in the AI prompt.
          </p>
        </div>

        <div v-if="!isChat" class="form-group">
          <label for="storyPerspective">Perspective &amp; Narrator</label>
          <div class="picker-row">
            <select id="storyPerspective" v-model="perspective" class="select-input">
              <option v-for="mode in PERSPECTIVE_MODES" :key="mode.value" :value="mode.value">
                {{ mode.label }}
              </option>
            </select>
            <select
              id="storyPerspectiveTense"
              v-model="perspectiveTense"
              class="select-input"
              aria-label="Tense"
            >
              <option v-for="tense in PERSPECTIVE_TENSES" :key="tense.value" :value="tense.value">
                {{ tense.label }}
              </option>
            </select>
            <select
              v-if="characterLabel"
              id="storyPerspectiveCharacter"
              v-model="perspectiveCharacterId"
              class="select-input"
              :aria-label="characterLabel"
            >
              <option :value="null">{{ characterLabel }}: not set</option>
              <option v-for="option in narratorOptions" :key="option.id" :value="option.id">
                {{ option.name }}
              </option>
            </select>
          </div>
          <p v-if="perspective === 'second'" class="form-help">The story's Persona is "you".</p>
          <p v-if="presetIgnoresPerspective" class="form-help perspective-warning">
            This story's preset has a custom system prompt without
            <code v-text="'{{perspective}}'"></code>, so the perspective set here is left out of the
            system prompt. Add <code v-text="'{{perspective}}'"></code> to it in the preset's prompt
            templates.
          </p>
        </div>
      </section>

      <section class="section">
        <h3 class="section-title">Generation</h3>
        <div class="form-group">
          <label for="storyPreset">Generation Preset</label>
          <div class="picker-row">
            <select id="storyPreset" v-model="presetId" class="select-input">
              <option :value="null">
                Use Default Preset{{ defaultPresetName ? ` (${defaultPresetName})` : '' }}
              </option>
              <option v-for="preset in presets" :key="preset.id" :value="preset.id">
                {{ preset.name }}
              </option>
            </select>
            <button
              type="button"
              class="btn btn-secondary"
              :disabled="!effectivePresetId"
              @click="showPresetEditor = true"
            >
              <i class="fas fa-edit"></i> Edit Preset
            </button>
          </div>
        </div>
      </section>
    </div>

    <PresetEditorModal
      v-if="showPresetEditor"
      :preset="{ id: effectivePresetId }"
      @close="showPresetEditor = false"
      @saved="handlePresetSaved"
    />

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="!storyTitle.trim() || saving" @click="save">
        <i class="fas fa-save"></i>
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import Modal from './Modal.vue';
import ContinuityPicker from './ContinuityPicker.vue';
import PresetEditorModal from './PresetEditorModal.vue';
import { storiesAPI, charactersAPI, lorebooksAPI, presetsAPI } from '../services/api';
import { chatsAPI } from '../services/chatsApi';
import {
  DEFAULT_PERSPECTIVE_MODE,
  DEFAULT_PERSPECTIVE_TENSE,
  PERSPECTIVE_MODES,
  PERSPECTIVE_TENSES,
} from '../../../shared/perspective.js';
import {
  generateAutoTitle,
  generateChatTitle,
  isAutoChatTitle,
  isAutoGeneratedTitle,
} from '../../../shared/story-titles.js';
import { useToast } from '../composables/useToast';
import { useDataCache } from '../composables/useDataCache';

// How many characters the add-a-character search lists at once
const MAX_CHARACTER_MATCHES = 8;

const props = defineProps({
  /** The story, or the chat when kind is 'chat'. */
  story: {
    type: Object,
    required: true,
  },
  /**
   * 'story' or 'chat'. A chat has no perspective, keeps its Persona out of the cast, and saves
   * everything in one update.
   */
  kind: {
    type: String,
    default: 'story',
  },
  /** Focus the scenario rather than the name. */
  focusScenario: {
    type: Boolean,
    default: false,
  },
});

// A chat's 'updated' carries the saved chat; a story's reloads instead
const emit = defineEmits(['close', 'updated']);

const isChat = props.kind === 'chat';
const noun = isChat ? 'chat' : 'story';
const Noun = isChat ? 'Chat' : 'Story';

const toast = useToast();
const { characters: cachedCharacters, loadCharacters } = useDataCache();

// Everything is edited locally and only written on Save, so Cancel leaves the story as it was.
const storyTitle = ref(props.story.title || '');
const storyScenario = ref(props.story.scenario || '');
// The name was typed in, so it no longer follows the cast
const titleEdited = ref(false);
const characterIds = ref([...(props.story.characterIds ?? [])]);
const personaId = ref(props.story.personaCharacterId ?? null);
const lorebookIds = ref([...(props.story.lorebookIds ?? [])]);
const presetId = ref(props.story.configPresetId ?? null);
const perspective = ref(props.story.perspective || DEFAULT_PERSPECTIVE_MODE);
const perspectiveTense = ref(props.story.perspectiveTense || DEFAULT_PERSPECTIVE_TENSE);
const perspectiveCharacterId = ref(props.story.perspectiveCharacterId ?? null);

const saving = ref(false);
const titleInput = ref(null);
const scenarioInput = ref(null);
const continuityPicker = ref(null);
const characterFilter = ref('');
const lorebooks = ref([]);
const presets = ref([]);
const defaultPresetId = ref(null);
const showPresetEditor = ref(false);
// Lorebooks taken off here, so one the server attaches with a character is only dropped when asked
const removedLorebookIds = new Set();
// The preset's custom system prompt leaves out {{perspective}}
const presetIgnoresPerspective = ref(false);

const allCharacters = computed(() => cachedCharacters.value ?? []);
const charactersById = computed(() => new Map(allCharacters.value.map((c) => [c.id, c])));

function byName(a, b) {
  return (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase());
}

const selectedCharacters = computed(() =>
  characterIds.value.map((id) => charactersById.value.get(id) || { id, name: 'Unknown' }),
);

// A story or chat still named after its cast is renamed as the cast changes, as the server
// does on Save. Only adding or removing someone counts, not the character list loading.
watch(
  () => characterIds.value.join(','),
  () => {
    const isAuto = isChat ? isAutoChatTitle : isAutoGeneratedTitle;
    if (titleEdited.value || !isAuto(storyTitle.value)) return;
    const names = selectedCharacters.value.map((c) => c.name);
    storyTitle.value = isChat ? generateChatTitle(names) : generateAutoTitle(names);
  },
);

// A chat's Persona can't also be in it, so choosing one takes them out of the cast
watch(personaId, (id) => {
  if (isChat && id && characterIds.value.includes(id)) {
    characterIds.value = characterIds.value.filter((item) => item !== id);
  }
});

const characterMatches = computed(() => {
  const term = characterFilter.value.trim().toLowerCase();
  if (!term) return [];
  return allCharacters.value
    .filter(
      (c) =>
        !characterIds.value.includes(c.id) &&
        (c.name?.toLowerCase().includes(term) ||
          c.tags?.some((tag) => tag.toLowerCase().includes(term))),
    )
    .toSorted(byName)
    .slice(0, MAX_CHARACTER_MATCHES);
});

const personaOptions = computed(() => {
  const options = allCharacters.value.map((c) => ({ id: c.id, name: c.name })).toSorted(byName);
  if (personaId.value && !charactersById.value.has(personaId.value)) {
    options.unshift({ id: personaId.value, name: 'Unknown' });
  }
  return options;
});

const selectedLorebooks = computed(() =>
  lorebookIds.value.map((id) => {
    const lorebook = lorebooks.value.find((l) => l.id === id);
    return { id, name: lorebook?.name || 'Untitled Lorebook' };
  }),
);

const availableLorebooks = computed(() =>
  lorebooks.value
    .filter((l) => !lorebookIds.value.includes(l.id))
    .map((l) => ({ id: l.id, name: l.name || 'Untitled Lorebook' }))
    .toSorted(byName),
);

const characterLabel = computed(
  () => PERSPECTIVE_MODES.find((mode) => mode.value === perspective.value)?.character || null,
);

// The narrator or viewpoint character comes from the characters picked here, or the Persona.
const narratorOptions = computed(() => {
  const options = selectedCharacters.value.map((c) => ({ id: c.id, name: c.name }));
  const persona = personaId.value && charactersById.value.get(personaId.value);
  if (persona && !options.some((option) => option.id === persona.id)) {
    options.unshift({ id: persona.id, name: `${persona.name} (Persona)` });
  }
  // A narrator no longer in the story stays listed, so saving doesn't silently drop them.
  const current = perspectiveCharacterId.value;
  if (current && !options.some((option) => option.id === current)) {
    options.push({ id: current, name: 'Not in this story' });
  }
  return options;
});

const effectivePresetId = computed(() => presetId.value || defaultPresetId.value);
const defaultPresetName = computed(
  () => presets.value.find((p) => p.id === defaultPresetId.value)?.name || '',
);

function imageUrl(character) {
  return character.thumbnailUrl || character.imageUrl || null;
}

function addCharacter(characterId) {
  if (!characterIds.value.includes(characterId)) {
    characterIds.value.push(characterId);
    if (isChat) {
      // And adding the Persona to a chat's cast leaves it without one
      if (personaId.value === characterId) personaId.value = null;
      characterFilter.value = '';
      return;
    }
    // Mirror the server, which attaches a character's own lorebook along with them. The
    // lorebook list names the characters linked to each one.
    const lorebook = lorebooks.value.find((l) => l.characters?.some((c) => c.id === characterId));
    if (lorebook && !lorebookIds.value.includes(lorebook.id)) {
      lorebookIds.value.push(lorebook.id);
      removedLorebookIds.delete(lorebook.id);
    }
  }
  characterFilter.value = '';
}

function addFirstMatch() {
  if (characterMatches.value.length > 0) addCharacter(characterMatches.value[0].id);
}

function removeCharacter(characterId) {
  characterIds.value = characterIds.value.filter((id) => id !== characterId);
  // Matches removing a character in Manage Characters, which also unsets them as Persona
  if (personaId.value === characterId) personaId.value = null;
}

function addLorebook(lorebookId, select) {
  if (lorebookId && !lorebookIds.value.includes(lorebookId)) lorebookIds.value.push(lorebookId);
  // Back to the placeholder, ready for the next pick
  if (select) select.value = '';
}

function removeLorebook(lorebookId) {
  lorebookIds.value = lorebookIds.value.filter((id) => id !== lorebookId);
  removedLorebookIds.add(lorebookId);
}

async function loadLorebooks() {
  try {
    const { lorebooks: all } = await lorebooksAPI.list();
    lorebooks.value = all || [];
  } catch (error) {
    console.error('Failed to load lorebooks:', error);
  }
}

async function loadPresets() {
  try {
    const [{ presets: all }, { defaultPresetId: id }] = await Promise.all([
      presetsAPI.list(),
      presetsAPI.getDefaultId(),
    ]);
    presets.value = all || [];
    defaultPresetId.value = id ?? null;
  } catch (error) {
    console.error('Failed to load presets:', error);
  }
}

async function checkPresetUsesPerspective() {
  const id = effectivePresetId.value;
  // Chats have no perspective to leave out
  if (!id || isChat) {
    presetIgnoresPerspective.value = false;
    return;
  }
  try {
    const { preset } = await presetsAPI.get(id);
    // The pick may have changed while this preset loaded
    if (id !== effectivePresetId.value) return;
    const template = preset?.promptTemplates?.systemPrompt;
    presetIgnoresPerspective.value = Boolean(template) && !template.includes('{{perspective}}');
  } catch (error) {
    console.error('Failed to check the story preset:', error);
  }
}

watch(effectivePresetId, checkPresetUsesPerspective);

async function handlePresetSaved() {
  showPresetEditor.value = false;
  await loadPresets();
  await checkPresetUsesPerspective();
}

onMounted(async () => {
  // Focus title input when modal opens, with all text selected for easy overwriting
  if (props.focusScenario && scenarioInput.value) {
    scenarioInput.value.focus();
  } else if (titleInput.value) {
    titleInput.value.focus();
    titleInput.value.select();
  }
  await Promise.all([loadCharacters(), loadLorebooks(), loadPresets()]);
  // Watching the effective preset covers the default once it loads; this covers a story's own
  if (presetId.value) await checkPresetUsesPerspective();
});

/** Apply the cast, Persona and lorebooks, each through the endpoint the old modals used. */
async function saveAssociations() {
  const storyId = props.story.id;
  const originalCharacters = props.story.characterIds ?? [];
  const removed = originalCharacters.filter((id) => !characterIds.value.includes(id));
  const added = characterIds.value.filter((id) => !originalCharacters.includes(id));

  for (const id of removed) {
    await storiesAPI.removeCharacterFromStory(storyId, id);
  }
  // Lorebooks the server attached along with an added character
  const attached = [];
  for (const id of added) {
    const response = await charactersAPI.addToStory(storyId, id);
    if (response?.addedLorebookId) attached.push(response.addedLorebookId);
  }

  const originalPersona = props.story.personaCharacterId ?? null;
  // Removing the Persona's character clears the Persona on the server too
  const personaCleared = originalPersona && removed.includes(originalPersona);
  if (personaId.value !== originalPersona || (personaCleared && personaId.value)) {
    await storiesAPI.setPersona(storyId, personaId.value);
  }

  const originalLorebooks = props.story.lorebookIds ?? [];
  const current = new Set([...originalLorebooks, ...attached]);
  for (const id of current) {
    const dropped = originalLorebooks.includes(id) || removedLorebookIds.has(id);
    if (dropped && !lorebookIds.value.includes(id)) {
      await storiesAPI.removeLorebookFromStory(storyId, id);
    }
  }
  for (const id of lorebookIds.value) {
    if (!current.has(id)) await storiesAPI.addLorebookToStory(storyId, id);
  }
}

function presetUpdate() {
  return presetId.value !== (props.story.configPresetId ?? null)
    ? { configPresetId: presetId.value }
    : {};
}

/** A chat takes everything in one update, which checks its Persona against its cast. */
async function saveChat() {
  try {
    saving.value = true;
    const updates = {
      scenario: storyScenario.value.trim(),
      characterIds: characterIds.value,
      personaCharacterId: personaId.value,
      lorebookIds: lorebookIds.value,
      ...presetUpdate(),
    };
    // A title still named after the cast is left to the server, which renames it from the cast
    // and has no length limit for it, unlike a title sent here
    if (titleEdited.value || !isAutoChatTitle(storyTitle.value)) {
      updates.title = storyTitle.value.trim();
    }
    const continuityId = await continuityPicker.value?.save();
    if (continuityId !== undefined) updates.continuityId = continuityId;

    const { chat } = await chatsAPI.update(props.story.id, updates);
    toast.success('Chat updated successfully');
    emit('updated', chat);
    emit('close');
  } catch (error) {
    console.error('Failed to update chat:', error);
    toast.error('Failed to update chat: ' + error.message);
  } finally {
    saving.value = false;
  }
}

function save() {
  if (!storyTitle.value.trim() || saving.value) return;
  return isChat ? saveChat() : saveStory();
}

async function saveStory() {
  try {
    saving.value = true;

    await saveAssociations();

    const updates = {
      title: storyTitle.value.trim(),
      scenario: storyScenario.value.trim(),
      // Defaults are stored as null, so they follow the default if it ever changes
      perspective: perspective.value === DEFAULT_PERSPECTIVE_MODE ? null : perspective.value,
      perspectiveTense:
        perspectiveTense.value === DEFAULT_PERSPECTIVE_TENSE ? null : perspectiveTense.value,
      perspectiveCharacterId: characterLabel.value ? perspectiveCharacterId.value : null,
      ...presetUpdate(),
    };
    const continuityId = await continuityPicker.value?.save();
    if (continuityId !== undefined) updates.continuityId = continuityId;

    await storiesAPI.updateMetadata(props.story.id, updates);

    toast.success('Story updated successfully');
    emit('updated');
    emit('close');
  } catch (error) {
    console.error('Failed to update story:', error);
    toast.error('Failed to update story: ' + error.message);
    // Some changes may have landed before the failure, so the story is reloaded either way
    emit('updated');
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.edit-story-content {
  --control-height: 2.625rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem 1.125rem 1.125rem;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
}

.section-title {
  margin: 0;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.text-input,
.select-input,
.textarea-input {
  width: 100%;
  padding: 0.625rem 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.5;
  outline: none;
}

.text-input:focus,
.select-input:focus,
.textarea-input:focus {
  border-color: var(--accent-primary);
}

/* Single-line inputs share the controls' height; the name stays a little larger */
.text-input,
.section :deep(.continuity-picker .text-input) {
  height: var(--control-height);
}

.title-input {
  height: auto;
  font-size: 1.125rem;
  font-weight: 600;
}

/*
 * Selects drawn by hand rather than natively, since native ones (macOS especially) ignore
 * padding and come out thinner than the buttons beside them. Continuity's are included.
 */
.select-input,
.section :deep(.continuity-picker .select-input) {
  min-width: 0;
  height: var(--control-height);
  padding: 0 2.25rem 0 0.75rem;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5 6 8l3.5-3.5' fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  border-radius: 6px;
  font-size: 0.95rem;
  line-height: normal;
  cursor: pointer;
}

/* Buttons beside a select match its height */
.picker-row .btn,
.section :deep(.continuity-picker .picker-row .btn) {
  height: var(--control-height);
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding-top: 0;
  padding-bottom: 0;
}

.textarea-input {
  resize: vertical;
  min-height: 100px;
}

.picker-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}

.picker-row .select-input {
  flex: 1 1 160px;
}

/* Cast: one tile per character, portrait above name */
.cast-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 0.75rem;
}

.cast-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.375rem;
  min-width: 0;
}

.cast-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 1.25rem;
  border: 2px solid var(--border-color);
}

.cast-avatar img,
.result-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
}

.cast-name {
  max-width: 100%;
  font-size: 0.8rem;
  text-align: center;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tile-remove {
  position: absolute;
  top: -2px;
  right: calc(50% - 38px);
  width: 22px;
  height: 22px;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  background-color: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 0.7rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tile-remove:hover {
  color: var(--danger, #dc3545);
  border-color: currentColor;
}

.empty-note {
  grid-column: 1 / -1;
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.search-picker {
  position: relative;
}

.search-icon {
  position: absolute;
  left: 0.75rem;
  top: 0.8rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
  pointer-events: none;
}

.search-input {
  padding-left: 2.1rem;
}

.search-results {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0.25rem;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.search-result {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.375rem 0.5rem;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.search-result:hover,
.search-result:focus-visible {
  background-color: var(--bg-tertiary);
}

.result-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.result-add {
  margin-left: auto;
  color: var(--text-secondary);
}

.search-empty {
  padding: 0.375rem 0.5rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.25rem 0.25rem 0.625rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.chip-icon {
  color: var(--text-secondary);
}

.chip-remove {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.chip-remove:hover {
  background-color: var(--bg-secondary);
  color: var(--text-primary);
}

.perspective-warning {
  color: var(--warning);
}

.form-help {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin: 0;
}

.form-help code {
  background-color: var(--bg-tertiary);
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
}

/* The Continuity picker brings its own fields; fit them to these sections */
.section :deep(.continuity-picker) {
  padding-bottom: 0;
  border-bottom: none;
}
</style>
