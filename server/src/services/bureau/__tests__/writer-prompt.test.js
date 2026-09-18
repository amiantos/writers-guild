import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../../prompt-builder.js';
import { buildWriterMessages, generationTypeFor, MAX_CONTEXT_TOKENS } from '../writer-prompt.js';

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
const IVO = member('Ivo', { description: 'The harbormaster.', personality: 'Gruff.' });
const THEO = member(
  'Theo',
  { description: 'A visiting cartographer.', personality: 'Careful.' },
  { isPersona: true },
);

function build(overrides = {}) {
  const result = buildWriterMessages({
    bureau: { timezone: 'UTC' },
    cast: [MARA, THEO],
    turns: [],
    request: { action: 'continue' },
    ...overrides,
  });
  return { ...result, system: result.messages[0].content, user: result.messages[1].content };
}

/** What story mode sends for the same story, from its own PromptBuilder. */
function storyMode({ characterCards, content, scenario = '', generationType, options = {} }) {
  return new PromptBuilder().buildPrompts(
    {
      persona: { name: 'Theo', description: 'A visiting cartographer.', writingStyle: 'Careful.' },
      characterCards,
      activatedLorebooks: [],
      story: { content, scenario },
      settings: { includeDialogueExamples: false },
    },
    { generationType, maxContextTokens: MAX_CONTEXT_TOKENS, maxGenerationTokens: 8000, ...options },
  );
}

describe('generationTypeFor', () => {
  it('uses the template of the story mode button that does the same thing', () => {
    expect(generationTypeFor('continue', true)).toBe('continue');
    expect(generationTypeFor('write', true)).toBe('continue');
    expect(generationTypeFor('direct', true)).toBe('instruction');
    expect(generationTypeFor('direct', false)).toBe('storyStarter');
    expect(generationTypeFor('character', true)).toBe('character');
    expect(generationTypeFor('greeting', false)).toBe('rewriteThirdPerson');
    expect(generationTypeFor('continue', false)).toBe('storyStarter');
  });
});

describe('buildWriterMessages', () => {
  it('sends a system message and a user message', () => {
    const { messages } = build();

    expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
  });

  describe("matches story mode's prompts when Bureau has nothing to add", () => {
    const turns = [prose('The lamp was lit.'), prose('Theo climbed the stairs.', 'user')];
    const content = 'The lamp was lit.\n\nTheo climbed the stairs.';

    it('for Continue and Write', () => {
      const expected = storyMode({
        characterCards: [MARA.seedCard],
        content,
        generationType: 'continue',
      });

      for (const action of ['continue', 'write']) {
        const { system, user, generationType } = build({ turns, request: { action } });
        expect(generationType).toBe('continue');
        expect(system).toBe(expected.system);
        expect(user).toBe(expected.user);
      }
      expect(expected.user).toContain('Here is the current story so far:');
      expect(expected.user).toContain('Write the next 7 paragraphs');
    });

    it('for Direct, as Continue with Instruction', () => {
      const expected = storyMode({
        characterCards: [MARA.seedCard],
        content,
        generationType: 'instruction',
        options: { customInstruction: 'Make it rain' },
      });

      const { system, user } = build({
        turns: [...turns, { kind: 'direction', source: 'user', content: 'Make it rain' }],
        request: { action: 'direct', direction: 'Make it rain' },
      });
      expect(system).toBe(expected.system);
      expect(user).toBe(expected.user);
      expect(user).toContain(
        'these instructions for what events they would like to see occur: Make it rain',
      );
    });

    it("with the chapter's scenario, as the story scenario", () => {
      const scenario = 'A storm has cut the power to the lighthouse.';
      const expected = storyMode({
        characterCards: [MARA.seedCard],
        content,
        scenario,
        generationType: 'continue',
      });

      const { system, user } = build({ turns, scenario });
      expect(system).toBe(expected.system);
      expect(user).toBe(expected.user);
      expect(system).toMatch(
        /^You are a creative writing assistant helping to write a novel-style story\.\n\n=== SCENARIO ===\nA storm has cut the power to the lighthouse\.\n\n=== CHARACTER PROFILE ===/,
      );
    });

    it('for Continue for Character', () => {
      const expected = storyMode({
        characterCards: [MARA.seedCard],
        content,
        generationType: 'character',
        options: { characterName: 'Mara' },
      });

      const { system, user } = build({
        turns,
        request: { action: 'character', character: { castId: 'mara', name: 'Mara' } },
      });
      expect(system).toBe(expected.system);
      expect(user).toBe(expected.user);
      expect(user).toContain("Write the next part of the story from Mara's perspective.");
    });

    it('for an empty chapter, as Start Story', () => {
      const expected = storyMode({
        characterCards: [MARA.seedCard],
        content: '',
        generationType: 'storyStarter',
      });

      const { system, user } = build();
      expect(system).toBe(expected.system);
      expect(user).toBe(expected.user);
      expect(user).toMatch(/^Write the opening 3-5 paragraphs for a new story\./);
    });

    it("for a greeting's rewrite, as the third-person rewrite", () => {
      const greeting = 'Mara looks up as you come in. "Late again."';
      const expected = storyMode({
        characterCards: [MARA.seedCard],
        content: greeting,
        generationType: 'rewriteThirdPerson',
      });

      const { system, user } = build({
        request: { action: 'greeting', greeting: { name: 'Mara', content: greeting } },
      });
      expect(system).toBe(expected.system);
      expect(user).toBe(expected.user);
      expect(user).toMatch(/^Rewrite the following text to be in third person/);
    });
  });

  it('opens an empty chapter with a direction as Start Story, carrying the direction', () => {
    const { user, generationType } = build({
      turns: [{ kind: 'direction', source: 'user', content: 'They meet at the night market' }],
      request: { action: 'direct', direction: 'They meet at the night market' },
    });

    expect(generationType).toBe('storyStarter');
    expect(user).toMatch(
      /^Write the opening 3-5 paragraphs for a new story\. .* End at a natural point that invites continuation\. The user additionally sends along these instructions for what events they would like to see occur: They meet at the night market$/,
    );
  });

  it("fills in names in the chapter's scenario, as in card text", () => {
    const { system } = build({ scenario: '{{user}} has *finally* come back to {{char}}.' });

    expect(system).toContain('=== SCENARIO ===\nTheo has finally come back to Mara.\n');
    expect(build().system).not.toContain('=== SCENARIO ===');
  });

  it("leaves out a lone character's scenario, which is where their card's story starts", () => {
    const withScenario = member('Mara', {
      description: 'Keeps the lighthouse.',
      scenario: '{{user}} meets {{char}} for the first time.',
    });

    const { system } = build({ cast: [withScenario, THEO] });

    expect(system).toContain(
      '=== CHARACTER PROFILE ===\nName: Mara\nDescription: Keeps the lighthouse.\n',
    );
    expect(system).not.toMatch(/Scenario|first time/);
  });

  it("describes the reader's character as story mode describes a persona", () => {
    const { system } = build();

    expect(system).toContain(
      '=== CHARACTER PROFILE ===\nName: Mara\nDescription: Mara keeps the Greywater lighthouse and trusts Theo.\nPersonality: Wry and stubborn.\n',
    );
    expect(system).toContain(
      '=== USER CHARACTER (PERSONA) ===\nName: Theo\nDescription: A visiting cartographer.\nWriting Style: Careful.',
    );
  });

  it('keeps every card when writing for one character', () => {
    const { system, user } = build({
      cast: [MARA, IVO, THEO],
      turns: [prose('The lamp was lit.')],
      request: { action: 'character', character: { castId: 'ivo', name: 'Ivo' } },
    });

    expect(system).toContain('=== CHARACTER PROFILES ===');
    expect(system).toContain('Character 1: Mara');
    expect(system).toContain('Character 2: Ivo');
    expect(user).toContain("Write the next part of the story from Ivo's perspective.");
  });

  it("still describes anyone else marked as a reader's character", () => {
    const ines = member('Ines', { description: 'A second traveler.' }, { isPersona: true });

    const { system } = build({ cast: [MARA, THEO, ines] });

    expect(system).toContain('Name: Theo');
    expect(system).toContain('Character 2: Ines\nDescription: A second traveler.');
  });

  it('includes activated lorebook entries, and the setting year, as world information', () => {
    const { system } = build({
      settingYear: '1996',
      loreEntries: [{ content: 'The lighthouse went dark in *1971*.' }],
    });

    expect(system).toContain(
      '=== WORLD INFORMATION ===\nThe year is 1996.\n\nThe lighthouse went dark in 1971.',
    );
    expect(build().system).not.toContain('The year is');
  });

  it("puts what Bureau adds before story mode's instructions", () => {
    const { system } = build({
      bureau: { timezone: 'UTC' },
      startTime: '2026-10-27T22:15:00.000Z',
      facts: [{ content: "{{user}} and Mara live in the *keeper's* cottage." }],
      arcNotesByCast: new Map([
        ['mara', [{ content: 'Mara lets Theo take the *oars* now.' }]],
        ['theo', []],
      ]),
      memoriesByCast: new Map([
        ['mara', { knowledge: [{ content: "Theo can't swim." }], episodes: [] }],
      ]),
    });

    const order = [
      '=== USER CHARACTER (PERSONA) ===',
      '=== ESTABLISHED FACTS ===',
      '=== CHARACTER DEVELOPMENT ===',
      '=== MEMORIES ===',
      '=== TIME ===',
      '=== INSTRUCTIONS ===',
      '=== PERSPECTIVE ===',
    ].map((header) => system.indexOf(header));
    expect(order.every((at) => at !== -1)).toBe(true);
    expect(order.toSorted((a, b) => a - b)).toEqual(order);

    expect(system).toContain(
      "=== ESTABLISHED FACTS ===\nTrue in this story unless the chapter itself shows one changing.\n- Theo and Mara live in the keeper's cottage.",
    );
    expect(system).toContain(
      '=== CHARACTER DEVELOPMENT ===\nHow Mara has changed:\n- Mara lets Theo take the oars now.\n\n',
    );
    expect(system).not.toContain('How Theo has changed');
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
            offscreen: { content: 'Repainted the *boathouse*.' },
          },
        ],
        ['theo', { knowledge: [{ content: 'Mara keeps the light.' }], episodes: [] }],
      ]),
    });

    expect(system).toContain(
      "=== MEMORIES ===\nWhat the characters remember from before this chapter, as background for how they act. People seldom talk about the past, so bring it up only when the moment calls for it, and never recite it. When a memory disagrees with a character's profile or an established fact, the profile or fact is right.\n\nMara knows:\n- Theo can't swim.\n- Theo hates boats.\n\nMara remembers:\n- Story 1: They met at the pier.\n- In messages: Theo texted about the storm.\n\nMara lately: Repainted the boathouse.",
    );
    // The reader's character remembers too.
    expect(system).toContain(
      'Mara lately: Repainted the boathouse.\n\nTheo knows:\n- Mara keeps the light.',
    );
  });

  it('leaves out sections with nothing in them', () => {
    const { system } = build({
      memoriesByCast: new Map([['mara', { knowledge: [], episodes: [] }]]),
    });

    expect(system).not.toMatch(/MEMORIES|ESTABLISHED FACTS|CHARACTER DEVELOPMENT|=== TIME ===/);
  });

  describe('time', () => {
    const bureau = { timezone: 'UTC' };
    const startTime = '2026-10-27T22:15:00.000Z';

    it('gives an opening the exact time the chapter begins', () => {
      const { system } = build({
        bureau: { timezone: 'America/Los_Angeles' },
        startTime: '2026-10-27T07:30:00.000Z',
      });

      expect(system).toContain(
        '=== TIME ===\nThis chapter begins at exactly 12:30 AM on Tuesday, October 27, 2026.\nLet the time shape the scene without dwelling on the clock, and if anyone mentions the time, keep it consistent with this.\n\n=== INSTRUCTIONS ===',
      );
    });

    it('gives every later passage the exact time the chapter began', () => {
      const { system } = build({ bureau, startTime, turns: [prose('The lamp was lit.')] });

      expect(system).toContain(
        'When the chapter began, the time was exactly 10:15 PM on Tuesday, October 27, 2026.\nLet the time shape the scene without dwelling on the clock, and if anyone mentions the time, keep it consistent with this and with how much has happened since.',
      );
      expect(build({ bureau, turns: [prose('The lamp was lit.')] }).system).not.toContain(
        '=== TIME ===',
      );
    });

    it('marks time passing in the chapter and goes by the last time it passed to', () => {
      const turns = [
        prose('The lamp was lit.'),
        timePasses('2026-10-28T08:00:00.000Z'),
        prose('Morning came grey.'),
        timePasses('2026-10-31T08:00:00.000Z'),
      ];

      const justPassed = build({ bureau, startTime, turns });
      expect(justPassed.user).toContain(
        "Here is the current story so far:\n\nThe lamp was lit.\n\n---\n\n[Time passes. It's now exactly 8:00 AM on Wednesday, October 28, 2026.]\n\nMorning came grey.\n\n---\n\n[Time passes. It's now exactly 8:00 AM on Saturday, October 31, 2026.]\n\n---\n\n",
      );
      expect(justPassed.system).toContain(
        "Time has just passed: it's now exactly 8:00 AM on Saturday, October 31, 2026. Pick the story up at this time.",
      );

      const afterward = build({ bureau, startTime, turns: [...turns, prose('Rain again.')] });
      expect(afterward.system).toContain(
        'When time last passed in the chapter, it was exactly 8:00 AM on Saturday, October 31, 2026.',
      );
    });
  });

  it('keeps directions out of the story text', () => {
    const { user, storySection } = build({
      turns: [
        prose('The lamp was lit.'),
        { kind: 'direction', source: 'user', content: 'An old direction' },
        { kind: 'scene_break', source: 'user', content: '' },
        prose('Morning came.'),
        { kind: 'direction', source: 'user', content: 'She suggests the night market' },
      ],
      request: { action: 'direct', direction: 'She suggests the night market' },
    });

    expect(storySection).toBe('The lamp was lit.\n\n---\n\nMorning came.');
    expect(user).not.toContain('An old direction');
    expect(user).toMatch(/see occur: She suggests the night market$/);
  });

  it('drops the oldest turns when the story is over budget, marked as story mode marks it', () => {
    const { user, storySection, storyTruncated } = build({
      turns: [prose('A'.repeat(50)), prose('B'.repeat(50)), prose('C'.repeat(50))],
      storyCharacterBudget: 110,
    });

    expect(storyTruncated).toBe(true);
    expect(storySection).toBe(`...${'B'.repeat(50)}\n\n${'C'.repeat(50)}`);
    expect(user).toContain(`Here is the current story so far:\n\n${storySection}\n\n---\n\n`);
    expect(user).not.toContain('AAAA');
  });

  it('keeps the whole story when it fits the context', () => {
    const turns = [prose('A'.repeat(50)), prose('B'.repeat(50))];

    expect(build({ turns }).storyTruncated).toBe(false);
    // A smaller reservation for the Writer's own text leaves more room for the story.
    expect(build({ turns, maxTokens: 256 }).storyTruncated).toBe(false);
  });

  it("keeps a greeting's images as markers, and asks the rewrite to keep them", () => {
    const imagePreserver = {
      saved: [],
      preserve(text, source) {
        if (source !== 'greeting') return text;
        this.saved.push({ source });
        return text.replace('![Mara](mara.webp)', '[WG_IMAGE_0]');
      },
    };

    const { user, storySection } = build({
      cast: [MARA],
      request: {
        action: 'greeting',
        greeting: { name: 'Mara', content: '![Mara](mara.webp)\n\nMara *waves* at you.' },
      },
      imagePreserver,
    });

    expect(storySection).toBe('[WG_IMAGE_0]\n\nMara waves at you.');
    expect(user).toContain('Text to rewrite:\n\n[WG_IMAGE_0]\n\nMara waves at you.');
    expect(user).toContain('IMPORTANT: Preserve any markers like [WG_IMAGE_0]');
  });

  it('runs card, lore, and story text through the image preserver', () => {
    const preserved = [];
    const imagePreserver = {
      saved: [],
      preserve: (text, source = 'context') => {
        preserved.push({ text, source });
        return text;
      },
    };

    build({
      loreEntries: [{ content: 'Lore' }],
      turns: [prose('The lamp was lit.')],
      imagePreserver,
    });

    const sources = (text) =>
      preserved.filter((entry) => entry.text.includes(text)).map((entry) => entry.source);
    expect(sources('Wry and stubborn.')).toContain('context');
    expect(sources('Lore')).toContain('context');
    expect(sources('The lamp was lit.')[0]).toBe('story');
  });
});
