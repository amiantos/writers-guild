import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ThreadStorage } from '../thread-storage.js';
import { BureauStorage } from '../bureau-storage.js';
import { closeBureauDb } from '../bureau-db.js';

const TIME = '2026-10-27T07:30:00.000Z';

function card(name) {
  return { spec: 'chara_card_v2', spec_version: '2.0', data: { name } };
}

describe('ThreadStorage', () => {
  let tempDir;
  let bureaus;
  let threads;
  let bureau;
  let mara;
  let theo;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thread-storage-'));
    bureaus = new BureauStorage(tempDir);
    threads = new ThreadStorage(tempDir);
    bureau = bureaus.createBureau({ name: 'Harbor' });
    mara = bureaus.addCastMember(bureau.id, { seedCard: card('Mara'), libraryCharacterId: 'c1' });
    theo = bureaus.addCastMember(bureau.id, {
      seedCard: card('Theo'),
      libraryCharacterId: 'c2',
      isPersona: true,
    });
  });

  afterEach(() => {
    closeBureauDb(tempDir);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('keeps one thread per cast member', () => {
    const first = threads.getOrCreateThread(bureau.id, mara.id);

    expect(threads.getOrCreateThread(bureau.id, mara.id).id).toBe(first.id);
    expect(first).toMatchObject({
      bureauId: bureau.id,
      castMemberId: mara.id,
      archivedThrough: -1,
      messageCount: 0,
      lastMessage: null,
    });
    expect(threads.getThread(bureau.id, first.id).id).toBe(first.id);
    expect(threads.getThreadForCast(bureau.id, theo.id)).toBeNull();
    expect(() => threads.getOrCreateThread(bureau.id, 'missing')).toThrow(/FOREIGN KEY/);
  });

  it('adds messages in order and lists the latest ones', () => {
    const thread = threads.getOrCreateThread(bureau.id, mara.id);
    const send = (source, content) =>
      threads.addMessage(thread.id, {
        source,
        content,
        bureauTime: TIME,
        senderCastId: source === 'user' ? theo.id : mara.id,
      });

    send('user', 'You up?');
    send('generated', 'Always.');
    const third = send('generated', 'The light needs me.');

    expect(third).toMatchObject({
      position: 2,
      source: 'generated',
      senderCastId: mara.id,
      bureauTime: TIME,
      runId: null,
      edited: false,
    });
    expect(threads.listMessages(thread.id).map((message) => message.content)).toEqual([
      'You up?',
      'Always.',
      'The light needs me.',
    ]);
    expect(
      threads.listMessages(thread.id, { limit: 2 }).map((message) => message.position),
    ).toEqual([1, 2]);
    expect(threads.listThreads(bureau.id)).toEqual([
      expect.objectContaining({
        id: thread.id,
        messageCount: 3,
        lastMessage: expect.objectContaining({
          content: 'The light needs me.',
          source: 'generated',
        }),
      }),
    ]);
    expect(() => send('narrator', 'Meanwhile')).toThrow(/Unknown message source/);
  });

  it('edits and deletes messages', () => {
    const thread = threads.getOrCreateThread(bureau.id, mara.id);
    const message = threads.addMessage(thread.id, {
      source: 'user',
      content: 'Hi',
      bureauTime: TIME,
    });

    expect(threads.editMessage(thread.id, message.id, 'Hello')).toMatchObject({
      content: 'Hello',
      edited: true,
    });
    expect(threads.editMessage(thread.id, 'missing', 'Hey')).toBeNull();
    expect(threads.deleteMessage(thread.id, message.id)).toBe(true);
    expect(threads.deleteMessage(thread.id, message.id)).toBe(false);
  });

  it('goes with the cast member, and keeps messages from someone who left', () => {
    const thread = threads.getOrCreateThread(bureau.id, mara.id);
    const message = threads.addMessage(thread.id, {
      source: 'user',
      content: 'Hi',
      bureauTime: TIME,
      senderCastId: theo.id,
    });

    bureaus.removeCastMember(bureau.id, theo.id);
    expect(threads.getMessage(thread.id, message.id).senderCastId).toBeNull();

    bureaus.removeCastMember(bureau.id, mara.id);
    expect(threads.getThread(bureau.id, thread.id)).toBeNull();
    expect(threads.deleteThread(bureau.id, thread.id)).toBe(false);
  });
});
