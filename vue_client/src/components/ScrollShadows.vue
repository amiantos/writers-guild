<template>
  <div class="scroll-shadows">
    <div
      ref="scroller"
      :class="['scroll-viewport', { 'hide-scrollbar': hideScrollbar }]"
      :style="maskStyle"
    >
      <slot />
    </div>
    <template v-if="edge === 'shadow'">
      <div v-if="canScrollLeft" class="scroll-shadow scroll-shadow-left" aria-hidden="true"></div>
      <div v-if="canScrollRight" class="scroll-shadow scroll-shadow-right" aria-hidden="true"></div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';

/**
 * Scrolls its content sideways and shadows whichever edge there is more content
 * towards, so content wider than the screen does not look like it simply ends.
 * Mostly for phones.
 *
 *   <ScrollShadows class="my-border-and-radius">
 *     <div class="my-row">...</div>
 *   </ScrollShadows>
 *
 * Style the outside through the class on the component, and the contents as
 * usual: slot content belongs to the parent, so scoped styles reach it.
 *
 * The state is measured rather than drawn with background-attachment: local,
 * which WebKit ignores on scroll containers, so a CSS-only version of this
 * shows nothing at all on iOS.
 */
const props = defineProps({
  // Hide the scrollbar, for rows where it would sit on top of the content.
  hideScrollbar: {
    type: Boolean,
    default: false,
  },
  // How to mark an edge there is more content towards. 'shadow' suits content
  // that is square anyway, like table rows. 'fade' dissolves the content
  // instead, for rounded cards that look sliced when they are simply clipped.
  edge: {
    type: String,
    default: 'shadow',
    validator: (value) => ['shadow', 'fade'].includes(value),
  },
});

const scroller = ref(null);
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

// Only fade the side there is actually more content towards, so content that
// fits, or is scrolled to one end, keeps a clean edge.
const maskStyle = computed(() => {
  if (props.edge !== 'fade') return null;
  if (!canScrollLeft.value && !canScrollRight.value) return null;

  const start = canScrollLeft.value ? 'transparent, black 1.5rem' : 'black 0';
  const end = canScrollRight.value ? 'black calc(100% - 1.5rem), transparent' : 'black 100%';
  const gradient = `linear-gradient(to right, ${start}, ${end})`;

  return { maskImage: gradient, WebkitMaskImage: gradient };
});

let resizeObserver = null;

function update() {
  const el = scroller.value;
  if (!el) return;

  canScrollLeft.value = el.scrollLeft > 1;
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
}

onMounted(() => {
  const el = scroller.value;
  el.addEventListener('scroll', update, { passive: true });

  // Watch the viewport for the window resizing and the content for rows or
  // cards arriving, either of which changes whether there is more to scroll to.
  resizeObserver = new ResizeObserver(update);
  resizeObserver.observe(el);
  if (el.firstElementChild) resizeObserver.observe(el.firstElementChild);

  update();
});

onBeforeUnmount(() => {
  scroller.value?.removeEventListener('scroll', update);
  resizeObserver?.disconnect();
});
</script>

<style scoped>
.scroll-shadows {
  position: relative;
  /* Clip the contents to whatever corners the consumer rounds. */
  overflow: hidden;
}

.scroll-viewport {
  overflow-x: auto;
  overflow-y: hidden;
}

.hide-scrollbar {
  scrollbar-width: none;
}

.hide-scrollbar::-webkit-scrollbar {
  display: none;
}

/* Positioned against the padding box, so a border on the consumer stays clear. */
.scroll-shadow {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 0.875rem;
  pointer-events: none;
}

.scroll-shadow-left {
  left: 0;
  background: radial-gradient(farthest-side at 0 50%, rgba(0, 0, 0, 0.2), transparent);
}

.scroll-shadow-right {
  right: 0;
  background: radial-gradient(farthest-side at 100% 50%, rgba(0, 0, 0, 0.2), transparent);
}
</style>
