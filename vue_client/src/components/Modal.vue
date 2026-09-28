<template>
  <div class="modal-overlay" @mousedown="handleOverlayPress" @click.self="handleOverlayClick">
    <div
      ref="contentRef"
      class="modal-content"
      :style="contentStyle"
      @focusin="rememberValue"
      @input="noteEdit"
    >
      <div v-if="!hideHeader" class="modal-header">
        <slot name="header">
          <h2>{{ title }}</h2>
        </slot>
        <button v-if="!hideCloseButton" class="close-btn" @click="handleClose">
          <i class="fas fa-xmark"></i>
        </button>
      </div>

      <div class="modal-body">
        <slot></slot>
      </div>

      <div v-if="hasFooter" class="modal-footer">
        <slot name="footer"></slot>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, useSlots } from 'vue';

const props = defineProps({
  title: {
    type: String,
    default: '',
  },
  maxWidth: {
    type: String,
    default: '600px',
  },
  maxHeight: {
    type: String,
    default: '80vh',
  },
  hideHeader: {
    type: Boolean,
    default: false,
  },
  hideCloseButton: {
    type: Boolean,
    default: false,
  },
  closeOnOverlayClick: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['close']);

const slots = useSlots();

// Input types that don't hold text someone typed. A search box only holds a query.
const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'search',
  'submit',
]);

const contentRef = ref(null);

// Whether the latest press started on the overlay. Selecting text and letting go past the modal's
// edge also clicks the overlay, and shouldn't close it.
let pressedOverlay = false;

// Text fields typed in, and what each held before the typing started.
const editedFields = new Set();
const valuesBefore = new WeakMap();

const hasFooter = computed(() => {
  return !!slots.footer;
});

const contentStyle = computed(() => {
  return {
    maxWidth: props.maxWidth,
    maxHeight: props.maxHeight,
  };
});

function isTextField(element) {
  if (element?.tagName === 'TEXTAREA') return true;
  if (element?.tagName === 'INPUT') return !NON_TEXT_INPUTS.has(element.type);
  return Boolean(element?.isContentEditable);
}

function valueOf(field) {
  return field.isContentEditable ? field.textContent : field.value;
}

function rememberValue(event) {
  if (isTextField(event.target) && !valuesBefore.has(event.target)) {
    valuesBefore.set(event.target, valueOf(event.target));
  }
}

function noteEdit(event) {
  if (isTextField(event.target)) {
    editedFields.add(event.target);
  }
}

/**
 * Whether the modal holds typed text that isn't saved: a field still in it whose text differs from
 * what it held before typing. A field that's gone, such as an editor closed after saving, doesn't
 * count.
 */
function hasUnsavedText() {
  for (const field of editedFields) {
    if (!contentRef.value?.contains(field)) {
      editedFields.delete(field);
    } else if (valueOf(field) !== (valuesBefore.has(field) ? valuesBefore.get(field) : '')) {
      return true;
    }
  }
  return false;
}

function handleClose() {
  emit('close');
}

function handleOverlayPress(event) {
  pressedOverlay = event.target === event.currentTarget;
}

// A click outside closes the modal only when the press started outside too, and never while it
// holds unsaved text. The close button still closes it.
function handleOverlayClick() {
  const startedOutside = pressedOverlay;
  pressedOverlay = false;
  if (props.closeOnOverlayClick && startedOutside && !hasUnsavedText()) {
    handleClose();
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background-color: var(--bg-secondary);
  border-radius: 8px;
  width: 90%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.25rem;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.close-btn:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
  flex: 1;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-color);
}
</style>
