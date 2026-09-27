import { describe, it, expect, beforeEach, vi } from 'vitest';

const getStories = vi.fn();
const deleteCharacterApi = vi.fn();
const confirm = vi.fn();
const removeCharacterLocally = vi.fn();
const removeStoryLocally = vi.fn();
const offerToDeleteOrphanedLorebook = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock('../../services/api', () => ({
  charactersAPI: {
    getStories: (...args) => getStories(...args),
    delete: (...args) => deleteCharacterApi(...args),
  },
}));
vi.mock('../useConfirm', () => ({ useConfirm: () => ({ confirm }) }));
vi.mock('../useToast', () => ({ useToast: () => toast }));
vi.mock('../useDataCache', () => ({
  useDataCache: () => ({ removeCharacterLocally, removeStoryLocally }),
}));
vi.mock('../useOrphanedLorebook', () => ({
  useOrphanedLorebook: () => ({ offerToDeleteOrphanedLorebook }),
}));

const { useCharacterDeletion, buildDeleteMessage } = await import('../useCharacterDeletion.js');

describe('buildDeleteMessage', () => {
  it('keeps the plain prompt when the character is in no stories', () => {
    const msg = buildDeleteMessage('Alice', []);
    expect(msg).toContain('Delete character "Alice"?');
    expect(msg).not.toContain('also deletes');
  });

  it('lists each story and flags the ones with other characters', () => {
    const msg = buildDeleteMessage('Alice', [
      { id: 's1', title: 'Solo', otherCharacters: [] },
      { id: 's2', title: 'Duet', otherCharacters: [{ id: 'c2', name: 'Bob' }] },
    ]);
    expect(msg).toContain('these 2 stories');
    expect(msg).toContain('• Solo\n');
    expect(msg).toContain('• Duet (also Bob)');
    expect(msg).toContain('stay in your library');
  });

  it('skips the other-characters note when every story is solo', () => {
    const msg = buildDeleteMessage('Alice', [{ id: 's1', title: 'Solo', otherCharacters: [] }]);
    expect(msg).toContain('this story');
    expect(msg).not.toContain('stay in your library');
  });
});

describe('useCharacterDeletion', () => {
  const alice = { id: 'c1', name: 'Alice' };
  let deleteCharacter;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ deleteCharacter } = useCharacterDeletion());
  });

  it('does nothing when the user cancels', async () => {
    getStories.mockResolvedValue({ stories: [] });
    confirm.mockResolvedValue(false);

    expect(await deleteCharacter(alice)).toBe(false);
    expect(deleteCharacterApi).not.toHaveBeenCalled();
  });

  it('does not ask for stories to be deleted when none were shown', async () => {
    getStories.mockResolvedValue({ stories: [] });
    confirm.mockResolvedValue(true);
    deleteCharacterApi.mockResolvedValue({ success: true, deletedStoryIds: [] });

    expect(await deleteCharacter(alice)).toBe(true);
    expect(deleteCharacterApi).toHaveBeenCalledWith('c1', { deleteStories: false });
    expect(removeCharacterLocally).toHaveBeenCalledWith('c1');
  });

  it('deletes the character with its stories once confirmed', async () => {
    getStories.mockResolvedValue({
      stories: [{ id: 's1', title: 'Solo', otherCharacters: [] }],
    });
    confirm.mockResolvedValue(true);
    const orphanedLorebook = { id: 'lb-1', name: 'Lore' };
    deleteCharacterApi.mockResolvedValue({
      success: true,
      deletedStoryIds: ['s1'],
      orphanedLorebook,
    });

    expect(await deleteCharacter(alice)).toBe(true);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmText: 'Delete Character & Story' }),
    );
    expect(deleteCharacterApi).toHaveBeenCalledWith('c1', { deleteStories: true });
    expect(removeStoryLocally).toHaveBeenCalledWith('s1');
    expect(offerToDeleteOrphanedLorebook).toHaveBeenCalledWith(orphanedLorebook);
  });

  it('reports a failed delete', async () => {
    getStories.mockResolvedValue({ stories: [] });
    confirm.mockResolvedValue(true);
    deleteCharacterApi.mockRejectedValue(new Error('boom'));

    expect(await deleteCharacter(alice)).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('Failed to delete character: boom');
    expect(removeCharacterLocally).not.toHaveBeenCalled();
  });
});
