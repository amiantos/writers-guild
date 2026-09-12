import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { StoryStorage } from '../story-storage.js';
import { BureauStorage } from '../bureau-storage.js';
import { closeBureauDb } from '../bureau-db.js';

const START = '2026-10-27T07:30:00.000Z';

function card(name) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name } };
}

describe('StoryStorage', () => {
  let tempDir;
  let bureaus;
  let stories;
  let bureau;
  let mara;
  let theo;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-storage-'));
    bureaus = new BureauStorage(tempDir);
    stories = new StoryStorage(tempDir);
    bureau = bureaus.createBureau({ name: 'Harbor' });
    mara = bureaus.addCastMember(bureau.id, { seedCard: card('Mara'), libraryCharacterId: 'c1' });
    theo = bureaus.addCastMember(bureau.id, {
      seedCard: card('Theo'),
      libraryCharacterId: 'c2',
      isPersona: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('stories', () => {
    it('creates stories in order with default titles', () => {
      const first = stories.createStory(bureau.id, {
        startTime: START,
        castIds: [mara.id, theo.id],
      });
      const second = stories.createStory(bureau.id, {
        startTime: START,
        castIds: [mara.id],
        title: 'The Night Market',
      });

      expect(first).toMatchObject({
        position: 0,
        title: 'Story 1',
        status: 'active',
        startTime: START,
        endTime: null,
        castIds: [mara.id, theo.id],
        turnCount: 0,
      });
      expect(stories.listStories(bureau.id).map((story) => story.title)).toEqual([
        'Story 1',
        'The Night Market',
      ]);
      expect(second.position).toBe(1);
    });

    it('updates the title and who is present', () => {
      const story = stories.createStory(bureau.id, { startTime: START, castIds: [mara.id] });

      const updated = stories.updateStory(bureau.id, story.id, {
        title: 'Lamplight',
        castIds: [theo.id, mara.id],
      });

      expect(updated).toMatchObject({ title: 'Lamplight', castIds: [theo.id, mara.id] });
    });

    it('ends a story', () => {
      const story = stories.createStory(bureau.id, { startTime: START, castIds: [] });

      const ended = stories.endStory(bureau.id, story.id, { endTime: '2026-10-28T02:00:00.000Z' });

      expect(ended).toMatchObject({ status: 'ended', endTime: '2026-10-28T02:00:00.000Z' });
    });

    it('records archive progress and keeps new turns past it', () => {
      const story = stories.createStory(bureau.id, { startTime: START, castIds: [] });
      expect(story).toMatchObject({ archivedThrough: -1, summary: '' });
      const turns = ['A', 'B', 'C'].map((content) =>
        stories.addTurn(story.id, { kind: 'prose', source: 'generated', content }),
      );
      stories.setArchiveProgress(story.id, {
        archivedThrough: 2,
        summary: 'Three things happened.',
      });
      stories.deleteTurn(story.id, turns[2].id);
      stories.deleteTurn(story.id, turns[1].id);

      const next = stories.addTurn(story.id, { kind: 'prose', source: 'generated', content: 'D' });

      expect(next.position).toBe(3);
      expect(stories.getStory(bureau.id, story.id)).toMatchObject({
        archivedThrough: 2,
        summary: 'Three things happened.',
      });
    });

    it('keeps stories inside their own Bureau', () => {
      const other = bureaus.createBureau({ name: 'Other' });
      const story = stories.createStory(bureau.id, { startTime: START, castIds: [] });

      expect(stories.getStory(other.id, story.id)).toBeNull();
      expect(stories.updateStory(other.id, story.id, { title: 'Nope' })).toBeNull();
      expect(stories.endStory(other.id, story.id, { endTime: START })).toBeNull();
      expect(stories.deleteStory(other.id, story.id)).toBe(false);
    });

    it('deletes a story with its turns', () => {
      const story = stories.createStory(bureau.id, { startTime: START, castIds: [] });
      stories.addTurn(story.id, { kind: 'prose', source: 'generated', content: 'Lamplight.' });

      expect(stories.deleteStory(bureau.id, story.id)).toBe(true);
      expect(stories.listTurns(story.id)).toEqual([]);
      expect(stories.db.prepare('SELECT COUNT(*) AS n FROM turn_variants').get().n).toBe(0);
    });

    it('drops a removed cast member from stories but keeps their turns', () => {
      const story = stories.createStory(bureau.id, { startTime: START, castIds: [mara.id] });
      const turn = stories.addTurn(story.id, {
        kind: 'prose',
        source: 'generated',
        content: 'Mara laughed.',
        authorCastId: mara.id,
      });

      bureaus.removeCastMember(bureau.id, mara.id);

      expect(stories.getStory(bureau.id, story.id).castIds).toEqual([]);
      expect(stories.getTurn(story.id, turn.id)).toMatchObject({
        content: 'Mara laughed.',
        authorCastId: null,
      });
    });
  });

  describe('turns', () => {
    let story;

    beforeEach(() => {
      story = stories.createStory(bureau.id, { startTime: START, castIds: [mara.id, theo.id] });
    });

    it('appends turns in order and counts them on the story', () => {
      stories.addTurn(story.id, { kind: 'prose', source: 'user', content: 'Theo knocked.' });
      stories.addTurn(story.id, { kind: 'direction', source: 'user', content: 'Mara is tired.' });
      stories.addTurn(story.id, { kind: 'scene_break', source: 'user' });

      expect(
        stories.listTurns(story.id).map((turn) => [turn.position, turn.kind, turn.source]),
      ).toEqual([
        [0, 'prose', 'user'],
        [1, 'direction', 'user'],
        [2, 'scene_break', 'user'],
      ]);
      expect(stories.getStory(bureau.id, story.id).turnCount).toBe(3);
    });

    it('gives user turns no variants', () => {
      const turn = stories.addTurn(story.id, { kind: 'prose', source: 'user', content: 'Hi.' });

      expect(turn).toMatchObject({ variants: [], activeVariantId: null, edited: false });
    });

    it('gives a generated turn its first variant', () => {
      const runId = bureaus.createRun({ bureauId: bureau.id, purpose: 'turn' });
      const turn = stories.addTurn(story.id, {
        kind: 'prose',
        source: 'generated',
        content: 'The lamp was lit.',
        authorCastId: mara.id,
        runId,
      });

      expect(turn).toMatchObject({ content: 'The lamp was lit.', runId, authorCastId: mara.id });
      expect(turn.variants).toEqual([{ id: turn.activeVariantId, runId, created: turn.created }]);
    });

    it('shows a new variant when regenerated, and can switch back', () => {
      const turn = stories.addTurn(story.id, {
        kind: 'prose',
        source: 'generated',
        content: 'First try.',
      });

      const regenerated = stories.addVariant(story.id, turn.id, { content: 'Second try.' });
      expect(regenerated.content).toBe('Second try.');
      expect(regenerated.variants).toHaveLength(2);

      const reverted = stories.selectVariant(story.id, turn.id, turn.activeVariantId);
      expect(reverted).toMatchObject({
        content: 'First try.',
        activeVariantId: turn.activeVariantId,
      });
    });

    it('saves an edit to the variant being shown', () => {
      const turn = stories.addTurn(story.id, {
        kind: 'prose',
        source: 'generated',
        content: 'First try.',
      });
      const regenerated = stories.addVariant(story.id, turn.id, { content: 'Second try.' });

      stories.editTurn(story.id, turn.id, 'Second try, edited.');
      stories.selectVariant(story.id, turn.id, turn.activeVariantId);
      const back = stories.selectVariant(story.id, turn.id, regenerated.activeVariantId);

      expect(back).toMatchObject({ content: 'Second try, edited.', edited: true });
    });

    it('tracks edits per version', () => {
      const turn = stories.addTurn(story.id, {
        kind: 'prose',
        source: 'generated',
        content: 'First try.',
      });
      stories.editTurn(story.id, turn.id, 'First try, edited.');

      const regenerated = stories.addVariant(story.id, turn.id, { content: 'Second try.' });
      expect(regenerated.edited).toBe(false);

      expect(stories.selectVariant(story.id, turn.id, turn.activeVariantId).edited).toBe(true);
      expect(stories.selectVariant(story.id, turn.id, regenerated.activeVariantId).edited).toBe(
        false,
      );
    });

    it('edits and deletes user turns', () => {
      const turn = stories.addTurn(story.id, { kind: 'prose', source: 'user', content: 'Hi.' });

      expect(stories.editTurn(story.id, turn.id, 'Hello.')).toMatchObject({
        content: 'Hello.',
        edited: true,
      });
      expect(stories.deleteTurn(story.id, turn.id)).toBe(true);
      expect(stories.getTurn(story.id, turn.id)).toBeNull();
    });

    it('keeps turns inside their own story', () => {
      const other = stories.createStory(bureau.id, { startTime: START, castIds: [] });
      const turn = stories.addTurn(story.id, {
        kind: 'prose',
        source: 'generated',
        content: 'Lamplight.',
      });

      expect(stories.getTurn(other.id, turn.id)).toBeNull();
      expect(stories.editTurn(other.id, turn.id, 'Nope')).toBeNull();
      expect(stories.addVariant(other.id, turn.id, { content: 'Nope' })).toBeNull();
      expect(stories.selectVariant(other.id, turn.id, turn.activeVariantId)).toBeNull();
      expect(stories.deleteTurn(other.id, turn.id)).toBe(false);
    });

    it('returns null for a variant that belongs to another turn', () => {
      const first = stories.addTurn(story.id, { kind: 'prose', source: 'generated', content: 'A' });
      const second = stories.addTurn(story.id, {
        kind: 'prose',
        source: 'generated',
        content: 'B',
      });

      expect(stories.selectVariant(story.id, first.id, second.activeVariantId)).toBeNull();
    });

    it('rejects unknown kinds and sources', () => {
      expect(() => stories.addTurn(story.id, { kind: 'poem', source: 'user' })).toThrow(
        /Unknown turn kind/,
      );
      expect(() => stories.addTurn(story.id, { kind: 'prose', source: 'ghost' })).toThrow(
        /Unknown turn source/,
      );
    });
  });
});
