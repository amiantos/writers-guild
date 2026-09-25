import { describe, it, expect } from 'vitest';
import { describeQueue, showsSender, splitReply } from '../chatMessages.js';

describe('chatMessages', () => {
  it('splits a reply being written at separator lines', () => {
    expect(splitReply('hey\n---\nyou up?\n--')).toEqual(['hey', 'you up?\n--']);
    expect(splitReply('')).toEqual([]);
  });

  it('drops and splits at the sender’s own labels, as the saved reply will', () => {
    expect(splitReply('Layla: hey\nlayla hart: you up?\nmeet at 5:30', 'Layla Hart')).toEqual([
      'hey',
      'you up?\nmeet at 5:30',
    ]);
    expect(splitReply('Layla: hey')).toEqual(['Layla: hey']);
  });

  it('names a character’s turn in a group when the speaker changes', () => {
    const turns = [
      { source: 'user' },
      { source: 'character', characterId: 'a' },
      { source: 'character', characterId: 'a' },
      { source: 'character', characterId: 'b' },
    ];
    expect(turns.map((_turn, index) => showsSender(turns, index, true))).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(showsSender(turns, 1, false)).toBe(false);
  });

  it('describes a queue position', () => {
    expect(describeQueue({ position: 3, waitTime: 19.6 })).toBe(
      'Waiting in line (position 3, about 20s)...',
    );
    expect(describeQueue({ position: 0, waitTime: 0 })).toBe('Waiting in line...');
  });
});
