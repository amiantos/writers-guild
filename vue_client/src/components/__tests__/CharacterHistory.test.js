import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const { mockCharactersAPI, mockConfirm } = vi.hoisted(() => ({
  mockCharactersAPI: { listVersions: vi.fn(), restoreVersion: vi.fn() },
  mockConfirm: vi.fn(),
}));

vi.mock('../../services/api', () => ({ charactersAPI: mockCharactersAPI }));

vi.mock('../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: mockConfirm }),
}));

import CharacterHistory from '../CharacterHistory.vue';

function version(id, source, changed, data) {
  return {
    id,
    source,
    changed,
    created: '2026-09-26T00:00:00.000Z',
    imageChanged: false,
    data: { data },
  };
}

async function mountHistory(character = { name: 'Ada' }) {
  const wrapper = mount(CharacterHistory, {
    props: {
      characterId: 'c1',
      character,
      lorebooks: [{ id: 'lb1', name: 'The Workshop' }],
    },
  });
  await flushPromises();
  return wrapper;
}

describe('CharacterHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCharactersAPI.listVersions.mockResolvedValue({
      editedSinceImport: true,
      versions: [
        version(1, 'original', [], { name: 'Ada', description: 'An inventor.' }),
        version(2, 'edit', ['description', 'lorebook', 'portrait'], {
          name: 'Ada',
          description: 'A famous inventor.',
          extensions: { ursceal_lorebook_id: 'lb1' },
        }),
      ],
    });
  });

  it('lists versions newest first, with what each changed', async () => {
    const wrapper = await mountHistory();
    const items = wrapper.findAll('.version');
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain('Edited');
    expect(items[0].text()).toContain('Current');
    expect(items[0].text()).toContain('Changed description, lorebook, and the portrait');
    expect(items[0].text()).toContain('The Workshop');
    expect(items[1].text()).toContain('As imported');
    expect(wrapper.text()).toContain('changed since it was imported');
  });

  it('restores an earlier version once confirmed', async () => {
    mockConfirm.mockResolvedValue(true);
    mockCharactersAPI.restoreVersion.mockResolvedValue({});
    const wrapper = await mountHistory();

    const restoreButtons = wrapper.findAll('button');
    expect(restoreButtons).toHaveLength(1);
    await restoreButtons[0].trigger('click');
    await flushPromises();

    expect(mockCharactersAPI.restoreVersion).toHaveBeenCalledWith('c1', 1);
    expect(wrapper.emitted('restored')).toHaveLength(1);
  });

  it('reloads when the character changes', async () => {
    const character = { name: 'Ada' };
    const wrapper = await mountHistory(character);
    await wrapper.setProps({ character: { name: 'Ada L.' } });
    await flushPromises();
    expect(mockCharactersAPI.listVersions).toHaveBeenCalledTimes(2);
  });
});
