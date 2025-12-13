import { describe, it, expect, beforeEach } from 'vitest';
import { TemplateEngine } from '../template-engine.js';

describe('TemplateEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new TemplateEngine();
  });

  describe('Variable Substitution', () => {
    it('should replace simple variables', () => {
      const template = 'Hello {{name}}!';
      const data = { name: 'Alice' };
      const result = engine.render(template, data);
      expect(result).toBe('Hello Alice!');
    });

    it('should handle nested object properties with dot notation', () => {
      const template = 'Hello {{user.name}}!';
      const data = { user: { name: 'Bob' } };
      const result = engine.render(template, data);
      expect(result).toBe('Hello Bob!');
    });

    it('should handle deep nesting', () => {
      const template = '{{a.b.c.d}}';
      const data = { a: { b: { c: { d: 'deep value' } } } };
      const result = engine.render(template, data);
      expect(result).toBe('deep value');
    });

    it('should replace multiple variables', () => {
      const template = '{{first}} {{last}}';
      const data = { first: 'John', last: 'Doe' };
      const result = engine.render(template, data);
      expect(result).toBe('John Doe');
    });

    it('should return empty string for undefined variables', () => {
      const template = 'Hello {{missing}}!';
      const data = {};
      const result = engine.render(template, data);
      expect(result).toBe('Hello !');
    });

    it('should return empty string for null variables', () => {
      const template = 'Value: {{value}}';
      const data = { value: null };
      const result = engine.render(template, data);
      expect(result).toBe('Value: ');
    });

    it('should handle numbers', () => {
      const template = 'Age: {{age}}';
      const data = { age: 42 };
      const result = engine.render(template, data);
      expect(result).toBe('Age: 42');
    });

    it('should handle booleans', () => {
      const template = 'Status: {{active}}';
      const data = { active: true };
      const result = engine.render(template, data);
      expect(result).toBe('Status: true');
    });

    it('should stringify objects', () => {
      const template = 'Data: {{obj}}';
      const data = { obj: { key: 'value' } };
      const result = engine.render(template, data);
      expect(result).toBe('Data: {"key":"value"}');
    });
  });

  describe('Conditional Blocks - if', () => {
    it('should render content when condition is truthy', () => {
      const template = '{{#if show}}Content{{/if}}';
      const data = { show: true };
      const result = engine.render(template, data);
      expect(result).toBe('Content');
    });

    it('should not render content when condition is falsy', () => {
      const template = '{{#if show}}Content{{/if}}';
      const data = { show: false };
      const result = engine.render(template, data);
      expect(result).toBe('');
    });

    it('should handle nested property conditions', () => {
      const template = '{{#if user.active}}Active{{/if}}';
      const data = { user: { active: true } };
      const result = engine.render(template, data);
      expect(result).toBe('Active');
    });

    it('should handle variables within if blocks', () => {
      const template = '{{#if show}}Hello {{name}}{{/if}}';
      const data = { show: true, name: 'Alice' };
      const result = engine.render(template, data);
      expect(result).toBe('Hello Alice');
    });

    it('should handle nested if blocks', () => {
      const template = '{{#if outer}}Outer {{#if inner}}Inner{{/if}}{{/if}}';
      const data = { outer: true, inner: true };
      const result = engine.render(template, data);
      expect(result).toBe('Outer Inner');
    });

    it('should treat empty arrays as falsy', () => {
      const template = '{{#if items}}Has items{{/if}}';
      const data = { items: [] };
      const result = engine.render(template, data);
      expect(result).toBe('');
    });

    it('should treat non-empty arrays as truthy', () => {
      const template = '{{#if items}}Has items{{/if}}';
      const data = { items: [1, 2, 3] };
      const result = engine.render(template, data);
      expect(result).toBe('Has items');
    });
  });

  describe('Conditional Blocks - unless', () => {
    it('should render content when condition is falsy', () => {
      const template = '{{#unless disabled}}Enabled{{/unless}}';
      const data = { disabled: false };
      const result = engine.render(template, data);
      expect(result).toBe('Enabled');
    });

    it('should not render content when condition is truthy', () => {
      const template = '{{#unless disabled}}Enabled{{/unless}}';
      const data = { disabled: true };
      const result = engine.render(template, data);
      expect(result).toBe('');
    });

    it('should handle nested properties', () => {
      const template = '{{#unless user.banned}}Welcome{{/unless}}';
      const data = { user: { banned: false } };
      const result = engine.render(template, data);
      expect(result).toBe('Welcome');
    });
  });

  describe('Each Blocks', () => {
    it('should iterate over arrays', () => {
      const template = '{{#each items}}{{name}} {{/each}}';
      const data = {
        items: [
          { name: 'Alice' },
          { name: 'Bob' },
          { name: 'Charlie' }
        ]
      };
      const result = engine.render(template, data);
      expect(result).toBe('Alice Bob Charlie ');
    });

    it('should provide @index variable', () => {
      const template = '{{#each items}}{{@index}}: {{name}} {{/each}}';
      const data = {
        items: [
          { name: 'Alice' },
          { name: 'Bob' }
        ]
      };
      const result = engine.render(template, data);
      expect(result).toBe('0: Alice 1: Bob ');
    });

    it('should provide @index_1 variable (1-based index)', () => {
      const template = '{{#each items}}{{@index_1}}. {{name}} {{/each}}';
      const data = {
        items: [
          { name: 'First' },
          { name: 'Second' }
        ]
      };
      const result = engine.render(template, data);
      expect(result).toBe('1. First 2. Second ');
    });

    it('should provide @first variable', () => {
      const template = '{{#each items}}{{@first}} {{/each}}';
      const data = {
        items: [
          { name: 'Alice' },
          { name: 'Bob' }
        ]
      };
      const result = engine.render(template, data);
      expect(result).toBe('true false ');
    });

    it('should provide @last variable', () => {
      const template = '{{#each items}}{{@last}} {{/each}}';
      const data = {
        items: [
          { name: 'Alice' },
          { name: 'Bob' },
          { name: 'Charlie' }
        ]
      };
      const result = engine.render(template, data);
      expect(result).toBe('false false true ');
    });

    it('should provide @length variable', () => {
      const template = '{{#each items}}{{@index_1}}/{{@length}} {{/each}}';
      const data = {
        items: [
          { name: 'Alice' },
          { name: 'Bob' },
          { name: 'Charlie' }
        ]
      };
      const result = engine.render(template, data);
      expect(result).toBe('1/3 2/3 3/3 ');
    });

    it('should handle empty arrays', () => {
      const template = '{{#each items}}{{name}}{{/each}}';
      const data = { items: [] };
      const result = engine.render(template, data);
      expect(result).toBe('');
    });

    it('should handle nested each blocks', () => {
      const template = '{{#each groups}}{{name}}: {{#each members}}{{name}} {{/each}}| {{/each}}';
      const data = {
        groups: [
          { name: 'A', members: [{ name: 'A1' }, { name: 'A2' }] },
          { name: 'B', members: [{ name: 'B1' }] }
        ]
      };
      const result = engine.render(template, data);
      expect(result).toBe('A: A1 A2 | B: B1 | ');
    });

    it('should handle nested path for array', () => {
      const template = '{{#each user.items}}{{name}} {{/each}}';
      const data = {
        user: {
          items: [
            { name: 'Item1' },
            { name: 'Item2' }
          ]
        }
      };
      const result = engine.render(template, data);
      expect(result).toBe('Item1 Item2 ');
    });

    it('should handle conditionals inside each blocks with item context', () => {
      // This test ensures {{#if}} inside {{#each}} uses item context, not root context
      const template = `{{#each characters}}
Character: {{name}}
{{#if description}}Description: {{description}}
{{/if}}{{#if personality}}Personality: {{personality}}
{{/if}}---
{{/each}}`;
      const data = {
        characters: [
          { name: 'Alice', description: 'A brave hero', personality: 'Bold' },
          { name: 'Bob', description: 'A wise sage' },
          { name: 'Charlie', personality: 'Mysterious' }
        ]
      };
      const result = engine.render(template, data);

      // All names should appear
      expect(result).toContain('Character: Alice');
      expect(result).toContain('Character: Bob');
      expect(result).toContain('Character: Charlie');

      // Descriptions should appear for items that have them
      expect(result).toContain('Description: A brave hero');
      expect(result).toContain('Description: A wise sage');

      // Personalities should appear for items that have them
      expect(result).toContain('Personality: Bold');
      expect(result).toContain('Personality: Mysterious');

      // Bob has no personality, Charlie has no description
      expect(result).not.toContain('Bob\nPersonality:');
      expect(result).not.toContain('Charlie\nDescription:');
    });

    it('should handle unless inside each blocks with item context', () => {
      const template = '{{#each items}}{{name}}{{#unless hidden}} (visible){{/unless}} {{/each}}';
      const data = {
        items: [
          { name: 'A', hidden: false },
          { name: 'B', hidden: true },
          { name: 'C' }
        ]
      };
      const result = engine.render(template, data);
      expect(result).toBe('A (visible) B C (visible) ');
    });
  });

  describe('Complex Templates', () => {
    it('should handle mixed conditionals and loops', () => {
      const template = `{{#if hasItems}}
Items:
{{#each items}}
- {{name}} ({{active}})
{{/each}}
{{/if}}`;
      const data = {
        hasItems: true,
        items: [
          { name: 'Item1', active: true },
          { name: 'Item2', active: false }
        ]
      };
      const result = engine.render(template, data);
      expect(result).toContain('Items:');
      expect(result).toContain('- Item1 (true)');
      expect(result).toContain('- Item2 (false)');
    });

    it('should handle variables, conditionals, and loops together', () => {
      const template = `Hello {{user.name}}!
{{#if user.premium}}You are a premium member.{{/if}}
{{#if user.items}}Your items:
{{#each user.items}}{{@index_1}}. {{title}}
{{/each}}{{/if}}`;
      const data = {
        user: {
          name: 'Alice',
          premium: true,
          items: [
            { title: 'First' },
            { title: 'Second' }
          ]
        }
      };
      const result = engine.render(template, data);
      expect(result).toContain('Hello Alice!');
      expect(result).toContain('You are a premium member.');
      expect(result).toContain('1. First');
      expect(result).toContain('2. Second');
    });
  });

  describe('Helper Functions', () => {
    it('should get nested values correctly', () => {
      const obj = { a: { b: { c: 'value' } } };
      const result = engine.getNestedValue('a.b.c', obj);
      expect(result).toBe('value');
    });

    it('should return undefined for missing paths', () => {
      const obj = { a: { b: 'value' } };
      const result = engine.getNestedValue('a.c.d', obj);
      expect(result).toBe(undefined);
    });

    it('should handle empty path', () => {
      const obj = { a: 'value' };
      const result = engine.getNestedValue('', obj);
      expect(result).toBe(undefined);
    });

    it('should evaluate truthy conditions', () => {
      expect(engine.evaluateCondition('value', { value: true })).toBe(true);
      expect(engine.evaluateCondition('value', { value: 'yes' })).toBe(true);
      expect(engine.evaluateCondition('value', { value: 1 })).toBe(true);
    });

    it('should evaluate falsy conditions', () => {
      expect(engine.evaluateCondition('value', { value: false })).toBe(false);
      expect(engine.evaluateCondition('value', { value: '' })).toBe(false);
      expect(engine.evaluateCondition('value', { value: 0 })).toBe(false);
      expect(engine.evaluateCondition('value', { value: null })).toBe(false);
    });

    it('should find matching closing tags', () => {
      const template = '{{#if a}}content{{/if}} more';
      const result = engine.findMatchingClose(template, '{{#if ', '{{/if}}', 9);
      expect(result).toBe(16); // Position of {{/if}}
    });

    it('should handle nested blocks when finding closing tags', () => {
      const template = '{{#if a}}{{#if b}}inner{{/if}} outer{{/if}}';
      const result = engine.findMatchingClose(template, '{{#if ', '{{/if}}', 9);
      expect(result).toBe(36); // Position of outer {{/if}}
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty template', () => {
      const result = engine.render('', { data: 'value' });
      expect(result).toBe('');
    });

    it('should handle template with no variables', () => {
      const result = engine.render('Just plain text', { data: 'value' });
      expect(result).toBe('Just plain text');
    });

    it('should clean up excessive newlines', () => {
      const template = 'Line 1\n\n\n\n\nLine 2';
      const result = engine.render(template, {});
      expect(result).toBe('Line 1\n\nLine 2');
    });

    it('should handle malformed blocks gracefully', () => {
      const template = '{{#if missing end';
      const result = engine.render(template, { missing: true });
      // Should not crash, return something reasonable
      expect(typeof result).toBe('string');
    });

    it('should prevent infinite loops with max iterations', () => {
      // This shouldn't hang - the engine has max iteration protection
      const template = '{{#if true}}{{#if true}}{{#if true}}content{{/if}}{{/if}}{{/if}}';
      const result = engine.render(template, {});
      expect(typeof result).toBe('string');
    });

    it('should handle special characters in variable names', () => {
      const template = '{{_special_var}}';
      const data = { _special_var: 'value' };
      const result = engine.render(template, data);
      expect(result).toBe('value');
    });

    it('should not process block tags inside variable substitutions', () => {
      const template = '{{variable}}';
      const data = { variable: '{{#if something}}' };
      const result = engine.render(template, data);
      expect(result).toBe('{{#if something}}');
    });
  });

  describe('Whitespace Handling', () => {
    it('should preserve whitespace in content', () => {
      const template = '  {{name}}  ';
      const data = { name: 'Alice' };
      const result = engine.render(template, data);
      expect(result).toBe('  Alice  ');
    });

    it('should handle variables with whitespace', () => {
      const template = '{{ name }}';
      const data = { name: 'Alice' };
      const result = engine.render(template, data);
      expect(result).toBe('Alice');
    });
  });
});
