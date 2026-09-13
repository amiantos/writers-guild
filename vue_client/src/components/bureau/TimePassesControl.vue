<template>
  <div class="time-passes">
    <button
      class="btn btn-secondary btn-small"
      :disabled="disabled"
      title="Move Bureau time forward"
      @click="open"
    >
      <i class="fas fa-hourglass-half"></i> Time passes
    </button>

    <Modal v-if="showing" title="Time passes" max-width="440px" @close="showing = false">
      <div class="form">
        <p class="help-text">
          Bureau time is {{ formatDateTime(bureau.bureauTime, bureau.timezone) }}. Only you move it
          forward.
        </p>

        <div class="step-list">
          <button
            v-for="step in STEPS"
            :key="step.value"
            class="btn btn-secondary step-button"
            :disabled="passing"
            @click="pass({ step: step.value })"
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
          <p class="help-text">
            Later than Bureau time. To set an earlier time, use the Bureau's settings.
          </p>
        </div>
      </div>

      <template #footer>
        <button class="btn btn-secondary" @click="showing = false">Cancel</button>
        <button
          class="btn btn-primary"
          :disabled="!laterTime || passing"
          @click="pass({ to: laterTime })"
        >
          <i class="fas fa-forward"></i> Move to this time
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import Modal from '../Modal.vue';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import {
  formatDateTime,
  fromDatetimeLocal,
  toDatetimeLocal,
} from '../../composables/bureau/format';

const STEPS = [
  { value: 'hour', label: 'An hour later' },
  { value: 'later', label: 'Later that day' },
  { value: 'morning', label: 'The next morning' },
  { value: 'days', label: 'A few days later' },
  { value: 'week', label: 'A week later' },
];

const props = defineProps({
  bureau: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['updated']);
const toast = useToast();

const showing = ref(false);
const passing = ref(false);
const customTime = ref('');

// The picked time, read on the Bureau's clock, while it's later than Bureau time.
const laterTime = computed(() => {
  const time = fromDatetimeLocal(customTime.value, props.bureau.timezone);
  return time && Date.parse(time) > Date.parse(props.bureau.bureauTime) ? time : null;
});

function open() {
  customTime.value = toDatetimeLocal(props.bureau.bureauTime, props.bureau.timezone);
  showing.value = true;
}

async function pass(move) {
  if (passing.value) return;
  passing.value = true;
  try {
    const { bureau } = await bureausAPI.passTime(props.bureau.id, move);
    emit('updated', bureau);
    showing.value = false;
    toast.success(`Bureau time is now ${formatDateTime(bureau.bureauTime, bureau.timezone)}`);
  } catch (error) {
    toast.error('Failed to move Bureau time: ' + error.message);
  } finally {
    passing.value = false;
  }
}
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
