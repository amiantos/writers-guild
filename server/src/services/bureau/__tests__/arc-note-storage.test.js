import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ArcNoteStorage } from '../arc-note-storage.js';
import { BureauStorage } from '../bureau-storage.js';
import { StoryStorage } from '../story-storage.js';
import { closeBureauDb } from '../bureau-db.js';

const START = '2026-10-27T07:30:00.000Z';

function card(name) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name } };
}

describe('ArcNoteStorage', () => {
  let tempDir;
  let bureaus;
  let stories;
  let arcNotes;
  let bureau;
  let mara;
  let story;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc-note-storage-'));
    bureaus = new BureauStorage(tempDir);
    stories = new StoryStorage(tempDir);
    arcNotes = new ArcNoteStorage(tempDir);
    bureau = bureaus.createBureau({ name: 'Harbor' });
    mara = bureaus.addCastMember(bureau.id, { seedCard: card('Mara'), libraryCharacterId: 'c1' });
    story = stories.createStory(bureau.id, {
      startTime: START,
      castIds: [mara.id],
      title: 'Lamplight',
    });
  });

  afterEach(() => {
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function propose(content, fields = {}) {
    return arcNotes.addNote(bureau.id, mara.id, {
      content,
      rationale: 'She let Theo row.',
      sourceType: 'story',
      sourceId: story.id,
      worldTime: START,
      ...fields,
    });
  }

  it('records a proposal with its story and turns', () => {
    const turn = stories.addTurn(story.id, { kind: 'prose', source: 'generated', content: 'x' });

    const note = propose('Mara has started to trust Theo with the boat.', {
      sourceTurnIds: [turn.id],
    });

    expect(note).toMatchObject({
      castMemberId: mara.id,
      content: 'Mara has started to trust Theo with the boat.',
      proposedContent: 'Mara has started to trust Theo with the boat.',
      rationale: 'She let Theo row.',
      status: 'proposed',
      sourceTitle: 'Lamplight',
      sourceTurnIds: [turn.id],
      decided: null,
      needsReview: false,
    });
  });

  it('accepts a note the reader writes as it is written', () => {
    const note = arcNotes.addNote(bureau.id, mara.id, {
      content: 'Mara no longer keeps the lamp lit for her brother.',
      status: 'accepted',
    });

    expect(note).toMatchObject({ status: 'accepted', sourceType: 'manual', worldTime: null });
    expect(note.decided).not.toBeNull();
  });

  it('accepts with edits, rejects, and keeps what was first proposed', () => {
    const accepted = propose('Mara trusts Theo.');
    const rejected = propose('Mara has become cheerful.');

    const edited = arcNotes.updateNote(bureau.id, accepted.id, {
      content: 'Mara trusts Theo with the boat, if not yet with the light.',
      status: 'accepted',
    });
    arcNotes.updateNote(bureau.id, rejected.id, { status: 'rejected' });

    expect(edited).toMatchObject({
      content: 'Mara trusts Theo with the boat, if not yet with the light.',
      proposedContent: 'Mara trusts Theo.',
      status: 'accepted',
    });
    expect(edited.decided).not.toBeNull();
    expect(
      arcNotes.listNotes(bureau.id, mara.id, { status: 'rejected' }).map((note) => note.id),
    ).toEqual([rejected.id]);
    expect(arcNotes.updateNote(bureau.id, 9999, { status: 'accepted' })).toBeNull();
    expect(() => arcNotes.updateNote(bureau.id, accepted.id, { status: 'maybe' })).toThrow(
      /Unknown arc note status/,
    );
  });

  it('lists notes oldest first, with notes the reader wrote first', () => {
    propose('Later', { worldTime: '2026-11-01T00:00:00.000Z' });
    propose('Earlier');
    arcNotes.addNote(bureau.id, mara.id, { content: 'Written', status: 'accepted' });

    expect(arcNotes.listNotes(bureau.id, mara.id).map((note) => note.content)).toEqual([
      'Written',
      'Earlier',
      'Later',
    ]);
  });

  it('flags notes citing changed turns and counts waiting proposals', () => {
    const cited = stories.addTurn(story.id, { kind: 'prose', source: 'user', content: 'Row.' });
    const note = propose('Mara lets Theo row.', { sourceTurnIds: [cited.id] });
    propose('Another proposal.');
    arcNotes.updateNote(bureau.id, note.id, { status: 'accepted' });

    expect(arcNotes.flagTurnsChanged(bureau.id, story.id, [cited.id])).toBe(1);
    expect(arcNotes.getNote(bureau.id, note.id).needsReview).toBe(true);
    expect(arcNotes.proposedCountsByCast(bureau.id)).toEqual({ [mara.id]: 1 });
  });

  it("deletes a story's notes, and all notes with their cast member", () => {
    propose('From the story.');
    arcNotes.addNote(bureau.id, mara.id, { content: 'Written', status: 'accepted' });

    expect(arcNotes.deleteStoryNotes(bureau.id, story.id)).toBe(1);
    expect(arcNotes.listNotes(bureau.id, mara.id)).toHaveLength(1);

    bureaus.removeCastMember(bureau.id, mara.id);
    expect(arcNotes.db.prepare('SELECT COUNT(*) AS n FROM arc_notes').get().n).toBe(0);
  });

  it('keeps notes inside their own Bureau', () => {
    const other = bureaus.createBureau({ name: 'Other' });
    const note = propose('Secret.');

    expect(arcNotes.getNote(other.id, note.id)).toBeNull();
    expect(arcNotes.updateNote(other.id, note.id, { status: 'accepted' })).toBeNull();
    expect(arcNotes.deleteNote(other.id, note.id)).toBe(false);
    expect(arcNotes.listNotes(other.id, mara.id)).toEqual([]);
  });
});
