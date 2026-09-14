import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BureauStorage } from '../bureau-storage.js';
import { InterviewConflictError, InterviewStorage } from '../interview-storage.js';
import { closeBureauDb } from '../bureau-db.js';

function card(name) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name } };
}

describe('InterviewStorage', () => {
  let tempDir;
  let bureaus;
  let interviews;
  let bureau;
  let mara;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bureau-interviews-'));
    bureaus = new BureauStorage(tempDir);
    interviews = new InterviewStorage(tempDir);
    bureau = bureaus.createBureau({ name: 'Harbor' });
    mara = bureaus.addCastMember(bureau.id, { seedCard: card('Mara') });
  });

  afterEach(() => {
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function start(focus = 'flesh_out') {
    return interviews.startInterview(bureau.id, mara.id, { focus });
  }

  it('starts one open interview per character', () => {
    const interview = interviews.startInterview(bureau.id, mara.id, {
      focus: 'routine',
      note: 'Her nights',
    });

    expect(interview).toMatchObject({
      castMemberId: mara.id,
      focus: 'routine',
      note: 'Her nights',
      status: 'open',
      messages: [],
      proposal: null,
    });
    expect(interviews.getOpenInterview(bureau.id, mara.id).id).toBe(interview.id);
    expect(() => start()).toThrow(InterviewConflictError);
  });

  it('adds questions and answers in order, and an answer sets the write-up aside', () => {
    const { id } = start();
    interviews.addMessage(bureau.id, id, { source: 'generated', content: 'Who taught her?' });
    interviews.setProposal(bureau.id, id, { description: 'Draft' });

    const asked = interviews.addMessage(bureau.id, id, {
      source: 'generated',
      content: 'Why the harbor?',
      runId: 'run-2',
      replaceQuestion: true,
    });
    expect(asked.messages).toEqual([
      expect.objectContaining({ source: 'generated', content: 'Why the harbor?', runId: 'run-2' }),
    ]);
    expect(asked.proposal).toEqual({ description: 'Draft' });

    const answered = interviews.addMessage(bureau.id, id, {
      source: 'user',
      content: 'Her father.',
    });
    expect(answered.messages.map((message) => [message.source, message.content])).toEqual([
      ['generated', 'Why the harbor?'],
      ['user', 'Her father.'],
    ]);
    expect(answered.proposal).toBeNull();
  });

  it('only replaces a question, never an answer', () => {
    const { id } = start();
    interviews.addMessage(bureau.id, id, { source: 'user', content: 'Her father.' });

    const asked = interviews.addMessage(bureau.id, id, {
      source: 'generated',
      content: 'Why the harbor?',
      replaceQuestion: true,
    });

    expect(asked.messages.map((message) => message.content)).toEqual([
      'Her father.',
      'Why the harbor?',
    ]);
  });

  it('closes an accepted interview, so another can start', () => {
    const { id } = start();

    expect(interviews.acceptInterview(bureau.id, id, { description: 'Kept' })).toBe(true);
    expect(interviews.getInterview(bureau.id, id)).toMatchObject({
      status: 'accepted',
      proposal: { description: 'Kept' },
    });
    expect(interviews.getOpenInterview(bureau.id, mara.id)).toBeNull();
    expect(interviews.addMessage(bureau.id, id, { source: 'user', content: 'Late.' })).toBeNull();
    expect(interviews.setProposal(bureau.id, id, {})).toBeNull();
    expect(interviews.acceptInterview(bureau.id, id, {})).toBe(false);
    expect(start().status).toBe('open');
  });

  it('deletes an interview, and a character leaving the cast takes theirs along', () => {
    const first = start();
    expect(interviews.deleteInterview(bureau.id, first.id)).toBe(true);
    expect(interviews.getInterview(bureau.id, first.id)).toBeNull();

    const second = start();
    bureaus.removeCastMember(bureau.id, mara.id);
    expect(interviews.getInterview(bureau.id, second.id)).toBeNull();
  });
});
