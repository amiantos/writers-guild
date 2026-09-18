import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import BureauSettingsSection from '../BureauSettingsSection.vue';
import { bureausAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({
  bureausAPI: { defaults: vi.fn(), update: vi.fn(), remove: vi.fn(), reset: vi.fn() },
}));

const { confirm } = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('../../../composables/useConfirm', () => ({ useConfirm: () => ({ confirm }) }));

function bureau(fields = {}) {
  return {
    id: 'b1',
    name: 'Harbor',
    description: 'Seaside',
    model: 'deepseek-flash',
    hasApiKey: true,
    apiKeySource: 'bureau',
    apiKeyPreview: 'sk-…1234',
    sharedApiKeyPreview: '',
    timezone: null,
    bureauTime: '2026-09-12T22:15:00.000Z',
    settings: {
      writer: { thinking: false, reasoningEffort: 'high', temperature: 0.5, maxTokens: 8000 },
      memory: {
        autoArchive: true,
        knowledgeCharacters: 4000,
        recentChapters: 5,
        offscreenLife: true,
      },
      correspondence: { style: '', thinking: false, reasoningEffort: 'low', maxTokens: 1000 },
    },
    ...fields,
  };
}

// A moment in the browser's time zone, in any year.
function localTime(year, month, day, hour, minute) {
  const date = new Date(2000, month - 1, day, hour, minute);
  date.setFullYear(year);
  return date.toISOString();
}

const findSaveButton = (wrapper) =>
  wrapper.findAll('button').find((button) => button.text().includes('Save settings'));

const removeButton = (wrapper) =>
  wrapper.findAll('button').find((button) => button.text() === 'Remove key');

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
      correspondenceStyle: 'Default style.',
      settings: {},
      model: 'deepseek-flash',
    });
    bureausAPI.update.mockReset();
    confirm.mockReset();
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

  it('follows the default again after saving an unedited copy of it', async () => {
    // The server saves a style that matches its default as empty.
    bureausAPI.update.mockImplementation(async () => ({ bureau: bureau() }));
    const wrapper = mount(BureauSettingsSection, { props: { bureau: bureau() } });
    await flushPromises();
    const field = wrapper.find('#bureau-settings-correspondence-style');

    expect(field.attributes('placeholder')).toBe('Default style.');
    await field.setValue('Default style.');
    await saveSettings(wrapper);

    expect(bureausAPI.update.mock.calls[0][1].settings.correspondence.style).toBe('Default style.');
    expect(field.element.value).toBe('');
    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Save settings'));
    expect(saveButton.attributes('disabled')).toBeDefined();
  });

  it('saves Writer and memory settings', async () => {
    bureausAPI.update.mockImplementation(async () => ({ bureau: bureau() }));
    const wrapper = mount(BureauSettingsSection, { props: { bureau: bureau() } });
    await flushPromises();

    await wrapper.find('#bureau-settings-temperature').setValue('0.7');
    await wrapper.find('#bureau-settings-offscreen-life').setValue(false);
    await wrapper.find('#bureau-settings-auto-archive').setValue(false);
    await wrapper.find('#bureau-settings-knowledge').setValue('6000');
    await wrapper.find('#bureau-settings-recent-chapters').setValue('8');
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Save settings'))
      .trigger('click');
    await flushPromises();

    expect(bureausAPI.update.mock.calls[0][1].settings).toEqual({
      writer: { thinking: false, reasoningEffort: 'high', temperature: 0.7, maxTokens: 8000 },
      memory: {
        autoArchive: false,
        knowledgeCharacters: 6000,
        recentChapters: 8,
        offscreenLife: false,
      },
      correspondence: { style: '', thinking: false, reasoningEffort: 'low', maxTokens: 1000 },
    });
  });

  it('resets the Bureau once confirmed', async () => {
    confirm.mockResolvedValue(true);
    bureausAPI.reset.mockResolvedValue({ bureau: bureau() });
    const wrapper = mount(BureauSettingsSection, { props: { bureau: bureau() } });
    await flushPromises();

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Reset Bureau'))
      .trigger('click');
    await flushPromises();

    expect(confirm.mock.calls[0][0].message).toContain(
      'Every chapter, message, memory, and arc note is deleted',
    );
    expect(bureausAPI.reset).toHaveBeenCalledWith('b1');
    expect(wrapper.emitted('reset')[0][0].id).toBe('b1');
  });

  describe('API key', () => {
    it('shows whether the Bureau uses its own key, the shared key, or none', async () => {
      const own = mount(BureauSettingsSection, { props: { bureau: bureau() } });
      const shared = mount(BureauSettingsSection, {
        props: {
          bureau: bureau({
            apiKeySource: 'shared',
            apiKeyPreview: 'sk-…9876',
            sharedApiKeyPreview: 'sk-…9876',
          }),
        },
      });
      const none = mount(BureauSettingsSection, {
        props: { bureau: bureau({ hasApiKey: false, apiKeySource: null, apiKeyPreview: '' }) },
      });
      await flushPromises();

      expect(own.text()).toContain("This Bureau's own key sk-…1234");
      expect(removeButton(own)).toBeDefined();
      expect(shared.text()).toContain('Uses the shared key sk-…9876');
      expect(removeButton(shared)).toBeUndefined();
      expect(none.text()).toContain('set a shared key for every Bureau on the Bureaus tab');
    });

    it('says whether removing the key leaves the shared key to use', async () => {
      confirm.mockResolvedValue(false);
      const wrapper = mount(BureauSettingsSection, {
        props: { bureau: bureau({ sharedApiKeyPreview: 'sk-…9876' }) },
      });
      await flushPromises();

      await removeButton(wrapper).trigger('click');
      await wrapper.setProps({ bureau: bureau() });
      await removeButton(wrapper).trigger('click');
      await flushPromises();

      expect(confirm.mock.calls.map(([options]) => options.message)).toEqual([
        "Remove this Bureau's own API key? It will use the shared key instead.",
        "Remove this Bureau's API key? Chapters can't be generated until you add another.",
      ]);
      expect(bureausAPI.update).not.toHaveBeenCalled();
    });
  });

  describe('Bureau time', () => {
    it('takes a typed year like 1350 and saves it', async () => {
      bureausAPI.update.mockImplementation(async (_id, updates) => ({
        bureau: bureau({ bureauTime: updates.bureauTime }),
      }));
      const wrapper = mount(BureauSettingsSection, {
        props: { bureau: bureau({ bureauTime: localTime(2026, 9, 12, 22, 15) }) },
      });
      await flushPromises();
      const field = wrapper.find('#bureau-settings-time');

      expect(field.element.value).toBe('2026-09-12T22:15');
      // Typing 1350 passes through 0001, 0013, and 0135, and the field keeps each.
      for (const typed of [
        '0001-09-12T22:15',
        '0013-09-12T22:15',
        '0135-09-12T22:15',
        '1350-09-12T22:15',
      ]) {
        await field.setValue(typed);
        expect(field.element.value).toBe(typed);
      }
      await saveSettings(wrapper);

      expect(bureausAPI.update.mock.calls[0][1].bureauTime).toBe(localTime(1350, 9, 12, 22, 15));
      expect(field.element.value).toBe('1350-09-12T22:15');
    });

    it("doesn't send Bureau time when it wasn't changed", async () => {
      bureausAPI.update.mockImplementation(async () => ({ bureau: bureau() }));
      const wrapper = mount(BureauSettingsSection, { props: { bureau: bureau() } });
      await flushPromises();

      await wrapper.find('#bureau-settings-name').setValue('Lighthouse');
      await saveSettings(wrapper);

      expect(bureausAPI.update.mock.calls[0][1]).not.toHaveProperty('bureauTime');
    });

    it('shows Bureau time moved elsewhere, unless the field was edited', async () => {
      const wrapper = mount(BureauSettingsSection, { props: { bureau: bureau() } });
      await flushPromises();
      const field = wrapper.find('#bureau-settings-time');

      await wrapper.setProps({ bureau: bureau({ bureauTime: localTime(2026, 9, 13, 8, 0) }) });
      expect(field.element.value).toBe('2026-09-13T08:00');
      expect(findSaveButton(wrapper).attributes('disabled')).toBeDefined();

      await field.setValue('1996-06-03T21:00');
      await wrapper.setProps({ bureau: bureau({ bureauTime: localTime(2026, 9, 20, 8, 0) }) });
      expect(field.element.value).toBe('1996-06-03T21:00');
    });

    it("won't save a date and time it can't read", async () => {
      const wrapper = mount(BureauSettingsSection, { props: { bureau: bureau() } });
      await flushPromises();

      await wrapper.find('#bureau-settings-time').setValue('');
      await saveSettings(wrapper);

      expect(bureausAPI.update).not.toHaveBeenCalled();
    });
  });
});
