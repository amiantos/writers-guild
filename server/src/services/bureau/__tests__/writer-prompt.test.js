import { describe, it, expect } from 'vitest';
import { buildWriterMessages, DEFAULT_HOUSE_STYLE } from '../writer-prompt.js';

function member(name, fields = {}, { isPersona = false } = {}) {
  return {
    id: name.toLowerCase(),
    name,
    isPersona,
    seedCard: { spec: 'chara_card_v2', spec_version: '2.0', data: { name, ...fields } },
  };
}

function prose(content, source = 'generated') {
  return { kind: 'prose', source, content };
}

function timePasses(bureauTime) {
  return { kind: 'time_passes', source: 'user', content: '', bureauTime };
}

const MARA = member('Mara', {
  description: '{{char}} keeps the *Greywater* lighthouse and trusts {{user}}.',
  personality: 'Wry and stubborn.',
});
const THEO = member('Theo', { description: 'A visiting cartographer.' }, { isPersona: true });

function build(overrides = {}) {
  const { messages, storyTruncated } = buildWriterMessages({
    bureau: { houseStyle: '' },
    cast: [MARA, THEO],
    turns: [],
    request: { action: 'continue' },
    ...overrides,
  });
  return { system: messages[0].content, user: messages[1].content, messages, storyTruncated };
}

describe('buildWriterMessages', () => {
  it('sends a system message and a user message', () => {
    const { messages } = build();

    expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
  });

  it('uses the default house style until the Bureau writes its own', () => {
    expect(build().system).toContain(DEFAULT_HOUSE_STYLE);
    expect(DEFAULT_HOUSE_STYLE).toMatch(/its own paragraph/);

    const custom = build({ bureau: { houseStyle: 'First person, present tense.' } });
    expect(custom.system).toContain('=== HOUSE STYLE ===\nFirst person, present tense.');
    expect(custom.system).not.toContain(DEFAULT_HOUSE_STYLE);
  });

  it('lists characters and the persona separately, with placeholders filled in', () => {
    const { system } = build();

    expect(system).toContain(
      '=== CHARACTERS ===\nName: Mara\nDescription: Mara keeps the Greywater lighthouse and trusts Theo.\nPersonality: Wry and stubborn.',
    );
    expect(system).toContain(
      "=== THEO (THE READER'S CHARACTER) ===\nName: Theo\nDescription: A visiting cartographer.",
    );
  });

  it('includes activated lorebook entries as world information', () => {
    const { system } = build({
      loreEntries: [{ content: 'The lighthouse went dark in *1971*.' }, { content: '' }],
    });

    expect(system).toContain('=== WORLD ===\nThe lighthouse went dark in 1971.');
  });

  it('names the year as setting for a story set in another year', () => {
    const { system } = build({
      settingYear: '1996',
      loreEntries: [{ content: 'The lighthouse went dark in 1971.' }],
    });

    expect(system).toContain(
      '=== WORLD ===\nThe year is 1996.\n\nThe lighthouse went dark in 1971.',
    );
    expect(build().system).not.toContain('The year is');
  });

  it('adds what a character did the last time they were away', () => {
    const { system } = build({
      memoriesByCast: new Map([
        [
          'mara',
          { knowledge: [], episodes: [], offscreen: { content: 'Repainted the *boathouse*.' } },
        ],
      ]),
    });

    expect(system).toContain('Mara lately: Repainted the boathouse.');
  });

  it('adds what each character remembers from earlier stories', () => {
    const { system } = build({
      memoriesByCast: new Map([
        [
          'mara',
          {
            knowledge: [{ content: "Theo *can't* swim." }, { content: 'Theo hates boats.' }],
            episodes: [
              { content: 'They met at the pier.', sourceTitle: 'Story 1' },
              { content: 'Theo texted about the storm.', sourceType: 'correspondence' },
            ],
          },
        ],
        ['theo', { knowledge: [{ content: 'Mara keeps the light.' }], episodes: [] }],
      ]),
    });

    expect(system).toContain(
      "=== MEMORIES ===\nWhat the characters remember from before this chapter, as background for how they act. People seldom talk about the past, so bring it up only when the moment calls for it, and never recite it. When a memory disagrees with a character's profile or an established fact, the profile or fact is right.\n\nMara knows:\n- Theo can't swim.\n- Theo hates boats.\n\nMara remembers:\n- Story 1: They met at the pier.\n- In messages: Theo texted about the storm.",
    );
    // The reader's character remembers too.
    expect(system).toContain(
      '- In messages: Theo texted about the storm.\n\nTheo knows:\n- Mara keeps the light.',
    );
  });

  it('adds how a character has changed to their profile', () => {
    const { system } = build({
      arcNotesByCast: new Map([
        ['mara', [{ content: 'Mara lets Theo take the *oars* now.' }]],
        ['theo', []],
      ]),
    });

    expect(system).toContain(
      'Personality: Wry and stubborn.\nHow Mara has changed:\n- Mara lets Theo take the oars now.',
    );
    expect(system).not.toContain('How Theo has changed');
  });

  it('adds the established facts before the memories, with placeholders filled in', () => {
    const { system } = build({
      facts: [{ content: "{{user}} and Mara live in the *keeper's* cottage." }],
      memoriesByCast: new Map([
        ['mara', { knowledge: [{ content: "Theo can't swim." }], episodes: [] }],
      ]),
    });

    expect(system).toContain(
      "=== ESTABLISHED FACTS ===\nTrue in this story unless the chapter itself shows one changing.\n- Theo and Mara live in the keeper's cottage.",
    );
    expect(system.indexOf('=== ESTABLISHED FACTS ===')).toBeLessThan(
      system.indexOf('=== MEMORIES ==='),
    );
    expect(build().system).not.toContain('ESTABLISHED FACTS');
  });

  it('leaves out the memories section when no one remembers anything', () => {
    const { system } = build({
      memoriesByCast: new Map([['mara', { knowledge: [], episodes: [] }]]),
    });

    expect(system).not.toContain('MEMORIES');
  });

  it('writes an opening at exactly the chapter start time when nothing has been written', () => {
    const { user } = build({
      bureau: { houseStyle: '', timezone: 'America/Los_Angeles' },
      startTime: '2026-10-27T07:30:00.000Z',
    });

    expect(user).toContain('(Nothing has been written yet.)');
    expect(user).toContain('Write the opening of this chapter');
    expect(user).toContain(
      'This chapter begins at exactly 12:30 AM on Tuesday, October 27, 2026.\nLet the time shape the scene without dwelling on the clock, and if anyone mentions the time, keep it consistent with this.',
    );
  });

  it('gives every later passage the exact time the chapter began', () => {
    const bureau = { houseStyle: '', timezone: 'UTC' };
    const startTime = '2026-10-27T22:15:00.000Z';

    const afterUserOpening = build({ bureau, startTime, turns: [prose('Theo knocked.', 'user')] });
    const later = build({ bureau, startTime, turns: [prose('The lamp was lit.')] });

    for (const { user } of [afterUserOpening, later]) {
      expect(user).toContain(
        'When the chapter began, the time was exactly 10:15 PM on Tuesday, October 27, 2026.\nLet the time shape the scene without dwelling on the clock, and if anyone mentions the time, keep it consistent with this and with how much has happened since.',
      );
      expect(user).not.toContain('This chapter begins');
    }
    expect(build({ bureau, turns: [prose('The lamp was lit.')] }).user).not.toContain('exactly');
  });

  it('marks time passing in the chapter and goes by the last time it passed to', () => {
    const bureau = { houseStyle: '', timezone: 'UTC' };
    const startTime = '2026-10-27T22:15:00.000Z';
    const turns = [
      prose('The lamp was lit.'),
      timePasses('2026-10-28T08:00:00.000Z'),
      prose('Morning came grey.'),
      timePasses('2026-10-31T08:00:00.000Z'),
    ];

    const justPassed = build({ bureau, startTime, turns });
    expect(justPassed.user).toContain(
      "=== CHAPTER SO FAR ===\nThe lamp was lit.\n\n---\n\n[Time passes. It's now exactly 8:00 AM on Wednesday, October 28, 2026.]\n\nMorning came grey.\n\n---\n\n[Time passes. It's now exactly 8:00 AM on Saturday, October 31, 2026.]",
    );
    expect(justPassed.user).toContain(
      "Time has just passed: it's now exactly 8:00 AM on Saturday, October 31, 2026. Pick the story up at this time.",
    );
    expect(justPassed.user).not.toContain('When the chapter began');

    const afterward = build({ bureau, startTime, turns: [...turns, prose('Rain again.')] });
    expect(afterward.user).toContain(
      'When time last passed in the chapter, it was exactly 8:00 AM on Saturday, October 31, 2026.\nLet the time shape the scene',
    );
    expect(afterward.user).not.toContain('Time has just passed');
  });

  it("continues from the reader's passage, naming their character", () => {
    const { user } = build({
      turns: [prose('The lamp was lit.'), prose('Theo climbed the stairs.', 'user')],
      request: { action: 'write' },
    });

    expect(user).toContain('=== CHAPTER SO FAR ===\nThe lamp was lit.\n\nTheo climbed the stairs.');
    expect(user).toContain(
      "=== NEXT ===\nContinue the story naturally from where it left off.\nSome passages may be written in first or second person; write in the house style's perspective and refer to Theo by name.\n",
    );
    expect(user).not.toMatch(/Theo left off|Respond to what/);
  });

  it("doesn't hold back the reader's character on any action", () => {
    for (const request of [
      { action: 'write' },
      { action: 'continue' },
      { action: 'direct', direction: 'Theo tells her about the map' },
    ]) {
      const { user } = build({
        turns: [prose('The lamp was lit.'), prose('Theo climbed the stairs.', 'user')],
        request,
      });

      expect(user).not.toMatch(
        /words and choices|for continuity, not for you|say or do|end the passage right there/,
      );
    }
  });

  it('writes for a reader with no character in the story without inventing a name', () => {
    const { user } = build({
      cast: [MARA],
      turns: [prose('The lamp was lit.'), prose('I opened the door.', 'user')],
      request: { action: 'write' },
    });

    expect(user).toContain(
      "Continue the story naturally from where it left off.\nSome passages may be written in first or second person; write in the house style's perspective.\n",
    );
    expect(user).not.toContain('User');
  });

  it('notes other perspectives once the reader has written', () => {
    const { user } = build({
      turns: [prose('I opened the door.', 'user'), prose('The lamp was lit.')],
      request: { action: 'continue' },
    });
    const generatedOnly = build({
      turns: [prose('The lamp was lit.')],
      request: { action: 'continue' },
    });

    expect(user).toContain('Some passages may be written in first or second person');
    expect(generatedOnly.user).not.toContain('Some passages may be written');
  });

  it("still describes anyone else marked as a reader's character", () => {
    const ines = member('Ines', { description: 'A second traveler.' }, { isPersona: true });

    const { system } = build({ cast: [MARA, THEO, ines] });

    expect(system).toContain("=== THEO (THE READER'S CHARACTER) ===");
    expect(system).toContain('Name: Ines\nDescription: A second traveler.');
  });

  it('keeps directions out of the story text and passes the current one as an instruction', () => {
    const { user } = build({
      turns: [
        prose('The lamp was lit.'),
        { kind: 'direction', source: 'user', content: 'An old direction' },
        { kind: 'scene_break', source: 'user', content: '' },
        prose('Morning came.'),
        { kind: 'direction', source: 'user', content: 'She suggests the night market' },
      ],
      request: { action: 'direct', direction: 'She suggests the night market' },
    });

    expect(user).toContain('=== CHAPTER SO FAR ===\nThe lamp was lit.\n\n---\n\nMorning came.');
    expect(user).not.toContain('An old direction');
    expect(user).toContain(
      "The author's direction for this passage (not part of the story yet): She suggests the night market\nCarry it out in the passage itself: write what it describes as happening.\n",
    );
  });

  it("carries out a direction without naming a reader's character when there is none", () => {
    const { user } = build({
      cast: [MARA],
      turns: [prose('The lamp was lit.')],
      request: { action: 'direct', direction: 'Make it rain' },
    });

    expect(user).toContain(
      'Make it rain\nCarry it out in the passage itself: write what it describes as happening.\n',
    );
    expect(user).not.toContain('end the passage right there');
  });

  it("follows the Director's brief, including its length", () => {
    const { user } = build({
      turns: [prose('The lamp was lit.')],
      request: {
        action: 'continue',
        brief: {
          beats: ['Mara hears the boat', 'She goes down to the dock'],
          pov: 'Mara',
          tone: 'uneasy',
          length: 'short',
          memories: [
            { id: 1, character: 'Mara', content: "Theo can't swim.", reason: 'The boat is his' },
          ],
          notes: 'Keep the storm offstage.',
        },
      },
    });

    expect(user).toContain(
      "Scene brief from the Director:\n- Mara hears the boat\n- She goes down to the dock\nTone: uneasy.\nStay consistent with:\n- Theo can't swim. (The boat is his)\nNotes: Keep the storm offstage.\nWrite 1 or 2 paragraphs.",
    );
    expect(user).not.toContain('Write as much as the moment needs');
    // An older brief may still carry a point of view; the Writer doesn't get it.
    expect(user).not.toContain('Point of view');
  });

  it('keeps the scene moving once the story has prose', () => {
    const continuing = build({
      turns: [prose('The lamp was lit.')],
      request: { action: 'continue' },
    });
    const opening = build({ turns: [], request: { action: 'continue' } });

    expect(continuing.user).toMatch(
      /Write as much as the moment needs, usually 2 to 4 paragraphs\. .*\nPick up right where the last passage stopped .*\nKeep the scene moving: don't reuse an action, gesture, image, or turn of phrase from earlier in the chapter .*\nDon't let characters repeat themselves: .*\nEnd where the moment naturally pauses, .*\nThe chapter so far is the story, not a model for the prose: .*$/,
    );
    expect(opening.user).not.toContain('Keep the scene moving');
  });

  it('drops the oldest turns when the story is over budget', () => {
    const { user, storyTruncated } = build({
      turns: [prose('A'.repeat(50)), prose('B'.repeat(50)), prose('C'.repeat(50))],
      storyCharacterBudget: 110,
    });

    expect(storyTruncated).toBe(true);
    expect(user).toContain('[Earlier parts of the chapter are omitted.]');
    expect(user).not.toContain('AAAA');
    expect(user).toContain(`${'B'.repeat(50)}\n\n${'C'.repeat(50)}`);
  });

  it("rewrites a greeting as the chapter's opening", () => {
    const { user } = build({
      request: {
        action: 'greeting',
        greeting: { name: 'Mara', content: 'Mara *looks up* as you come in. "Late again."' },
      },
    });

    expect(user).toContain('=== CHAPTER SO FAR ===\n(Nothing has been written yet.)');
    expect(user).toContain(
      [
        '=== NEXT ===',
        "Write the opening of this chapter by rewriting Mara's greeting below in the house style. It comes from a character card and isn't part of the story yet.",
        'Greeting:',
        'Mara looks up as you come in. "Late again."',
        'Keep its events, dialogue, and details.',
        'Where the greeting says "you", it means Theo: refer to Theo by name, in the house style\'s perspective.',
        "Where the greeting disagrees with the chapter's time or with what the characters know, follow the chapter.",
        'Write about as much as the greeting.',
      ].join('\n'),
    );
    expect(user).not.toMatch(/set the scene|Write 3 to 5 paragraphs|image marker/);
  });

  it("keeps a greeting's images as markers, at the chapter's time", () => {
    const imagePreserver = {
      preserve: (text, source) =>
        source === 'greeting' ? text.replace('![Mara](mara.webp)', '[WG_IMAGE_0]') : text,
    };

    const { user } = build({
      cast: [MARA],
      bureau: { houseStyle: '', timezone: 'UTC' },
      request: {
        action: 'greeting',
        greeting: { name: 'Mara', content: '![Mara](mara.webp)\n\nMara waves at you.' },
      },
      startTime: '2026-10-27T07:30:00.000Z',
      imagePreserver,
    });

    expect(user).toContain(
      [
        'Greeting:',
        '[WG_IMAGE_0]',
        '',
        'Mara waves at you.',
        'Keep its events, dialogue, and details.',
        'Keep each image marker, such as [WG_IMAGE_0], exactly as written and where it belongs.',
        `Where the greeting says "you", write in the house style's perspective without inventing a name.`,
        'This chapter begins at exactly 7:30 AM on Tuesday, October 27, 2026.',
      ].join('\n'),
    );
  });

  it('runs card, lore, and story text through the image preserver', () => {
    const sources = [];
    const imagePreserver = {
      preserve: (text, source) => {
        sources.push(source);
        return text;
      },
    };

    build({
      loreEntries: [{ content: 'Lore' }],
      turns: [prose('The lamp was lit.')],
      imagePreserver,
    });

    expect(new Set(sources)).toEqual(new Set(['cast', 'lore', 'story']));
  });
});
