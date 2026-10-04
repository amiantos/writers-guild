import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SqliteStorageService } from '../sqliteStorage.js';
import { SCHEMA_VERSION } from '../database.js';

const HOUR = 60 * 60 * 1000;

describe('the prompts passages were written from', () => {
  let dataRoot;
  let storage;

  beforeEach(() => {
    dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'passage-prompts-test-'));
    storage = new SqliteStorageService(dataRoot);
  });

  afterEach(() => {
    vi.useRealTimers();
    storage.close();
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  it('keeps a prompt gzipped and gives it back whole', async () => {
    const { id: storyId } = await storage.createStory('Story');
    const user = 'The story so far. '.repeat(1000);
    const promptId = storage.savePassagePrompt(storyId, { system: 'Be a writer.', user });

    const prompt = storage.getPassagePrompt(storyId, promptId);
    expect(prompt).toMatchObject({ id: promptId, system: 'Be a writer.', user });

    const row = storage.db.prepare('SELECT user FROM passage_prompts WHERE id = ?').get(promptId);
    expect(row.user.length).toBeLessThan(user.length / 10);
  });

  it("doesn't give a story's prompt to another story", async () => {
    const { id: storyId } = await storage.createStory('Story');
    const { id: otherId } = await storage.createStory('Other');
    const promptId = storage.savePassagePrompt(storyId, { system: 's', user: 'u' });
    expect(storage.getPassagePrompt(otherId, promptId)).toBeNull();
  });

  it('drops prompts no passage names once their grace period is over', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-01T12:00:00Z'), toFake: ['Date'] });
    const { id: storyId } = await storage.createStory('Story');
    const named = storage.savePassagePrompt(storyId, { system: 's', user: 'kept' });
    const unnamed = storage.savePassagePrompt(storyId, { system: 's', user: 'cancelled' });
    const passages = [{ id: 'p1', text: 'Rain.', source: 'generated', promptId: named }];

    // A save mid-generation, before its passage is recorded, leaves the new prompt alone.
    await storage.updateStoryContent(storyId, 'Rain.', { passages });
    expect(storage.getPassagePrompt(storyId, unnamed)).not.toBeNull();

    vi.setSystemTime(Date.now() + 2 * HOUR);
    await storage.updateStoryContent(storyId, 'Rain.', { passages });
    expect(storage.getPassagePrompt(storyId, named)).not.toBeNull();
    expect(storage.getPassagePrompt(storyId, unnamed)).toBeNull();
  });

  it('copies prompts with a duplicated story and drops them with a deleted one', async () => {
    const { id: storyId } = await storage.createStory('Story');
    const promptId = storage.savePassagePrompt(storyId, { system: 's', user: 'u' });
    await storage.updateStoryContent(storyId, 'Rain.', {
      passages: [{ id: 'p1', text: 'Rain.', source: 'generated', promptId }],
    });

    const copy = await storage.duplicateStory(storyId);
    expect(storage.getPassagePrompt(copy.id, promptId)).toMatchObject({ user: 'u' });

    await storage.deleteStory(storyId);
    expect(storage.getPassagePrompt(storyId, promptId)).toBeNull();
    expect(storage.getPassagePrompt(copy.id, promptId)).not.toBeNull();
  });

  it('adds the table to a database from before it', async () => {
    storage.close();
    const db = new Database(path.join(dataRoot, 'writers-guild.db'));
    db.exec('DROP TABLE passage_prompts');
    db.prepare('UPDATE schema_version SET version = 17').run();
    db.close();

    storage = new SqliteStorageService(dataRoot);
    const { id: storyId } = await storage.createStory('Story');
    const promptId = storage.savePassagePrompt(storyId, { system: 's', user: 'u' });
    expect(storage.getPassagePrompt(storyId, promptId)).not.toBeNull();
    expect(storage.db.prepare('SELECT version FROM schema_version').get().version).toBe(
      SCHEMA_VERSION,
    );
  });
});
