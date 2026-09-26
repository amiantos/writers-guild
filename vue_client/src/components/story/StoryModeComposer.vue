<template>
  <div class="composer">
    <textarea
      ref="inputRef"
      v-model="text"
      class="composer-input"
      rows="3"
      :disabled="generating"
      placeholder="Write what happens next, or an instruction for the model..."
      aria-label="Write or instruct the next part of the story"
      @keydown="handleKeydown"
    ></textarea>

    <div class="composer-bar">
      <div v-if="!generating" class="composer-options">
        <button
          v-if="empty"
          class="btn btn-secondary btn-small"
          title="Open the story with a greeting from a character's card"
          :disabled="!ready"
          @click="$emit('greeting')"
        >
          <i class="fas fa-message"></i> Greeting
        </button>
        <button
          class="btn btn-secondary btn-small"
          title="Add your text to the story without continuing"
          :disabled="!ready || !text.trim()"
          @click="submit('add')"
        >
          <i class="fas fa-plus"></i> Add
        </button>
        <slot name="tools"></slot>
      </div>

      <div class="composer-actions">
        <template v-if="!generating">
          <button
            v-if="empty"
            class="btn btn-secondary"
            title="Let the model open the story"
            :disabled="!ready"
            @click="$emit('start')"
          >
            <i class="fas fa-rocket"></i> Start Story
          </button>
          <template v-else>
            <button
              v-if="canContinueForCharacter"
              class="btn btn-secondary"
              title="Continue from one character's perspective"
              :disabled="!ready"
              @click="$emit('character')"
            >
              <i class="fas fa-comments"></i> Continue for Character
            </button>
            <button
              class="btn btn-secondary"
              title="Let the model continue the story"
              :disabled="!ready"
              @click="$emit('continue')"
            >
              <i class="fas fa-play"></i> Continue
            </button>
          </template>
          <button
            class="btn btn-secondary"
            title="Continue with your text as an instruction, which isn't added to the story"
            :disabled="!ready || !text.trim()"
            @click="submit('instruct')"
          >
            <i class="fas fa-wand-magic-sparkles"></i> Instruct
          </button>
          <button
            class="btn btn-primary"
            :title="`Add your text to the story, then ${canContinueForCharacter ? 'continue for a character' : 'continue'} (Ctrl or ⌘ + Enter)`"
            :disabled="!ready || !text.trim()"
            @click="submit('send')"
          >
            <i class="fas fa-paper-plane"></i> Send
          </button>
        </template>
        <template v-else>
          <span class="composer-status">
            <span class="spinner" aria-hidden="true"></span>
            {{ status }}
          </span>
          <button class="btn btn-danger" title="Stop generation" @click="$emit('stop')">
            <i class="fas fa-stop"></i> Stop
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const props = defineProps({
  generating: { type: Boolean, default: false },
  /** What the generation is doing, as the toolbar shows it. */
  status: { type: String, default: '' },
  /** The story has loaded, so there's something to write into. */
  ready: { type: Boolean, default: false },
  /** The story is empty, so it's started rather than continued. */
  empty: { type: Boolean, default: false },
  /** The story has characters, so Send and Continue for Character can write for one. */
  canContinueForCharacter: { type: Boolean, default: false },
});

const emit = defineEmits([
  'send',
  'add',
  'instruct',
  'continue',
  'character',
  'start',
  'greeting',
  'stop',
]);

const text = ref('');
const inputRef = ref(null);

function submit(action) {
  const trimmed = text.value.trim();
  if (props.generating || !props.ready || !trimmed) return;
  emit(action, trimmed);
  text.value = '';
}

function handleKeydown(event) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    submit('send');
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

.composer-options {
  position: relative;
}

.composer-actions {
  margin-left: auto;
}

.composer-status {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  color: var(--text-secondary);
}

.spinner {
  width: 18px;
  height: 18px;
  border: 3px solid var(--border-color);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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
