import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import BureauSettingsSection from '../BureauSettingsSection.vue';
import { bureausAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({
  bureausAPI: { defaults: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

function bureau(fields = {}) {
  return {
    id: 'b1',
    name: 'Harbor',
    description: 'Seaside',
    model: 'deepseek-flash',
    houseStyle: '',
    hasApiKey: true,
    apiKeyPreview: 'sk-…1234',
    timezone: null,
    presentOffsetDays: 0,
    settings: {
      writer: { thinking: false, reasoningEffort: 'high', temperature: 1, maxTokens: 4000 },
      director: {
        enabled: true,
        thinking: true,
        reasoningEffort: 'low',
        skipOnContinue: true,
        createCharacters: true,
      },
      editor: { enabled: true },
      style: { bannedPhrases: ['a testament to'] },
      correspondence: { style: '', thinking: false, reasoningEffort: 'low', maxTokens: 1000 },
    },
    ...fields,
  };
}

async function saveSettings(wrapper) {
  await wrapper
    .findAll('button')
    .find((button) => button.text().includes('Save settings'))
    .trigger('click');
  await flushPromises();
}

describe('BureauSettingsSection', () => {
  beforeEach(() => {
    bureausAPI.defaults.mockResolvedValue({
      houseStyle: 'Default style.',
      settings: {},
      model: 'deepseek-flash',
    });
    bureausAPI.update.mockReset();
  });

  it('keeps unsaved edits when the Bureau changes elsewhere', async () => {
    const wrapper = mount(BureauSettingsSection, { props: { bureau: bureau() } });
    await flushPromises();

    await wrapper.find('#bureau-settings-name').setValue('Lighthouse');
    await wrapper.setProps({
      bureau: bureau({ description: 'Changed elsewhere', timezone: 'America/Chicago' }),
    });

    expect(wrapper.find('#bureau-settings-name').element.value).toBe('Lighthouse');
    expect(wrapper.find('#bureau-settings-description').element.value).toBe('Changed elsewhere');
  });

  it('saves edits, then clears the key field', async () => {
    bureausAPI.update.mockImplementation(async (_id, updates) => ({
      bureau: bureau({ name: updates.name }),
    }));
    const wrapper = mount(BureauSettingsSection, { props: { bureau: bureau() } });
    await flushPromises();

    await wrapper.find('#bureau-settings-name').setValue('Lighthouse');
    await wrapper.find('#bureau-settings-api-key').setValue('sk-new-key-5678');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Save settings'))
      .trigger('click');
    await flushPromises();

    expect(bureausAPI.update).toHaveBeenCalledWith(
      'b1',
      expect.objectContaining({ name: 'Lighthouse', apiKey: 'sk-new-key-5678' }),
    );
    expect(wrapper.emitted('updated')[0][0].name).toBe('Lighthouse');
    expect(wrapper.find('#bureau-settings-api-key').element.value).toBe('');
  });

  it('saves Director, Editor, and banned phrase settings', async () => {
    bureausAPI.update.mockImplementation(async () => ({ bureau: bureau() }));
    const wrapper = mount(BureauSettingsSection, { props: { bureau: bureau() } });
    await flushPromises();

    await wrapper.find('#bureau-settings-director-skip').setValue(false);
    await wrapper.find('#bureau-settings-director-create').setValue(false);
    await wrapper.find('#bureau-settings-editor-enabled').setValue(false);
    await wrapper
      .find('#bureau-settings-banned-phrases')
      .setValue('a testament to\n\n  sent shivers down  \n');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Save settings'))
      .trigger('click');
    await flushPromises();

    expect(bureausAPI.update.mock.calls[0][1].settings).toEqual({
      writer: { thinking: false, reasoningEffort: 'high', temperature: 1, maxTokens: 4000 },
      director: {
        enabled: true,
        thinking: true,
        reasoningEffort: 'low',
        skipOnContinue: false,
        createCharacters: false,
      },
      editor: { enabled: false },
      style: { bannedPhrases: ['a testament to', 'sent shivers down'] },
      correspondence: { style: '', thinking: false, reasoningEffort: 'low', maxTokens: 1000 },
    });
  });

  describe("the Bureau's present", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('sets the present from the date field', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 8, 12, 12, 0));
      bureausAPI.update.mockImplementation(async () => ({ bureau: bureau() }));
      const wrapper = mount(BureauSettingsSection, { props: { bureau: bureau() } });
      await flushPromises();

      expect(wrapper.find('#bureau-settings-present').element.value).toBe('2026-09-12');
      await wrapper.find('#bureau-settings-present').setValue('1996-07-31');
      await saveSettings(wrapper);

      expect(bureausAPI.update.mock.calls[0][1].presentOffsetDays).toBe(-11000);
    });

    it("keeps the present's offset when saving after midnight", async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 8, 12, 23, 59));
      bureausAPI.update.mockImplementation(async () => ({ bureau: bureau() }));
      const wrapper = mount(BureauSettingsSection, {
        props: { bureau: bureau({ presentOffsetDays: -11000 }) },
      });
      await flushPromises();

      vi.setSystemTime(new Date(2026, 8, 13, 0, 30));
      await wrapper.find('#bureau-settings-correspondence-thinking').setValue(true);
      await saveSettings(wrapper);

      expect(bureausAPI.update.mock.calls[0][1].presentOffsetDays).toBe(-11000);
    });
  });
});
