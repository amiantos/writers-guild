<template>
  <Modal
    title="Edit Story"
    max-width="720px"
    max-height="90vh"
    :close-on-overlay-click="false"
    @close="$emit('close')"
  >
    <div class="edit-story-content">
      <div class="form-group">
        <label for="storyTitle">Story Name *</label>
        <input
          id="storyTitle"
          ref="titleInput"
          v-model="storyTitle"
          type="text"
          class="text-input"
          placeholder="Enter story name..."
          @keydown.enter.prevent
        />
      </div>

      <div class="form-group">
        <label for="characterFilter">Characters</label>
        <div class="chip-list">
          <span v-for="character in selectedCharacters" :key="character.id" class="chip">
            <span class="chip-avatar">
              <img v-if="imageUrl(character)" :src="imageUrl(character)" :alt="character.name" />
              <i v-else class="fas fa-user"></i>
            </span>
            {{ character.name }}
            <button
              type="button"
              class="chip-remove"
              :aria-label="`Remove ${character.name}`"
              @click="removeCharacter(character.id)"
            >
              <i class="fas fa-xmark"></i>
            </button>
          </span>
          <span v-if="selectedCharacters.length === 0" class="chip-empty">No characters yet</span>
        </div>
        <div class="search-picker">
          <input
            id="characterFilter"
            v-model="characterFilter"
            type="text"
            class="text-input"
            autocomplete="off"
            placeholder="Add a character by name or tag..."
            @keydown.enter.prevent="addFirstMatch"
            @keydown.esc.stop="characterFilter = ''"
          />
          <ul v-if="characterFilter.trim()" class="search-results">
            <li v-for="character in characterMatches" :key="character.id">
              <button type="button" class="search-result" @click="addCharacter(character.id)">
                <span class="chip-avatar">
                  <img
                    v-if="imageUrl(character)"
                    :src="imageUrl(character)"
                    :alt="character.name"
                  />
                  <i v-else class="fas fa-user"></i>
                </span>
                {{ character.name }}
              </button>
            </li>
            <li v-if="characterMatches.length === 0" class="search-empty">No characters match</li>
          </ul>
        </div>
        <div class="inline-field">
          <label for="storyPersona">Persona</label>
          <select id="storyPersona" v-model="personaId" class="select-input">
            <option :value="null">None</option>
            <option v-for="option in personaOptions" :key="option.id" :value="option.id">
              {{ option.name }}
            </option>
          </select>
        </div>
      </div>

      <div class="form-group">
        <label for="lorebookSelect">Lorebooks</label>
        <div class="chip-list">
          <span v-for="lorebook in selectedLorebooks" :key="lorebook.id" class="chip">
            <i class="fas fa-book chip-icon"></i>
            {{ lorebook.name }}
            <button
              type="button"
              class="chip-remove"
              :aria-label="`Remove ${lorebook.name}`"
              @click="removeLorebook(lorebook.id)"
            >
              <i class="fas fa-xmark"></i>
            </button>
          </span>
          <span v-if="selectedLorebooks.length === 0" class="chip-empty">No lorebooks</span>
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
      </div>

      <ContinuityPicker ref="continuityPicker" :continuity-id="story.continuityId ?? null" />

      <div class="form-group">
        <label for="storyScenario">Story Scenario</label>
        <textarea
          id="storyScenario"
          v-model="storyScenario"
          class="textarea-input"
          placeholder="Set a scenario for this story. This describes the initial situation, setting, or premise..."
          rows="4"
        ></textarea>
        <p class="form-help">
          When set, the story scenario replaces character-specific scenarios in the AI prompt.
        </p>
      </div>

      <div class="form-group">
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
        </div>
        <div v-if="characterLabel" class="inline-field">
          <label for="storyPerspectiveCharacter">{{ characterLabel }}</label>
          <select
            id="storyPerspectiveCharacter"
            v-model="perspectiveCharacterId"
            class="select-input"
          >
            <option :value="null">Not set</option>
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
            class="btn btn-secondary btn-small"
            :disabled="!effectivePresetId"
            @click="showPresetEditor = true"
          >
            <i class="fas fa-edit"></i> Edit Preset
          </button>
        </div>
      </div>
    </div>

    <PresetEditorModal
      v-if="showPresetEditor"
      :preset="{ id: effectivePresetId }"
      @close="showPresetEditor = false"
      @saved="handlePresetSaved"
    />

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="!storyTitle.trim() || saving" @click="saveStory">
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
import {
  DEFAULT_PERSPECTIVE_MODE,
  DEFAULT_PERSPECTIVE_TENSE,
  PERSPECTIVE_MODES,
  PERSPECTIVE_TENSES,
} from '../../../shared/perspective.js';
import { useToast } from '../composables/useToast';
import { useDataCache } from '../composables/useDataCache';

// How many characters the add-a-character search lists at once
const MAX_CHARACTER_MATCHES = 8;

const props = defineProps({
  story: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['close', 'updated']);

const toast = useToast();
const { characters: cachedCharacters, loadCharacters } = useDataCache();

// Everything is edited locally and only written on Save, so Cancel leaves the story as it was.
const storyTitle = ref(props.story.title || '');
const storyScenario = ref(props.story.scenario || '');
const characterIds = ref([...(props.story.characterIds ?? [])]);
const personaId = ref(props.story.personaCharacterId ?? null);
const lorebookIds = ref([...(props.story.lorebookIds ?? [])]);
const presetId = ref(props.story.configPresetId ?? null);
const perspective = ref(props.story.perspective || DEFAULT_PERSPECTIVE_MODE);
const perspectiveTense = ref(props.story.perspectiveTense || DEFAULT_PERSPECTIVE_TENSE);
const perspectiveCharacterId = ref(props.story.perspectiveCharacterId ?? null);

const saving = ref(false);
const titleInput = ref(null);
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
  if (!id) {
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
  if (titleInput.value) {
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

  return { castChanged: removed.length > 0 || added.length > 0 };
}

async function saveStory() {
  if (!storyTitle.value.trim() || saving.value) return;

  try {
    saving.value = true;

    const { castChanged } = await saveAssociations();

    const updates = {
      scenario: storyScenario.value.trim(),
      // Defaults are stored as null, so they follow the default if it ever changes
      perspective: perspective.value === DEFAULT_PERSPECTIVE_MODE ? null : perspective.value,
      perspectiveTense:
        perspectiveTense.value === DEFAULT_PERSPECTIVE_TENSE ? null : perspectiveTense.value,
      perspectiveCharacterId: characterLabel.value ? perspectiveCharacterId.value : null,
    };
    // An untouched auto-generated title follows the cast, which the server renames on changes
    const title = storyTitle.value.trim();
    if (title !== props.story.title || !castChanged) updates.title = title;
    if (presetId.value !== (props.story.configPresetId ?? null)) {
      updates.configPresetId = presetId.value;
    }
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
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
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

.text-input {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.5;
  outline: none;
}

.text-input:focus {
  border-color: var(--accent-primary);
}

.select-input {
  flex: 1;
  min-width: 0;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  outline: none;
}

.select-input:focus {
  border-color: var(--accent-primary);
}

.picker-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  align-items: center;
}

.inline-field {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.inline-field label {
  font-weight: 500;
  color: var(--text-secondary);
  white-space: nowrap;
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
  padding: 0.25rem 0.25rem 0.25rem 0.375rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  font-size: 0.875rem;
  color: var(--text-primary);
}

.chip-icon {
  margin-left: 0.25rem;
  color: var(--text-secondary);
}

.chip-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 0.75rem;
}

.chip-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
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

.chip-empty {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.search-picker {
  position: relative;
}

.search-results {
  list-style: none;
  margin: 0.25rem 0 0;
  padding: 0.25rem;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

.search-result {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
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

.search-empty {
  padding: 0.375rem 0.5rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.perspective-warning {
  color: var(--warning);
}

.textarea-input {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.5;
  resize: vertical;
  min-height: 100px;
  outline: none;
}

.textarea-input:focus {
  border-color: var(--accent-primary);
}

.form-help {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin: 0;
}
</style>
