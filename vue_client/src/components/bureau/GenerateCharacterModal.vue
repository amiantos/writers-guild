<template>
  <Modal title="Generate a character" max-width="640px" @close="$emit('close')">
    <div class="form">
      <div class="form-group">
        <label for="generate-idea">Idea</label>
        <textarea
          id="generate-idea"
          v-model="idea"
          class="textarea-input"
          rows="3"
          placeholder="A harbor pub owner who hears everything and trusts no one"
          :disabled="generating"
        ></textarea>
        <p class="help-text">
          The generator knows this Bureau's cast and world, so the character fits in without
          repeating anyone.
        </p>
      </div>
      <div class="form-group">
        <label for="generate-name">Name (optional)</label>
        <input
          id="generate-name"
          v-model="name"
          type="text"
          class="text-input"
          placeholder="Leave this empty to let the generator choose"
          :disabled="generating"
        />
      </div>
      <div v-if="forChapter" class="form-group">
        <label for="generate-role">Their part in this chapter (optional)</label>
        <input
          id="generate-role"
          v-model="role"
          type="text"
          class="text-input"
          placeholder="The courier who brings the letter"
          :disabled="generating"
        />
      </div>
      <div class="generate-row">
        <button
          class="btn btn-secondary btn-small"
          :disabled="!idea.trim() || generating || adding"
          @click="generate"
        >
          <i class="fas fa-wand-magic-sparkles"></i>
          {{ generating ? 'Generating...' : card ? 'Generate again' : 'Generate' }}
        </button>
      </div>

      <template v-if="card">
        <div class="form-group">
          <label for="generated-name">Name</label>
          <input id="generated-name" v-model="card.data.name" type="text" class="text-input" />
        </div>
        <div class="form-group">
          <label for="generated-description">Description</label>
          <textarea
            id="generated-description"
            v-model="card.data.description"
            class="textarea-input"
            rows="6"
          ></textarea>
        </div>
        <div class="form-group">
          <label for="generated-personality">Personality</label>
          <textarea
            id="generated-personality"
            v-model="card.data.personality"
            class="textarea-input"
            rows="3"
          ></textarea>
        </div>
        <div class="form-group">
          <label for="generated-scenario">Scenario</label>
          <textarea
            id="generated-scenario"
            v-model="card.data.scenario"
            class="textarea-input"
            rows="2"
          ></textarea>
        </div>
        <div class="form-group">
          <label for="generated-first-message">First message</label>
          <textarea
            id="generated-first-message"
            v-model="card.data.first_mes"
            class="textarea-input"
            rows="3"
          ></textarea>
        </div>
        <details class="appearance">
          <summary>Appearance</summary>
          <div class="appearance-grid">
            <div v-for="field in APPEARANCE" :key="field.key" class="form-group">
              <label :for="`appearance-${field.key}`">{{ field.label }}</label>
              <input
                :id="`appearance-${field.key}`"
                v-model="card.data.extensions.bureau_appearance[field.key]"
                type="text"
                class="text-input"
              />
            </div>
          </div>
        </details>
      </template>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <template v-if="card">
        <button class="btn btn-secondary" :disabled="!canAdd" @click="add(true)">
          Add and save to library
        </button>
        <button class="btn btn-primary" :disabled="!canAdd" @click="add(false)">
          <i class="fas fa-user-plus"></i> {{ adding ? 'Adding...' : 'Add to cast' }}
        </button>
      </template>
    </template>
  </Modal>
</template>

<script setup>
import { computed, ref } from 'vue';
import Modal from '../Modal.vue';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';

const APPEARANCE = [
  { key: 'age_range', label: 'Age' },
  { key: 'build', label: 'Build' },
  { key: 'hair', label: 'Hair' },
  { key: 'eyes', label: 'Eyes' },
  { key: 'clothing', label: 'Clothing' },
  { key: 'distinguishing_marks', label: 'Distinguishing marks' },
];

const props = defineProps({
  bureauId: { type: String, required: true },
  /** Generating from inside a chapter, where a character has a part to play in it. */
  forChapter: { type: Boolean, default: false },
});

const emit = defineEmits(['close', 'added']);
const toast = useToast();

const idea = ref('');
const name = ref('');
const role = ref('');
const card = ref(null);
const generating = ref(false);
const adding = ref(false);

const canAdd = computed(
  () => Boolean(card.value?.data.name?.trim()) && !generating.value && !adding.value,
);

async function generate() {
  generating.value = true;
  try {
    const result = await bureausAPI.generateCharacter(props.bureauId, idea.value.trim(), {
      name: name.value.trim(),
      role: role.value.trim(),
    });
    result.card.data.extensions ??= {};
    result.card.data.extensions.bureau_appearance ??= {};
    card.value = result.card;
  } catch (error) {
    toast.error('Failed to generate the character: ' + error.message);
  } finally {
    generating.value = false;
  }
}

async function add(saveToLibrary) {
  adding.value = true;
  try {
    card.value.data.name = card.value.data.name.trim();
    const { castMember } = await bureausAPI.addDraft(props.bureauId, card.value);
    if (!saveToLibrary) {
      emit('added', { castMember, savedToLibrary: false });
      return;
    }
    // The draft is in the cast either way, so a failed save still closes the modal: adding the
    // card again would make a second draft.
    try {
      const promoted = await bureausAPI.promoteCast(props.bureauId, castMember.id);
      emit('added', { castMember: promoted.castMember, savedToLibrary: true });
    } catch (error) {
      emit('added', { castMember, savedToLibrary: false, libraryError: error.message });
    }
  } catch (error) {
    toast.error('Failed to add the character: ' + error.message);
  } finally {
    adding.value = false;
  }
}
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.generate-row {
  display: flex;
  justify-content: flex-end;
}

.appearance summary {
  cursor: pointer;
  font-weight: 600;
  font-size: 0.875rem;
}

.appearance-grid {
  margin-top: 0.75rem;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
}
</style>
