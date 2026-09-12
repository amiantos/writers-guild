<template>
  <section class="edit-section">
    <div class="section-header">
      <h2><i class="fas fa-users"></i> Cast</h2>
      <div class="header-actions">
        <button
          class="btn btn-secondary btn-small"
          :disabled="!hasApiKey"
          :title="hasApiKey ? '' : 'Add a DeepSeek API key in Settings to generate characters'"
          @click="showGenerate = true"
        >
          <i class="fas fa-wand-magic-sparkles"></i> Generate character
        </button>
        <button class="btn btn-secondary btn-small" @click="showAdd = true">
          <i class="fas fa-user-plus"></i> Add character
        </button>
      </div>
    </div>

    <div class="section-content">
      <p v-if="cast.length === 0" class="empty-hint">
        No one yet. Add characters from your library; the Bureau keeps its own copy of each card, so
        nothing here changes your library.
      </p>

      <ul v-else class="cast-list">
        <li v-for="member in cast" :key="member.id" class="cast-row">
          <img
            v-if="member.libraryCharacterId && !brokenImages[member.id]"
            class="cast-avatar"
            :src="`/api/characters/${member.libraryCharacterId}/thumbnail`"
            alt=""
            @error="brokenImages[member.id] = true"
          />
          <div v-else class="cast-avatar placeholder"><i class="fas fa-user"></i></div>

          <div class="cast-info">
            <span class="cast-name">{{ member.name }}</span>
            <span v-if="member.isPersona" class="persona-tag">Reader's character</span>
            <span
              v-if="member.isDraft"
              class="persona-tag"
              title="Generated in this Bureau and not in your library yet"
            >
              Draft
            </span>
          </div>

          <button
            v-if="!member.isPersona"
            class="btn btn-secondary btn-small memories-button"
            :title="`Browse and correct what ${member.name} remembers`"
            @click="memoryMember = member"
          >
            <i class="fas fa-brain"></i> Memories
            <span v-if="memoryCounts[member.id]?.current" class="memory-count">
              {{ memoryCounts[member.id].current }}
            </span>
            <span v-if="reviewTitle(member)" class="review-dot" :title="reviewTitle(member)"></span>
          </button>
          <label class="checkbox-label reader-toggle" :title="readerToggleTitle">
            <input
              type="checkbox"
              :checked="member.isPersona"
              :disabled="busy[member.id]"
              @change="setPersona(member, $event.target.checked)"
            />
            Reader
          </label>
          <button
            v-if="member.isDraft"
            class="icon-btn"
            title="Save to your library"
            :disabled="busy[member.id]"
            @click="saveDraft(member)"
          >
            <i class="fas fa-floppy-disk"></i>
          </button>
          <button
            v-else-if="!member.isPersona"
            class="icon-btn"
            title="Export to your library as a new character"
            :disabled="busy[member.id]"
            @click="exportMember(member)"
          >
            <i class="fas fa-file-export"></i>
          </button>
          <button
            class="icon-btn"
            title="Remove from the cast"
            :disabled="busy[member.id]"
            @click="remove(member)"
          >
            <i class="fas fa-trash"></i>
          </button>
        </li>
      </ul>
    </div>

    <AddCastModal
      v-if="showAdd"
      :bureau-id="bureauId"
      :cast="cast"
      @close="showAdd = false"
      @added="handleAdded"
    />
    <GenerateCharacterModal
      v-if="showGenerate"
      :bureau-id="bureauId"
      @close="showGenerate = false"
      @added="handleGenerated"
    />
    <MemoryBrowserModal
      v-if="memoryMember"
      :bureau-id="bureauId"
      :member="memoryMember"
      @close="memoryMember = null"
      @changed="emit('changed')"
    />
  </section>
</template>

<script setup>
import { reactive, ref } from 'vue';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';
import AddCastModal from './AddCastModal.vue';
import GenerateCharacterModal from './GenerateCharacterModal.vue';
import MemoryBrowserModal from './MemoryBrowserModal.vue';

const props = defineProps({
  bureauId: { type: String, required: true },
  cast: { type: Array, required: true },
  /** Current memories per cast member id: { current, needsReview }. */
  memoryCounts: { type: Object, default: () => ({}) },
  /** Arc notes that wait for the reader per cast member id: { proposed, needsReview }. */
  arcNoteCounts: { type: Object, default: () => ({}) },
  /** Generating characters needs the Bureau's API key. */
  hasApiKey: { type: Boolean, default: true },
});

const emit = defineEmits(['changed', 'lorebook-attached']);
const toast = useToast();
const { confirm } = useConfirm();

const readerToggleTitle = "The reader's character is the one you write for in stories";
const showAdd = ref(false);
const showGenerate = ref(false);
const memoryMember = ref(null);
// Cast member ids with a request in flight.
const busy = reactive({});
const brokenImages = reactive({});

/** What waits for the reader in a member's memory browser, or '' when nothing does. */
function reviewTitle(member) {
  const check = props.memoryCounts[member.id]?.needsReview ?? 0;
  const proposed = props.arcNoteCounts[member.id]?.proposed ?? 0;
  const changesToCheck = props.arcNoteCounts[member.id]?.needsReview ?? 0;
  const parts = [];
  if (check) parts.push(`${check} ${check === 1 ? 'memory' : 'memories'} to check`);
  if (proposed) parts.push(`${proposed} ${proposed === 1 ? 'change' : 'changes'} to review`);
  if (changesToCheck) {
    parts.push(`${changesToCheck} ${changesToCheck === 1 ? 'change' : 'changes'} to check`);
  }
  return parts.join(', ');
}

async function exportMember(member) {
  const confirmed = await confirm({
    message: `Export ${member.name} to your library as a new character?\n\nThe new character starts from ${member.name}'s card in this Bureau, with the changes you've accepted. The library character this Bureau copied isn't touched.`,
    confirmText: 'Export',
  });
  if (!confirmed) return;

  busy[member.id] = true;
  try {
    const { name } = await bureausAPI.exportCast(props.bureauId, member.id);
    toast.success(`Exported ${name} to your library`);
  } catch (error) {
    toast.error('Failed to export: ' + error.message);
  } finally {
    delete busy[member.id];
  }
}

async function saveDraft(member) {
  busy[member.id] = true;
  try {
    await bureausAPI.promoteCast(props.bureauId, member.id);
    toast.success(`Saved ${member.name} to your library`);
    emit('changed');
  } catch (error) {
    toast.error('Failed to save to your library: ' + error.message);
  } finally {
    delete busy[member.id];
  }
}

function handleGenerated({ castMember, savedToLibrary, libraryError }) {
  showGenerate.value = false;
  if (libraryError) {
    toast.error(
      `${castMember.name} joined the cast as a draft, but saving to your library failed: ${libraryError}`,
    );
  } else {
    toast.success(
      savedToLibrary
        ? `${castMember.name} joined the cast and your library`
        : `${castMember.name} joined the cast as a draft`,
    );
  }
  emit('changed');
}

async function setPersona(member, isPersona) {
  busy[member.id] = true;
  try {
    await bureausAPI.updateCast(props.bureauId, member.id, { isPersona });
    emit('changed');
  } catch (error) {
    toast.error('Failed to update the cast: ' + error.message);
  } finally {
    delete busy[member.id];
  }
}

async function remove(member) {
  const confirmed = await confirm({
    message: `Remove ${member.name} from this Bureau's cast?\n\nTheir copy of the card is deleted. Your library character is not affected.`,
    confirmText: 'Remove',
    variant: 'danger',
  });
  if (!confirmed) return;

  busy[member.id] = true;
  try {
    await bureausAPI.removeCast(props.bureauId, member.id);
    emit('changed');
  } catch (error) {
    toast.error('Failed to remove from the cast: ' + error.message);
  } finally {
    delete busy[member.id];
  }
}

function handleAdded({ castMember, attachedLorebookId }) {
  toast.success(`${castMember.name} joined the cast`);
  emit('changed');
  if (attachedLorebookId) {
    toast.info(`Attached ${castMember.name}'s lorebook to this Bureau`);
    emit('lorebook-attached');
  }
}
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.cast-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.cast-row {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.5rem 0.75rem;
  background-color: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
}

.cast-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.cast-name {
  font-weight: 600;
}

.reader-toggle {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.memories-button {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.memory-count {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.review-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background-color: var(--warning-color, #d49b2a);
}
</style>
