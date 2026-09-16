<template>
  <Modal title="Who's in this chapter" max-width="480px" @close="$emit('close')">
    <div class="form">
      <p class="help-text">The Writer only sees the cards of characters who are in the chapter.</p>
      <div class="form-group">
        <div v-for="member in cast" :key="member.id" class="cast-option">
          <label class="checkbox-label">
            <input v-model="castIds" type="checkbox" :value="member.id" :disabled="readonly" />
            {{ member.name }}
            <span v-if="member.isPersona" class="persona-tag">Reader's character</span>
          </label>
          <button
            class="icon-btn"
            :title="`${member.name}'s profile`"
            @click="$emit('profile', member)"
          >
            <i class="fas fa-id-card"></i>
          </button>
        </div>
      </div>
      <div v-if="!readonly" class="cast-actions">
        <button class="btn btn-secondary btn-small" @click="showLibrary = true">
          <i class="fas fa-book"></i> Add from library
        </button>
        <button
          class="btn btn-secondary btn-small"
          :disabled="!hasApiKey"
          :title="hasApiKey ? '' : 'This Bureau needs an API key to generate a character.'"
          @click="showGenerate = true"
        >
          <i class="fas fa-wand-magic-sparkles"></i> Generate a character
        </button>
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

  <AddCastModal
    v-if="showLibrary"
    :bureau-id="bureauId"
    :cast="cast"
    :allow-persona="false"
    @added="castAdded"
    @close="showLibrary = false"
  />
  <GenerateCharacterModal
    v-if="showGenerate"
    :bureau-id="bureauId"
    for-chapter
    @added="castAdded"
    @close="showGenerate = false"
  />
</template>

<script setup>
import { ref } from 'vue';
import Modal from '../Modal.vue';
import AddCastModal from './AddCastModal.vue';
import GenerateCharacterModal from './GenerateCharacterModal.vue';
import { bureauStoriesAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';

const props = defineProps({
  bureauId: { type: String, required: true },
  story: { type: Object, required: true },
  cast: { type: Array, required: true },
  hasApiKey: { type: Boolean, default: false },
  readonly: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'updated', 'profile', 'cast-added']);
const toast = useToast();

const castIds = ref([...props.story.castIds]);
const saving = ref(false);
const showLibrary = ref(false);
const showGenerate = ref(false);

/**
 * Someone added here joins the Bureau's cast, so they're ticked into the chapter and left for
 * Save. The library stays open for adding several; the generator is done once its card is added.
 */
function castAdded(result) {
  showGenerate.value = false;
  const member = result?.castMember;
  if (!member) return;
  if (!castIds.value.includes(member.id)) {
    castIds.value.push(member.id);
  }
  // The whole result travels on: it says whether the library save failed and whether the
  // character's lorebook was attached to the Bureau.
  emit('cast-added', result);
}

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

<style scoped>
.cast-option {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.cast-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
</style>
