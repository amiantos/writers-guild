<template>
  <div class="composer">
    <p v-if="!hasApiKey" class="composer-warning">
      <i class="fas fa-key"></i> This Bureau has no API key. Add one in the Bureau's settings to
      generate.
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
        <label class="focus-label" for="composer-focus">Focus</label>
        <select
          id="composer-focus"
          v-model="leadCastId"
          class="focus-select"
          :disabled="generating"
        >
          <option :value="null">Whoever fits</option>
          <option v-for="member in cast" :key="member.id" :value="member.id">
            {{ member.name }}
          </option>
        </select>
        <button
          class="btn btn-secondary btn-small"
          title="Add a scene break"
          :disabled="generating"
          @click="$emit('scene-break')"
        >
          <i class="fas fa-grip-lines"></i> Scene break
        </button>
      </div>

      <div class="composer-actions">
        <template v-if="!generating">
          <button
            class="btn btn-secondary"
            title="Let the Writer continue"
            :disabled="!hasApiKey"
            @click="submit('continue')"
          >
            <i class="fas fa-forward"></i> Continue
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
import { ref, watch } from 'vue';

const props = defineProps({
  /** Cast members in the story, any of whom the next passage can center on. */
  cast: { type: Array, default: () => [] },
  generating: { type: Boolean, default: false },
  hasApiKey: { type: Boolean, default: true },
});

const emit = defineEmits(['generate', 'scene-break', 'stop']);

const text = ref('');
const leadCastId = ref(null);
const inputRef = ref(null);

watch(
  () => props.cast,
  (cast) => {
    if (leadCastId.value && !cast.some((member) => member.id === leadCastId.value)) {
      leadCastId.value = null;
    }
  },
);

function submit(action) {
  const trimmed = text.value.trim();
  if (props.generating || !props.hasApiKey) return;
  if (action !== 'continue' && !trimmed) return;

  emit('generate', {
    action,
    text: action === 'continue' ? '' : trimmed,
    leadCastId: leadCastId.value,
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

.focus-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-secondary);
}

.focus-select {
  padding: 0.375rem 0.5rem;
  font: inherit;
  font-size: 0.85rem;
  color: var(--text-primary);
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
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
