<template>
  <Teleport to="body">
    <div
      class="sheet-overlay"
      @mousedown.self="pressedOverlay = true"
      @click.self="closeFromOverlay"
    >
      <section
        ref="panel"
        class="sheet"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="labelledby"
        tabindex="-1"
        @keydown.esc.stop="$emit('close')"
      >
        <div class="sheet-grabber" aria-hidden="true"></div>
        <slot></slot>
      </section>
    </div>
  </Teleport>
</template>

<script setup>
import { onMounted, ref } from 'vue';

// A sheet that rises from the bottom on a phone and sits centred as a dialog on wider screens.
defineProps({
  // The id of the element that names the sheet
  labelledby: { type: String, default: null },
});

const emit = defineEmits(['close']);

const panel = ref(null);
const pressedOverlay = ref(false);

// Close only for a click that both started and ended on the overlay, not a drag out of the sheet.
function closeFromOverlay() {
  if (pressedOverlay.value) emit('close');
  pressedOverlay.value = false;
}

onMounted(() => panel.value?.focus());
</script>

<style scoped>
.sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.58);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.sheet {
  width: 100%;
  max-width: 440px;
  max-height: calc(100dvh - 2rem);
  overflow-y: auto;
  box-sizing: border-box;
  padding: 1rem 1rem 1.25rem;
  border-radius: 16px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  box-shadow: var(--shadow-lg);
  outline: none;
}

.sheet-grabber {
  display: none;
}

@media (max-width: 720px) {
  .sheet-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .sheet {
    max-width: none;
    max-height: 90dvh;
    padding: 0.5rem 1rem calc(1.5rem + env(safe-area-inset-bottom));
    border-radius: 20px 20px 0 0;
  }

  .sheet-grabber {
    display: block;
    width: 38px;
    height: 5px;
    margin: 0 auto 0.75rem;
    border-radius: 3px;
    background: var(--bg-tertiary);
  }
}
</style>
