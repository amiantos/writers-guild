import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import BureauCastSection from '../BureauCastSection.vue';
import { bureausAPI } from '../../../services/bureauApi';

vi.mock('../../../services/bureauApi', () => ({
  bureausAPI: {
    promoteCast: vi.fn(),
    exportCast: vi.fn(),
    updateCast: vi.fn(),
    removeCast: vi.fn(),
  },
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));

const CAST = [
  { id: 'c1', name: 'Ines', isDraft: true, isPersona: false, libraryCharacterId: null },
  { id: 'c2', name: 'Mara', isDraft: false, isPersona: false, libraryCharacterId: null },
];

function mountSection(props = {}) {
  return mount(BureauCastSection, { props: { bureauId: 'b1', cast: CAST, ...props } });
}

describe('BureauCastSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bureausAPI.promoteCast.mockResolvedValue({ castMember: { ...CAST[0], isDraft: false } });
  });

  it('marks drafts and saves them to the library instead of exporting', async () => {
    const wrapper = mountSection();
    const [draft, saved] = wrapper.findAll('.cast-row');

    expect(draft.text()).toContain('Draft');
    expect(draft.find('[title="Export to your library as a new character"]').exists()).toBe(false);
    expect(saved.text()).not.toContain('Draft');
    expect(saved.find('[title="Save to your library"]').exists()).toBe(false);

    await draft.find('[title="Save to your library"]').trigger('click');
    await flushPromises();

    expect(bureausAPI.promoteCast).toHaveBeenCalledWith('b1', 'c1');
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it("opens a cast member's profile, which holds their routine", async () => {
    const wrapper = mount(BureauCastSection, {
      props: { bureauId: 'b1', cast: CAST, hasApiKey: false },
      global: {
        stubs: {
          ProfileModal: {
            props: ['castId', 'hasApiKey'],
            template: '<div class="profile-stub">{{ castId }} {{ hasApiKey }}</div>',
          },
        },
      },
    });
    const [, saved] = wrapper.findAll('.cast-row');

    expect(saved.find('.fa-calendar-day').exists()).toBe(false);
    await saved
      .findAll('button')
      .find((button) => button.text().includes('Profile'))
      .trigger('click');

    expect(wrapper.find('.profile-stub').text()).toBe('c2 false');
  });

  it("can't generate a character without an API key", () => {
    const wrapper = mountSection({ hasApiKey: false });
    const generate = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Generate character'));

    expect(generate.attributes('disabled')).toBeDefined();
  });
});
