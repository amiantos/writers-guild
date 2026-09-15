<template>
  <Modal
    :title="member ? `${member.name}'s profile` : 'Profile'"
    max-width="720px"
    @close="$emit('close')"
  >
    <div v-if="loading" class="loading">Loading profile...</div>
    <div v-else-if="member" class="form profile">
      <p class="help-text">
        {{ member.name }}'s card as this Bureau keeps it, and their routine. Changes stay in this
        Bureau{{ member.libraryCharacterId ? ", and your library character isn't touched" : '' }}.
        Every version is kept under History.
      </p>

      <div class="tabs" role="tablist">
        <button
          v-for="option in tabs"
          :key="option.key"
          role="tab"
          class="tab"
          :class="{ active: tab === option.key }"
          :aria-selected="tab === option.key"
          @click="tab = option.key"
        >
          {{ option.label }}
          <span v-if="option.count" class="tab-count">{{ option.count }}</span>
        </button>
      </div>

      <template v-if="tab === 'profile'">
        <section v-for="field in fields" :key="field.key" class="profile-field">
          <div class="field-header">
            <h3>{{ field.label }}</h3>
            <button
              v-if="editing !== field.key"
              class="btn btn-secondary btn-small"
              :disabled="editing !== null || busy"
              @click="startEdit(field.key)"
            >
              <i class="fas fa-pen"></i> Edit
            </button>
          </div>

          <template v-if="editing === field.key">
            <textarea
              ref="editorRef"
              v-model="draft"
              class="textarea-input"
              :rows="field.rows"
              :maxlength="field.maxLength"
              :placeholder="field.placeholder"
              :aria-label="field.label"
              @keydown.meta.enter.prevent="save"
              @keydown.ctrl.enter.prevent="save"
              @keydown.esc="editing = null"
            ></textarea>
            <p v-if="field.help" class="help-text">{{ field.help }}</p>
            <div class="field-actions">
              <button class="btn btn-secondary btn-small" @click="editing = null">Cancel</button>
              <button class="btn btn-primary btn-small" :disabled="busy" @click="save">
                <i class="fas fa-save"></i> {{ busy ? 'Saving...' : 'Save' }}
              </button>
            </div>
          </template>
          <div
            v-else-if="profile[field.key].trim() && field.prose"
            class="field-text"
            v-html="renderProse(profile[field.key])"
          ></div>
          <p v-else-if="profile[field.key].trim()" class="field-text plain">
            {{ profile[field.key] }}
          </p>
          <p v-else class="empty-hint">{{ field.empty }}</p>
        </section>

        <section v-if="arcNotes.length > 0" class="profile-field">
          <div class="field-header">
            <h3>How {{ member.name }} has changed</h3>
          </div>
          <ul class="changes-list">
            <li v-for="note in arcNotes" :key="note.id">{{ note.content }}</li>
          </ul>
          <p class="help-text">
            Changes you accepted in {{ member.name }}'s memories. The Writer reads them with the
            profile.
          </p>
        </section>
      </template>

      <template v-else>
        <p v-if="versions.length === 0" class="empty-hint">
          No changes yet. {{ member.name }}'s profile is as it was when they joined the Bureau.
        </p>
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
                :disabled="busy || editing !== null"
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
              <template v-for="field in fields" :key="field.key">
                <div v-if="version.fields[field.key]?.trim()" class="version-field">
                  <h4>{{ field.label }}</h4>
                  <p>{{ version.fields[field.key] }}</p>
                </div>
              </template>
            </details>
          </li>
        </ul>
      </template>
    </div>

    <template #footer>
      <button
        class="btn btn-secondary"
        :disabled="!member || !hasApiKey"
        :title="interviewTitle"
        @click="openInterview"
      >
        <i class="fas fa-comments"></i> Interview
      </button>
      <button class="btn btn-primary" @click="$emit('close')">Done</button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Modal from '../Modal.vue';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import { renderProse } from '../../composables/bureau/renderProse';

const SOURCE_LABELS = {
  original: 'Original',
  manual: 'Edited by you',
  interview: 'From an interview',
  restore: 'Restored an earlier version',
};
const ROUTINE_MAX_LENGTH = 2000;

const props = defineProps({
  bureauId: { type: String, required: true },
  castId: { type: String, required: true },
  /** Interviews need the Bureau's API key. */
  hasApiKey: { type: Boolean, default: true },
});

const emit = defineEmits(['close', 'changed']);
const router = useRouter();
const toast = useToast();
const { confirm } = useConfirm();

const member = ref(null);
const profile = ref({});
const versions = ref([]);
const arcNotes = ref([]);
const loading = ref(true);
const tab = ref('profile');
const editing = ref(null);
const draft = ref('');
const busy = ref(false);
const editorRef = ref([]);

const fields = computed(() => {
  const name = member.value?.name ?? '';
  return [
    {
      key: 'description',
      label: 'Description',
      rows: 8,
      prose: true,
      empty: 'No description yet.',
    },
    {
      key: 'personality',
      label: 'Personality',
      rows: 4,
      prose: true,
      empty: 'No personality yet.',
    },
    {
      key: 'routine',
      label: 'Routine',
      rows: 4,
      maxLength: ROUTINE_MAX_LENGTH,
      placeholder:
        'Keeps the light from dusk to dawn, sleeps through the mornings, and eats lunch at the harbor pub on Fridays.',
      help: `How ${name} usually spends their days and weeks. Replies take it into account at each time of day, and so does their offscreen life when time jumps forward.`,
      empty: `No routine yet. Describe how ${name} usually spends their days, or interview them about it.`,
    },
    { key: 'scenario', label: 'Scenario', rows: 3, prose: true, empty: 'No scenario.' },
    { key: 'first_mes', label: 'First message', rows: 6, prose: true, empty: 'No first message.' },
    { key: 'mes_example', label: 'Example dialogue', rows: 6, empty: 'No example dialogue.' },
  ];
});

const tabs = computed(() => [
  { key: 'profile', label: 'Profile', count: 0 },
  { key: 'history', label: 'History', count: versions.value.length },
]);

const newestFirst = computed(() => versions.value.toReversed());

const interviewTitle = computed(() =>
  props.hasApiKey
    ? `Answer questions about ${member.value?.name ?? 'them'} to flesh out their profile`
    : "Add a DeepSeek API key in the Bureau's settings or on the Bureaus tab to interview characters",
);

function apply(data) {
  member.value = data.castMember;
  profile.value = data.profile;
  versions.value = data.versions;
}

async function load() {
  try {
    const [profileData, notesData] = await Promise.all([
      bureausAPI.getProfile(props.bureauId, props.castId),
      bureausAPI.listArcNotes(props.bureauId, props.castId, { status: 'accepted' }),
    ]);
    apply(profileData);
    arcNotes.value = notesData.arcNotes;
  } catch (error) {
    toast.error('Failed to load the profile: ' + error.message);
    emit('close');
  } finally {
    loading.value = false;
  }
}

function startEdit(field) {
  draft.value = profile.value[field];
  editing.value = field;
  nextTick(() => editorRef.value[0]?.focus());
}

async function save() {
  const field = editing.value;
  if (!field || busy.value) return;
  busy.value = true;
  try {
    apply(await bureausAPI.updateProfile(props.bureauId, props.castId, { [field]: draft.value }));
    editing.value = null;
    emit('changed');
  } catch (error) {
    toast.error('Failed to save: ' + error.message);
  } finally {
    busy.value = false;
  }
}

async function restore(version) {
  const confirmed = await confirm({
    message: `Restore ${member.value.name}'s profile to this version?\n\nThe current version stays in History, so you can come back to it.`,
    confirmText: 'Restore',
  });
  if (!confirmed) return;

  busy.value = true;
  try {
    apply(await bureausAPI.restoreProfileVersion(props.bureauId, props.castId, version.id));
    toast.success(`Restored ${member.value.name}'s profile`);
    emit('changed');
  } catch (error) {
    toast.error('Failed to restore: ' + error.message);
  } finally {
    busy.value = false;
  }
}

/** "description", "description and routine", or "description, personality, and routine". */
function changedLabel(version) {
  const labels = version.changed.map(
    (key) => fields.value.find((field) => field.key === key)?.label.toLowerCase() ?? key,
  );
  if (labels.length <= 2) return labels.join(' and ');
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function openInterview() {
  router.push({
    name: 'bureau-interview',
    params: { bureauId: props.bureauId, castId: props.castId },
  });
}

onMounted(load);
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.tabs {
  display: flex;
  gap: 0.25rem;
  border-bottom: 1px solid var(--border-color);
}

.tab {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
}

.tab.active {
  color: var(--text-primary);
  border-bottom-color: var(--accent-primary);
  font-weight: 600;
}

.tab-count {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.profile-field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.field-header h3 {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 600;
}

.field-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.field-text {
  margin: 0;
  line-height: 1.55;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.field-text :deep(p) {
  margin: 0 0 0.625rem;
}

.field-text :deep(p:last-child) {
  margin-bottom: 0;
}

.field-text :deep(img) {
  max-width: 100%;
  border-radius: 4px;
}

.field-text.plain {
  white-space: pre-wrap;
}

.changes-list {
  margin: 0;
  padding-left: 1.25rem;
  line-height: 1.5;
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
