/**
 * Offer to clean up a lorebook that deleting a character just left behind.
 *
 * The delete endpoint reports an orphan rather than removing it, so the choice
 * stays with the user — same as the stories a character is in, which are only
 * deleted with it once the user has agreed.
 */
import { lorebooksAPI } from '../services/api';
import { useConfirm } from './useConfirm';
import { useToast } from './useToast';
import { useDataCache } from './useDataCache';

export function useOrphanedLorebook() {
  const { confirm } = useConfirm();
  const toast = useToast();
  const { removeLorebookLocally } = useDataCache();

  /**
   * @param {{id: string, name: string}} [orphanedLorebook] - `orphanedLorebook`
   *   from a DELETE /api/characters/:id response. Absent when nothing was stranded.
   */
  async function offerToDeleteOrphanedLorebook(orphanedLorebook) {
    if (!orphanedLorebook?.id) return;

    const confirmed = await confirm({
      message:
        `"${orphanedLorebook.name}" is no longer used by any character or story.\n\n` +
        'Delete it too?',
      confirmText: 'Delete Lorebook',
      cancelText: 'Keep It',
      variant: 'warning',
    });

    if (!confirmed) return;

    try {
      await lorebooksAPI.delete(orphanedLorebook.id);
      removeLorebookLocally(orphanedLorebook.id);
      toast.success('Lorebook deleted');
    } catch (error) {
      console.error('Failed to delete orphaned lorebook:', error);
      toast.error('Failed to delete lorebook: ' + error.message);
    }
  }

  return { offerToDeleteOrphanedLorebook };
}
