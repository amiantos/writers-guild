/**
 * Users API Routes
 *
 * The admin's view of who has an account: inviting someone, giving them a link to reset their
 * password, and deleting an account with everything in it. There's no signing up; an account is
 * only made from an invitation, and invitations need signing in to be on.
 */

import express from 'express';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { AssetManager } from '../services/asset-manager.js';
import { ADMIN_USER_ID } from '../services/user-context.js';
import { userStorageFor } from '../services/auth/user-storage.js';
import { linkPath } from './auth.js';

const router = express.Router();

let users;

router.use((req, res, next) => {
  users = userStorageFor(req.app.locals.dataRoot);
  next();
});

router.use(requireAdmin);

function withPath(link) {
  const { token: _token, ...rest } = link;
  return { ...rest, path: linkPath(link) };
}

function requireAuthEnabled() {
  if (!users.authEnabled()) {
    throw new AppError('Turn on signing in before inviting anyone', 409);
  }
}

router.get('/', (req, res) => {
  res.json({ users: users.listUsers() });
});

router.delete(
  '/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    if (userId === ADMIN_USER_ID) {
      throw new AppError("The admin's account can't be deleted", 400);
    }
    const deleted = users.deleteUser(userId);
    if (!deleted) throw new AppError('User not found', 404);

    // Their cached images aren't in the database, so they go separately.
    const dataRoot = req.app.locals.dataRoot;
    for (const [entityType, ids] of [
      ['characters', deleted.characterIds],
      ['lorebooks', deleted.lorebookIds],
    ]) {
      const assets = new AssetManager(dataRoot, entityType);
      for (const id of ids) {
        await assets.deleteDir(id).catch((error) => {
          console.error(`Failed to delete cached images for ${entityType} ${id}:`, error.message);
        });
      }
    }
    res.json({ success: true });
  }),
);

// A link for a user to choose a new password, replacing any they had.
router.post('/:userId/reset-link', (req, res) => {
  requireAuthEnabled();
  const user = users.getUser(req.params.userId);
  if (!user) throw new AppError('User not found', 404);
  if (!user.username) throw new AppError('This account has no username to sign in with', 400);
  const link = users.createLink('reset', user.id);
  res.json({ link: withPath(link) });
});

router.get('/invitations', (req, res) => {
  res.json({ invitations: users.listInvitations() });
});

router.post('/invitations', (req, res) => {
  requireAuthEnabled();
  const link = users.createLink('invite');
  res.status(201).json({ invitation: withPath(link) });
});

router.delete('/invitations/:linkId', (req, res) => {
  if (!users.deleteLink(req.params.linkId)) throw new AppError('Invitation not found', 404);
  res.json({ success: true });
});

export default router;
