import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromptBuilder } from '../prompt-builder.js';
import { MacroProcessor } from '../macro-processor.js';
import { ImagePreserver } from '../image-preserver.js';

describe('PromptBuilder', () => {
  let builder;
  let macroProcessor;
  let characterCard;
  let persona;

  beforeEach(() => {
    builder = new PromptBuilder();
    macroProcessor = new MacroProcessor({
      userName: 'Alice',
      charName: 'Bob',
    });

    characterCard = {
      data: {
        name: 'Bob',
        description: 'A friendly character',
        personality: 'Kind and helpful',
        scenario: 'Meeting in a cafe',
        mes_example: '<START>\n{{user}}: Hello!\n{{char}}: Hi there!',
      },
    };

    persona = {
      name: 'Alice',
      description: 'A curious adventurer',
      writingStyle: 'Descriptive and poetic',
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
      const result = builder.buildSingleCharacterSection(characterCard, persona, macroProcessor, {
        includeDialogueExamples: false,
      });

      expect(result).not.toContain('=== DIALOGUE STYLE EXAMPLES ===');
    });

    it('should handle missing character card gracefully', () => {
      const result = builder.buildSingleCharacterSection(null, persona, macroProcessor);
      expect(result).toBe('');
    });

    it('should handle character card with missing optional fields', () => {
      const minimalCard = {
        data: {
          name: 'Simple Character',
        },
      };
      const result = builder.buildSingleCharacterSection(minimalCard, persona, macroProcessor);

      expect(result).toContain('Name: Simple Character');
      expect(result).not.toContain('Description:');
      expect(result).not.toContain('Personality:');
    });

    it('should return empty for characterCard with null/undefined data', () => {
      expect(builder.buildSingleCharacterSection({ data: null }, persona, macroProcessor)).toBe('');
      expect(
        builder.buildSingleCharacterSection({ data: undefined }, persona, macroProcessor),
      ).toBe('');
      expect(builder.buildSingleCharacterSection({}, persona, macroProcessor)).toBe('');
    });
  });

  describe('buildMultipleCharactersSection', () => {
    it('should build profiles for multiple characters', () => {
      const cards = [
        {
          data: {
            name: 'Alice',
            description: 'First character',
            personality: 'Brave',
          },
        },
        {
          data: {
            name: 'Bob',
            description: 'Second character',
            personality: 'Clever',
          },
        },
      ];

      const result = builder.buildMultipleCharactersSection(cards, persona, macroProcessor);

      expect(result).toContain('=== CHARACTER PROFILES ===');
      expect(result).toContain('Character 1: Alice');
      expect(result).toContain('Character 2: Bob');
      expect(result).toContain('Description: First character');
      expect(result).toContain('Description: Second character');
    });

    it('should separate characters with dividers', () => {
      const cards = [{ data: { name: 'Alice' } }, { data: { name: 'Bob' } }];

      const result = builder.buildMultipleCharactersSection(cards, persona, macroProcessor);
      expect(result).toContain('---');
    });

    it('should include scenario only for single character', () => {
      const singleCard = [
        {
          data: {
            name: 'Alice',
            scenario: 'In the forest',
          },
        },
      ];

      const result = builder.buildMultipleCharactersSection(singleCard, persona, macroProcessor);
      expect(result).toContain('Scenario: In the forest');
    });

    it('should not include scenario for multiple characters', () => {
      const multipleCards = [
        { data: { name: 'Alice', scenario: 'Forest' } },
        { data: { name: 'Bob', scenario: 'City' } },
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
          content: 'The kingdom is vast',
        },
        {
          comment: 'Entry 2',
          content: 'Magic is common',
        },
      ];

      const result = builder.buildLorebookSection(lorebooks, macroProcessor);

      expect(result).toContain('=== WORLD INFORMATION ===');
      expect(result).toContain('The kingdom is vast');
      expect(result).toContain('Magic is common');
    });

    it('should process macros in lorebook content', () => {
      const lorebooks = [
        {
          content: '{{user}} lives in the city',
        },
      ];

      const result = builder.buildLorebookSection(lorebooks, macroProcessor);
      expect(result).toContain('Alice lives in the city');
    });

    it('should filter asterisks from lorebook content', () => {
      const lorebooks = [
        {
          content: 'The *ancient* sword',
        },
      ];

      const result = builder.buildLorebookSection(lorebooks, macroProcessor);
      expect(result).toContain('The ancient sword');
    });

    it('should show comments when showPrompt is enabled', () => {
      const lorebooks = [
        {
          comment: 'Test Entry',
          content: 'Content here',
        },
      ];

      const result = builder.buildLorebookSection(lorebooks, macroProcessor, { showPrompt: true });
      expect(result).toContain('<!-- Test Entry -->');
    });

    it('should not show comments when showPrompt is disabled', () => {
      const lorebooks = [
        {
          comment: 'Test Entry',
          content: 'Content here',
        },
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

  describe('buildSystemPrompt', () => {
    it('should build a system prompt with a single character', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).toContain('=== CHARACTER PROFILE ===');
      expect(result).toContain('Name: Bob');
      expect(result).toContain('Description: A friendly character');
      expect(result).toContain('Personality: Kind and helpful');
      expect(result).toContain('=== INSTRUCTIONS ===');
      expect(result).toContain('=== PERSPECTIVE ===');
      expect(result).toContain('=== DIALOGUE STYLE EXAMPLES ===');
      expect(result).toContain('=== USER CHARACTER (PERSONA) ===');
      expect(result).toContain('Name: Alice');
    });

    it('should process macros in character fields', () => {
      characterCard.data.description = "{{user}}'s friend";
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).toContain("Description: Alice's friend");
    });

    it('should filter asterisks from character content', () => {
      characterCard.data.personality = '*kind* and *brave*';
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).toContain('Personality: kind and brave');
      expect(result).not.toContain('*kind*');
    });

    it('should include story scenario when provided', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: { scenario: 'A dark forest at night' },
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).toContain('=== SCENARIO ===');
      expect(result).toContain('A dark forest at night');
    });

    it('should include lorebook entries', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [{ content: 'Magic is real and powerfu:q', comment: 'Magic' }],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).toContain('=== WORLD INFORMATION ===');
    });

    it('should handle multiple character cards', () => {
      const context = {
        persona,
        characterCards: [
          { data: { name: 'Alice', description: 'First character', personality: 'Brave' } },
          { data: { name: 'Bob', description: 'Second character', personality: 'Clever' } },
        ],
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).toContain('=== CHARACTER PROFILES ===');
      expect(result).toContain('Character 1: Alice');
      expect(result).toContain('Character 2: Bob');
      expect(result).not.toContain('=== CHARACTER PROFILE ===');
    });

    it('should handle no character cards', () => {
      const context = {
        persona,
        characterCards: [],
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).not.toContain('=== CHARACTER PROFILE ===');
      expect(result).not.toContain('=== CHARACTER PROFILES ===');
      expect(result).toContain('=== INSTRUCTIONS ===');
    });

    it('should handle null character cards', () => {
      const context = {
        persona,
        characterCards: null,
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).toContain('=== INSTRUCTIONS ===');
    });

    it('should handle single character with empty name', () => {
      const context = {
        persona,
        characterCards: [{ data: { name: '', description: 'No name char' } }],
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).toContain('Name: ');
      expect(result).toContain('Description: No name char');
    });

    it('should handle multiple characters with empty names', () => {
      const context = {
        persona,
        characterCards: [
          { data: { name: '', description: 'First' } },
          { data: { name: '', description: 'Second' } },
        ],
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).toContain('Character 1: ');
      expect(result).toContain('Character 2: ');
      expect(result).toContain('Description: First');
      expect(result).toContain('Description: Second');
    });

    it('should handle null activated lorebooks', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: null,
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).toContain('=== CHARACTER PROFILE ===');
      expect(result).not.toContain('=== WORLD INFORMATION ===');
    });

    it('should handle lorebook entries without comment', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [{ content: 'No comment entry' }],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).toContain('No comment entry');
      expect(result).toContain('=== WORLD INFORMATION ===');
    });

    it('should exclude dialogue examples when setting is false', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: {},
        settings: { includeDialogueExamples: false },
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).not.toContain('=== DIALOGUE STYLE EXAMPLES ===');
    });

    it('should use custom template when provided', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const customTemplate = 'Custom system: {{#if has_single_character}}{{character.name}}{{/if}}';
      const result = builder.buildSystemPrompt(context, customTemplate);
      expect(result).toContain('Custom system: Bob');
      expect(result).not.toContain('=== CHARACTER PROFILE ===');
    });

    it('should handle null persona gracefully', () => {
      const context = {
        persona: null,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).toContain('=== CHARACTER PROFILE ===');
      expect(result).toContain('Name: Bob');
      expect(result).not.toContain('=== USER CHARACTER (PERSONA) ===');
    });

    it('should handle persona without a name', () => {
      const context = {
        persona: { description: 'No name' },
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      expect(result).not.toContain('=== USER CHARACTER (PERSONA) ===');
    });

    it('should include character name in macro processor for single character', () => {
      const charCard = {
        data: {
          name: 'Dr. {{user}}',
          description: 'The {{char}} is here',
        },
      };

      const context = {
        persona: { name: 'Patient' },
        characterCards: [charCard],
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      // macro processor replaces {{char}} with 'Dr. Patient'
      expect(result).toContain('The Dr. Patient is here');
    });

    it('should process macros in lorebook content', () => {
      const context = {
        persona: { name: 'Hero' },
        characterCards: [characterCard],
        activatedLorebooks: [{ content: 'The {{user}} is the chosen one', comment: 'Prophecy' }],
        story: {},
        settings: {},
      };

      const result = builder.buildSystemPrompt(context);
      // lorebook entries don't get processContent (no placeholder replacement or asterisk filter via processContent),
      // but macros are processed via macroProcessor.process()
      expect(result).toContain('The Hero is the chosen one');
    });
  });

  describe('truncateStoryContent', () => {
    it('should return empty string for null/empty content', () => {
      expect(builder.truncateStoryContent(null, 1000)).toBe('');
      expect(builder.truncateStoryContent('', 1000)).toBe('');
    });

    it('should return empty string for whitespace-only content', () => {
      expect(builder.truncateStoryContent('   ', 1000)).toBe('');
    });

    it('should return content as-is when within limit', () => {
      const content = 'Short story content here.';
      const result = builder.truncateStoryContent(content, 1000);
      expect(result).toBe(
        'Here is the current story so far:\n\nShort story content here.\n\n---\n\n',
      );
    });

    it('should truncate content exceeding maxChars', () => {
      const content = 'A'.repeat(200);
      const result = builder.truncateStoryContent(content, 100);
      expect(result).toContain('...');
      expect(result).toContain('Here is the current story so far:');
      // Should only have 100 chars + '...' prefix
      const match = result.match(new RegExp('so far:\\n\\n(.+)\\n\\n---', 's'));
      expect(match).toBeTruthy();
      const extracted = match[1];
      expect(extracted.length).toBeLessThanOrEqual(103);
      expect(extracted.startsWith('...')).toBe(true);
      // Should be the last 100 chars of the original
      expect(extracted).toBe('...' + 'A'.repeat(100));
    });

    it('should throw error for invalid maxChars', () => {
      expect(() => builder.truncateStoryContent('content', 0)).toThrow(
        'maxChars must be provided and greater than 0',
      );
      expect(() => builder.truncateStoryContent('content', -1)).toThrow(
        'maxChars must be provided and greater than 0',
      );
      expect(() => builder.truncateStoryContent('content', null)).toThrow(
        'maxChars must be provided and greater than 0',
      );
    });
  });

  describe('buildGenerationPrompt', () => {
    it('should use default continue template', () => {
      const result = builder.buildGenerationPrompt('continue', {
        storyContent: '',
        characterName: '',
        customInstruction: '',
        templateText: null,
        maxChars: 1000,
        userName: 'User',
      });

      expect(result).toContain('Continue the story naturally');
      expect(result).not.toContain('{{storyContent}}');
    });

    it('should use character template', () => {
      const result = builder.buildGenerationPrompt('character', {
        storyContent: '',
        characterName: 'Alice',
        customInstruction: '',
        templateText: null,
        maxChars: 1000,
        userName: 'User',
      });

      expect(result).toContain('Alice');
      expect(result).toContain('Focus on their thoughts');
    });

    it('should use instruction template', () => {
      const result = builder.buildGenerationPrompt('instruction', {
        storyContent: '',
        characterName: '',
        customInstruction: 'Make it spooky',
        templateText: null,
        maxChars: 1000,
        userName: 'User',
      });

      expect(result).toContain('Make it spooky');
    });

    it('keeps $ patterns in an instruction or the text to rewrite as written', () => {
      const params = { characterName: '', maxChars: 1000, userName: 'User' };

      const instruction = builder.buildGenerationPrompt('instruction', {
        ...params,
        storyContent: '',
        customInstruction: "He owes her $$50, and $& and $' stay put",
      });
      const rewrite = builder.buildGenerationPrompt('rewriteThirdPerson', {
        ...params,
        storyContent: "You pay $$5, then $' and $& too.",
      });

      expect(instruction).toMatch(/occur: He owes her \$\$50, and \$& and \$' stay put$/);
      expect(rewrite).toMatch(/Text to rewrite:\n\nYou pay \$\$5, then \$' and \$& too\.$/);
    });

    it('should use rewriteThirdPerson template', () => {
      const result = builder.buildGenerationPrompt('rewriteThirdPerson', {
        storyContent: '',
        characterName: '',
        customInstruction: '',
        templateText: null,
        maxChars: 1000,
        userName: 'User',
      });

      expect(result).toContain('Rewrite the following text');
      expect(result).toContain('third person narrative');
    });

    it('should use ideate template', () => {
      const result = builder.buildGenerationPrompt('ideate', {
        storyContent: '',
        characterName: '',
        customInstruction: '',
        templateText: null,
        maxChars: 1000,
        userName: 'User',
      });

      expect(result).toContain('creative suggestions');
    });

    it('should use storyStarter template', () => {
      const result = builder.buildGenerationPrompt('storyStarter', {
        storyContent: '',
        characterName: '',
        customInstruction: '',
        templateText: null,
        maxChars: 1000,
        userName: 'User',
      });

      expect(result).toContain('opening 3-5 paragraphs');
    });

    it('should use custom template for custom type', () => {
      const result = builder.buildGenerationPrompt('custom', {
        storyContent: '',
        characterName: '',
        customInstruction: '',
        templateText: null,
        maxChars: 1000,
        userName: 'User',
      });

      expect(result).toBe('Continue the story.');
    });

    it('should use custom template as fallback for unknown type', () => {
      const result = builder.buildGenerationPrompt('unknown_type', {
        storyContent: '',
        characterName: '',
        customInstruction: '',
        templateText: null,
        maxChars: 1000,
        userName: 'User',
      });

      expect(result).toBe('Continue the story.');
    });

    it('should use custom templateText when provided', () => {
      const result = builder.buildGenerationPrompt('continue', {
        storyContent: 'Story content here.',
        characterName: 'Bob',
        customInstruction: 'Do something fun',
        templateText: 'Write about {{charName}}: {{instruction}} -- {{storyContent}} -- {{user}}',
        maxChars: 1000,
        userName: 'Player',
      });

      expect(result).toContain('Write about Bob: Do something fun --');
      expect(result).toContain('Story content here.');
      expect(result).toContain('-- Player');
    });

    it('should include story context separately when template lacks {{storyContent}}', () => {
      const result = builder.buildGenerationPrompt('continue', {
        storyContent: 'Once upon a time...',
        characterName: '',
        customInstruction: '',
        templateText: 'Write a story', // no {{storyContent}} placeholder
        maxChars: 1000,
        userName: 'User',
      });

      expect(result).toContain('Here is the current story so far:');
      expect(result).toContain('Once upon a time...');
      // The instruction should also be present
      expect(result).toContain('Write a story');
    });

    it('should preserve images with ImagePreserver', () => {
      const imagePreserver = new ImagePreserver();
      const result = builder.buildGenerationPrompt('continue', {
        storyContent: 'Text with ![img](photo.png) inside.',
        characterName: '',
        customInstruction: '',
        templateText: 'Story: {{storyContent}}',
        maxChars: 1000,
        userName: 'User',
        imagePreserver,
      });

      expect(result).toContain('[WG_IMAGE_0]');
      expect(result).not.toContain('![img](photo.png)');
    });

    it('should append image preservation note for whole-text rewrites', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const imagePreserver = new ImagePreserver();

      const result = builder.buildGenerationPrompt('rewriteThirdPerson', {
        storyContent: '![img](photo.png)',
        characterName: '',
        customInstruction: '',
        templateText: 'Story: {{storyContent}}',
        maxChars: 1000,
        userName: 'User',
        imagePreserver,
      });

      expect(result).toContain('[WG_IMAGE_0]');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[ImagePreserver] Appended image-preservation note for rewriteThirdPerson',
        ),
      );
      consoleSpy.mockRestore();
    });

    it('should not tell generative types to preserve markers', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const imagePreserver = new ImagePreserver();

      const result = builder.buildGenerationPrompt('continue', {
        storyContent: '![img](photo.png)',
        characterName: '',
        customInstruction: '',
        templateText: 'Story: {{storyContent}}',
        maxChars: 1000,
        userName: 'User',
        imagePreserver,
      });

      // Images are still hidden behind placeholders...
      expect(result).toContain('[WG_IMAGE_0]');
      // ...but a continuation returns new text, so instructing it to reproduce
      // the markers would invite images it was never asked for.
      expect(result).not.toContain('IMPORTANT: Preserve any markers');
      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Appended image-preservation note'),
      );
      consoleSpy.mockRestore();
    });

    it('should not append image note when no images saved', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const imagePreserver = new ImagePreserver();

      builder.buildGenerationPrompt('continue', {
        storyContent: 'Plain text without images.',
        characterName: '',
        customInstruction: '',
        templateText: 'Story: {{storyContent}}',
        maxChars: 1000,
        userName: 'User',
        imagePreserver,
      });

      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should replace {{user}} placeholder with user name', () => {
      const result = builder.buildGenerationPrompt('continue', {
        storyContent: '',
        characterName: '',
        customInstruction: '',
        templateText: 'Hello {{user}}!',
        maxChars: 1000,
        userName: 'Adventurer',
      });

      expect(result).toContain('Hello Adventurer!');
    });

    it('should fall back to "the user" when userName not provided (custom template)', () => {
      const result = builder.buildGenerationPrompt('continue', {
        storyContent: '',
        characterName: '',
        customInstruction: '',
        templateText: 'Greetings {{user}}!',
        maxChars: 1000,
        // intentionally no userName
      });

      expect(result).toContain('Greetings the user!');
    });

    it('should fall back to "the user" when userName not provided (default template)', () => {
      const result = builder.buildGenerationPrompt('ideate', {
        storyContent: '',
        characterName: '',
        customInstruction: '',
        templateText: null,
        maxChars: 1000,
        // intentionally no userName
      });

      // ideate template contains {{user}}
      expect(result).toContain('the user');
    });

    it('should preserve images in story context when custom templateText lacks {{storyContent}}', () => {
      const imagePreserver = new ImagePreserver();
      const result = builder.buildGenerationPrompt('continue', {
        storyContent: 'Story with ![img](photo.png) inside.',
        characterName: '',
        customInstruction: '',
        templateText: 'Custom instruction without story placeholder',
        maxChars: 1000,
        userName: 'User',
        imagePreserver,
      });

      expect(result).toContain('[WG_IMAGE_0]');
      expect(result).not.toContain('![img](photo.png)');
      expect(result).toContain('Custom instruction without story placeholder');
      expect(result).toContain('Here is the current story so far:');
    });

    it('should include truncated story context when templateText lacks {{storyContent}} and story is long', () => {
      const longContent = 'A'.repeat(500);
      const result = builder.buildGenerationPrompt('continue', {
        storyContent: longContent,
        characterName: '',
        customInstruction: '',
        templateText: 'Short template',
        maxChars: 100,
        userName: 'User',
      });

      // Should have truncated story (with ... prefix) plus the instruction
      expect(result).toContain('...');
      expect(result).toContain('Short template');
    });

    it('should not add story context when storyContent is empty', () => {
      const result = builder.buildGenerationPrompt('continue', {
        storyContent: '',
        characterName: '',
        customInstruction: '',
        templateText: 'Just the instruction',
        maxChars: 1000,
        userName: 'User',
      });

      expect(result).toBe('Just the instruction');
    });

    it('should add story context with default template and story content (no imagePreserver)', () => {
      const result = builder.buildGenerationPrompt('continue', {
        storyContent: 'Some story text here.',
        characterName: '',
        customInstruction: '',
        templateText: null,
        maxChars: 1000,
        userName: 'User',
      });

      // Default continue template has no {{storyContent}}, so story context is added separately
      expect(result).toContain('Here is the current story so far:');
      expect(result).toContain('Some story text here.');
      expect(result).toContain('Continue the story naturally');
    });

    it('should add story context with custom template lacking {{storyContent}} and no imagePreserver', () => {
      const result = builder.buildGenerationPrompt('continue', {
        storyContent: 'Custom template story.',
        characterName: '',
        customInstruction: '',
        templateText: 'Custom: no placeholder here',
        maxChars: 1000,
        userName: 'User',
      });

      expect(result).toContain('Here is the current story so far:');
      expect(result).toContain('Custom template story.');
      expect(result).toContain('Custom: no placeholder here');
    });

    it('should not add story context when defaultTemplate has {{storyContent}}', () => {
      // rewriteThirdPerson template contains {{storyContent}}
      const result = builder.buildGenerationPrompt('rewriteThirdPerson', {
        storyContent: 'Some text to rewrite',
        characterName: '',
        customInstruction: '',
        templateText: null,
        maxChars: 1000,
        userName: 'User',
      });

      // The story content should be embedded directly, no separate story context
      expect(result).toContain('Some text to rewrite');
      expect(result).not.toContain('Here is the current story so far:');
    });
  });

  describe('estimateTokens', () => {
    it('should return 0 for null/undefined text', () => {
      expect(builder.estimateTokens(null)).toBe(0);
      expect(builder.estimateTokens(undefined)).toBe(0);
    });

    it('should return 0 for empty string', () => {
      expect(builder.estimateTokens('')).toBe(0);
    });

    it('should estimate tokens based on character count', () => {
      // ~3 chars per token
      expect(builder.estimateTokens('Hello world')).toBe(4); // 11 chars / 3 = 3.67 -> 4
      expect(builder.estimateTokens('A')).toBe(1); // 1 / 3 = 0.33 -> 1
      expect(builder.estimateTokens('ABC')).toBe(1); // 3 / 3 = 1
      expect(builder.estimateTokens('ABCD')).toBe(2); // 4 / 3 = 1.33 -> 2
    });

    it('should estimate longer text', () => {
      const text = 'This is a longer piece of text that should produce many tokens.';
      const expected = Math.ceil(text.length / 3);
      expect(builder.estimateTokens(text)).toBe(expected);
    });
  });

  describe('buildPrompts', () => {
    it('should build system and user prompts', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: { content: 'The story begins.' },
        settings: {},
      };

      const result = builder.buildPrompts(context, {
        generationType: 'continue',
        userName: 'Alice',
      });

      expect(result).toHaveProperty('system');
      expect(result).toHaveProperty('user');
      expect(result.system).toContain('=== CHARACTER PROFILE ===');
      expect(result.user).toContain('Continue the story naturally');
    });

    it('should use custom system prompt template', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: { content: 'Story content.' },
        settings: {},
      };

      const result = builder.buildPrompts(context, {
        generationType: 'continue',
        systemPromptTemplate: 'Custom system: {{character.name}}',
        userName: 'Alice',
      });

      expect(result.system).toContain('Custom system: Bob');
      expect(result.system).not.toContain('=== CHARACTER PROFILE ===');
    });

    it('should pass generation parameters through', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: { content: 'Some story content here.' },
        settings: {},
      };

      const result = builder.buildPrompts(context, {
        generationType: 'character',
        characterName: 'Bob',
        customInstruction: 'Make it dramatic',
        userName: 'Alice',
      });

      expect(result.user).toContain('Bob');
      expect(result.user).toContain('Focus on their thoughts');
    });

    it('should handle image preserver in prompts', () => {
      const imagePreserver = new ImagePreserver();
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: { content: 'Story with ![img](photo.png) inside.' },
        settings: {},
      };

      const result = builder.buildPrompts(context, {
        generationType: 'continue',
        userName: 'Alice',
        imagePreserver,
      });

      expect(result.user).toContain('[WG_IMAGE_0]');
      expect(result.user).not.toContain('![img](photo.png)');
    });

    it('should handle null systemPromptTemplate', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: { content: 'Story.' },
        settings: {},
      };

      // Explicitly passing null should use default template
      const result = builder.buildPrompts(context, {
        generationType: 'continue',
        systemPromptTemplate: null,
        userName: 'Alice',
      });

      expect(result.system).toContain('=== CHARACTER PROFILE ===');
    });

    it('should handle missing story content', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        story: {},
        settings: {},
      };

      const result = builder.buildPrompts(context, {
        generationType: 'continue',
        userName: 'Alice',
      });

      expect(result.system).toBeTruthy();
      expect(result.user).toBeTruthy();
    });

    it('should handle context without story object', () => {
      const context = {
        persona,
        characterCards: [characterCard],
        activatedLorebooks: [],
        settings: {},
      };

      const result = builder.buildPrompts(context, {
        generationType: 'continue',
        userName: 'Alice',
      });

      expect(result.system).toContain('=== CHARACTER PROFILE ===');
      expect(result.user).toBeTruthy();
    });
  });

  describe('Configuration', () => {
    it('should allow custom section headers', () => {
      const customBuilder = new PromptBuilder({
        sectionHeaders: {
          characterProfile: '### CHARACTER ###',
        },
      });

      const result = customBuilder.buildSingleCharacterSection(
        characterCard,
        persona,
        macroProcessor,
      );
      expect(result).toContain('### CHARACTER ###');
    });

    it('should allow disabling asterisk filtering globally', () => {
      const noFilterBuilder = new PromptBuilder({
        filterAsterisks: false,
      });

      characterCard.data.description = '*friendly*';
      const result = noFilterBuilder.buildSingleCharacterSection(
        characterCard,
        persona,
        macroProcessor,
      );
      expect(result).toContain('*friendly*');
    });

    it('should use custom instruction templates', () => {
      const customBuilder = new PromptBuilder({
        instructionTemplates: {
          continue: 'Custom continue instruction',
        },
      });

      expect(customBuilder.config.instructionTemplates.continue).toBe(
        'Custom continue instruction',
      );
    });
  });
});
