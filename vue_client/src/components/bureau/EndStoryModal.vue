<template>
  <Modal title="End this story" max-width="520px" @close="$emit('close')">
    <div class="form">
      <p class="help-text">
        An ended story takes no new turns. What should the Bureau's clock say afterward?
      </p>

      <div class="form-group">
        <label class="radio-label">
          <input v-model="choice" type="radio" value="present" />
          Now
          <span class="choice-detail">{{ formatDateTime(now) }}</span>
        </label>
        <label class="radio-label">
          <input v-model="choice" type="radio" value="custom" />
          A time I pick
          <span class="choice-detail">to reflect how long the story lasted</span>
        </label>
        <input
          v-if="choice === 'custom'"
          v-model="customTime"
          type="datetime-local"
          class="text-input"
          aria-label="End time"
        />
        <label class="radio-label">
          <input v-model="choice" type="radio" value="unchanged" />
          Leave it as is
          <span class="choice-detail">{{
            formatDateTime(bureau.bureauTime, bureau.timezone)
          }}</span>
        </label>
      </div>
    </div>

    <template #footer>
      <button class="btn btn-secondary" @click="$emit('close')">Cancel</button>
      <button class="btn btn-primary" :disabled="!canEnd || ending" @click="end">
        <i class="fas fa-flag-checkered"></i> {{ ending ? 'Ending...' : 'End story' }}
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

const now = new Date();
const choice = ref(rememberedChoice(CHOICE_KEY, ['present', 'custom', 'unchanged'], 'present'));
const customTime = ref(toDatetimeLocal(new Date(Date.parse(props.story.startTime) + TWO_HOURS)));
const ending = ref(false);

const canEnd = computed(() => choice.value !== 'custom' || fromDatetimeLocal(customTime.value));

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
    toast.error('Failed to end the story: ' + error.message);
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
