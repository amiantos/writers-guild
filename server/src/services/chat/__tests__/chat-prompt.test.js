import { describe, it, expect } from 'vitest';
import { buildChatPrompts, joinNames, pickSpeaker, splitReply } from '../chat-prompt.js';

function card(id, name, data = {}) {
  return { id, data: { name, ...data } };
}

function turn(source, characterId, messages, senderName = '') {
  return { source, characterId, senderName, messages };
}

const layla = card('layla', 'Layla Hart', {
  description: 'A nurse who works nights. {{user}} is her brother.',
  personality: 'Dry *wit*',
  mes_example: '<START>\nLayla: ugh, mondays',
  scenario: 'They meet at a tavern.',
});
const sam = card('sam', 'Sam');
const bradley = card('bradley', 'Bradley', { description: 'Travels for work.' });

const preset = {
  generationSettings: { maxTokens: 500, includeDialogueExamples: false },
  promptTemplates: {},
};

function build(overrides = {}) {
  return buildChatPrompts({
    chat: { scenario: '' },
    speaker: layla,
    characters: [layla],
    persona: bradley,
    turns: [],
    preset,
    maxContextTokens: 8000,
    ...overrides,
  });
}

describe('joinNames', () => {
  it('joins names in English', () => {
    expect(joinNames(['A'])).toBe('A');
    expect(joinNames(['A', 'B'])).toBe('A and B');
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B, and C');
  });
});

describe('pickSpeaker', () => {
  it('is the only character in a one-on-one chat', () => {
    expect(pickSpeaker([layla], [])).toBe(layla);
  });

  it('is the character the user named first', () => {
    const turns = [turn('user', null, ['hey sam, is layla there?'])];
    expect(pickSpeaker([layla, sam], turns)).toBe(sam);
  });

  it('matches a first name', () => {
    const turns = [turn('character', 'sam', ['yo']), turn('user', null, ['Layla you up?'])];
    expect(pickSpeaker([layla, sam], turns)).toBe(layla);
  });

  it('is whoever spoke last when nobody is named', () => {
    const turns = [
      turn('character', 'layla', ['hi']),
      turn('character', 'sam', ['hey']),
      turn('user', null, ['what are you both doing']),
    ];
    expect(pickSpeaker([layla, sam], turns)).toBe(sam);
  });

  it('is the first character when nobody has spoken', () => {
    expect(pickSpeaker([layla, sam], [turn('user', null, ['hello?'])])).toBe(layla);
  });
});

describe('splitReply', () => {
  it('splits at separator lines and strips asterisks', () => {
    expect(splitReply('hey\n---\n*yawns* you up?\n---\n', 'Layla')).toEqual([
      'hey',
      'yawns you up?',
    ]);
  });

  it('drops the sender’s own labels, full or first name, and splits at them', () => {
    expect(splitReply('Layla: hey\nLayla Hart: you there?', 'Layla Hart')).toEqual([
      'hey',
      'you there?',
    ]);
  });

  it('keeps colons that are not labels', () => {
    expect(splitReply('meet at 5:30\nNote: bring cash', 'Layla')).toEqual([
      'meet at 5:30\nNote: bring cash',
    ]);
  });

  it('cuts the reply where someone else starts talking', () => {
    expect(splitReply('hey\nBradley: hi!\nLayla: ok', 'Layla', ['Bradley'])).toEqual(['hey']);
  });

  it('joins messages past the limit into the last one', () => {
    const parts = splitReply(['1', '2', '3', '4', '5', '6', '7'].join('\n---\n'), 'Layla');
    expect(parts).toHaveLength(6);
    expect(parts.at(-1)).toBe('6\n\n7');
  });
});

describe('buildChatPrompts', () => {
  it('describes a private chat with the character, persona, and message style', () => {
    const { system } = build();
    expect(system).toContain('private chat between Bradley and Layla Hart');
    expect(system).toContain('Description: A nurse who works nights. Bradley is her brother.');
    expect(system).toContain('Personality: Dry wit');
    expect(system).toContain("=== Bradley (THE USER'S CHARACTER) ===");
    expect(system).toContain('Description: Travels for work.');
    expect(system).toContain('=== MESSAGE STYLE ===');
    // Card scenarios are for scenes, not texting, so the default leaves them out.
    expect(system).not.toContain('tavern');
    expect(system).not.toContain('=== SCENARIO ===');
  });

  it('includes the chat’s scenario', () => {
    const { system } = build({
      chat: { scenario: "It's nearly midnight and {{user}} is traveling; {{char}} is home." },
    });
    expect(system).toContain(
      "=== SCENARIO ===\nIt's nearly midnight and Bradley is traveling; Layla Hart is home.",
    );
  });

  it('includes dialogue examples only when the preset asks for them', () => {
    expect(build().system).not.toContain('ugh, mondays');
    const withExamples = build({
      preset: { ...preset, generationSettings: { includeDialogueExamples: true } },
    });
    expect(withExamples.system).toContain('How they talk:\n<START>\nLayla: ugh, mondays');
  });

  it('describes a group chat with every character', () => {
    const { system } = build({ characters: [layla, sam] });
    expect(system).toContain('group chat between Bradley, Layla Hart, and Sam');
    expect(system).toContain('=== CHARACTERS ===');
    expect(system).toContain('Name: Sam');
  });

  it('includes activated lorebook entries', () => {
    const { system } = build({ loreEntries: [{ content: 'The hospital is St. Jude.' }] });
    expect(system).toContain('=== WORLD INFORMATION ===\nThe hospital is St. Jude.');
  });

  it('calls the user "User" without a persona', () => {
    const { system, user } = build({ persona: null });
    expect(system).toContain('between User and Layla Hart');
    expect(system).not.toContain("THE USER'S CHARACTER");
    expect(user).toContain('Write the first message Layla Hart sends.');
  });

  it('sends the conversation as a labeled transcript before the instruction', () => {
    const { user } = build({
      characters: [layla, sam],
      turns: [
        turn('user', 'bradley', ['landed', 'finally'], 'Bradley'),
        turn('character', 'sam', ['nice'], 'Sam'),
      ],
    });
    expect(user).toBe(
      [
        '=== CONVERSATION ===',
        'Bradley: landed',
        'Bradley: finally',
        'Sam: nice',
        '',
        '=== NOW ===',
        "Write Layla Hart's reply.",
        "Stay in character. Write only what Layla Hart sends, never anyone else's messages, and don't label messages with names.",
        'Write one to four messages, with a line containing only --- between messages.',
      ].join('\n'),
    );
  });

  it('asks for a follow-up when the speaker wrote last', () => {
    const { user } = build({ turns: [turn('character', 'layla', ['hello?'])] });
    expect(user).toContain('No one has answered Layla Hart yet. Write a short follow-up');
  });

  it('keeps only the latest messages that fit the context', () => {
    const turns = Array.from({ length: 200 }, (_, i) =>
      turn('user', null, [`message number ${i} ${'x'.repeat(100)}`], 'Bradley'),
    );
    const { user } = build({ turns, maxContextTokens: 1500 });
    expect(user).toContain('(Earlier messages are omitted.)');
    expect(user).toContain('message number 199');
    expect(user).not.toContain('message number 0 ');
  });

  it('uses the preset’s templates, placing the conversation where the reply template says', () => {
    const { system, user } = build({
      preset: {
        ...preset,
        promptTemplates: {
          chatSystemPrompt: 'Chat as {{char}} with {{user}}.{{#if has_chat_scenario}} Hi{{/if}}',
          chatReply: 'Transcript:\n{{conversation}}\nNow {{char}}.',
        },
      },
      turns: [turn('user', null, ['hey'], 'Bradley')],
    });
    expect(system).toBe('Chat as Layla Hart with Bradley.');
    expect(user).toBe('Transcript:\nBradley: hey\nNow Layla Hart.');
  });

  it('can end with the speaker’s label for text-completion backends', () => {
    expect(build({ primeSpeaker: true }).user.endsWith('\n\nLayla Hart:')).toBe(true);
  });
});
