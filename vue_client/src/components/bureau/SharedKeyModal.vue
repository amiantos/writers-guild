<template>
  <Modal title="Shared API key" :close-on-overlay-click="false" @close="$emit('close')">
    <div class="form">
      <p class="help-text">
        Every Bureau without a key of its own uses this DeepSeek API key. A key in a Bureau's
        settings takes its place for that Bureau, which also keeps its billing separate.
      </p>

      <div v-if="loading" class="loading">Loading...</div>
      <div v-else class="form-group">
        <label for="shared-api-key">DeepSeek API key</label>
        <p v-if="sharedKey.hasApiKey" class="status-line">
          <i class="fas fa-lock"></i> Saved key {{ sharedKey.apiKeyPreview }}
        </p>
        <input
          id="shared-api-key"
          ref="keyInput"
          v-model="apiKey"
          type="password"
          class="text-input"
          autocomplete="off"
          :placeholder="sharedKey.hasApiKey ? 'Paste a new key to replace it' : 'sk-...'"
          @keydown.enter="save"
        />
      </div>
    </div>

    <template #footer>
      <button
        v-if="sharedKey.hasApiKey"
        class="btn btn-danger remove-key"
        :disabled="saving"
        @click="removeKey"
      >
        Remove key
      </button>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="!apiKey.trim() || saving" @click="save">
        <i class="fas fa-save"></i> {{ saving ? 'Saving...' : 'Save key' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { nextTick, onMounted, ref } from 'vue';
import Modal from '../Modal.vue';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';

const emit = defineEmits(['close', 'saved']);
const toast = useToast();
const { confirm } = useConfirm();

const keyInput = ref(null);
const sharedKey = ref({ hasApiKey: false, apiKeyPreview: '' });
const apiKey = ref('');
const loading = ref(true);
const saving = ref(false);

async function update(value, message) {
  saving.value = true;
  try {
    const data = await bureausAPI.updateSharedKey(value);
    toast.success(message);
    emit('saved', data.sharedKey);
  } catch (error) {
    toast.error('Failed to save the shared key: ' + error.message);
  } finally {
    saving.value = false;
  }
}

function save() {
  if (!apiKey.value.trim() || saving.value) return;
  update(apiKey.value.trim(), 'Shared key saved');
}

async function removeKey() {
  const confirmed = await confirm({
    message:
      "Remove the shared API key? Bureaus without a key of their own can't generate until you add another.",
    confirmText: 'Remove key',
    variant: 'danger',
  });
  if (confirmed) update('', 'Shared key removed');
}

onMounted(async () => {
  try {
    sharedKey.value = (await bureausAPI.sharedKey()).sharedKey;
  } catch (error) {
    toast.error('Failed to load the shared key: ' + error.message);
  } finally {
    loading.value = false;
  }
  await nextTick();
  keyInput.value?.focus();
});
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.remove-key {
  margin-right: auto;
}
</style>
