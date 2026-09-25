<template>
  <Modal title="Edit Chat" :close-on-overlay-click="false" @close="$emit('close')">
    <div class="edit-chat-content">
      <div class="form-group">
        <label for="chatTitle">Chat Title *</label>
        <input
          id="chatTitle"
          ref="titleInput"
          v-model="chatTitle"
          type="text"
          class="text-input"
          maxlength="200"
          placeholder="Enter chat title..."
          @keydown.enter.prevent
        />
      </div>

      <div class="form-group">
        <label for="chatScenario">Describe this scenario</label>
        <textarea
          id="chatScenario"
          ref="scenarioInput"
          v-model="chatScenario"
          class="textarea-input"
          maxlength="8000"
          placeholder="Set the scene for the texts: where everyone is, what time it is, and what's going on. For example: It's nearly midnight on a Tuesday. {{user}} is traveling for work and texts {{char}} while she's at home."
          rows="5"
        ></textarea>
        <p class="form-help">
          Sent with every reply, so characters know the situation they're texting in.
          <code v-text="'{{user}}'"></code> and <code v-text="'{{char}}'"></code> work here.
        </p>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="!chatTitle.trim() || saving" @click="saveChat">
        <i class="fas fa-save"></i>
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import Modal from '../Modal.vue';
import { chatsAPI } from '../../services/chatsApi';
import { useToast } from '../../composables/useToast';

const props = defineProps({
  chat: {
    type: Object,
    required: true,
  },
  /** Focus the scenario rather than the title. */
  focusScenario: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'updated']);

const toast = useToast();
const chatTitle = ref(props.chat.title || '');
const chatScenario = ref(props.chat.scenario || '');
const saving = ref(false);
const titleInput = ref(null);
const scenarioInput = ref(null);

onMounted(() => {
  if (props.focusScenario) {
    scenarioInput.value?.focus();
  } else if (titleInput.value) {
    titleInput.value.focus();
    titleInput.value.select();
  }
});

async function saveChat() {
  if (!chatTitle.value.trim() || saving.value) return;

  try {
    saving.value = true;
    const { chat } = await chatsAPI.update(props.chat.id, {
      title: chatTitle.value.trim(),
      scenario: chatScenario.value.trim(),
    });
    toast.success('Chat updated successfully');
    emit('updated', chat);
    emit('close');
  } catch (error) {
    console.error('Failed to update chat:', error);
    toast.error('Failed to update chat: ' + error.message);
  } finally {
    saving.value = false;
  }
}
</script>

<style scoped>
.edit-chat-content {
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

.form-help code {
  background-color: var(--bg-tertiary);
  padding: 0.05rem 0.3rem;
  border-radius: 3px;
}
</style>
