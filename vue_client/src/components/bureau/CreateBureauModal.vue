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

      <div v-if="!keyChecked" class="form-group">
        <span class="group-label">DeepSeek API key</span>
        <p class="status-line">Checking for a shared key...</p>
      </div>
      <div v-else-if="usesSharedKey" class="form-group">
        <span class="group-label">DeepSeek API key</span>
        <p class="status-line">
          <i class="fas fa-key"></i> Uses the shared key {{ sharedKey.apiKeyPreview }}
        </p>
        <div>
          <button class="btn btn-secondary btn-small" @click="ownKey = true">
            Use a different key for this Bureau
          </button>
        </div>
      </div>
      <div v-else class="form-group">
        <label for="new-bureau-api-key">DeepSeek API key</label>
        <input
          id="new-bureau-api-key"
          v-model="apiKey"
          type="password"
          class="text-input"
          autocomplete="off"
          placeholder="sk-..."
        />
        <label v-if="canShare" class="checkbox-label">
          <input id="new-bureau-share-key" v-model="shareKey" type="checkbox" />
          Share it with every Bureau that has no key of its own
        </label>
        <p class="help-text">
          {{
            sharedKey?.hasApiKey
              ? 'Only this Bureau uses it, which also keeps its billing separate. Leave it empty to use the shared key.'
              : 'You can add it later.'
          }}
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
      <button
        class="btn btn-primary"
        :disabled="!name.trim() || creating || !keyChecked"
        @click="create"
      >
        <i class="fas fa-plus"></i> {{ creating ? 'Creating...' : 'Create Bureau' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
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
// Whether a shared key is saved, once known. Creating waits for the check, so a key typed before it
// can't be dropped or go unshared.
const sharedKey = ref(null);
const keyChecked = ref(false);
const ownKey = ref(false);
const shareKey = ref(true);

// With a shared key saved, the new Bureau uses it unless it's given its own.
const usesSharedKey = computed(() => Boolean(sharedKey.value?.hasApiKey) && !ownKey.value);
// Without one, the key typed here can become the shared key.
const canShare = computed(() => sharedKey.value?.hasApiKey === false);

async function create() {
  if (!name.value.trim() || creating.value || !keyChecked.value) return;
  creating.value = true;
  try {
    const { bureau } = await bureausAPI.create({
      name: name.value.trim(),
      description: description.value.trim(),
      apiKey: usesSharedKey.value ? '' : apiKey.value.trim(),
      // The server shares the key only if no shared key has been saved since this opened.
      shareApiKey: canShare.value && shareKey.value,
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

onMounted(async () => {
  nameInput.value?.focus();
  try {
    sharedKey.value = (await bureausAPI.sharedKey()).sharedKey;
  } catch (error) {
    // The key field still works; the key is this Bureau's own.
    console.error('Failed to load the shared key:', error);
  } finally {
    keyChecked.value = true;
  }
});
</script>

<style scoped src="./bureau-ui.css"></style>
