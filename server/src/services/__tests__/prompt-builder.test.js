import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromptBuilder } from '../prompt-builder.js';
import { MacroProcessor } from '../macro-processor.js';

describe('PromptBuilder', () => {
  let builder;
  let macroProcessor;
  let characterCard;
  let persona;

  beforeEach(() => {
    builder = new PromptBuilder();
    macroProcessor = new MacroProcessor({
      userName: 'Alice',
      charName: 'Bob'
    });

    characterCard = {
      data: {
        name: 'Bob',
        description: 'A friendly character',
        personality: 'Kind and helpful',
        scenario: 'Meeting in a cafe',
        mes_example: '<START>\n{{user}}: Hello!\n{{char}}: Hi there!'
      }
    };

    persona = {
      name: 'Alice',
      description: 'A curious adventurer',
      writingStyle: 'Descriptive and poetic'
    };
  });

  describe('replacePlaceholders', () => {
    it('should replace {{user}} with persona name', () => {
      const result = builder.replacePlaceholders('Hello {{user}}!', characterCard, persona);
      expect(result).toBe('Hello Alice!');
    });

    it('should replace {{char}} with character name', () => {
      const result = builder.replacePlaceholders('{{char}} says hello', characterCard, persona);
      expect(result).toBe('Bob says hello');
    });

    it('should replace {{character}} with character name', () => {
      const result = builder.replacePlaceholders('{{character}} waves', characterCard, persona);
      expect(result).toBe('Bob waves');
    });

    it('should use default names when persona/character missing', () => {
      const result = builder.replacePlaceholders('{{user}} and {{char}}', null, null);
      expect(result).toBe('User and Character');
    });

    it('should be case-insensitive', () => {
      const result = builder.replacePlaceholders('{{USER}} and {{CHAR}}', characterCard, persona);
      expect(result).toBe('Alice and Bob');
    });

    it('should handle null text', () => {
      const result = builder.replacePlaceholders(null, characterCard, persona);
      expect(result).toBe(null);
    });
  });

  describe('filterAsterisks', () => {
    it('should remove asterisks when enabled', () => {
      const result = builder.filterAsterisks('*smiles* Hello *waves*', true);
      expect(result).toBe('smiles Hello waves');
    });

    it('should not remove asterisks when disabled', () => {
      const result = builder.filterAsterisks('*smiles* Hello *waves*', false);
      expect(result).toBe('*smiles* Hello *waves*');
    });

    it('should handle null text', () => {
      const result = builder.filterAsterisks(null, true);
      expect(result).toBe(null);
    });

    it('should handle empty string', () => {
      const result = builder.filterAsterisks('', true);
      expect(result).toBe('');
    });

    it('should remove all asterisks', () => {
      const result = builder.filterAsterisks('*****', true);
      expect(result).toBe('');
    });
  });

  describe('processContent', () => {
    it('should process placeholders, macros, and filter asterisks', () => {
      const text = '{{user}} *smiles* at {{char}}';
      const result = builder.processContent(text, characterCard, persona, macroProcessor);
      expect(result).toBe('Alice smiles at Bob');
    });

    it('should process macros', () => {
      const text = '{{random:hello,hi,hey}} {{user}}!';
      const result = builder.processContent(text, characterCard, persona, macroProcessor);
      expect(result).toMatch(/^(hello|hi|hey) Alice!$/);
    });

    it('should handle null text', () => {
      const result = builder.processContent(null, characterCard, persona, macroProcessor);
      expect(result).toBe(null);
    });
  });

  describe('buildSingleCharacterSection', () => {
    it('should build complete character profile', () => {
      const result = builder.buildSingleCharacterSection(characterCard, persona, macroProcessor);

      expect(result).toContain('=== CHARACTER PROFILE ===');
      expect(result).toContain('Name: Bob');
      expect(result).toContain('Description: A friendly character');
      expect(result).toContain('Personality: Kind and helpful');
      expect(result).toContain('Current Scenario: Meeting in a cafe');
      expect(result).toContain('=== DIALOGUE STYLE EXAMPLES ===');
    });

    it('should process placeholders in character data', () => {
      characterCard.data.description = 'Likes talking to {{user}}';
      const result = builder.buildSingleCharacterSection(characterCard, persona, macroProcessor);

      expect(result).toContain('Description: Likes talking to Alice');
    });

    it('should filter asterisks from character content', () => {
      characterCard.data.personality = '*friendly* and *kind*';
      const result = builder.buildSingleCharacterSection(characterCard, persona, macroProcessor);

      expect(result).toContain('Personality: friendly and kind');
    });

    it('should skip dialogue examples when disabled', () => {
      const result = builder.buildSingleCharacterSection(
        characterCard,
        persona,
        macroProcessor,
        { includeDialogueExamples: false }
      );

      expect(result).not.toContain('=== DIALOGUE STYLE EXAMPLES ===');
    });

    it('should handle missing character card gracefully', () => {
      const result = builder.buildSingleCharacterSection(null, persona, macroProcessor);
      expect(result).toBe('');
    });

    it('should handle character card with missing optional fields', () => {
      const minimalCard = {
        data: {
          name: 'Simple Character'
        }
      };
      const result = builder.buildSingleCharacterSection(minimalCard, persona, macroProcessor);

      expect(result).toContain('Name: Simple Character');
      expect(result).not.toContain('Description:');
      expect(result).not.toContain('Personality:');
    });
  });

  describe('buildMultipleCharactersSection', () => {
    it('should build profiles for multiple characters', () => {
      const cards = [
        {
          data: {
            name: 'Alice',
            description: 'First character',
            personality: 'Brave'
          }
        },
        {
          data: {
            name: 'Bob',
            description: 'Second character',
            personality: 'Clever'
          }
        }
      ];

      const result = builder.buildMultipleCharactersSection(cards, persona, macroProcessor);

      expect(result).toContain('=== CHARACTER PROFILES ===');
      expect(result).toContain('Character 1: Alice');
      expect(result).toContain('Character 2: Bob');
      expect(result).toContain('Description: First character');
      expect(result).toContain('Description: Second character');
    });

    it('should separate characters with dividers', () => {
      const cards = [
        { data: { name: 'Alice' } },
        { data: { name: 'Bob' } }
      ];

      const result = builder.buildMultipleCharactersSection(cards, persona, macroProcessor);
      expect(result).toContain('---');
    });

    it('should include scenario only for single character', () => {
      const singleCard = [{
        data: {
          name: 'Alice',
          scenario: 'In the forest'
        }
      }];

      const result = builder.buildMultipleCharactersSection(singleCard, persona, macroProcessor);
      expect(result).toContain('Scenario: In the forest');
    });

    it('should not include scenario for multiple characters', () => {
      const multipleCards = [
        { data: { name: 'Alice', scenario: 'Forest' } },
        { data: { name: 'Bob', scenario: 'City' } }
      ];

      const result = builder.buildMultipleCharactersSection(multipleCards, persona, macroProcessor);
      expect(result).not.toContain('Scenario:');
    });

    it('should return empty string for empty array', () => {
      const result = builder.buildMultipleCharactersSection([], persona, macroProcessor);
      expect(result).toBe('');
    });

    it('should return empty string for null', () => {
      const result = builder.buildMultipleCharactersSection(null, persona, macroProcessor);
      expect(result).toBe('');
    });
  });

  describe('buildLorebookSection', () => {
    it('should build lorebook entries', () => {
      const lorebooks = [
        {
          comment: 'Entry 1',
          content: 'The kingdom is vast'
        },
        {
          comment: 'Entry 2',
          content: 'Magic is common'
        }
      ];

      const result = builder.buildLorebookSection(lorebooks, macroProcessor);

      expect(result).toContain('=== WORLD INFORMATION ===');
      expect(result).toContain('The kingdom is vast');
      expect(result).toContain('Magic is common');
    });

    it('should process macros in lorebook content', () => {
      const lorebooks = [
        {
          content: '{{user}} lives in the city'
        }
      ];

      const result = builder.buildLorebookSection(lorebooks, macroProcessor);
      expect(result).toContain('Alice lives in the city');
    });

    it('should filter asterisks from lorebook content', () => {
      const lorebooks = [
        {
          content: 'The *ancient* sword'
        }
      ];

      const result = builder.buildLorebookSection(lorebooks, macroProcessor);
      expect(result).toContain('The ancient sword');
    });

    it('should show comments when showPrompt is enabled', () => {
      const lorebooks = [
        {
          comment: 'Test Entry',
          content: 'Content here'
        }
      ];

      const result = builder.buildLorebookSection(lorebooks, macroProcessor, { showPrompt: true });
      expect(result).toContain('<!-- Test Entry -->');
    });

    it('should not show comments when showPrompt is disabled', () => {
      const lorebooks = [
        {
          comment: 'Test Entry',
          content: 'Content here'
        }
      ];

      const result = builder.buildLorebookSection(lorebooks, macroProcessor, { showPrompt: false });
      expect(result).not.toContain('<!-- Test Entry -->');
    });

    it('should return empty string for empty array', () => {
      const result = builder.buildLorebookSection([], macroProcessor);
      expect(result).toBe('');
    });

    it('should return empty string for null', () => {
      const result = builder.buildLorebookSection(null, macroProcessor);
      expect(result).toBe('');
    });
  });

  describe('buildPersonaSection', () => {
    it('should build complete persona section', () => {
      const result = builder.buildPersonaSection(persona, characterCard, macroProcessor);

      expect(result).toContain('=== USER CHARACTER (PERSONA) ===');
      expect(result).toContain('Name: Alice');
      expect(result).toContain('Description: A curious adventurer');
      expect(result).toContain('Writing Style: Descriptive and poetic');
    });

    it('should process placeholders in persona', () => {
      persona.description = 'Friends with {{char}}';
      const result = builder.buildPersonaSection(persona, characterCard, macroProcessor);

      expect(result).toContain('Description: Friends with Bob');
    });

    it('should filter asterisks from persona content', () => {
      persona.description = '*brave* and *strong*';
      const result = builder.buildPersonaSection(persona, characterCard, macroProcessor);

      expect(result).toContain('Description: brave and strong');
    });

    it('should return empty string for null persona', () => {
      const result = builder.buildPersonaSection(null, characterCard, macroProcessor);
      expect(result).toBe('');
    });

    it('should return empty string for persona without name', () => {
      const result = builder.buildPersonaSection({}, characterCard, macroProcessor);
      expect(result).toBe('');
    });

    it('should handle persona with minimal data', () => {
      const minimalPersona = { name: 'User' };
      const result = builder.buildPersonaSection(minimalPersona, characterCard, macroProcessor);

      expect(result).toContain('Name: User');
      expect(result).not.toContain('Description:');
      expect(result).not.toContain('Writing Style:');
    });
  });

  describe('buildInstructionsSection', () => {
    it('should include narrative instructions', () => {
      const result = builder.buildInstructionsSection();

      expect(result).toContain('=== INSTRUCTIONS ===');
      expect(result).toContain('Write in a narrative, novel-style format');
      expect(result).toContain('Maintain consistency');
      expect(result).toContain('showing rather than telling');
    });
  });

  describe('buildPerspectiveSection', () => {
    it('should include perspective instructions', () => {
      const result = builder.buildPerspectiveSection();

      expect(result).toContain('=== PERSPECTIVE ===');
      expect(result).toContain('third-person past tense');
      expect(result).toContain('he/she/they pronouns');
      expect(result).toContain('Do NOT use first-person');
    });

    it('should include asterisk filtering instruction', () => {
      const result = builder.buildPerspectiveSection();
      expect(result).toContain('Do not use asterisks');
    });
  });

  describe('Configuration', () => {
    it('should allow custom section headers', () => {
      const customBuilder = new PromptBuilder({
        sectionHeaders: {
          characterProfile: '### CHARACTER ###'
        }
      });

      const result = customBuilder.buildSingleCharacterSection(characterCard, persona, macroProcessor);
      expect(result).toContain('### CHARACTER ###');
    });

    it('should allow disabling asterisk filtering globally', () => {
      const noFilterBuilder = new PromptBuilder({
        filterAsterisks: false
      });

      characterCard.data.description = '*friendly*';
      const result = noFilterBuilder.buildSingleCharacterSection(characterCard, persona, macroProcessor);
      expect(result).toContain('*friendly*');
    });

    it('should use custom instruction templates', () => {
      const customBuilder = new PromptBuilder({
        instructionTemplates: {
          continue: 'Custom continue instruction'
        }
      });

      expect(customBuilder.config.instructionTemplates.continue).toBe('Custom continue instruction');
    });
  });
});
