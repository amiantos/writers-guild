<template>
  <Modal title="Edit Story" :close-on-overlay-click="false" @close="$emit('close')">
    <div class="edit-story-content">
      <div class="form-group">
        <label for="storyTitle">Story Title *</label>
        <input
          id="storyTitle"
          ref="titleInput"
          v-model="storyTitle"
          type="text"
          class="text-input"
          placeholder="Enter story title..."
          @keydown.enter.prevent
        />
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
        <label for="storyPerspective">Perspective</label>
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
      </div>

      <div v-if="characterLabel" class="form-group">
        <label for="storyPerspectiveCharacter">{{ characterLabel }}</label>
        <select
          id="storyPerspectiveCharacter"
          v-model="perspectiveCharacterId"
          class="select-input"
        >
          <option :value="null">Not set</option>
          <option v-for="option in characterOptions" :key="option.id" :value="option.id">
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
import { ref, computed, onMounted } from 'vue';
import Modal from './Modal.vue';
import ContinuityPicker from './ContinuityPicker.vue';
import { storiesAPI, presetsAPI } from '../services/api';
import {
  DEFAULT_PERSPECTIVE_MODE,
  DEFAULT_PERSPECTIVE_TENSE,
  PERSPECTIVE_MODES,
  PERSPECTIVE_TENSES,
} from '../../../shared/perspective.js';
import { useToast } from '../composables/useToast';

const props = defineProps({
  story: {
    type: Object,
    required: true,
  },
  // The story's characters, for picking a narrator or viewpoint character
  characters: {
    type: Array,
    default: () => [],
  },
  // The story's Persona ({ id, name }), who can also narrate
  persona: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['close', 'updated']);

const toast = useToast();
const storyTitle = ref(props.story.title || '');
const storyScenario = ref(props.story.scenario || '');
const saving = ref(false);
const titleInput = ref(null);
const continuityPicker = ref(null);
const perspective = ref(props.story.perspective || DEFAULT_PERSPECTIVE_MODE);
const perspectiveTense = ref(props.story.perspectiveTense || DEFAULT_PERSPECTIVE_TENSE);
const perspectiveCharacterId = ref(props.story.perspectiveCharacterId ?? null);
// The preset's custom system prompt leaves out {{perspective}}
const presetIgnoresPerspective = ref(false);

const characterLabel = computed(
  () => PERSPECTIVE_MODES.find((mode) => mode.value === perspective.value)?.character || null,
);

const characterOptions = computed(() => {
  const options = props.characters.map((c) => ({ id: c.id, name: c.name }));
  if (props.persona && !options.some((option) => option.id === props.persona.id)) {
    options.unshift({ id: props.persona.id, name: `${props.persona.name} (Persona)` });
  }
  // A narrator no longer in the story stays listed, so saving doesn't silently drop them.
  const current = perspectiveCharacterId.value;
  if (current && !options.some((option) => option.id === current)) {
    options.push({ id: current, name: 'Not in this story' });
  }
  return options;
});

async function checkPresetUsesPerspective() {
  try {
    const presetId =
      props.story.configPresetId || (await presetsAPI.getDefaultId()).defaultPresetId;
    if (!presetId) return;
    const { preset } = await presetsAPI.get(presetId);
    const template = preset?.promptTemplates?.systemPrompt;
    presetIgnoresPerspective.value = Boolean(template) && !template.includes('{{perspective}}');
  } catch (error) {
    console.error('Failed to check the story preset:', error);
  }
}

onMounted(() => {
  checkPresetUsesPerspective();
  // Focus title input when modal opens
  if (titleInput.value) {
    titleInput.value.focus();
    // Select all text for easy overwriting
    titleInput.value.select();
  }
});

async function saveStory() {
  if (!storyTitle.value.trim() || saving.value) return;

  try {
    saving.value = true;

    const updates = {
      title: storyTitle.value.trim(),
      scenario: storyScenario.value.trim(),
      // Defaults are stored as null, so they follow the default if it ever changes
      perspective: perspective.value === DEFAULT_PERSPECTIVE_MODE ? null : perspective.value,
      perspectiveTense:
        perspectiveTense.value === DEFAULT_PERSPECTIVE_TENSE ? null : perspectiveTense.value,
      perspectiveCharacterId: characterLabel.value ? perspectiveCharacterId.value : null,
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
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.edit-story-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
