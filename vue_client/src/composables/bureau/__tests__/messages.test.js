import { describe, it, expect } from 'vitest';
import { groupSessions, splitReply } from '../messages';

function message(id, bureauTime) {
  return { id, bureauTime };
}

describe('splitReply', () => {
  it('splits a reply at separator lines as it streams in', () => {
    expect(splitReply('Always.\n---\nStorm?')).toEqual(['Always.', 'Storm?']);
    expect(splitReply('Always.\n-')).toEqual(['Always.\n-']);
    expect(splitReply('Dear Theo,\n\nThe fog lifted.\n---\n')).toEqual([
      'Dear Theo,\n\nThe fog lifted.',
    ]);
  });
});

describe('groupSessions', () => {
  it('starts a new session after a long gap', () => {
    const sessions = groupSessions([
      message('a', '2026-10-24T21:00:00Z'),
      message('b', '2026-10-24T23:30:00Z'),
      message('c', '2026-10-25T09:00:00Z'),
    ]);

    expect(sessions).toEqual([
      {
        startTime: '2026-10-24T21:00:00Z',
        messages: [message('a', '2026-10-24T21:00:00Z'), message('b', '2026-10-24T23:30:00Z')],
      },
      { startTime: '2026-10-25T09:00:00Z', messages: [message('c', '2026-10-25T09:00:00Z')] },
    ]);
    expect(groupSessions([])).toEqual([]);
  });
});
