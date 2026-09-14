import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import ProfileModal from '../ProfileModal.vue';
import { bureausAPI } from '../../../services/bureauApi';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

vi.mock('../../../services/bureauApi', () => ({
  bureausAPI: {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    restoreProfileVersion: vi.fn(),
    listArcNotes: vi.fn(),
  },
}));

vi.mock('../../../composables/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('../../../composables/useConfirm', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true) }),
}));

const MARA = { id: 'c1', name: 'Mara', libraryCharacterId: 'char-1' };
const PROFILE = {
  description: 'Keeps the light.',
  personality: 'Dry.',
  scenario: '',
  first_mes: '',
  mes_example: '',
  routine: '',
};

function version(id, source, changed, fields) {
  return { id, source, changed, fields, created: `2026-09-1${id}T10:00:00Z` };
}

function profileData(profile = PROFILE, versions = []) {
  return { castMember: MARA, profile, versions };
}

function mountModal(props = {}) {
  return mount(ProfileModal, { props: { bureauId: 'b1', castId: 'c1', ...props } });
}

function button(wrapper, label) {
  return wrapper.findAll('button').find((candidate) => candidate.text().includes(label));
}

describe('ProfileModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bureausAPI.getProfile.mockResolvedValue(profileData());
    bureausAPI.listArcNotes.mockResolvedValue({ arcNotes: [{ id: 1, content: 'Sleeps better.' }] });
  });

  it("shows the Bureau's copy of the card, the routine, and the changes accepted", async () => {
    const wrapper = mountModal();
    await flushPromises();

    expect(wrapper.find('h2').text()).toBe("Mara's profile");
    expect(bureausAPI.listArcNotes).toHaveBeenCalledWith('b1', 'c1', { status: 'accepted' });
    expect(wrapper.text()).toContain('Keeps the light.');
    expect(wrapper.text()).toContain('No routine yet.');
    expect(wrapper.text()).toContain('Sleeps better.');
  });

  it('edits the routine and keeps the change as a version', async () => {
    const withRoutine = { ...PROFILE, routine: 'Nights at the light.' };
    bureausAPI.updateProfile.mockResolvedValue(
      profileData(withRoutine, [
        version(1, 'original', [], PROFILE),
        version(2, 'manual', ['routine'], withRoutine),
      ]),
    );
    const wrapper = mountModal();
    await flushPromises();

    const routine = wrapper
      .findAll('.profile-field')
      .find((field) => field.find('h3').text() === 'Routine');
    await routine.find('button').trigger('click');
    await wrapper.find('textarea').setValue('Nights at the light.');
    await button(wrapper, 'Save').trigger('click');
    await flushPromises();

    expect(bureausAPI.updateProfile).toHaveBeenCalledWith('b1', 'c1', {
      routine: 'Nights at the light.',
    });
    expect(wrapper.find('textarea').exists()).toBe(false);
    expect(wrapper.text()).toContain('Nights at the light.');
    expect(wrapper.emitted('changed')).toHaveLength(1);
    expect(button(wrapper, 'History').text()).toContain('2');
  });

  it('restores an earlier version from History', async () => {
    const interviewed = {
      ...PROFILE,
      description: 'Keeps her father’s light.',
      routine: 'Nights.',
    };
    bureausAPI.getProfile.mockResolvedValue(
      profileData(interviewed, [
        version(1, 'original', [], PROFILE),
        version(2, 'interview', ['description', 'personality', 'routine'], interviewed),
      ]),
    );
    bureausAPI.restoreProfileVersion.mockResolvedValue(profileData());
    const wrapper = mountModal();
    await flushPromises();

    await button(wrapper, 'History').trigger('click');
    const [latest, original] = wrapper.findAll('.version');
    expect(latest.text()).toContain('From an interview');
    expect(latest.text()).toContain('Changed description, personality, and routine');
    expect(latest.text()).toContain('Current');
    expect(button(latest, 'Restore')).toBeUndefined();

    await button(original, 'Restore').trigger('click');
    await flushPromises();

    expect(bureausAPI.restoreProfileVersion).toHaveBeenCalledWith('b1', 'c1', 1);
    expect(wrapper.emitted('changed')).toHaveLength(1);
  });

  it('opens an interview, which needs an API key', async () => {
    const wrapper = mountModal();
    await flushPromises();

    await button(wrapper, 'Interview').trigger('click');
    expect(push).toHaveBeenCalledWith({
      name: 'bureau-interview',
      params: { bureauId: 'b1', castId: 'c1' },
    });

    const withoutKey = mountModal({ hasApiKey: false });
    await flushPromises();
    expect(button(withoutKey, 'Interview').attributes('disabled')).toBeDefined();
  });
});
