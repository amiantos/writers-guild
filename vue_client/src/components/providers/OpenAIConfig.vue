<template>
  <div class="provider-config">
    <!-- API Configuration -->
    <section class="form-section">
      <h3 class="section-title">API Configuration</h3>

      <div class="form-group">
        <label for="apiKey">API Key *</label>
        <input
          id="apiKey"
          v-model="localApiConfig.apiKey"
          type="password"
          class="text-input"
          placeholder="sk-..."
        />
        <small class="help-text">Get your API key from https://platform.openai.com</small>
      </div>

      <div v-if="showAdvancedApiConfig" class="form-group">
        <label for="baseURL">Base URL</label>
        <input
          id="baseURL"
          v-model="localApiConfig.baseURL"
          type="text"
          class="text-input"
          placeholder="https://api.openai.com/v1"
        />
        <small class="help-text">Leave empty to use default</small>
      </div>

      <div class="form-group">
        <label for="model">Model</label>
        <input
          id="model"
          v-model="localApiConfig.model"
          type="text"
          class="text-input"
          placeholder="gpt-4-turbo-preview"
        />
        <small class="help-text">Default: gpt-4-turbo-preview (or gpt-4, gpt-3.5-turbo)</small>
      </div>

      <button
        type="button"
        class="btn-link"
        @click="showAdvancedApiConfig = !showAdvancedApiConfig"
      >
        {{ showAdvancedApiConfig ? 'Hide' : 'Show' }} Advanced API Options
      </button>
    </section>

    <!-- Generation Settings -->
    <section class="form-section">
      <h3 class="section-title">Generation Settings</h3>

      <div class="form-group">
        <label for="maxTokens">
          Max Tokens: {{ localGenerationSettings.maxTokens }}
        </label>
        <input
          id="maxTokens"
          v-model.number="localGenerationSettings.maxTokens"
          type="range"
          min="100"
          max="8000"
          step="100"
          class="range-input"
        />
        <small class="help-text">Maximum tokens to generate (100-8000)</small>
      </div>

      <div class="form-group">
        <label for="temperature">
          Temperature: {{ localGenerationSettings.temperature.toFixed(2) }}
        </label>
        <input
          id="temperature"
          v-model.number="localGenerationSettings.temperature"
          type="range"
          min="0"
          max="2"
          step="0.05"
          class="range-input"
        />
        <small class="help-text">Creativity/randomness (0 = focused, 2 = creative)</small>
      </div>

      <div class="form-group checkbox-group">
        <label>
          <input
            type="checkbox"
            v-model="localGenerationSettings.includeDialogueExamples"
          />
          Include dialogue examples from character cards
        </label>
      </div>
    </section>

    <!-- Lorebook Settings -->
    <section class="form-section">
      <h3 class="section-title">Lorebook Settings</h3>

      <div class="form-group">
        <label for="scanDepth">
          Scan Depth: {{ localLorebookSettings.scanDepth }} tokens
        </label>
        <input
          id="scanDepth"
          v-model.number="localLorebookSettings.scanDepth"
          type="range"
          min="500"
          max="4000"
          step="100"
          class="range-input"
        />
        <small class="help-text">How much of the story to scan for keywords</small>
      </div>

      <div class="form-group">
        <label for="tokenBudget">
          Token Budget: {{ localLorebookSettings.tokenBudget }} tokens
        </label>
        <input
          id="tokenBudget"
          v-model.number="localLorebookSettings.tokenBudget"
          type="range"
          min="500"
          max="4000"
          step="100"
          class="range-input"
        />
        <small class="help-text">Maximum tokens for lorebook content</small>
      </div>

      <div class="form-group">
        <label for="recursionDepth">
          Recursion Depth: {{ localLorebookSettings.recursionDepth }}
        </label>
        <input
          id="recursionDepth"
          v-model.number="localLorebookSettings.recursionDepth"
          type="range"
          min="0"
          max="5"
          step="1"
          class="range-input"
        />
        <small class="help-text">How many levels of cascading entries to allow</small>
      </div>

      <div class="form-group checkbox-group">
        <label>
          <input
            type="checkbox"
            v-model="localLorebookSettings.enableRecursion"
          />
          Enable recursive activation
        </label>
        <small class="help-text">Allow lorebook entries to trigger other entries</small>
      </div>
    </section>

    <!-- Prompt Templates (Optional/Advanced) -->
    <div v-if="showPromptTemplates">
      <section class="form-section">
        <h3 class="section-title">Prompt Templates (Advanced)</h3>
        <p class="section-description">
          Customize the instructions sent to the AI. Use <code v-text="'{{char}}'"></code>,
          <code v-text="'{{instruction}}'"></code>, and <code v-text="'{{storyContent}}'"></code> as placeholders.
        </p>

        <div class="form-group">
          <label for="templateContinue">Continue Template</label>
          <textarea
            id="templateContinue"
            v-model="localPromptTemplates.continue"
            class="textarea-input"
            rows="3"
            placeholder="Continue the story naturally..."
          ></textarea>
        </div>

        <div class="form-group">
          <label for="templateCharacter">Character Response Template</label>
          <textarea
            id="templateCharacter"
            v-model="localPromptTemplates.character"
            class="textarea-input"
            rows="3"
            placeholder="Write from {char}'s perspective..."
          ></textarea>
        </div>

        <div class="form-group">
          <label for="templateInstruction">Custom Instruction Template</label>
          <textarea
            id="templateInstruction"
            v-model="localPromptTemplates.instruction"
            class="textarea-input"
            rows="2"
            placeholder="{instruction}"
          ></textarea>
        </div>

        <div class="form-group">
          <label for="templateRewrite">Rewrite to Third Person Template</label>
          <textarea
            id="templateRewrite"
            v-model="localPromptTemplates.rewriteThirdPerson"
            class="textarea-input"
            rows="3"
            placeholder="Rewrite to third person..."
          ></textarea>
        </div>
      </section>
    </div>

    <button
      type="button"
      class="btn-link"
      @click="showPromptTemplates = !showPromptTemplates"
    >
      {{ showPromptTemplates ? 'Hide' : 'Show' }} Prompt Templates (Advanced)
    </button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  config: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:config'])

const showAdvancedApiConfig = ref(false)
const showPromptTemplates = ref(false)

// Create local computed properties for each section that syncs with parent
const localApiConfig = computed({
  get() {
    return props.config.apiConfig || {}
  },
  set(value) {
    emit('update:config', { ...props.config, apiConfig: value })
  }
})

const localGenerationSettings = computed({
  get() {
    return props.config.generationSettings || {}
  },
  set(value) {
    emit('update:config', { ...props.config, generationSettings: value })
  }
})

const localLorebookSettings = computed({
  get() {
    return props.config.lorebookSettings || {}
  },
  set(value) {
    emit('update:config', { ...props.config, lorebookSettings: value })
  }
})

const localPromptTemplates = computed({
  get() {
    return props.config.promptTemplates || {}
  },
  set(value) {
    emit('update:config', { ...props.config, promptTemplates: value })
  }
})
</script>

<style scoped>
.provider-config {
  margin-bottom: 1rem;
}

.form-section {
  margin-bottom: 2rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid var(--border-color);
}

.form-section:last-child {
  border-bottom: none;
}

.section-title {
  margin: 0 0 0.5rem 0;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--text-primary);
}

.section-description {
  margin: 0 0 1rem 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.section-description code {
  background-color: var(--bg-tertiary);
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.85em;
  color: var(--text-primary);
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

.checkbox-group label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: normal;
}

.checkbox-group input[type="checkbox"] {
  width: auto;
  margin: 0;
}

.text-input,
.textarea-input {
  width: 100%;
  padding: 0.6rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.95rem;
  font-family: inherit;
}

.text-input:focus,
.textarea-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.range-input {
  width: 100%;
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

.help-text {
  display: block;
  margin-top: 0.4rem;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.btn-link {
  background: none;
  border: none;
  color: var(--accent-primary);
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0.5rem 0;
  text-decoration: underline;
}

.btn-link:hover {
  opacity: 0.8;
}
</style>
