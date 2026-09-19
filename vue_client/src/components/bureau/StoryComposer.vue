<template>
  <div class="composer">
    <p v-if="!hasApiKey" class="composer-warning">
      <i class="fas fa-key"></i> This Bureau has no API key. Add one in its settings, or a shared
      key on the Bureaus tab, to generate.
    </p>

    <textarea
      ref="inputRef"
      v-model="text"
      class="composer-input"
      rows="3"
      :disabled="generating"
      placeholder="Write what happens next, or a direction for the Writer..."
      aria-label="Write or direct the next part of the chapter"
      @keydown="handleKeydown"
    ></textarea>

    <div class="composer-bar">
      <div class="composer-options">
        <button
          v-if="canUseGreeting"
          class="btn btn-secondary btn-small"
          title="Open the chapter with a greeting from a character's card"
          :disabled="generating"
          @click="$emit('greeting')"
        >
          <i class="fas fa-message"></i> Greeting
        </button>
        <button
          class="btn btn-secondary btn-small"
          title="Add a scene break"
          :disabled="generating"
          @click="$emit('scene-break')"
        >
          <i class="fas fa-grip-lines"></i> Scene break
        </button>
        <button
          class="btn btn-secondary btn-small"
          title="Move the chapter's time forward"
          :disabled="generating"
          @click="$emit('time-passes')"
        >
          <i class="fas fa-hourglass-half"></i> Time passes
        </button>
      </div>

      <div class="composer-actions">
        <template v-if="!generating">
          <button
            v-if="canContinueForCharacter"
            class="btn btn-secondary"
            title="Let the Writer continue from one character's perspective"
            :disabled="!hasApiKey"
            @click="$emit('character')"
          >
            <i class="fas fa-comments"></i> Continue for Character
          </button>
          <button
            class="btn btn-secondary"
            :title="empty ? 'Let the Writer open the chapter' : 'Let the Writer continue'"
            :disabled="!hasApiKey"
            @click="submit('continue')"
          >
            <template v-if="empty"><i class="fas fa-rocket"></i> Start</template>
            <template v-else><i class="fas fa-forward"></i> Continue</template>
          </button>
          <button
            class="btn btn-secondary"
            title="Tell the Writer what should happen next"
            :disabled="!hasApiKey || !text.trim()"
            @click="submit('direct')"
          >
            <i class="fas fa-compass"></i> Direct
          </button>
          <button
            class="btn btn-primary"
            title="Add your text to the chapter, then the Writer continues from it (Ctrl or ⌘ + Enter)"
            :disabled="!hasApiKey || !text.trim()"
            @click="submit('write')"
          >
            <i class="fas fa-feather"></i> Write
          </button>
        </template>
        <button v-else class="btn btn-danger" @click="$emit('stop')">
          <i class="fas fa-stop"></i> Stop
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const props = defineProps({
  generating: { type: Boolean, default: false },
  hasApiKey: { type: Boolean, default: true },
  /** Offer to open the chapter with a greeting, before it has any prose. */
  canUseGreeting: { type: Boolean, default: false },
  /** The chapter has no prose yet, so Continue starts it, as story mode's Start Story does. */
  empty: { type: Boolean, default: false },
  /** Offer Continue for Character, once the chapter has prose and a character to write for. */
  canContinueForCharacter: { type: Boolean, default: false },
});

const emit = defineEmits([
  'generate',
  'character',
  'greeting',
  'scene-break',
  'time-passes',
  'stop',
]);

const text = ref('');
const inputRef = ref(null);

function submit(action) {
  const trimmed = text.value.trim();
  if (props.generating || !props.hasApiKey) return;
  if (action !== 'continue' && !trimmed) return;

  emit('generate', {
    action,
    text: action === 'continue' ? '' : trimmed,
  });
  if (action !== 'continue') {
    text.value = '';
  }
}

function handleKeydown(event) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    submit('write');
  }
}

defineExpose({
  /** Put text back after a generation failed before anything was saved. */
  restore(value) {
    text.value = value;
    inputRef.value?.focus();
  },
});
</script>

<style scoped>
.composer {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.875rem 1.5rem 1rem;
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
}

.composer-warning {
  margin: 0;
  font-size: 0.85rem;
  color: var(--warning);
}

.composer-input {
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  box-sizing: border-box;
  padding: 0.75rem 1rem;
  font: inherit;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--text-primary);
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  resize: vertical;
  outline: none;
}

.composer-input:focus {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(139, 90, 43, 0.1);
}

.composer-bar {
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.625rem;
}

.composer-options,
.composer-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

@media (max-width: 700px) {
  .composer {
    padding: 0.625rem 0.75rem 0.75rem;
  }

  .composer-actions {
    width: 100%;
  }

  .composer-actions .btn {
    flex: 1;
  }
}
</style>
