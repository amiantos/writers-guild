<template>
  <Modal :title="`${member.name}'s routine`" max-width="560px" @close="$emit('close')">
    <div class="form">
      <div class="form-group">
        <label for="routine-text">Usual routine</label>
        <textarea
          id="routine-text"
          v-model="text"
          class="textarea-input"
          rows="6"
          maxlength="2000"
          placeholder="Keeps the light from dusk to dawn, sleeps through the mornings, and eats lunch at the harbor pub on Fridays."
        ></textarea>
        <p class="help-text">
          How {{ member.name }} usually spends their days and weeks. Replies take it into account at
          each time of day, and so does their offscreen life when time jumps forward.
        </p>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="saving" @click="save">
        <i class="fas fa-save"></i> {{ saving ? 'Saving...' : 'Save routine' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref } from 'vue';
import Modal from '../Modal.vue';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';

const props = defineProps({
  bureauId: { type: String, required: true },
  /** A cast member from the cast list, with their routine. */
  member: { type: Object, required: true },
});

const emit = defineEmits(['close', 'saved']);
const toast = useToast();

const text = ref(props.member.routine?.text ?? '');
const saving = ref(false);

async function save() {
  saving.value = true;
  try {
    const { castMember } = await bureausAPI.updateCast(props.bureauId, props.member.id, {
      routine: text.value.trim(),
    });
    emit('saved', castMember);
  } catch (error) {
    toast.error('Failed to save the routine: ' + error.message);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped src="./bureau-ui.css"></style>
