<template>
  <section class="form-section">
    <h3 class="section-title">Advanced Sampling Settings</h3>
    <p class="section-description">
      Optional parameters for fine-tuning generation behavior. Leave blank to use API defaults.
    </p>

    <!-- Universal Parameters (Most Providers) -->
    <div v-if="supportsTopP" class="form-group">
      <label for="top_p">
        Top P (Nucleus Sampling): {{ localSettings.top_p != null ? localSettings.top_p.toFixed(2) : 'Default' }}
      </label>
      <div class="input-with-clear">
        <input
          id="top_p"
          v-model.number="localSettings.top_p"
          type="range"
          min="0"
          max="1"
          step="0.01"
          class="range-input"
        />
        <button v-if="localSettings.top_p != null" @click="localSettings.top_p = null" class="clear-btn">
          Clear
        </button>
      </div>
      <small class="help-text">
        Sample from tokens with cumulative probability up to this value (0-1). Lower = more focused.
      </small>
    </div>

    <div v-if="supportsTopK" class="form-group">
      <label for="top_k">
        Top K: {{ localSettings.top_k != null ? localSettings.top_k : 'Default' }}
      </label>
      <div class="input-with-clear">
        <input
          id="top_k"
          v-model.number="localSettings.top_k"
          type="range"
          min="1"
          max="100"
          step="1"
          class="range-input"
        />
        <button v-if="localSettings.top_k != null" @click="localSettings.top_k = null" class="clear-btn">
          Clear
        </button>
      </div>
      <small class="help-text">
        Sample from top K most likely tokens (1-100). Lower = more focused.
      </small>
    </div>

    <!-- OpenAI / DeepSeek / OpenRouter Parameters -->
    <div v-if="supportsFrequencyPenalty" class="form-group">
      <label for="frequency_penalty">
        Frequency Penalty: {{ localSettings.frequency_penalty != null ? localSettings.frequency_penalty.toFixed(2) : 'Default' }}
      </label>
      <div class="input-with-clear">
        <input
          id="frequency_penalty"
          v-model.number="localSettings.frequency_penalty"
          type="range"
          min="-2"
          max="2"
          step="0.1"
          class="range-input"
        />
        <button v-if="localSettings.frequency_penalty != null" @click="localSettings.frequency_penalty = null" class="clear-btn">
          Clear
        </button>
      </div>
      <small class="help-text">
        Penalize tokens based on frequency in the text (-2 to 2). Positive = less repetition.
      </small>
    </div>

    <div v-if="supportsPresencePenalty" class="form-group">
      <label for="presence_penalty">
        Presence Penalty: {{ localSettings.presence_penalty != null ? localSettings.presence_penalty.toFixed(2) : 'Default' }}
      </label>
      <div class="input-with-clear">
        <input
          id="presence_penalty"
          v-model.number="localSettings.presence_penalty"
          type="range"
          min="-2"
          max="2"
          step="0.1"
          class="range-input"
        />
        <button v-if="localSettings.presence_penalty != null" @click="localSettings.presence_penalty = null" class="clear-btn">
          Clear
        </button>
      </div>
      <small class="help-text">
        Penalize tokens that have appeared in the text (-2 to 2). Positive = more diverse topics.
      </small>
    </div>

    <!-- Stop Sequences (All Providers) -->
    <div class="form-group">
      <label for="stop_sequences">
        Stop Sequences
      </label>
      <textarea
        id="stop_sequences"
        v-model="stopSequencesText"
        rows="2"
        class="text-input"
        placeholder="Enter stop sequences, one per line"
      ></textarea>
      <small class="help-text">
        Generation will stop when any of these sequences are encountered.
      </small>
    </div>

    <!-- AI Horde Specific Parameters -->
    <template v-if="provider === 'aihorde'">
      <h4 class="subsection-title">AI Horde Samplers</h4>

      <div class="form-group">
        <label for="rep_pen">
          Repetition Penalty: {{ localSettings.rep_pen != null ? localSettings.rep_pen.toFixed(2) : 'Default (1.1)' }}
        </label>
        <div class="input-with-clear">
          <input
            id="rep_pen"
            v-model.number="localSettings.rep_pen"
            type="range"
            min="1"
            max="3"
            step="0.05"
            class="range-input"
          />
          <button v-if="localSettings.rep_pen != null" @click="localSettings.rep_pen = null" class="clear-btn">
            Clear
          </button>
        </div>
        <small class="help-text">
          Penalize repeated tokens (1.0-3.0). Higher = less repetition.
        </small>
      </div>

      <div class="form-group">
        <label for="rep_pen_range">
          Repetition Penalty Range: {{ localSettings.rep_pen_range != null ? localSettings.rep_pen_range : 'Default (320)' }}
        </label>
        <div class="input-with-clear">
          <input
            id="rep_pen_range"
            v-model.number="localSettings.rep_pen_range"
            type="number"
            min="0"
            max="4096"
            step="32"
            class="number-input"
          />
          <button v-if="localSettings.rep_pen_range != null" @click="localSettings.rep_pen_range = null" class="clear-btn">
            Clear
          </button>
        </div>
        <small class="help-text">
          How many tokens back to apply repetition penalty (0-4096).
        </small>
      </div>

      <div class="form-group">
        <label for="top_a">
          Top A: {{ localSettings.top_a != null ? localSettings.top_a.toFixed(2) : 'Default' }}
        </label>
        <div class="input-with-clear">
          <input
            id="top_a"
            v-model.number="localSettings.top_a"
            type="range"
            min="0"
            max="1"
            step="0.01"
            class="range-input"
          />
          <button v-if="localSettings.top_a != null" @click="localSettings.top_a = null" class="clear-btn">
            Clear
          </button>
        </div>
        <small class="help-text">
          Top-A sampling (0-1). Alternative to Top-K/Top-P.
        </small>
      </div>

      <div class="form-group">
        <label for="typical">
          Typical (Tau): {{ localSettings.typical != null ? localSettings.typical.toFixed(2) : 'Default' }}
        </label>
        <div class="input-with-clear">
          <input
            id="typical"
            v-model.number="localSettings.typical"
            type="range"
            min="0"
            max="1"
            step="0.01"
            class="range-input"
          />
          <button v-if="localSettings.typical != null" @click="localSettings.typical = null" class="clear-btn">
            Clear
          </button>
        </div>
        <small class="help-text">
          Typical sampling (0-1). Selects "typical" tokens.
        </small>
      </div>

      <div class="form-group">
        <label for="tfs">
          Tail Free Sampling (TFS): {{ localSettings.tfs != null ? localSettings.tfs.toFixed(2) : 'Default' }}
        </label>
        <div class="input-with-clear">
          <input
            id="tfs"
            v-model.number="localSettings.tfs"
            type="range"
            min="0"
            max="1"
            step="0.01"
            class="range-input"
          />
          <button v-if="localSettings.tfs != null" @click="localSettings.tfs = null" class="clear-btn">
            Clear
          </button>
        </div>
        <small class="help-text">
          Tail-free sampling (0-1). Removes low-probability "tail" tokens.
        </small>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  modelValue: {
    type: Object,
    required: true
  },
  provider: {
    type: String,
    required: true
  },
  model: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:modelValue'])

// Provider capability checks
const supportsTopP = computed(() => {
  return ['anthropic', 'openai', 'deepseek', 'openrouter', 'aihorde'].includes(props.provider)
})

const supportsTopK = computed(() => {
  return ['anthropic', 'deepseek', 'aihorde'].includes(props.provider)
})

const supportsFrequencyPenalty = computed(() => {
  // DeepSeek reasoner doesn't support these parameters
  if (props.provider === 'deepseek' && props.model === 'deepseek-reasoner') {
    return false
  }
  return ['openai', 'deepseek', 'openrouter'].includes(props.provider)
})

const supportsPresencePenalty = computed(() => {
  // DeepSeek reasoner doesn't support these parameters
  if (props.provider === 'deepseek' && props.model === 'deepseek-reasoner') {
    return false
  }
  return ['openai', 'deepseek', 'openrouter'].includes(props.provider)
})

const localSettings = computed({
  get() {
    return props.modelValue || {}
  },
  set(value) {
    emit('update:modelValue', value)
  }
})

// Convert stop_sequences array to text and back
const stopSequencesText = computed({
  get() {
    return (localSettings.value.stop_sequences || []).join('\n')
  },
  set(value) {
    localSettings.value.stop_sequences = value.split('\n').filter(s => s.trim() !== '')
  }
})
</script>

<style scoped>
.form-section {
  margin-bottom: 2rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid var(--border-color);
}

.section-title {
  margin: 0 0 0.5rem 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--text-primary);
}

.subsection-title {
  margin: 1.5rem 0 1rem 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.section-description {
  margin: 0 0 1rem 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
  font-style: italic;
}

.form-group {
  margin-bottom: 1.25rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--text-primary);
}

.input-with-clear {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.range-input {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--border-color);
  outline: none;
}

.range-input::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent-primary);
  cursor: pointer;
}

.range-input::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent-primary);
  cursor: pointer;
  border: none;
}

.number-input {
  flex: 1;
  padding: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.95rem;
}

.text-input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 0.95rem;
  font-family: monospace;
  resize: vertical;
}

.clear-btn {
  padding: 0.4rem 0.8rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.clear-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.help-text {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}
</style>
