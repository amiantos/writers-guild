<template>
  <Modal title="Who's in this chapter" max-width="480px" @close="$emit('close')">
    <div class="form">
      <p class="help-text">The Writer only sees the cards of characters who are in the chapter.</p>
      <div class="form-group">
        <label v-for="member in cast" :key="member.id" class="checkbox-label">
          <input v-model="castIds" type="checkbox" :value="member.id" :disabled="readonly" />
          {{ member.name }}
          <span v-if="member.isPersona" class="persona-tag">Reader's character</span>
        </label>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">
        {{ readonly ? 'Close' : 'Cancel' }}
      </button>
      <button
        v-if="!readonly"
        class="btn btn-primary"
        :disabled="saving || castIds.length === 0"
        @click="save"
      >
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
  cast: { type: Array, required: true },
  readonly: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'updated']);
const toast = useToast();

const castIds = ref([...props.story.castIds]);
const saving = ref(false);

async function save() {
  saving.value = true;
  try {
    const { story } = await bureauStoriesAPI.update(props.bureauId, props.story.id, {
      castIds: castIds.value,
    });
    emit('updated', story);
  } catch (error) {
    toast.error("Failed to update who's in the chapter: " + error.message);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped src="./bureau-ui.css"></style>
