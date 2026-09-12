/**
 * Bureau Stores
 *
 * One set of storage objects per data root, shared by the Bureau routers.
 * Production mounts the routers once; test suites mount them against their
 * own temporary directories.
 */

import { SqliteStorageService } from '../sqliteStorage.js';
import { BureauStorage } from './bureau-storage.js';
import { StoryStorage } from './story-storage.js';

const storesByRoot = new Map();

/**
 * @param {string} dataRoot
 * @returns {{ bureaus: BureauStorage, stories: StoryStorage, library: SqliteStorageService }}
 *   `library` is story mode's storage, used read-only for library characters and
 *   lorebooks (and to save new library characters).
 */
export function getBureauStores(dataRoot) {
  if (!storesByRoot.has(dataRoot)) {
    storesByRoot.set(dataRoot, {
      bureaus: new BureauStorage(dataRoot),
      stories: new StoryStorage(dataRoot),
      library: new SqliteStorageService(dataRoot),
    });
  }
  return storesByRoot.get(dataRoot);
}
