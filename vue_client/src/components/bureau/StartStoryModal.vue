<template>
  <Modal title="Start a chapter" max-width="540px" @close="$emit('close')">
    <div class="form">
      <div class="form-group">
        <label for="start-story-title">Title</label>
        <input
          id="start-story-title"
          v-model="title"
          type="text"
          class="text-input"
          :placeholder="`Chapter ${storyCount + 1}`"
        />
      </div>

      <div class="form-group">
        <span class="group-label">Who's in it</span>
        <label v-for="member in cast" :key="member.id" class="checkbox-label">
          <input v-model="castIds" type="checkbox" :value="member.id" />
          {{ member.name }}
          <span v-if="member.isPersona" class="persona-tag">Reader's character</span>
        </label>
      </div>

      <div class="form-group">
        <span class="group-label">When does it start?</span>
        <label class="radio-label">
          <input v-model="choice" type="radio" value="bureau" />
          Bureau time
          <span class="choice-detail">{{
            formatDateTime(bureau.bureauTime, bureau.timezone)
          }}</span>
        </label>
        <label class="radio-label">
          <input v-model="choice" type="radio" value="custom" />
          A time I pick
        </label>
        <input
          v-if="choice === 'custom'"
          v-model="customTime"
          type="datetime-local"
          min="0001-01-02T00:00"
          max="9999-12-30T23:59"
          class="text-input"
          aria-label="Start time"
        />
        <p class="help-text">
          The chapter opens at exactly this time, and the Bureau's clock moves to it. An earlier
          time works as a flashback, and any year from 1 to 9999 works.
        </p>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="!canStart || starting" @click="start">
        <i class="fas fa-play"></i> {{ starting ? 'Starting...' : 'Start chapter' }}
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
  browserTimeZone,
  formatDateTime,
  fromDatetimeLocal,
  rememberChoice,
  rememberedChoice,
  toDatetimeLocal,
} from '../../composables/bureau/format';

const CHOICE_KEY = 'bureau-story-start-choice';

const props = defineProps({
  bureau: { type: Object, required: true },
  cast: { type: Array, required: true },
  storyCount: { type: Number, default: 0 },
});

const emit = defineEmits(['close', 'started']);
const toast = useToast();

const title = ref('');
const castIds = ref(props.cast.map((member) => member.id));
const choice = ref(rememberedChoice(CHOICE_KEY, ['bureau', 'custom'], 'bureau'));
const customTime = ref(toDatetimeLocal(props.bureau.bureauTime, props.bureau.timezone));
const starting = ref(false);

// The picked time, read on the Bureau's clock (the browser's until the Bureau has a time zone).
const pickedTime = computed(() => fromDatetimeLocal(customTime.value, props.bureau.timezone));
const canStart = computed(
  () => castIds.value.length > 0 && (choice.value !== 'custom' || pickedTime.value),
);

watch(choice, (value) => rememberChoice(CHOICE_KEY, value));

async function start() {
  if (!canStart.value || starting.value) return;
  starting.value = true;
  try {
    const { story, archiveError, offscreenError } = await bureauStoriesAPI.start(props.bureau.id, {
      title: title.value.trim() || undefined,
      castIds: castIds.value,
      start: {
        choice: choice.value,
        customTime: choice.value === 'custom' ? pickedTime.value : undefined,
      },
      timeZone: browserTimeZone(),
    });
    if (archiveError) {
      toast.error(`The chapter started, but committing messages to memory failed: ${archiveError}`);
    }
    if (offscreenError) {
      toast.error(
        `The chapter started, but catching the cast up on time away failed: ${offscreenError}`,
      );
    }
    emit('started', story);
  } catch (error) {
    console.error('Failed to start story:', error);
    toast.error('Failed to start the chapter: ' + error.message);
  } finally {
    starting.value = false;
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
