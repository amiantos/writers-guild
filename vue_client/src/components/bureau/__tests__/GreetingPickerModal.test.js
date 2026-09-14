import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import GreetingPickerModal from '../GreetingPickerModal.vue';
import { bureauStoriesAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({
  bureauStoriesAPI: { listGreetings: vi.fn(), addGreeting: vi.fn() },
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ error: vi.fn() }),
}));

// happy-dom's DOM trips up DOMPurify; renderProse's own tests cover sanitizing.
vi.mock('dompurify', () => ({ default: { sanitize: (html) => html } }));

const ModalStub = {
  props: ['title', 'maxWidth'],
  template: '<div><h2>{{ title }}</h2><slot /><slot name="footer" /></div>',
};

const GREETINGS = [
  { castId: 'c2', name: 'June', index: 0, label: 'First message', content: 'June looks up.' },
  {
    castId: 'c2',
    name: 'June',
    index: 2,
    label: 'Alternate greeting 2',
    content: '![June](/api/assets/characters/l2/june.webp)\n\nJune waves.',
  },
];

function buttonNamed(wrapper, name) {
  return wrapper.findAll('button').find((button) => button.text().includes(name));
}

async function mountPicker(props = {}) {
  const wrapper = mount(GreetingPickerModal, {
    props: { bureauId: 'b1', storyId: 's1', ...props },
    global: { stubs: { Modal: ModalStub } },
  });
  await flushPromises();
  return wrapper;
}

describe('GreetingPickerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bureauStoriesAPI.listGreetings.mockResolvedValue({ greetings: GREETINGS });
  });

  it('pages through greetings, then asks whether the Writer should rewrite the one picked', async () => {
    const wrapper = await mountPicker();

    expect(bureauStoriesAPI.listGreetings).toHaveBeenCalledWith('b1', 's1');
    expect(wrapper.find('.greeting-name').text()).toBe('June');
    expect(wrapper.find('.greeting-heading .persona-tag').text()).toBe('First message');
    expect(wrapper.find('.greeting-text').text()).toBe('June looks up.');
    expect(buttonNamed(wrapper, 'Previous').attributes('disabled')).toBeDefined();

    await buttonNamed(wrapper, 'Next').trigger('click');
    expect(wrapper.find('.greeting-count').text()).toBe('2 / 2');
    expect(wrapper.find('.greeting-text img').attributes('src')).toBe(
      '/api/assets/characters/l2/june.webp',
    );

    await buttonNamed(wrapper, 'Use this greeting').trigger('click');
    expect(wrapper.find('h2').text()).toBe('Rewrite the greeting?');
    expect(wrapper.find('.prompt-message').text()).toBe(
      "Rewrite June's greeting for this chapter?",
    );

    await buttonNamed(wrapper, 'Rewrite').trigger('click');

    expect(wrapper.emitted('rewrite')).toEqual([[{ castId: 'c2', content: GREETINGS[1].content }]]);
    expect(bureauStoriesAPI.addGreeting).not.toHaveBeenCalled();
  });

  it('keeps a greeting as written', async () => {
    bureauStoriesAPI.addGreeting.mockResolvedValue({ turn: { id: 't1' } });
    const wrapper = await mountPicker();

    await buttonNamed(wrapper, 'Use this greeting').trigger('click');
    await buttonNamed(wrapper, 'Keep as written').trigger('click');
    await flushPromises();

    expect(bureauStoriesAPI.addGreeting).toHaveBeenCalledWith('b1', 's1', 'June looks up.');
    expect(wrapper.emitted('added')).toEqual([[{ id: 't1' }]]);
    expect(wrapper.emitted('rewrite')).toBeUndefined();
  });

  it("can't rewrite without an API key, and goes back to the greetings", async () => {
    const wrapper = await mountPicker({ hasApiKey: false });

    await buttonNamed(wrapper, 'Use this greeting').trigger('click');

    expect(wrapper.find('.notice').text()).toContain('needs an API key');
    expect(buttonNamed(wrapper, 'Rewrite').attributes('disabled')).toBeDefined();
    await buttonNamed(wrapper, 'Back').trigger('click');
    expect(wrapper.find('.greeting-text').text()).toBe('June looks up.');
  });

  it('says when no one in the chapter has a greeting', async () => {
    bureauStoriesAPI.listGreetings.mockResolvedValue({ greetings: [] });
    const wrapper = await mountPicker();

    expect(wrapper.text()).toContain('No one in this chapter has a greeting on their card.');
    expect(buttonNamed(wrapper, 'Use this greeting').attributes('disabled')).toBeDefined();
  });
});
