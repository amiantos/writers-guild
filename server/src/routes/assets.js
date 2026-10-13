/**
 * Assets API Routes
 *
 * Serves locally cached gallery assets for characters and lorebooks.
 *
 * GET /api/assets/characters/:entityId/:filename
 * GET /api/assets/lorebooks/:entityId/:filename
 *   — Serves the asset file with proper Content-Type and immutable caching, to the user whose
 *     character or lorebook it is.
 */

import express from 'express';
import path from 'path';
import { asyncHandler, AppError } from '../middleware/error-handler.js';
import { AssetManager } from '../services/asset-manager.js';
import { SqliteStorageService } from '../services/sqliteStorage.js';
import { mimeTypeFromExt } from '../../../shared/mime-types.js';

const router = express.Router();

// Opened again if the data directory changes, as it does between tests.
let storage;
let storageRoot;

router.use((req, res, next) => {
  const dataRoot = req.app.locals.dataRoot;
  if (!storage || storageRoot !== dataRoot) {
    storage?.close();
    storage = new SqliteStorageService(dataRoot);
    storageRoot = dataRoot;
  }
  next();
});

// Entity ids are uuids; anything else is a malformed or hostile path segment.
const ENTITY_ID_RE = /^[A-Za-z0-9_-]+$/;

// Cached filenames are always "{sha256}.{ext}" — see image-cacher.js.
const ASSET_FILENAME_RE = /^[a-f0-9]{64}\.[a-z0-9]+$/;

/**
 * Serve a cached asset file. Filenames are content-hashed so we use
 * immutable caching: files never change once created.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {string} entityType — 'characters' or 'lorebooks'
 */
const serveAsset = async (req, res, entityType) => {
  const { entityId, filename } = req.params;

  // Reject traversal attempts before they reach the filesystem. Both segments
  // are strictly formatted, so an allowlist is safer than blocking '..' and '/'.
  if (!ENTITY_ID_RE.test(entityId)) {
    throw new AppError('Invalid asset path', 400);
  }
  if (!ASSET_FILENAME_RE.test(filename)) {
    throw new AppError('Invalid asset filename', 400);
  }

  // Only serve allowed image extensions
  const ext = path.extname(filename).toLowerCase();
  const mimeType = mimeTypeFromExt(ext);
  if (!mimeType) {
    throw new AppError(`Unsupported file type ${ext}`, 400);
  }

  // Someone else's reads the same as one that doesn't exist.
  const owned =
    entityType === 'characters'
      ? storage.characterExists(entityId)
      : storage.lorebookExists(entityId);
  if (!owned) {
    throw new AppError('Asset not found', 404);
  }

  const assetManager = new AssetManager(req.app.locals.dataRoot, entityType);
  const buffer = await assetManager.readAsset(entityId, filename);

  if (!buffer) {
    throw new AppError('Asset not found', 404);
  }

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', buffer.length);
  // Private: it's only this user's to see, so shared caches mustn't keep it.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(buffer);
};

router.get(
  '/characters/:entityId/:filename',
  asyncHandler(async (req, res) => {
    await serveAsset(req, res, 'characters');
  }),
);

router.get(
  '/lorebooks/:entityId/:filename',
  asyncHandler(async (req, res) => {
    await serveAsset(req, res, 'lorebooks');
  }),
);

export default router;
