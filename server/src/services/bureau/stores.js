/**
 * Bureau Stores
 *
 * One set of storage objects per data root, shared by the Bureau routers.
 * Production mounts the routers once; test suites mount them against their
 * own temporary directories.
 */

import { SqliteStorageService } from '../sqliteStorage.js';
import { ArcNoteStorage } from './arc-note-storage.js';
import { BureauStorage } from './bureau-storage.js';
import { FactStorage } from './fact-storage.js';
import { InterviewStorage } from './interview-storage.js';
import { MemoryStorage } from './memory-storage.js';
import { StoryStorage } from './story-storage.js';
import { ThreadStorage } from './thread-storage.js';

const storesByRoot = new Map();

/**
 * @param {string} dataRoot
 * @returns {{ bureaus: BureauStorage, stories: StoryStorage, threads: ThreadStorage,
 *   memories: MemoryStorage, arcNotes: ArcNoteStorage, facts: FactStorage,
 *   interviews: InterviewStorage, library: SqliteStorageService }}
 *   `library` is story mode's storage, used read-only for library characters and
 *   lorebooks (and to save new library characters).
 */
export function getBureauStores(dataRoot) {
  if (!storesByRoot.has(dataRoot)) {
    storesByRoot.set(dataRoot, {
      bureaus: new BureauStorage(dataRoot),
      stories: new StoryStorage(dataRoot),
      threads: new ThreadStorage(dataRoot),
      memories: new MemoryStorage(dataRoot),
      arcNotes: new ArcNoteStorage(dataRoot),
      facts: new FactStorage(dataRoot),
      interviews: new InterviewStorage(dataRoot),
      library: new SqliteStorageService(dataRoot),
    });
  }
  return storesByRoot.get(dataRoot);
}
