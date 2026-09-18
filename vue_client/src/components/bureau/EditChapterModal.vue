<template>
  <Modal title="Edit chapter" max-width="560px" @close="$emit('close')">
    <div class="form">
      <div class="form-group">
        <label for="chapter-title">Chapter title</label>
        <input
          id="chapter-title"
          v-model="title"
          type="text"
          class="text-input"
          @keydown.enter.prevent
        />
      </div>

      <div class="form-group">
        <label for="chapter-scenario">Chapter scenario</label>
        <textarea
          id="chapter-scenario"
          v-model="scenario"
          class="textarea-input"
          rows="5"
          placeholder="Set a scenario for this chapter. This describes the initial situation, setting, or premise..."
        ></textarea>
        <p class="help-text">
          The Writer gets it at the top of every prompt, as story mode's story scenario.
        </p>
      </div>

      <div class="form-group">
        <label for="chapter-summary">Summary</label>
        <p v-if="story.summaryNeedsReview" class="notice">
          <i class="fas fa-triangle-exclamation"></i> A passage changed after this was written, so
          it may be out of date. Saving marks it checked.
        </p>
        <textarea
          id="chapter-summary"
          v-model="summary"
          class="textarea-input"
          rows="6"
          placeholder="The Archivist writes this up as the chapter is committed to memory."
        ></textarea>
        <p class="help-text">
          What happened in the chapter. Later chapters are written with it, and so are replies and
          accounts of time away for the characters who were in it.
        </p>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="!title.trim() || saving" @click="save">
        <i class="fas fa-save"></i> {{ saving ? 'Saving...' : 'Save' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref } from 'vue';
import Modal from '../Modal.vue';
import { bureauStoriesAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';

const props = defineProps({
  bureauId: { type: String, required: true },
  story: { type: Object, required: true },
});

const emit = defineEmits(['close', 'updated']);
const toast = useToast();

const title = ref(props.story.title ?? '');
const scenario = ref(props.story.scenario ?? '');
const summary = ref(props.story.summary ?? '');
const saving = ref(false);

async function save() {
  if (!title.value.trim() || saving.value) return;
  saving.value = true;
  try {
    const updates = { title: title.value.trim(), scenario: scenario.value.trim() };
    // Sent when changed, or to mark one waiting for review as checked.
    if (summary.value.trim() !== (props.story.summary ?? '') || props.story.summaryNeedsReview) {
      updates.summary = summary.value.trim();
    }
    const { story } = await bureauStoriesAPI.update(props.bureauId, props.story.id, updates);
    emit('updated', story);
  } catch (error) {
    toast.error('Failed to save the chapter: ' + error.message);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped src="./bureau-ui.css"></style>
