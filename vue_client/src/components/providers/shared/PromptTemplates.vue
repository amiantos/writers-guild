<template>
  <div>
    <section class="form-section">
      <h3 class="section-title">Prompt Templates</h3>
      <p class="section-description">
        Customize the prompts sent to the AI. Use placeholders like <code v-text="'{{char}}'"></code>,
        <code v-text="'{{instruction}}'"></code>, <code v-text="'{{storyContent}}'"></code>, etc.
        Toggle each prompt to customize or use system defaults.
      </p>

      <!-- System Prompt -->
      <div class="form-group">
        <div class="label-row">
          <label for="templateSystemPrompt">System Prompt Template</label>
          <button
            type="button"
            class="btn-toggle"
            @click="toggleCustomization('systemPrompt')"
          >
            {{ isCustomized('systemPrompt') ? 'Use Default' : 'Customize' }}
          </button>
        </div>
        <p class="field-description">
          Granular template with full control. Variables: <code v-text="'{{character.name}}'"></code>,
          <code v-text="'{{persona.description}}'"></code>, etc.
          Conditionals: <code v-text="'{{#if variable}}...{{/if}}'"></code>.
          Loops: <code v-text="'{{#each array}}...{{/each}}'"></code>.
          See default for complete reference.
        </p>
        <textarea
          v-if="isCustomized('systemPrompt')"
          id="templateSystemPrompt"
          v-model="localTemplates.systemPrompt"
          class="textarea-input"
          rows="8"
          placeholder="Enter custom system prompt template..."
        ></textarea>
        <div v-else class="default-display">
          <div class="default-label">Using System Default:</div>
          <pre class="default-content">{{ DEFAULT_TEMPLATES.systemPrompt }}</pre>
        </div>
      </div>

      <!-- Continue Template -->
      <div class="form-group">
        <div class="label-row">
          <label for="templateContinue">Continue Template</label>
          <button
            type="button"
            class="btn-toggle"
            @click="toggleCustomization('continue')"
          >
            {{ isCustomized('continue') ? 'Use Default' : 'Customize' }}
          </button>
        </div>
        <textarea
          v-if="isCustomized('continue')"
          id="templateContinue"
          v-model="localTemplates.continue"
          class="textarea-input"
          rows="3"
          placeholder="Enter custom continue template..."
        ></textarea>
        <div v-else class="default-display">
          <div class="default-label">Using System Default:</div>
          <pre class="default-content">{{ DEFAULT_TEMPLATES.continue }}</pre>
        </div>
      </div>

      <!-- Character Template -->
      <div class="form-group">
        <div class="label-row">
          <label for="templateCharacter">Character Response Template</label>
          <button
            type="button"
            class="btn-toggle"
            @click="toggleCustomization('character')"
          >
            {{ isCustomized('character') ? 'Use Default' : 'Customize' }}
          </button>
        </div>
        <textarea
          v-if="isCustomized('character')"
          id="templateCharacter"
          v-model="localTemplates.character"
          class="textarea-input"
          rows="3"
          placeholder="Enter custom character template..."
        ></textarea>
        <div v-else class="default-display">
          <div class="default-label">Using System Default:</div>
          <pre class="default-content">{{ DEFAULT_TEMPLATES.character }}</pre>
        </div>
      </div>

      <!-- Instruction Template -->
      <div class="form-group">
        <div class="label-row">
          <label for="templateInstruction">Custom Instruction Template</label>
          <button
            type="button"
            class="btn-toggle"
            @click="toggleCustomization('instruction')"
          >
            {{ isCustomized('instruction') ? 'Use Default' : 'Customize' }}
          </button>
        </div>
        <textarea
          v-if="isCustomized('instruction')"
          id="templateInstruction"
          v-model="localTemplates.instruction"
          class="textarea-input"
          rows="3"
          placeholder="Enter custom instruction template..."
        ></textarea>
        <div v-else class="default-display">
          <div class="default-label">Using System Default:</div>
          <pre class="default-content">{{ DEFAULT_TEMPLATES.instruction }}</pre>
        </div>
      </div>

      <!-- Rewrite Template -->
      <div class="form-group">
        <div class="label-row">
          <label for="templateRewrite">Rewrite to Third Person Template</label>
          <button
            type="button"
            class="btn-toggle"
            @click="toggleCustomization('rewriteThirdPerson')"
          >
            {{ isCustomized('rewriteThirdPerson') ? 'Use Default' : 'Customize' }}
          </button>
        </div>
        <textarea
          v-if="isCustomized('rewriteThirdPerson')"
          id="templateRewrite"
          v-model="localTemplates.rewriteThirdPerson"
          class="textarea-input"
          rows="4"
          placeholder="Enter custom rewrite template..."
        ></textarea>
        <div v-else class="default-display">
          <div class="default-label">Using System Default:</div>
          <pre class="default-content">{{ DEFAULT_TEMPLATES.rewriteThirdPerson }}</pre>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// Default templates (matching backend defaults)
const DEFAULT_TEMPLATES = {
  systemPrompt: `You are a creative writing assistant helping to write a novel-style story.

{{#if has_single_character}}
=== CHARACTER PROFILE ===
Name: {{character.name}}
{{#if character.description}}Description: {{character.description}}
{{/if}}{{#if character.personality}}Personality: {{character.personality}}
{{/if}}{{#if character.scenario}}
Current Scenario: {{character.scenario}}
{{/if}}{{#if include_dialogue_examples}}{{#if character.mes_example}}
=== DIALOGUE STYLE EXAMPLES ===
{{character.mes_example}}
{{/if}}{{/if}}
{{/if}}{{#if has_multiple_characters}}
=== CHARACTER PROFILES ===
{{#each characters}}
Character {{@index_1}}: {{name}}
{{#if description}}Description: {{description}}
{{/if}}{{#if personality}}Personality: {{personality}}
{{/if}}{{#unless @last}}
---
{{/unless}}{{/each}}

{{/if}}{{#if has_lorebook}}
=== WORLD INFORMATION ===
{{#each lorebook_entries}}{{content}}{{#unless @last}}

{{/unless}}{{/each}}

{{/if}}{{#if has_persona}}
=== USER CHARACTER (PERSONA) ===
Name: {{persona.name}}
{{#if persona.description}}Description: {{persona.description}}
{{/if}}{{#if persona.writing_style}}Writing Style: {{persona.writing_style}}
{{/if}}

{{/if}}
=== INSTRUCTIONS ===
Write in a narrative, novel-style format with proper paragraphs and dialogue.
Maintain consistency with established characters and plot.
Focus on showing rather than telling, with vivid descriptions and natural dialogue.

=== PERSPECTIVE ===
Write only in third-person past tense perspective.
Use he/she/they pronouns and past tense verbs (said, walked, thought, etc.).
Do NOT use first-person (I, me, my, we) or present tense.
All narrative and dialogue tags should be in past tense.
Aspects of character information, such as their profile or dialog style examples, may be in the incorrect tense. Ignore the tense, focus on the context.

Do not use asterisks (*) for actions. Write everything as prose.`,

  continue: "Continue the story naturally from where it left off. Write the next 2-3 paragraphs maximum, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters.",

  character: "Write the next part of the story from {{char}}'s perspective. Focus on their thoughts, actions, and dialogue. Write 2-3 paragraphs maximum, less if it makes sense stylistically or sets up a good response opportunity for other characters. (There is a chance that \"{{char}}'s\" is multiple characters, at which point you may respond as any of them as is relevant to the story.)",

  instruction: "Continue the story naturally from where it left off. Write the next 2-3 paragraphs maximum, maintaining the established tone and style, write less if it makes sense stylistically or sets up a good response opportunity for other characters. The user additionally sends along these instructions for what they would like to see happen: {{instruction}}",

  rewriteThirdPerson: "Rewrite the following text to be in third person narrative perspective, using past tense. Assume reference to \"you\" in the original text are meant to reference the user's Persona, if one is provided. Convert all first-person and second-person pronouns (I, me, my, we, us, our, you) to third-person (he, she, they, him, her, them, his, her, their). Change all verbs to past tense. Maintain the same events, dialogue, and meaning, but from a third-person narrator's viewpoint. Only return the rewritten text by itself in your response.\n\nText to rewrite:\n\n{{storyContent}}"
}

const props = defineProps({
  modelValue: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:modelValue'])

const localTemplates = computed({
  get() {
    // Ensure we always have an object with all fields (defaulting to null)
    const templates = props.modelValue || {}
    return {
      systemPrompt: templates.systemPrompt ?? null,
      continue: templates.continue ?? null,
      character: templates.character ?? null,
      instruction: templates.instruction ?? null,
      rewriteThirdPerson: templates.rewriteThirdPerson ?? null
    }
  },
  set(value) {
    emit('update:modelValue', value)
  }
})

// Check if a prompt is customized (not null)
const isCustomized = (key) => {
  return localTemplates.value[key] !== null
}

// Toggle customization for a prompt
const toggleCustomization = (key) => {
  const current = localTemplates.value[key]

  if (current === null) {
    // Switching to customize: load the default template
    localTemplates.value = {
      ...localTemplates.value,
      [key]: DEFAULT_TEMPLATES[key]
    }
  } else {
    // Switching to use default: set to null
    localTemplates.value = {
      ...localTemplates.value,
      [key]: null
    }
  }
}
</script>

<style scoped>
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
  margin: 0 0 1.5rem 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.section-description code,
.field-description code {
  background-color: var(--bg-tertiary);
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.85em;
  color: var(--text-primary);
}

.form-group {
  margin-bottom: 1.5rem;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.form-group label {
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
}

.field-description {
  margin: 0 0 0.5rem 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.btn-toggle {
  padding: 0.35rem 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-toggle:hover {
  background-color: var(--accent-primary);
  color: white;
  border-color: var(--accent-primary);
}

.textarea-input {
  width: 100%;
  padding: 0.6rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-size: 0.9rem;
  font-family: monospace;
  resize: vertical;
}

.textarea-input:focus {
  outline: none;
  border-color: var(--accent-primary);
}

.default-display {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.75rem;
}

.default-label {
  font-size: 0.8rem;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.default-content {
  margin: 0;
  padding: 0.5rem;
  background-color: var(--bg-tertiary);
  border-radius: 3px;
  font-size: 0.85rem;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: monospace;
  line-height: 1.4;
  max-height: 300px;
  overflow-y: auto;
}
</style>
