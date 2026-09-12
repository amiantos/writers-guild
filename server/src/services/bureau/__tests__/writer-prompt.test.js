import { describe, it, expect } from 'vitest';
import { buildWriterMessages, DEFAULT_HOUSE_STYLE } from '../writer-prompt.js';

function member(name, fields = {}, { isPersona = false } = {}) {
  return {
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
