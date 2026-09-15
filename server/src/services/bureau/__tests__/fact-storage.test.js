import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FactStorage } from '../fact-storage.js';
import { BureauStorage } from '../bureau-storage.js';
import { StoryStorage } from '../story-storage.js';
import { ThreadStorage } from '../thread-storage.js';
import { closeBureauDb } from '../bureau-db.js';

const START = '2026-10-27T07:30:00.000Z';

describe('FactStorage', () => {
  let tempDir;
  let bureaus;
  let stories;
  let threads;
  let facts;
  let bureau;
  let story;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-storage-'));
    bureaus = new BureauStorage(tempDir);
    stories = new StoryStorage(tempDir);
    threads = new ThreadStorage(tempDir);
    facts = new FactStorage(tempDir);
    bureau = bureaus.createBureau({ name: 'Harbor' });
    story = stories.createStory(bureau.id, { startTime: START, castIds: [], title: 'Lamplight' });
  });

  afterEach(() => {
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("adds the reader's fact as accepted, and the Archivist's proposal with its source", () => {
    const home = facts.addFact(bureau.id, {
      content: 'Mara and Theo live above the bakery.',
      status: 'accepted',
    });
    expect(home).toMatchObject({
      status: 'accepted',
      sourceType: 'manual',
      worldTime: null,
      replaces: null,
      replacedBy: null,
      needsReview: false,
    });
    expect(home.decided).toBeTruthy();

    const turn = stories.addTurn(story.id, { kind: 'prose', source: 'generated', content: 'x' });
    const move = facts.addFact(bureau.id, {
      content: 'Mara and Theo live in a house by the harbor.',
      rationale: 'They signed the lease.',
      replaces: home.id,
      worldTime: START,
      sourceType: 'story',
      sourceId: story.id,
      sourceTurnIds: [turn.id],
    });
    expect(move).toMatchObject({
      status: 'proposed',
      proposedContent: 'Mara and Theo live in a house by the harbor.',
      rationale: 'They signed the lease.',
      replaces: home.id,
      replacesContent: 'Mara and Theo live above the bakery.',
      sourceTitle: 'Lamplight',
      sourcePosition: 0,
      sourceTurnIds: [turn.id],
      decided: null,
    });

    expect(facts.listFacts(bureau.id).map((fact) => fact.id)).toEqual([home.id, move.id]);
    expect(facts.listFacts(bureau.id, { status: 'proposed' }).map((fact) => fact.id)).toEqual([
      move.id,
    ]);
  });

  it('shows what replaced a fact once the change is accepted, until the change is gone', () => {
    const home = facts.addFact(bureau.id, {
      content: 'Mara lives above the bakery.',
      status: 'accepted',
    });
    const move = facts.addFact(bureau.id, {
      content: 'Mara lives by the harbor.',
      replaces: home.id,
    });
    expect(facts.getFact(bureau.id, home.id).replacedBy).toBeNull();

    facts.updateFact(bureau.id, move.id, { status: 'accepted' });
    expect(facts.getFact(bureau.id, home.id).replacedBy).toBe(move.id);

    expect(facts.deleteFact(bureau.id, move.id)).toBe(true);
    expect(facts.getFact(bureau.id, home.id).replacedBy).toBeNull();
    expect(facts.deleteFact(bureau.id, move.id)).toBe(false);
  });

  it("ignores replacing a fact that isn't in the Bureau", () => {
    const elsewhere = bureaus.createBureau({ name: 'Elsewhere' });
    const theirs = facts.addFact(elsewhere.id, {
      content: 'Ines runs the pub.',
      status: 'accepted',
    });

    expect(
      facts.addFact(bureau.id, { content: 'A change.', replaces: theirs.id }).replaces,
    ).toBeNull();
    expect(facts.addFact(bureau.id, { content: 'Another.', replaces: 999 }).replaces).toBeNull();
    expect(facts.getFact(bureau.id, theirs.id)).toBeNull();
  });

  it('accepts with edits, keeping what was first proposed, then rejects', () => {
    const shift = facts.addFact(bureau.id, { content: 'Theo works nights.' });

    const accepted = facts.updateFact(bureau.id, shift.id, {
      content: 'Theo works days.',
      status: 'accepted',
    });
    expect(accepted).toMatchObject({
      content: 'Theo works days.',
      proposedContent: 'Theo works nights.',
      status: 'accepted',
    });
    expect(accepted.decided).toBeTruthy();
    expect(facts.updateFact(bureau.id, shift.id, { status: 'rejected' }).status).toBe('rejected');
    expect(facts.updateFact(bureau.id, 999, { status: 'accepted' })).toBeNull();
  });

  it('flags facts citing changed turns or messages until they are reviewed', () => {
    const mara = bureaus.addCastMember(bureau.id, {
      seedCard: { data: { name: 'Mara' } },
      libraryCharacterId: 'c1',
    });
    const thread = threads.getOrCreateThread(bureau.id, mara.id);
    const message = threads.addMessage(thread.id, {
      source: 'user',
      content: 'Moving day.',
      bureauTime: START,
    });
    const turn = stories.addTurn(story.id, { kind: 'prose', source: 'generated', content: 'x' });
    const fromStory = facts.addFact(bureau.id, {
      content: 'From the chapter.',
      status: 'accepted',
      sourceType: 'story',
      sourceId: story.id,
      worldTime: START,
      sourceTurnIds: [turn.id],
    });
    const fromThread = facts.addFact(bureau.id, {
      content: 'From messages.',
      status: 'accepted',
      sourceType: 'correspondence',
      sourceId: thread.id,
      worldTime: START,
      sourceTurnIds: [message.id],
    });

    expect(facts.flagTurnsChanged(bureau.id, story.id, [])).toBe(0);
    expect(facts.flagTurnsChanged(bureau.id, story.id, [turn.id])).toBe(1);
    expect(facts.flagTurnsChanged(bureau.id, thread.id, [message.id], 'correspondence')).toBe(1);
    expect(facts.getFact(bureau.id, fromStory.id).needsReview).toBe(true);
    expect(facts.getFact(bureau.id, fromThread.id)).toMatchObject({
      needsReview: true,
      sourceCreated: message.created,
    });

    expect(facts.updateFact(bureau.id, fromStory.id, { needsReview: false }).needsReview).toBe(
      false,
    );
    expect(
      facts.updateFact(bureau.id, fromThread.id, { content: 'Edited from messages.' }).needsReview,
    ).toBe(false);
  });

  it("deletes a story's facts, keeping the rest", () => {
    const mine = facts.addFact(bureau.id, { content: 'Mine.', status: 'accepted' });
    facts.addFact(bureau.id, {
      content: 'From the chapter.',
      sourceType: 'story',
      sourceId: story.id,
      worldTime: START,
    });

    expect(facts.deleteStoryFacts(bureau.id, story.id)).toBe(1);
    expect(facts.listFacts(bureau.id).map((fact) => fact.id)).toEqual([mine.id]);
  });

  it('removes facts with their Bureau', () => {
    facts.addFact(bureau.id, { content: 'Gone with it.', status: 'accepted' });
    bureaus.deleteBureau(bureau.id);
    expect(facts.listFacts(bureau.id)).toEqual([]);
  });

  it('rejects unknown statuses and sources', () => {
    expect(() => facts.addFact(bureau.id, { content: 'x', status: 'maybe' })).toThrow(
      /Unknown fact status/,
    );
    expect(() => facts.addFact(bureau.id, { content: 'x', sourceType: 'dream' })).toThrow(
      /Unknown fact source/,
    );
    expect(() => facts.listFacts(bureau.id, { status: 'maybe' })).toThrow(/Unknown fact status/);
  });
});
