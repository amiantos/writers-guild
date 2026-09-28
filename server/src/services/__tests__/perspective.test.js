import { describe, it, expect } from 'vitest';
import { PromptBuilder } from '../prompt-builder.js';
import {
  describePerspective,
  modeTakesCharacter,
  renderPerspective,
} from '../../../../shared/perspective.js';

// The perspective text the default system prompt had before it became {{perspective}}
const LEGACY_PERSPECTIVE = `Write only in third-person past tense perspective.
Use he/she/they pronouns and past tense verbs (said, walked, thought, etc.).
Do NOT use first-person (I, me, my, we) or present tense.
All narrative and dialogue tags should be in past tense.
Aspects of character information, such as their profile or dialog style examples, may be in the incorrect tense. Ignore the tense, focus on the context.`;

const layla = { id: 'char-layla', data: { name: 'Layla', description: 'A pilot' } };
const sam = { id: 'char-sam', data: { name: 'Sam', description: 'A mechanic' } };

describe('renderPerspective', () => {
  it('renders the default exactly as the system prompt always had it', () => {
    expect(renderPerspective()).toBe(LEGACY_PERSPECTIVE);
    expect(renderPerspective({ mode: 'third', tense: 'past' })).toBe(LEGACY_PERSPECTIVE);
    expect(renderPerspective({ mode: 'bogus', tense: 'bogus' })).toBe(LEGACY_PERSPECTIVE);
  });

  it('switches every tense reference for present tense', () => {
    const text = renderPerspective({ mode: 'third', tense: 'present' });
    expect(text).toContain('third-person present tense perspective');
    expect(text).toContain('(says, walks, thinks, etc.)');
    expect(text).toContain('or past tense.');
    expect(text).toContain('dialogue tags should be in present tense');
  });

  it('names the narrator in first person, or falls back to the main character', () => {
    const text = renderPerspective({ mode: 'first', characterName: 'Layla' });
    expect(text).toContain('first-person past tense perspective, narrated by Layla.');
    expect(text).toContain('Use I/me/my for Layla');
    expect(renderPerspective({ mode: 'first' })).toContain(
      "narrated by the story's main character",
    );
  });

  it('addresses the Persona as "you" in second person', () => {
    const text = renderPerspective({ mode: 'second', personaName: 'Brad', characterName: 'Layla' });
    expect(text).toContain('addressing Brad as "you"');
    expect(text).not.toContain('Layla');
    expect(renderPerspective({ mode: 'second' })).toContain(`addressing the reader's character`);
  });

  it('describes each third-person variant', () => {
    expect(renderPerspective({ mode: 'third_limited', characterName: 'Sam' })).toContain(
      'staying close to Sam',
    );
    expect(renderPerspective({ mode: 'third_omniscient' })).toContain("every character's thoughts");
    expect(renderPerspective({ mode: 'third_objective' })).toContain(
      'Report only what can be seen and heard',
    );
  });
});

describe('describePerspective', () => {
  it('describes the default and a narrated story', () => {
    expect(describePerspective()).toBe('third person, past tense');
    expect(describePerspective({ mode: 'first', tense: 'present', characterName: 'Layla' })).toBe(
      'first person, present tense, narrated by Layla',
    );
  });

  it('knows which modes take a character', () => {
    expect(modeTakesCharacter('first')).toBe(true);
    expect(modeTakesCharacter('third_limited')).toBe(true);
    expect(modeTakesCharacter('second')).toBe(false);
    expect(modeTakesCharacter(null)).toBe(false);
  });
});

describe('PromptBuilder perspective', () => {
  const builder = new PromptBuilder();
  const persona = { name: 'Brad', description: '', writingStyle: '' };

  function systemFor(story, characterCards = [layla, sam]) {
    return builder.buildSystemPrompt({ story, characterCards, persona });
  }

  it("puts the default perspective in a story that hasn't set one", () => {
    expect(systemFor({ content: '' })).toContain(`=== PERSPECTIVE ===\n${LEGACY_PERSPECTIVE}\n`);
  });

  it('names a narrator who is one of the story characters', () => {
    const prompt = systemFor({ perspective: 'first', perspectiveCharacterId: 'char-sam' });
    expect(prompt).toContain('narrated by Sam.');
  });

  it('names the Persona as narrator', () => {
    const prompt = systemFor({
      perspective: 'first',
      perspectiveTense: 'present',
      personaCharacterId: 'char-brad',
      perspectiveCharacterId: 'char-brad',
    });
    expect(prompt).toContain('first-person present tense perspective, narrated by Brad.');
  });

  it("drops a narrator who's no longer in the story", () => {
    const prompt = systemFor({ perspective: 'first', perspectiveCharacterId: 'char-gone' });
    expect(prompt).toContain("narrated by the story's main character");
  });

  it('ignores a leftover character for a mode that takes none', () => {
    const prompt = systemFor({
      perspective: 'third_omniscient',
      perspectiveCharacterId: 'char-sam',
    });
    expect(prompt).not.toContain('Sam.');
    expect(
      builder.resolvePerspective({
        story: { perspective: 'third_omniscient', perspectiveCharacterId: 'char-sam' },
        characterCards: [sam],
      }).characterName,
    ).toBe('');
  });

  it('exposes the perspective to custom system prompts', () => {
    const prompt = builder.buildSystemPrompt(
      {
        story: { perspective: 'third_limited', perspectiveCharacterId: 'char-layla' },
        characterCards: [layla, sam],
        persona,
      },
      'Mode {{perspective_mode}}, {{perspective_tense}}, {{perspective_character}}.\n{{perspective}}',
    );
    expect(prompt).toContain('Mode third_limited, past, Layla.');
    expect(prompt).toContain('staying close to Layla');
  });

  it("gives the default rewrite template the story's perspective, not the story's text", () => {
    const { user } = builder.buildPrompts(
      {
        story: {
          perspective: 'first',
          perspectiveCharacterId: 'char-layla',
          content: 'Keep {{perspective}} as written.',
        },
        characterCards: [layla],
        persona,
      },
      { generationType: 'rewriteThirdPerson' },
    );
    expect(user).toContain('narrated by Layla.');
    expect(user).toContain('Keep {{perspective}} as written.');
  });
});
