<template>
  <Modal title="Time passes" max-width="440px" @close="$emit('close')">
    <div class="form">
      <p v-if="intro" class="help-text">{{ intro }}</p>

      <div class="step-list">
        <button
          v-for="step in STEPS"
          :key="step.value"
          class="btn btn-secondary step-button"
          :disabled="passing"
          @click="$emit('pass', { step: step.value })"
        >
          {{ step.label }}
        </button>
      </div>

      <div class="form-group">
        <label for="time-passes-to">Pick a date and time</label>
        <input
          id="time-passes-to"
          v-model="customTime"
          type="datetime-local"
          min="0001-01-02T00:00"
          max="9999-12-30T23:59"
          class="text-input"
        />
        <p v-if="pickHelp" class="help-text">{{ pickHelp }}</p>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button
        class="btn btn-primary"
        :disabled="!laterTime || passing"
        @click="$emit('pass', { to: laterTime })"
      >
        <i class="fas fa-forward"></i> Move to this time
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed, ref } from 'vue';
import Modal from '../Modal.vue';
import { fromDatetimeLocal, toDatetimeLocal } from '../../composables/bureau/format';

// The ways time can pass (TIME_STEPS on the server).
const STEPS = [
  { value: 'hour', label: 'An hour later' },
  { value: 'later', label: 'Later that day' },
  { value: 'morning', label: 'The next morning' },
  { value: 'days', label: 'A few days later' },
  { value: 'week', label: 'A week later' },
];

const props = defineProps({
  /** The time it passes from (ISO): Bureau time, or a chapter's time. */
  from: { type: String, required: true },
  /** The Bureau's time zone, which the picked time is read in. */
  timeZone: { type: String, default: null },
  passing: { type: Boolean, default: false },
  intro: { type: String, default: '' },
  pickHelp: { type: String, default: '' },
});

defineEmits(['pass', 'close']);

const customTime = ref(toDatetimeLocal(props.from, props.timeZone));

// The picked time, read on the Bureau's clock, while it's later than the time it passes from.
const laterTime = computed(() => {
  const time = fromDatetimeLocal(customTime.value, props.timeZone);
  return time && Date.parse(time) > Date.parse(props.from) ? time : null;
});
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.step-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.step-button {
  justify-content: flex-start;
}
</style>
