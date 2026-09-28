<template>
  <Modal
    title="Generate a character"
    max-width="640px"
    :close-on-overlay-click="false"
    @close="!saving && $emit('close')"
  >
    <div class="form">
      <div class="form-group">
        <label for="generator-idea">Idea</label>
        <textarea
          id="generator-idea"
          v-model="idea"
          class="textarea-input"
          rows="3"
          placeholder="A harbor pub owner who hears everything and trusts no one"
          :disabled="generating"
        ></textarea>
      </div>
      <div class="form-group">
        <label for="generator-name">Name (optional)</label>
        <input
          id="generator-name"
          v-model="name"
          type="text"
          class="text-input"
          placeholder="Leave this empty to let the generator choose"
          :disabled="generating"
        />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="generator-preset">Preset</label>
          <select
            id="generator-preset"
            v-model="presetId"
            class="select-input"
            :disabled="generating"
          >
            <option :value="null">Default preset</option>
            <option v-for="preset in presets" :key="preset.id" :value="preset.id">
              {{ preset.name }}
            </option>
          </select>
        </div>
        <div class="form-group">
          <label for="generator-lorebook">World (optional)</label>
          <select
            id="generator-lorebook"
            v-model="lorebookId"
            class="select-input"
            :disabled="generating"
          >
            <option :value="null">None</option>
            <option v-for="lorebook in lorebooks" :key="lorebook.id" :value="lorebook.id">
              {{ lorebook.name }}
            </option>
          </select>
        </div>
      </div>
      <p class="help-text">
        Pick a lorebook to set the character in its world. The card isn't linked to it.
      </p>
      <div class="generate-row">
        <button
          class="btn btn-secondary btn-small"
          :disabled="!idea.trim() || generating || saving"
          @click="generate"
        >
          <i class="fas fa-wand-magic-sparkles"></i>
          {{ generating ? 'Generating...' : card ? 'Generate again' : 'Generate' }}
        </button>
      </div>

      <template v-if="card">
        <div v-for="field in FIELDS" :key="field.key" class="form-group">
          <label :for="`generated-${field.key}`">{{ field.label }}</label>
          <input
            v-if="field.rows === 0"
            :id="`generated-${field.key}`"
            v-model="card.data[field.key]"
            type="text"
            class="text-input"
          />
          <textarea
            v-else
            :id="`generated-${field.key}`"
            v-model="card.data[field.key]"
            class="textarea-input"
            :rows="field.rows"
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
      <button class="btn btn-secondary" :disabled="saving" @click="$emit('close')">Cancel</button>
      <button v-if="card" class="btn btn-primary" :disabled="!canSave" @click="save">
        <i class="fas fa-user-plus"></i> {{ saving ? 'Saving...' : 'Save to library' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import Modal from './Modal.vue';
import { characterGeneratorAPI } from '../services/api';
import { useToast } from '../composables/useToast';

const FIELDS = [
  { key: 'name', label: 'Name', rows: 0 },
  { key: 'description', label: 'Description', rows: 6 },
  { key: 'personality', label: 'Personality', rows: 3 },
  { key: 'scenario', label: 'Scenario', rows: 2 },
  { key: 'first_mes', label: 'First message', rows: 3 },
  { key: 'mes_example', label: 'Example dialogue', rows: 3 },
];

const APPEARANCE = [
  { key: 'age_range', label: 'Age' },
  { key: 'build', label: 'Build' },
  { key: 'hair', label: 'Hair' },
  { key: 'eyes', label: 'Eyes' },
  { key: 'clothing', label: 'Clothing' },
  { key: 'distinguishing_marks', label: 'Distinguishing marks' },
];

defineProps({
  presets: { type: Array, default: () => [] },
  lorebooks: { type: Array, default: () => [] },
});

const emit = defineEmits(['close', 'created']);
const toast = useToast();

const idea = ref('');
const name = ref('');
const presetId = ref(null);
const lorebookId = ref(null);
const card = ref(null);
const generating = ref(false);
const saving = ref(false);
let controller = null;

const canSave = computed(
  () => Boolean(card.value?.data.name?.trim()) && !generating.value && !saving.value,
);

async function generate() {
  generating.value = true;
  controller = new AbortController();
  try {
    const result = await characterGeneratorAPI.generate(
      {
        idea: idea.value.trim(),
        name: name.value.trim(),
        presetId: presetId.value ?? undefined,
        lorebookId: lorebookId.value ?? undefined,
      },
      { signal: controller.signal },
    );
    result.card.data.extensions ??= {};
    result.card.data.extensions.bureau_appearance ??= {};
    card.value = result.card;
  } catch (error) {
    if (error.name !== 'AbortError') {
      toast.error('Failed to generate the character: ' + error.message);
    }
  } finally {
    generating.value = false;
    controller = null;
  }
}

async function save() {
  saving.value = true;
  try {
    const character = await characterGeneratorAPI.save(card.value);
    toast.success(`Saved "${character.name}" to the library`);
    emit('created', character);
    emit('close');
  } catch (error) {
    toast.error('Failed to save the character: ' + error.message);
  } finally {
    saving.value = false;
  }
}

// Closing the modal stops a generation still running.
onBeforeUnmount(() => controller?.abort());
</script>

<style scoped src="./bureau/bureau-ui.css"></style>

<style scoped>
.form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 0.75rem;
}

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
