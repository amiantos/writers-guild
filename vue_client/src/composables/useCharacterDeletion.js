/**
 * Delete a library character after confirming with the user.
 *
 * Stories the character is in go with it, so the prompt names each one and
 * which other characters it involves: those characters stay in the library
 * but lose the story.
 */
import { charactersAPI } from '../services/api';
import { useConfirm } from './useConfirm';
import { useToast } from './useToast';
import { useDataCache } from './useDataCache';
import { useOrphanedLorebook } from './useOrphanedLorebook';

export function buildDeleteMessage(name, stories) {
  if (stories.length === 0) {
    return `Delete character "${name}"?\n\nThis cannot be undone.`;
  }

  const lines = stories.map((story) => {
    const others = story.otherCharacters?.map((c) => c.name) || [];
    return others.length > 0 ? `• ${story.title} (also ${others.join(', ')})` : `• ${story.title}`;
  });
  const shared = stories.filter((s) => s.otherCharacters?.length > 0).length;
  const count = stories.length === 1 ? 'this story' : `these ${stories.length} stories`;

  let msg = `Delete character "${name}"?\n\nThis also deletes ${count}:\n${lines.join('\n')}`;
  if (shared > 0) {
    msg +=
      '\n\nThe other characters named above stay in your library, but their ' +
      `${shared === 1 ? 'story is' : 'stories are'} deleted too.`;
  }
  return msg + '\n\nThis cannot be undone.';
}

export function useCharacterDeletion() {
  const { confirm } = useConfirm();
  const toast = useToast();
  const { removeCharacterLocally, removeStoryLocally } = useDataCache();
  const { offerToDeleteOrphanedLorebook } = useOrphanedLorebook();

  /**
   * @param {{id: string, name: string}} character
   * @returns {Promise<boolean>} true if the character was deleted
   */
  async function deleteCharacter(character) {
    try {
      const { stories } = await charactersAPI.getStories(character.id);

      const confirmed = await confirm({
        message: buildDeleteMessage(character.name, stories),
        confirmText:
          stories.length === 0
            ? 'Delete Character'
            : `Delete Character & ${stories.length === 1 ? 'Story' : `${stories.length} Stories`}`,
        variant: 'danger',
      });
      if (!confirmed) return false;

      // Only the stories the user was shown are confirmed, so one added in the
      // meantime makes the server refuse rather than deleting it unannounced.
      const { orphanedLorebook, deletedStoryIds = [] } = await charactersAPI.delete(
        character.id,
        stories.map((s) => s.id),
      );
      removeCharacterLocally(character.id);
      for (const storyId of deletedStoryIds) removeStoryLocally(storyId);
      toast.success(
        deletedStoryIds.length > 0
          ? `Character and ${deletedStoryIds.length} ${deletedStoryIds.length === 1 ? 'story' : 'stories'} deleted`
          : 'Character deleted successfully',
      );
      await offerToDeleteOrphanedLorebook(orphanedLorebook);
      return true;
    } catch (error) {
      console.error('Error deleting character:', error);
      toast.error('Failed to delete character: ' + error.message);
      return false;
    }
  }

  return { deleteCharacter };
}
