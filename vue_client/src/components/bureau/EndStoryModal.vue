<template>
  <Modal title="End this chapter" max-width="520px" @close="$emit('close')">
    <div class="form">
      <p class="help-text">
        An ended chapter takes no new turns.
        <template v-if="commitsToMemory">
          The Archivist then commits the rest of it to the characters' memories.
        </template>
        What should the Bureau's clock say afterward?
      </p>

      <div class="form-group">
        <label class="radio-label">
          <input v-model="choice" type="radio" value="unchanged" />
          Leave Bureau time as it is
          <span class="choice-detail">{{
            formatDateTime(bureau.bureauTime, bureau.timezone)
          }}</span>
        </label>
        <label class="radio-label">
          <input v-model="choice" type="radio" value="custom" />
          A time I pick
          <span class="choice-detail">to reflect how long the chapter lasted</span>
        </label>
        <input
          v-if="choice === 'custom'"
          v-model="customTime"
          type="datetime-local"
          min="0001-01-01T00:00"
          max="9999-12-31T23:59"
          class="text-input"
          aria-label="End time"
        />
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="!canEnd || ending" @click="end">
        <i class="fas fa-flag-checkered"></i> {{ endingLabel }}
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import Modal from '../Modal.vue';
import { bureauStoriesAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import {
  formatDateTime,
  fromDatetimeLocal,
  rememberChoice,
  rememberedChoice,
  toDatetimeLocal,
} from '../../composables/bureau/format';

const CHOICE_KEY = 'bureau-story-end-choice';
const TWO_HOURS = 2 * 60 * 60 * 1000;

const props = defineProps({
  bureau: { type: Object, required: true },
  story: { type: Object, required: true },
});

const emit = defineEmits(['close', 'ended']);
const toast = useToast();

const choice = ref(rememberedChoice(CHOICE_KEY, ['unchanged', 'custom'], 'unchanged'));
const customTime = ref(toDatetimeLocal(new Date(Date.parse(props.story.startTime) + TWO_HOURS)));
const ending = ref(false);

const canEnd = computed(() => choice.value !== 'custom' || fromDatetimeLocal(customTime.value));
const commitsToMemory = computed(
  () => props.bureau.hasApiKey && props.bureau.settings?.memory?.autoArchive !== false,
);
const endingLabel = computed(() => {
  if (!ending.value) return 'End chapter';
  return commitsToMemory.value ? 'Committing to memory...' : 'Ending...';
});

watch(choice, (value) => rememberChoice(CHOICE_KEY, value));

async function end() {
  if (!canEnd.value || ending.value) return;
  ending.value = true;
  try {
    const result = await bureauStoriesAPI.end(props.bureau.id, props.story.id, {
      choice: choice.value,
      customTime: choice.value === 'custom' ? fromDatetimeLocal(customTime.value) : undefined,
    });
    emit('ended', result);
  } catch (error) {
    console.error('Failed to end story:', error);
    toast.error('Failed to end the chapter: ' + error.message);
  } finally {
    ending.value = false;
  }
}
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.choice-detail {
  color: var(--text-secondary);
  font-size: 0.8rem;
  font-weight: 400;
}
</style>
