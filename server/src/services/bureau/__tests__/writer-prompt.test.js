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
      settingYear: 1996,
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
        ['theo', { knowledge: [{ content: 'The reader remembers this.' }], episodes: [] }],
      ]),
    });

    expect(system).toContain(
      "=== MEMORIES ===\nWhat the characters remember from before this story, as background for how they act. People seldom talk about the past, so bring it up only when the moment calls for it, and never recite it.\n\nMara knows:\n- Theo can't swim.\n- Theo hates boats.\n\nMara remembers:\n- Story 1: They met at the pier.\n- In messages: Theo texted about the storm.",
    );
    expect(system).not.toContain('The reader remembers this.');
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

  it('leaves out the memories section when no one remembers anything', () => {
    const { system } = build({
      memoriesByCast: new Map([['mara', { knowledge: [], episodes: [] }]]),
    });

    expect(system).not.toContain('MEMORIES');
  });

  it('writes an opening, set at the story start time, when nothing has been written', () => {
    const { user } = build({ openingTime: 'a Tuesday, a little past midnight, late October' });

    expect(user).toContain('(Nothing has been written yet.)');
    expect(user).toContain('Write the opening of this story');
    expect(user).toContain('The story begins on a Tuesday, a little past midnight, late October.');
  });

  it('keeps the start time until the story has generated prose', () => {
    const openingTime = 'a Tuesday, late evening, late October';

    const afterUserOpening = build({ turns: [prose('Theo knocked.', 'user')], openingTime });
    expect(afterUserOpening.user).toContain(openingTime);

    const later = build({ turns: [prose('The lamp was lit.')], openingTime });
    expect(later.user).not.toContain(openingTime);
  });

  it('tells the Writer to respond to the reader without writing for them', () => {
    const { user } = build({
      turns: [prose('The lamp was lit.'), prose('Theo climbed the stairs.', 'user')],
      request: { action: 'write' },
    });

    expect(user).toContain('=== STORY SO FAR ===\nThe lamp was lit.\n\nTheo climbed the stairs.');
    expect(user).toContain("leave Theo's next words and choices to Theo");
    expect(user).toContain(
      "write yours in the house style's perspective and refer to Theo by name",
    );
  });

  it('writes for a reader with no character in the story without inventing a name', () => {
    const { user } = build({
      cast: [MARA],
      turns: [prose('The lamp was lit.'), prose('I opened the door.', 'user')],
      request: { action: 'write' },
    });

    expect(user).toContain("Continue the story from the reader's latest passage");
    expect(user).not.toContain('User');
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

    expect(user).toContain('=== STORY SO FAR ===\nThe lamp was lit.\n\n---\n\nMorning came.');
    expect(user).not.toContain('An old direction');
    expect(user).toContain('The author wants this to happen next: She suggests the night market');
  });

  it('centers the passage on a chosen cast member', () => {
    const { user } = build({
      turns: [prose('The lamp was lit.')],
      request: { action: 'continue', leadName: 'Mara' },
    });

    expect(user).toContain('Center this passage on Mara');
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
      "Scene brief from the Director:\n- Mara hears the boat\n- She goes down to the dock\nPoint of view: Mara, narrated in the house style's person and tense. Tone: uneasy.\nStay consistent with:\n- Theo can't swim. (The boat is his)\nNotes: Keep the storm offstage.\nWrite 1 to 3 paragraphs.",
    );
    expect(user).not.toContain('Write the next 3 to 6 paragraphs');
  });

  it('drops the oldest turns when the story is over budget', () => {
    const { user, storyTruncated } = build({
      turns: [prose('A'.repeat(50)), prose('B'.repeat(50)), prose('C'.repeat(50))],
      storyCharacterBudget: 110,
    });

    expect(storyTruncated).toBe(true);
    expect(user).toContain('[Earlier parts of the story are omitted.]');
    expect(user).not.toContain('AAAA');
    expect(user).toContain(`${'B'.repeat(50)}\n\n${'C'.repeat(50)}`);
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
