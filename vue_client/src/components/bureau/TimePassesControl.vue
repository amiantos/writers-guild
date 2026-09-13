<template>
  <div class="time-passes">
    <button
      class="btn btn-secondary btn-small"
      :disabled="disabled"
      title="Move Bureau time forward"
      @click="showing = true"
    >
      <i class="fas fa-hourglass-half"></i> Time passes
    </button>

    <TimePassesPicker
      v-if="showing"
      :from="bureau.bureauTime"
      :time-zone="bureau.timezone"
      :passing="passing"
      :intro="`Bureau time is ${formatDateTime(bureau.bureauTime, bureau.timezone)}. Only you move it forward.`"
      pick-help="Later than Bureau time. To set an earlier time, use the Bureau's settings."
      @pass="pass"
      @close="showing = false"
    />
  </div>
</template>

<script setup>
import { ref } from 'vue';
import TimePassesPicker from './TimePassesPicker.vue';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import { formatDateTime } from '../../composables/bureau/format';

const props = defineProps({
  bureau: { type: Object, required: true },
  disabled: { type: Boolean, default: false },
});

const emit = defineEmits(['updated']);
const toast = useToast();

const showing = ref(false);
const passing = ref(false);

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
