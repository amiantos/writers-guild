/**
 * Default Sets
 *
 * A default set is a folder under `defaults/sets/` that bundles characters, a
 * lorebook, finished stories, and a continuity that belong together, so a fresh
 * install can show the features working as one. Onboarding imports every set
 * when the reader asks for sample content (see routes/onboarding.js); loose
 * character cards in `defaults/` are imported separately, one story each, by
 * migration.js.
 *
 * A set's manifest, `set.json`, names its files, each relative to the set's
 * folder:
 *
 *   {
 *     "name": "...",
 *     "characters": ["characters/a.json", ...],   Character Card V2 JSON; a PNG
 *                                                 beside it with the same base
 *                                                 name is the card's portrait
 *     "lorebook": "lorebook.json",                SillyTavern standalone format
 *     "continuity": "continuity.json",            { name, versions: [...] }
 *     "stories": ["stories/one.json", ...]        story metadata, in order
 *   }
 *
 * A story's metadata holds its title, description, scenario, perspective, the
 * cast as paths from the `characters` list, and `content`, the name of the text
 * file beside it. A continuity's versions are oldest first; the last is its
 * current text, and a version with `"source": "archivist"` names in `story` the
 * story it is recorded as having come from.
 *
 * `readDefaultSet` checks all of this and throws on anything missing or
 * inconsistent, so a broken bundled set fails the test suite rather than a
 * reader's first launch.
 */

import { v4 as uuidv4 } from 'uuid';
import { access, readdir, readFile } from 'fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { LorebookParser } from './lorebook-parser.js';
import { ContinuityStorage } from './continuity/continuity-storage.js';
import { isPerspectiveMode, isPerspectiveTense } from '../../../shared/perspective.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const DEFAULT_SETS_DIR = join(__dirname, '../../../defaults/sets');

const VERSION_SOURCES = new Set(['created', 'edit', 'archivist']);

function invalid(setDir, message) {
  return new Error(`Default set ${basename(setDir)}: ${message}`);
}

/** A path from the manifest, resolved inside the set's folder and nowhere else. */
function setPath(setDir, relativePath, what) {
  if (typeof relativePath !== 'string' || !relativePath) {
    throw invalid(setDir, `${what} must be a path`);
  }
  const full = resolve(setDir, relativePath);
  if (full !== setDir && !full.startsWith(setDir + sep)) {
    throw invalid(setDir, `${what} must be inside the set: ${relativePath}`);
  }
  return full;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readCharacter(setDir, relativePath) {
  const path = setPath(setDir, relativePath, 'character');
  const card = await readJson(path);
  if (card?.spec !== 'chara_card_v2' || !card.data?.name) {
    throw invalid(setDir, `${relativePath} is not a Character Card V2 with a name`);
  }
  const imagePath = join(dirname(path), `${basename(path, extname(path))}.png`);
  const image = (await exists(imagePath)) ? await readFile(imagePath) : null;
  return { path: relativePath, card, image };
}

async function readStory(setDir, relativePath, characterPaths) {
  const path = setPath(setDir, relativePath, 'story');
  const meta = await readJson(path);
  if (!meta.title) throw invalid(setDir, `${relativePath} has no title`);
  if (!Array.isArray(meta.characters) || meta.characters.length === 0) {
    throw invalid(setDir, `${relativePath} has no characters`);
  }
  for (const character of meta.characters) {
    if (!characterPaths.has(character)) {
      throw invalid(setDir, `${relativePath} names a character not in the set: ${character}`);
    }
  }
  if (meta.perspective !== undefined && !isPerspectiveMode(meta.perspective)) {
    throw invalid(setDir, `${relativePath} has an unknown perspective: ${meta.perspective}`);
  }
  if (meta.perspectiveTense !== undefined && !isPerspectiveTense(meta.perspectiveTense)) {
    throw invalid(setDir, `${relativePath} has an unknown tense: ${meta.perspectiveTense}`);
  }
  if (
    meta.perspectiveCharacter !== undefined &&
    !meta.characters.includes(meta.perspectiveCharacter)
  ) {
    throw invalid(setDir, `${relativePath} has a viewpoint character outside its cast`);
  }
  const contentPath = setPath(dirname(path), meta.content, `${relativePath} content`);
  const content = (await readFile(contentPath, 'utf8')).trim();
  if (!content) throw invalid(setDir, `${relativePath} has empty content`);
  return {
    path: relativePath,
    title: meta.title,
    description: meta.description ?? '',
    scenario: meta.scenario ?? '',
    perspective: meta.perspective ?? null,
    perspectiveTense: meta.perspectiveTense ?? null,
    perspectiveCharacter: meta.perspectiveCharacter ?? null,
    characters: meta.characters,
    content,
  };
}

async function readContinuity(setDir, relativePath, storyPaths) {
  const data = await readJson(setPath(setDir, relativePath, 'continuity'));
  if (!data.name) throw invalid(setDir, `${relativePath} has no name`);
  if (!Array.isArray(data.versions) || data.versions.length === 0) {
    throw invalid(setDir, `${relativePath} has no versions`);
  }
  const versions = data.versions.map((version, index) => {
    const source = version.source ?? (index === 0 ? 'created' : 'edit');
    if (!VERSION_SOURCES.has(source)) {
      throw invalid(setDir, `${relativePath} version ${index} has an unknown source: ${source}`);
    }
    if (index === 0 && source !== 'created') {
      throw invalid(setDir, `${relativePath}'s first version must have source "created"`);
    }
    if (typeof version.content !== 'string' || !version.content.trim()) {
      throw invalid(setDir, `${relativePath} version ${index} has no content`);
    }
    if (source === 'archivist' && !storyPaths.has(version.story)) {
      throw invalid(setDir, `${relativePath} version ${index} names a story not in the set`);
    }
    return { source, story: version.story ?? null, content: version.content.trim() };
  });
  return { name: data.name, versions };
}

/**
 * Read and check one set.
 * @param {string} setDir - The set's folder, holding `set.json`.
 * @returns {Promise<Object>} The set, with every file read and every reference checked.
 */
export async function readDefaultSet(setDir) {
  setDir = resolve(setDir);
  const manifest = await readJson(join(setDir, 'set.json'));
  if (!manifest.name) throw invalid(setDir, 'set.json has no name');
  for (const list of ['characters', 'stories']) {
    if (!Array.isArray(manifest[list]) || manifest[list].length === 0) {
      throw invalid(setDir, `set.json has no ${list}`);
    }
  }

  const characters = [];
  for (const path of manifest.characters) characters.push(await readCharacter(setDir, path));
  const characterPaths = new Set(characters.map((character) => character.path));

  const lorebook = manifest.lorebook
    ? LorebookParser.parseStandaloneLorebook(
        await readFile(setPath(setDir, manifest.lorebook, 'lorebook')),
      )
    : null;

  const stories = [];
  for (const path of manifest.stories) stories.push(await readStory(setDir, path, characterPaths));
  const storyPaths = new Set(stories.map((story) => story.path));

  const continuity = manifest.continuity
    ? await readContinuity(setDir, manifest.continuity, storyPaths)
    : null;

  return {
    dir: setDir,
    name: manifest.name,
    description: manifest.description ?? '',
    characters,
    lorebook,
    stories,
    continuity,
  };
}

/** Every set folder under `root` that holds a `set.json`, in name order. */
export async function listDefaultSetDirs(root = DEFAULT_SETS_DIR) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (await exists(join(dir, 'set.json'))) dirs.push(dir);
  }
  return dirs.sort();
}

/**
 * Import a set that `readDefaultSet` returned: its characters, its lorebook, its
 * stories (each with the cast and the lorebook attached, in the continuity), and
 * the continuity with its version history. A set's stories are finished ensemble
 * pieces about their own cast, so unlike the one-card stories migration.js makes,
 * they get no persona.
 * @param {import('./sqliteStorage.js').SqliteStorageService} storage
 * @param {Object} set
 * @returns {Promise<Object>} What was created: characters, lorebook, continuity, stories.
 */
export async function importDefaultSet(storage, set) {
  const continuities = new ContinuityStorage(storage.db);

  const characterIds = new Map();
  const characters = [];
  for (const { path, card, image } of set.characters) {
    const id = uuidv4();
    await storage.saveCharacter(id, structuredClone(card), image);
    characterIds.set(path, id);
    characters.push({ id, name: card.data.name });
  }

  let lorebook = null;
  if (set.lorebook) {
    const id = uuidv4();
    await storage.saveLorebook(id, set.lorebook);
    lorebook = { id, name: set.lorebook.name, entryCount: set.lorebook.entries.length };
  }

  let continuity = null;
  if (set.continuity) {
    const [first] = set.continuity.versions;
    continuity = continuities.create({ name: set.continuity.name, content: first.content });
  }

  const storyIds = new Map();
  const stories = [];
  for (const story of set.stories) {
    const created = await storage.createStory(story.title, story.description, {
      needsRewritePrompt: false,
    });
    await storage.updateStoryMetadata(created.id, {
      scenario: story.scenario,
      continuityId: continuity?.id ?? null,
      perspective: story.perspective,
      perspectiveTense: story.perspectiveTense,
      perspectiveCharacterId: story.perspectiveCharacter
        ? characterIds.get(story.perspectiveCharacter)
        : null,
    });
    for (const path of story.characters) {
      await storage.addCharacterToStory(created.id, characterIds.get(path));
    }
    if (lorebook) await storage.addLorebookToStory(created.id, lorebook.id);
    await storage.updateStoryContent(created.id, story.content);
    storyIds.set(story.path, created.id);
    stories.push({ id: created.id, title: story.title });
  }

  if (continuity) {
    for (const version of set.continuity.versions.slice(1)) {
      const sourceId = version.story ? `story:${storyIds.get(version.story)}` : null;
      continuities.update(
        continuity.id,
        { content: version.content },
        { source: version.source, sourceId },
      );
    }
    continuity = continuities.get(continuity.id);
  }

  return { name: set.name, characters, lorebook, continuity, stories };
}

/**
 * Import every set under `root`. A set that fails to read or import is logged
 * and skipped, so one bad set doesn't stop the others.
 * @param {import('./sqliteStorage.js').SqliteStorageService} storage
 * @param {Object} [options]
 * @param {string} [options.root] - Where the sets live; defaults to `defaults/sets`.
 * @returns {Promise<{characters: Array, lorebooks: Array, continuities: Array, stories: Array}>}
 */
export async function importDefaultSets(storage, { root = DEFAULT_SETS_DIR } = {}) {
  const result = { characters: [], lorebooks: [], continuities: [], stories: [] };
  for (const dir of await listDefaultSetDirs(root)) {
    try {
      const set = await readDefaultSet(dir);
      const imported = await importDefaultSet(storage, set);
      result.characters.push(...imported.characters);
      if (imported.lorebook) result.lorebooks.push(imported.lorebook);
      if (imported.continuity) result.continuities.push(imported.continuity);
      result.stories.push(...imported.stories);
      console.log(
        `✓ Imported default set ${set.name}: ${imported.characters.length} characters, ` +
          `${imported.stories.length} stories`,
      );
    } catch (error) {
      console.error(`Failed to import default set ${basename(dir)}:`, error.message);
    }
  }
  return result;
}
