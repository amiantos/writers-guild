import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import EditChapterModal from '../EditChapterModal.vue';
import { bureauStoriesAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({
  bureauStoriesAPI: { update: vi.fn() },
}));

const story = { id: 's1', title: 'Chapter 1', scenario: 'A storm is coming.' };

function saveButton(wrapper) {
  return wrapper.findAll('button').find((button) => button.text().includes('Save'));
}

describe('EditChapterModal', () => {
  beforeEach(() => {
    bureauStoriesAPI.update.mockReset();
  });

  it("saves the chapter's title and scenario, trimmed", async () => {
    bureauStoriesAPI.update.mockImplementation(async (_bureauId, _storyId, updates) => ({
      story: { ...story, ...updates },
    }));
    const wrapper = mount(EditChapterModal, { props: { bureauId: 'b1', story } });

    expect(wrapper.find('#chapter-scenario').element.value).toBe('A storm is coming.');
    await wrapper.find('#chapter-title').setValue('  Lamplight ');
    await wrapper.find('#chapter-scenario').setValue('  The power is out.  ');
    await saveButton(wrapper).trigger('click');
    await flushPromises();

    expect(bureauStoriesAPI.update).toHaveBeenCalledWith('b1', 's1', {
      title: 'Lamplight',
      scenario: 'The power is out.',
    });
    expect(wrapper.emitted('updated')[0][0]).toMatchObject({
      title: 'Lamplight',
      scenario: 'The power is out.',
    });
  });

  it('clears the scenario, and needs a title', async () => {
    bureauStoriesAPI.update.mockResolvedValue({ story: { ...story, scenario: '' } });
    const wrapper = mount(EditChapterModal, { props: { bureauId: 'b1', story } });

    await wrapper.find('#chapter-title').setValue(' ');
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined();

    await wrapper.find('#chapter-title').setValue('Chapter 1');
    await wrapper.find('#chapter-scenario').setValue('');
    await saveButton(wrapper).trigger('click');
    await flushPromises();

    expect(bureauStoriesAPI.update.mock.calls[0][2]).toEqual({ title: 'Chapter 1', scenario: '' });
  });
});
