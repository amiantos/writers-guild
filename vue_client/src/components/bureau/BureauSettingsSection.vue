<template>
  <section class="edit-section">
    <div class="section-header">
      <h2><i class="fas fa-sliders"></i> Settings</h2>
    </div>

    <div class="section-content">
      <div class="form-group">
        <label for="bureau-settings-name">Name</label>
        <input id="bureau-settings-name" v-model="form.name" type="text" class="text-input" />
      </div>

      <div class="form-group">
        <label for="bureau-settings-description">Description</label>
        <textarea
          id="bureau-settings-description"
          v-model="form.description"
          class="textarea-input"
          rows="2"
        ></textarea>
      </div>

      <div class="form-group">
        <label for="bureau-settings-api-key">DeepSeek API key</label>
        <p v-if="bureau.hasApiKey" class="status-line">
          <i class="fas fa-lock"></i> Saved key {{ bureau.apiKeyPreview }}
        </p>
        <div class="inline-row">
          <input
            id="bureau-settings-api-key"
            v-model="form.apiKey"
            type="password"
            class="text-input"
            autocomplete="off"
            :placeholder="bureau.hasApiKey ? 'Paste a new key to replace it' : 'sk-...'"
          />
          <button
            v-if="bureau.hasApiKey"
            class="btn btn-secondary btn-small"
            :disabled="saving"
            @click="removeKey"
          >
            Remove key
          </button>
        </div>
      </div>

      <div class="form-group">
        <label for="bureau-settings-model">Model</label>
        <input
          id="bureau-settings-model"
          v-model="form.model"
          type="text"
          class="text-input"
          list="bureau-settings-models"
        />
        <datalist id="bureau-settings-models">
          <option value="deepseek-flash">DeepSeek V4.1 Flash</option>
          <option value="deepseek-v4-pro">DeepSeek V4 Pro</option>
        </datalist>
      </div>

      <fieldset class="writer-settings">
        <legend>Writer</legend>
        <label class="checkbox-label">
          <input v-model="form.writer.thinking" type="checkbox" />
          Thinking mode
        </label>
        <div class="settings-grid">
          <div v-if="form.writer.thinking" class="form-group">
            <label for="bureau-settings-effort">Reasoning effort</label>
            <select
              id="bureau-settings-effort"
              v-model="form.writer.reasoningEffort"
              class="select-input"
            >
              <option value="low">Low</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>
          </div>
          <div v-else class="form-group">
            <label for="bureau-settings-temperature">Temperature</label>
            <input
              id="bureau-settings-temperature"
              v-model.number="form.writer.temperature"
              type="number"
              min="0"
              max="2"
              step="0.1"
              class="text-input"
            />
          </div>
          <div class="form-group">
            <label for="bureau-settings-max-tokens">Max tokens</label>
            <input
              id="bureau-settings-max-tokens"
              v-model.number="form.writer.maxTokens"
              type="number"
              min="256"
              max="32000"
              step="100"
              class="text-input"
            />
          </div>
        </div>
        <p class="help-text">
          DeepSeek ignores temperature in thinking mode. The Writer's reasoning shows in each turn's
          seam.
        </p>
      </fieldset>

      <fieldset class="writer-settings">
        <legend>Director</legend>
        <label class="checkbox-label">
          <input
            id="bureau-settings-director-enabled"
            v-model="form.director.enabled"
            type="checkbox"
          />
          Plan each passage with the Director
        </label>
        <template v-if="form.director.enabled">
          <label class="checkbox-label">
            <input
              id="bureau-settings-director-skip"
              v-model="form.director.skipOnContinue"
              type="checkbox"
            />
            Skip planning for a plain Continue
          </label>
          <label class="checkbox-label">
            <input
              id="bureau-settings-director-create"
              v-model="form.director.createCharacters"
              type="checkbox"
            />
            Let the Director create new characters as drafts
          </label>
          <label class="checkbox-label">
            <input v-model="form.director.thinking" type="checkbox" />
            Thinking mode
          </label>
          <div v-if="form.director.thinking" class="form-group">
            <label for="bureau-settings-director-effort">Reasoning effort</label>
            <select
              id="bureau-settings-director-effort"
              v-model="form.director.reasoningEffort"
              class="select-input"
            >
              <option value="low">Low</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>
          </div>
        </template>
        <p class="help-text">
          The Director looks up memories and lore, then gives the Writer a scene brief. Both show in
          each turn's seam.
        </p>
      </fieldset>

      <fieldset class="writer-settings">
        <legend>Style checks</legend>
        <label class="checkbox-label">
          <input
            id="bureau-settings-editor-enabled"
            v-model="form.editor.enabled"
            type="checkbox"
          />
          Let the Editor fix what the checks find
        </label>
        <div class="form-group">
          <label for="bureau-settings-banned-phrases">Banned phrases</label>
          <textarea
            id="bureau-settings-banned-phrases"
            v-model="form.bannedPhrases"
            class="textarea-input"
            rows="3"
            placeholder="One per line"
          ></textarea>
        </div>
        <p class="help-text">
          Every generated passage is checked for two characters speaking in one paragraph,
          first-person narration, repeated phrasing, and banned phrases. Findings and fixes show in
          the turn's seam, where a fix can be reverted.
        </p>
      </fieldset>

      <fieldset class="writer-settings">
        <legend>Messages</legend>
        <label class="checkbox-label">
          <input
            id="bureau-settings-correspondence-thinking"
            v-model="form.correspondence.thinking"
            type="checkbox"
          />
          Thinking mode for replies
        </label>
        <div v-if="form.correspondence.thinking" class="form-group">
          <label for="bureau-settings-correspondence-effort">Reasoning effort</label>
          <select
            id="bureau-settings-correspondence-effort"
            v-model="form.correspondence.reasoningEffort"
            class="select-input"
          >
            <option value="low">Low</option>
            <option value="high">High</option>
            <option value="max">Max</option>
          </select>
        </div>
        <div class="form-group">
          <label for="bureau-settings-correspondence-style">How messages read</label>
          <textarea
            id="bureau-settings-correspondence-style"
            v-model="form.correspondence.style"
            class="textarea-input"
            rows="4"
            :placeholder="defaults?.correspondenceStyle"
          ></textarea>
        </div>
        <p class="help-text">
          Replies follow these rules instead of the house style. While this is empty, the default
          shown in the box applies. For a Bureau set before phones, describe letters or telegrams.
        </p>
      </fieldset>

      <div class="form-group">
        <div class="label-row">
          <label for="bureau-settings-house-style">House style</label>
          <button
            v-if="defaults && !form.houseStyle"
            class="btn btn-secondary btn-small"
            @click="form.houseStyle = defaults.houseStyle"
          >
            Edit the default
          </button>
        </div>
        <textarea
          id="bureau-settings-house-style"
          v-model="form.houseStyle"
          class="textarea-input house-style"
          rows="8"
          :placeholder="defaults?.houseStyle"
        ></textarea>
        <p class="help-text">
          Rules the Writer follows on every turn. While this is empty, the default shown in the box
          applies.
        </p>
      </div>

      <div class="form-group">
        <label for="bureau-settings-present">The Bureau's present</label>
        <input
          id="bureau-settings-present"
          :value="presentDate"
          type="date"
          class="text-input"
          @input="setPresentDate($event.target.value)"
        />
        <p class="help-text">
          Messages are sent on this date, with the time of day following your clock. Set another
          year, such as 1996, and stories and replies take it as the setting. Clear it for today.
        </p>
      </div>

      <div class="form-group">
        <span class="group-label">Time zone</span>
        <p class="status-line">
          {{
            bureau.timezone ||
            "Not set yet. This browser's time zone is saved when you start a story."
          }}
        </p>
        <div v-if="browserZone && bureau.timezone !== browserZone">
          <button class="btn btn-secondary btn-small" :disabled="saving" @click="useBrowserZone">
            Use {{ browserZone }}
          </button>
        </div>
      </div>

      <div class="section-actions">
        <button class="btn btn-danger" :disabled="saving" @click="deleteBureau">
          <i class="fas fa-trash"></i> Delete Bureau
        </button>
        <button class="btn btn-primary" :disabled="!dirty || saving" @click="save">
          <i class="fas fa-save"></i> {{ saving ? 'Saving...' : 'Save settings' }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { browserTimeZone, offsetDaysTo, presentDateValue } from '../../composables/bureau/format';

const props = defineProps({
  bureau: { type: Object, required: true },
});

const emit = defineEmits(['updated', 'deleted']);
const toast = useToast();
const { confirm } = useConfirm();

const browserZone = browserTimeZone();
const defaults = ref(null);
const saving = ref(false);
const form = reactive({});

function snapshot(bureau) {
  return {
    name: bureau.name,
    description: bureau.description,
    model: bureau.model,
    houseStyle: bureau.houseStyle,
    // The offset, not the date: a date turned back into an offset after midnight would be a day off.
    presentOffsetDays: bureau.presentOffsetDays ?? 0,
    writer: { ...bureau.settings.writer },
    director: { ...bureau.settings.director },
    editor: { ...bureau.settings.editor },
    correspondence: { ...bureau.settings.correspondence },
    bannedPhrases: bureau.settings.style.bannedPhrases.join('\n'),
  };
}

function phrasesFrom(text) {
  return text
    .split('\n')
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

// What the form was last synced from. When the Bureau changes elsewhere (removing the
// key, setting the time zone), only fields the reader hasn't touched take the new values.
let syncedFrom = null;

function syncForm(bureau) {
  const incoming = snapshot(bureau);
  if (!syncedFrom) {
    Object.assign(form, incoming, { apiKey: '' });
  } else {
    for (const [field, value] of Object.entries(incoming)) {
      const untouched = JSON.stringify(form[field]) === JSON.stringify(syncedFrom[field]);
      if (untouched) {
        form[field] = typeof value === 'object' && value !== null ? { ...value } : value;
      }
    }
  }
  syncedFrom = incoming;
}

const dirty = computed(() => {
  const { apiKey, ...current } = form;
  return (
    Boolean(apiKey.trim()) || JSON.stringify(current) !== JSON.stringify(snapshot(props.bureau))
  );
});

watch(() => props.bureau, syncForm, { immediate: true });

const presentDate = computed(() =>
  presentDateValue({
    presentOffsetDays: form.presentOffsetDays,
    timezone: props.bureau.timezone,
  }),
);

function setPresentDate(value) {
  form.presentOffsetDays = offsetDaysTo(value, new Date(), props.bureau.timezone) ?? 0;
}

async function update(updates, message) {
  saving.value = true;
  try {
    const { bureau } = await bureausAPI.update(props.bureau.id, updates);
    emit('updated', bureau);
    toast.success(message);
    return true;
  } catch (error) {
    toast.error('Failed to save: ' + error.message);
    return false;
  } finally {
    saving.value = false;
  }
}

async function save() {
  const updates = {
    name: form.name.trim(),
    description: form.description.trim(),
    model: form.model.trim(),
    houseStyle: form.houseStyle,
    presentOffsetDays: form.presentOffsetDays,
    settings: {
      writer: { ...form.writer },
      director: { ...form.director },
      editor: { ...form.editor },
      style: { bannedPhrases: phrasesFrom(form.bannedPhrases) },
      correspondence: { ...form.correspondence },
    },
  };
  if (form.apiKey.trim()) {
    updates.apiKey = form.apiKey.trim();
  }
  if (await update(updates, 'Settings saved')) {
    Object.assign(form, {
      name: updates.name,
      description: updates.description,
      model: updates.model,
      apiKey: '',
    });
  }
}

async function removeKey() {
  const confirmed = await confirm({
    message: "Remove this Bureau's API key? Stories can't be generated until you add another.",
    confirmText: 'Remove key',
    variant: 'danger',
  });
  if (confirmed) update({ apiKey: '' }, 'API key removed');
}

function useBrowserZone() {
  update({ timezone: browserZone }, `Time zone set to ${browserZone}`);
}

async function deleteBureau() {
  const confirmed = await confirm({
    message: `Delete "${props.bureau.name}"?\n\nIts stories, cast, and run records are deleted. Your library characters and lorebooks are not affected. This cannot be undone.`,
    confirmText: 'Delete Bureau',
    variant: 'danger',
  });
  if (!confirmed) return;

  saving.value = true;
  try {
    await bureausAPI.remove(props.bureau.id);
    toast.success(`Deleted ${props.bureau.name}`);
    emit('deleted');
  } catch (error) {
    toast.error('Failed to delete Bureau: ' + error.message);
    saving.value = false;
  }
}

onMounted(async () => {
  try {
    defaults.value = await bureausAPI.defaults();
  } catch (error) {
    console.error('Failed to load Bureau defaults:', error);
  }
});
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.status-line {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.inline-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.writer-settings {
  margin: 0;
  padding: 0.875rem 1rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.writer-settings legend {
  padding: 0 0.375rem;
  font-weight: 600;
  font-size: 0.875rem;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.75rem;
}

.label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}

.label-row label {
  font-weight: 600;
  font-size: 0.875rem;
}

.house-style {
  font-size: 0.875rem;
}

.section-actions {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--border-color);
}
</style>
