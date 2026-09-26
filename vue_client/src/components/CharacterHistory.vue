<template>
  <div class="section-content">
    <p v-if="loading" class="history-hint">Loading history...</p>
    <template v-else>
      <p class="history-hint">
        <template v-if="editedSinceImport">
          This card has changed since it was imported or created.
        </template>
        <template v-else>This card is as it was when it was imported or created.</template>
        Every change is kept here, and restoring one keeps the current card too.
      </p>
      <p v-if="versions.length === 0" class="history-hint">No changes yet.</p>
      <ul v-else class="version-list">
        <li v-for="(version, index) in newestFirst" :key="version.id" class="version">
          <div class="version-header">
            <div class="version-summary">
              <span class="version-label">{{ SOURCE_LABELS[version.source] }}</span>
              <span class="version-date">{{ formatWhen(version.created) }}</span>
              <span v-if="index === 0" class="meta-tag">Current</span>
            </div>
            <button
              v-if="index > 0"
              class="btn btn-secondary btn-small"
              :disabled="busy"
              @click="restore(version)"
            >
              <i class="fas fa-rotate-left"></i> Restore
            </button>
          </div>
          <p v-if="version.changed.length > 0" class="version-changed">
            Changed {{ changedLabel(version) }}
          </p>
          <details class="version-details">
            <summary>Show this version</summary>
            <template v-for="field in FIELDS" :key="field.key">
              <div v-if="fieldText(version, field.key)" class="version-field">
                <h4>{{ field.label }}</h4>
                <p>{{ fieldText(version, field.key) }}</p>
              </div>
            </template>
          </details>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { charactersAPI } from '../services/api';
import { useToast } from '../composables/useToast';
import { useConfirm } from '../composables/useConfirm';

const SOURCE_LABELS = {
  original: 'As imported',
  baseline: 'When history started',
  edit: 'Edited',
  restore: 'Restored an earlier version',
};

const FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description' },
  { key: 'lorebook', label: 'Lorebook' },
  { key: 'personality', label: 'Personality' },
  { key: 'scenario', label: 'Scenario' },
  { key: 'mes_example', label: 'Dialogue examples' },
  { key: 'first_mes', label: 'First message' },
  { key: 'alternate_greetings', label: 'Alternate greetings' },
  { key: 'system_prompt', label: 'System prompt' },
];

const CHANGED_LABELS = {
  ...Object.fromEntries(FIELDS.map((field) => [field.key, field.label.toLowerCase()])),
  portrait: 'the portrait',
  other: 'other card details',
};

const props = defineProps({
  characterId: { type: String, required: true },
  /** The character as the page shows it; history reloads whenever it changes. */
  character: { type: Object, required: true },
  /** Library lorebooks, to name the one a version links. */
  lorebooks: { type: Array, default: () => [] },
});

const emit = defineEmits(['restored']);
const toast = useToast();
const { confirm } = useConfirm();

const versions = ref([]);
const editedSinceImport = ref(false);
const loading = ref(true);
const busy = ref(false);

const newestFirst = computed(() => versions.value.toReversed());

async function load() {
  try {
    const data = await charactersAPI.listVersions(props.characterId);
    versions.value = data.versions;
    editedSinceImport.value = data.editedSinceImport;
  } catch (error) {
    toast.error('Failed to load history: ' + error.message);
  } finally {
    loading.value = false;
  }
}

async function restore(version) {
  const confirmed = await confirm({
    message: `Restore ${props.character.name}'s card to this version?\n\nThe current version stays in History, so you can come back to it. The portrait stays as it is.`,
    confirmText: 'Restore',
  });
  if (!confirmed) return;

  busy.value = true;
  try {
    await charactersAPI.restoreVersion(props.characterId, version.id);
    toast.success(`Restored ${props.character.name}'s card`);
    emit('restored');
  } catch (error) {
    toast.error('Failed to restore: ' + error.message);
  } finally {
    busy.value = false;
  }
}

function fieldText(version, key) {
  const data = version.data?.data ?? {};
  if (key === 'lorebook') {
    const lorebookId = data.extensions?.ursceal_lorebook_id;
    if (!lorebookId) return '';
    return props.lorebooks.find((lorebook) => lorebook.id === lorebookId)?.name ?? 'A lorebook';
  }
  const value = data[key];
  if (Array.isArray(value)) return value.filter((item) => item?.trim()).join('\n\n');
  return typeof value === 'string' ? value.trim() : '';
}

/** "description", "description and personality", or "name, description, and personality". */
function changedLabel(version) {
  const labels = version.changed.map((key) => CHANGED_LABELS[key] ?? key);
  if (labels.length <= 2) return labels.join(' and ');
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

watch(() => props.character, load, { deep: true });
onMounted(load);
</script>

<style scoped>
.history-hint {
  margin: 0 0 1rem 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.version-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.version {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.625rem 0.75rem;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.version-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.version-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.5rem;
}

.version-label {
  font-weight: 600;
}

.version-date,
.version-changed {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.version-changed {
  margin: 0;
}

.meta-tag {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--text-secondary);
  background-color: var(--bg-tertiary);
  border-radius: 999px;
  padding: 0.0625rem 0.5rem;
}

.version-details summary {
  font-size: 0.8rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.version-field h4 {
  margin: 0.625rem 0 0.25rem;
  font-size: 0.8rem;
  font-weight: 600;
}

.version-field p {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
