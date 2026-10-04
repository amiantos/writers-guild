<template>
  <div v-if="enabled" class="continuity-picker">
    <div class="form-group">
      <label for="continuitySelect">Continuity</label>
      <div class="picker-row">
        <select id="continuitySelect" v-model="selection" class="select-input">
          <option :value="NONE">None</option>
          <option v-for="continuity in continuities" :key="continuity.id" :value="continuity.id">
            {{ continuity.name }}
          </option>
          <option :value="NEW">New Continuity...</option>
        </select>
        <template v-if="selected">
          <button
            v-if="archivist"
            type="button"
            class="btn btn-secondary btn-small"
            :disabled="busy || !content.trim()"
            title="Ask the Archivist to condense this Continuity, using its characters' cards"
            @click="compact"
          >
            <i class="fas" :class="compacting ? 'fa-spinner fa-spin' : 'fa-compress'"></i>
            {{ compacting ? 'Compacting...' : 'Compact' }}
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-small"
            :disabled="busy"
            @click="toggleHistory"
          >
            <i class="fas fa-clock-rotate-left"></i> History
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-small"
            :disabled="busy"
            @click="deleteSelected"
          >
            <i class="fas fa-trash"></i> Delete
          </button>
        </template>
      </div>
    </div>

    <template v-if="selection !== NONE">
      <div class="form-group">
        <label for="continuityName">Continuity Name</label>
        <input
          id="continuityName"
          v-model="name"
          type="text"
          class="text-input"
          maxlength="200"
          placeholder="Name this Continuity..."
          @keydown.enter.prevent
        />
      </div>
      <div class="form-group">
        <label for="continuityContent">What's true across stories</label>
        <textarea
          id="continuityContent"
          v-model="content"
          class="textarea-input"
          :readonly="compacting"
          maxlength="20000"
          placeholder="What carries over from story to story: who is together, what happened last time, where everyone is now..."
          rows="6"
        ></textarea>
        <p class="form-help">
          Goes ahead of the scenario below.
          <template v-if="sharedWith > 0">
            Also used by {{ sharedWith }} other
            {{ sharedWith === 1 ? 'story or chat' : 'stories and chats' }}, so changes here apply to
            them too.
          </template>
        </p>
        <p v-if="beforeCompact !== null" class="form-help compact-note">
          The Archivist condensed this from {{ beforeCompact.length }} to
          {{ content.length }} characters{{ compactRationale ? `: ${compactRationale}` : '.' }} It's
          kept when you save, and the old text stays in History.
          <button type="button" class="btn btn-secondary btn-small" @click="undoCompact">
            <i class="fas fa-rotate-left"></i> Undo
          </button>
        </p>
      </div>

      <div v-if="showHistory && selected" class="continuity-history">
        <p v-if="versions.length === 0" class="form-help">No versions yet.</p>
        <ul v-else class="version-list">
          <li v-for="(version, index) in newestFirst" :key="version.id" class="version">
            <div class="version-header">
              <span class="version-label">{{ sourceLabel(version) }}</span>
              <span class="version-date">{{ formatWhen(version.created) }}</span>
              <span v-if="index === 0" class="meta-tag">Current</span>
              <button
                v-if="index > 0"
                type="button"
                class="btn btn-secondary btn-small version-restore"
                :disabled="busy"
                @click="restore(version)"
              >
                <i class="fas fa-rotate-left"></i> Restore
              </button>
            </div>
            <details>
              <summary>Show this version</summary>
              <p class="version-text">{{ version.content || '(empty)' }}</p>
            </details>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { archivistAPI, continuitiesAPI, settingsAPI } from '../services/api';
import { useToast } from '../composables/useToast';
import { useConfirm } from '../composables/useConfirm';

const NONE = '';
const NEW = '__new__';

const SOURCE_LABELS = {
  created: 'Created',
  edit: 'Edited',
  restore: 'Restored an earlier version',
  archivist: 'Archivist update',
};

function sourceLabel(version) {
  const label = SOURCE_LABELS[version.source] ?? 'Changed';
  return version.source === 'archivist' && version.sourceTitle
    ? `${label} from ${version.sourceTitle}`
    : label;
}

const props = defineProps({
  /** The Continuity the story or chat is in now, if any. */
  continuityId: { type: String, default: null },
});

const toast = useToast();
const { confirm } = useConfirm();

const enabled = ref(false);
const continuities = ref([]);
const selection = ref(props.continuityId ?? NONE);
const name = ref('');
const content = ref('');
const versions = ref([]);
const showHistory = ref(false);
const busy = ref(false);
// Whether the Archivist is on, for Compact, and the text as it was before the last Compact.
const archivist = ref(false);
const compacting = ref(false);
const beforeCompact = ref(null);
const compactRationale = ref('');

const selected = computed(
  () => continuities.value.find((continuity) => continuity.id === selection.value) ?? null,
);
const newestFirst = computed(() => versions.value.toReversed());

/** How many other stories and chats use the selected Continuity. */
const sharedWith = computed(() => {
  if (!selected.value) return 0;
  const total = selected.value.storyCount + selected.value.chatCount;
  return selected.value.id === props.continuityId ? total - 1 : total;
});

watch(selection, () => {
  name.value = selected.value?.name ?? '';
  content.value = selected.value?.content ?? '';
  showHistory.value = false;
  beforeCompact.value = null;
});

onMounted(async () => {
  try {
    const { settings } = await settingsAPI.get();
    if (!settings?.experimentalContinuity) return;
    archivist.value = Boolean(settings.experimentalArchivist);
    continuities.value = (await continuitiesAPI.list()).continuities;
    enabled.value = true;
    if (!selected.value) selection.value = NONE;
    name.value = selected.value?.name ?? '';
    content.value = selected.value?.content ?? '';
  } catch (error) {
    console.error('Failed to load Continuities:', error);
  }
});

/** Replace one Continuity in the list with the server's copy. */
function keep(continuity) {
  continuities.value = continuities.value.map((existing) =>
    existing.id === continuity.id ? { ...existing, ...continuity } : existing,
  );
}

async function loadVersions() {
  versions.value = (await continuitiesAPI.listVersions(selected.value.id)).versions;
}

async function toggleHistory() {
  showHistory.value = !showHistory.value;
  if (!showHistory.value) return;
  try {
    await loadVersions();
  } catch (error) {
    toast.error('Failed to load history: ' + error.message);
  }
}

/** Ask the Archivist to condense the text as it stands here; nothing is saved until the story is. */
async function compact() {
  busy.value = true;
  compacting.value = true;
  try {
    const before = content.value;
    const result = await archivistAPI.compactContinuity(selected.value.id, before);
    if (!result.content) {
      toast.info("The Archivist couldn't make this Continuity any shorter.");
      return;
    }
    // A second Compact still undoes to the text before the first.
    beforeCompact.value ??= before;
    compactRationale.value = result.rationale;
    content.value = result.content;
  } catch (error) {
    toast.error('Failed to compact: ' + error.message);
  } finally {
    busy.value = false;
    compacting.value = false;
  }
}

function undoCompact() {
  content.value = beforeCompact.value;
  beforeCompact.value = null;
}

async function restore(version) {
  const confirmed = await confirm({
    message: `Restore "${selected.value.name}" to this version?\n\nThe current text stays in History, and any unsaved changes to it here are replaced.`,
    confirmText: 'Restore',
  });
  if (!confirmed) return;

  busy.value = true;
  try {
    const { continuity } = await continuitiesAPI.restoreVersion(selected.value.id, version.id);
    keep(continuity);
    content.value = continuity.content;
    beforeCompact.value = null;
    await loadVersions();
    toast.success(`Restored "${continuity.name}"`);
  } catch (error) {
    toast.error('Failed to restore: ' + error.message);
  } finally {
    busy.value = false;
  }
}

async function deleteSelected() {
  const target = selected.value;
  const others = target.storyCount + target.chatCount;
  const confirmed = await confirm({
    message: `Delete "${target.name}" and its history?\n\n${
      others > 0
        ? `${others === 1 ? 'The story or chat' : `The ${others} stories and chats`} in it stay, without a Continuity.`
        : 'Nothing is in it.'
    }`,
    confirmText: 'Delete',
    variant: 'danger',
  });
  if (!confirmed) return;

  busy.value = true;
  try {
    await continuitiesAPI.delete(target.id);
    continuities.value = continuities.value.filter((continuity) => continuity.id !== target.id);
    selection.value = NONE;
    toast.success(`Deleted "${target.name}"`);
  } catch (error) {
    toast.error('Failed to delete: ' + error.message);
  } finally {
    busy.value = false;
  }
}

/**
 * Save the picked Continuity's name and text, creating it when it's new.
 * @returns {Promise<string|null|undefined>} The id the story or chat should be in, null for
 *   none, or undefined while Continuities are off, when the story or chat should be left as it is.
 */
async function save() {
  if (!enabled.value) return undefined;
  if (selection.value === NONE) return null;

  const fields = {
    name: name.value.trim() || 'Untitled Continuity',
    content: content.value.trim(),
  };
  if (selection.value === NEW) {
    const { continuity } = await continuitiesAPI.create(fields);
    return continuity.id;
  }
  const current = selected.value;
  if (fields.name !== current.name || fields.content !== current.content) {
    const { continuity } = await continuitiesAPI.update(current.id, fields);
    keep(continuity);
  }
  return current.id;
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

defineExpose({ save });
</script>

<style scoped>
.continuity-picker {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
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

.picker-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.picker-row .select-input {
  flex: 1;
  min-width: 10rem;
}

.select-input,
.text-input,
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
  outline: none;
}

.select-input:focus,
.text-input:focus,
.textarea-input:focus {
  border-color: var(--accent-primary);
}

.textarea-input {
  resize: vertical;
  min-height: 120px;
}

.form-help {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin: 0;
}

.compact-note .btn {
  margin-left: 0.5rem;
}

.version-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 16rem;
  overflow-y: auto;
}

.version {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 0.875rem;
}

.version-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.version-label {
  font-weight: 600;
  color: var(--text-primary);
}

.version-date {
  color: var(--text-secondary);
}

.version-restore {
  margin-left: auto;
}

.meta-tag {
  font-size: 0.7rem;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  background-color: var(--bg-tertiary);
  color: var(--text-secondary);
}

.version-text {
  white-space: pre-wrap;
  margin: 0.5rem 0 0 0;
  color: var(--text-primary);
}
</style>
