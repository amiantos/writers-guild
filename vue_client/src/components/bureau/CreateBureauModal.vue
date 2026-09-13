<template>
  <Modal title="New Bureau" :close-on-overlay-click="false" @close="$emit('close')">
    <div class="form">
      <div class="form-group">
        <label for="new-bureau-name">Name *</label>
        <input
          id="new-bureau-name"
          ref="nameInput"
          v-model="name"
          type="text"
          class="text-input"
          placeholder="For example, Greywater Harbor"
          @keydown.enter="create"
        />
      </div>

      <div class="form-group">
        <label for="new-bureau-description">Description</label>
        <textarea
          id="new-bureau-description"
          v-model="description"
          class="textarea-input"
          rows="2"
          placeholder="What this Bureau is for"
        ></textarea>
      </div>

      <div class="form-group">
        <label for="new-bureau-api-key">DeepSeek API key</label>
        <input
          id="new-bureau-api-key"
          v-model="apiKey"
          type="password"
          class="text-input"
          autocomplete="off"
          placeholder="sk-..."
        />
        <p class="help-text">
          Each Bureau uses its own key, which also keeps billing separate. You can add it later.
        </p>
      </div>

      <div class="form-group">
        <label for="new-bureau-model">Model</label>
        <input
          id="new-bureau-model"
          v-model="model"
          type="text"
          class="text-input"
          list="new-bureau-models"
        />
        <datalist id="new-bureau-models">
          <option value="deepseek-flash">DeepSeek V4.1 Flash</option>
          <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
        </datalist>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="!name.trim() || creating" @click="create">
        <i class="fas fa-plus"></i> {{ creating ? 'Creating...' : 'Create Bureau' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import Modal from '../Modal.vue';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';

const emit = defineEmits(['close', 'created']);
const toast = useToast();

const nameInput = ref(null);
const name = ref('');
const description = ref('');
const apiKey = ref('');
const model = ref('deepseek-flash');
const creating = ref(false);

async function create() {
  if (!name.value.trim() || creating.value) return;
  creating.value = true;
  try {
    const { bureau } = await bureausAPI.create({
      name: name.value.trim(),
      description: description.value.trim(),
      apiKey: apiKey.value.trim(),
      model: model.value.trim() || undefined,
    });
    toast.success(`Created ${bureau.name}`);
    emit('created', bureau);
  } catch (error) {
    console.error('Failed to create Bureau:', error);
    toast.error('Failed to create Bureau: ' + error.message);
  } finally {
    creating.value = false;
  }
}

onMounted(() => nameInput.value?.focus());
</script>

<style scoped src="./bureau-ui.css"></style>
