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
import { ref, onMounted } from 'vue';
import Modal from './Modal.vue';
import ContinuityPicker from './ContinuityPicker.vue';
import { storiesAPI } from '../services/api';
import { useToast } from '../composables/useToast';

const props = defineProps({
  story: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(['close', 'updated']);

const toast = useToast();
const storyTitle = ref(props.story.title || '');
const storyScenario = ref(props.story.scenario || '');
const saving = ref(false);
const titleInput = ref(null);
const continuityPicker = ref(null);

onMounted(() => {
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
