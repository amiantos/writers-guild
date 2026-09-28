import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ScrollShadows from '../ScrollShadows.vue';

// happy-dom does no layout, so each test sets the scroll dimensions itself and
// fires the observer or scroll event the component listens for.
let observers;

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    observers.push(this);
  }
  observe(target) {
    this.targets.push(target);
  }
  disconnect() {
    this.targets = [];
  }
}

function setScroll(el, { scrollLeft = 0, clientWidth = 100, scrollWidth = 100 }) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  el.scrollLeft = scrollLeft;
}

async function resize() {
  observers.forEach((observer) => observer.callback([]));
  await nextTick();
}

function mountShadows(props = {}) {
  return mount(ScrollShadows, {
    props,
    slots: { default: '<div class="row">content</div>' },
  });
}

describe('ScrollShadows', () => {
  beforeEach(() => {
    observers = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('observes the viewport and its content', () => {
    const wrapper = mountShadows();
    const viewport = wrapper.find('.scroll-viewport').element;

    expect(observers[0].targets).toEqual([viewport, viewport.firstElementChild]);
  });

  it('shows no shadows when the content fits', async () => {
    const wrapper = mountShadows();
    setScroll(wrapper.find('.scroll-viewport').element, { scrollWidth: 100 });
    await resize();

    expect(wrapper.find('.scroll-shadow-left').exists()).toBe(false);
    expect(wrapper.find('.scroll-shadow-right').exists()).toBe(false);
  });

  it('shadows each edge there is more content towards as it scrolls', async () => {
    const wrapper = mountShadows();
    const viewport = wrapper.find('.scroll-viewport');

    setScroll(viewport.element, { scrollLeft: 0, scrollWidth: 300 });
    await resize();
    expect(wrapper.find('.scroll-shadow-left').exists()).toBe(false);
    expect(wrapper.find('.scroll-shadow-right').exists()).toBe(true);

    viewport.element.scrollLeft = 100;
    await viewport.trigger('scroll');
    expect(wrapper.find('.scroll-shadow-left').exists()).toBe(true);
    expect(wrapper.find('.scroll-shadow-right').exists()).toBe(true);

    viewport.element.scrollLeft = 200;
    await viewport.trigger('scroll');
    expect(wrapper.find('.scroll-shadow-left').exists()).toBe(true);
    expect(wrapper.find('.scroll-shadow-right').exists()).toBe(false);
  });

  it('clears the shadows when a resize makes the content fit', async () => {
    const wrapper = mountShadows();
    const viewport = wrapper.find('.scroll-viewport').element;

    setScroll(viewport, { scrollWidth: 300 });
    await resize();
    expect(wrapper.find('.scroll-shadow-right').exists()).toBe(true);

    setScroll(viewport, { scrollWidth: 100 });
    await resize();
    expect(wrapper.find('.scroll-shadow-right').exists()).toBe(false);
  });

  describe('fade edge', () => {
    it('masks only the edges there is more content towards', async () => {
      const wrapper = mountShadows({ edge: 'fade' });
      const viewport = wrapper.find('.scroll-viewport');

      setScroll(viewport.element, { scrollWidth: 100 });
      await resize();
      expect(viewport.attributes('style')).toBeUndefined();

      setScroll(viewport.element, { scrollLeft: 0, scrollWidth: 300 });
      await resize();
      expect(viewport.element.style.maskImage).toContain('black 0');
      expect(viewport.element.style.maskImage).toContain('transparent)');

      viewport.element.scrollLeft = 200;
      await viewport.trigger('scroll');
      expect(viewport.element.style.maskImage).toContain('transparent, black 1.5rem');
      expect(viewport.element.style.maskImage).toContain('black 100%');
    });

    it('draws no shadow elements', async () => {
      const wrapper = mountShadows({ edge: 'fade' });
      setScroll(wrapper.find('.scroll-viewport').element, { scrollWidth: 300 });
      await resize();

      expect(wrapper.find('.scroll-shadow').exists()).toBe(false);
    });
  });

  it('disconnects the observer on unmount', () => {
    const wrapper = mountShadows();
    wrapper.unmount();

    expect(observers[0].targets).toEqual([]);
  });
});
