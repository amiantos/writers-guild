import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import DOMPurify from 'dompurify';
import GreetingSelectorModal from '../GreetingSelectorModal.vue';
import { proseToHtml } from '../../composables/renderProse';

function greetingsResponse(greetings) {
  return { json: () => Promise.resolve({ greetings }) };
}

async function mountModal(greetings) {
  globalThis.fetch.mockResolvedValue(greetingsResponse(greetings));
  const wrapper = mount(GreetingSelectorModal, {
    props: { story: { id: 's1', characterIds: ['c1'] } },
  });
  await flushPromises();
  return wrapper;
}

describe('GreetingSelectorModal', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders markdown and HTML images in a greeting', async () => {
    const wrapper = await mountModal([
      {
        characterName: 'Layla',
        index: 0,
        content:
          'Hello.\n\n![a door](https://example.com/door.png)\n\n<img src="https://example.com/hall.png">',
      },
    ]);

    const images = wrapper.findAll('.greeting-display img');
    expect(images.map((img) => img.attributes('src'))).toEqual([
      'https://example.com/door.png',
      'https://example.com/hall.png',
    ]);
    expect(images.every((img) => img.classes('story-image'))).toBe(true);
    expect(wrapper.find('.greeting-display').text()).toContain('Hello.');
  });

  it('sanitizes greeting HTML before rendering it', async () => {
    const sanitize = vi.spyOn(DOMPurify, 'sanitize').mockReturnValue('<p>clean</p>');
    const content = '<img src="x.png" onerror="alert(1)">';
    const wrapper = await mountModal([{ characterName: 'Layla', index: 0, content }]);

    expect(sanitize).toHaveBeenCalledWith(proseToHtml(content));
    expect(wrapper.find('.greeting-display').html()).toContain('<p>clean</p>');
  });

  it('selects the raw greeting text, not the rendered HTML', async () => {
    const content = 'Hi.\n\n![a door](https://example.com/door.png)';
    const wrapper = await mountModal([{ characterName: 'Layla', index: 0, content }]);

    await wrapper.find('.btn-primary.full-width').trigger('click');
    expect(wrapper.emitted('select')).toEqual([[content]]);
  });
});
