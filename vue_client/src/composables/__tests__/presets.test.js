import { describe, it, expect } from 'vitest';
import {
  buildPresetDeleteMessage,
  groupPresets,
  modelLabel,
  settingsLine,
  usageLine,
} from '../presets.js';

const PRESETS = [
  {
    id: 'p1',
    name: 'Quick Draft',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    maxTokens: 4000,
    temperature: 1,
  },
  {
    id: 'p2',
    name: 'Careful Prose',
    provider: 'anthropic',
    model: 'claude-sonnet',
    maxTokens: 2000,
  },
  { id: 'p3', name: 'Another Draft', provider: 'deepseek', model: 'deepseek-v4-pro' },
  { id: 'p4', name: 'Free', provider: 'aihorde', models: [] },
];

const STORIES = [{ configPresetId: 'p2' }, { configPresetId: 'p2' }, { configPresetId: null }];
const CHATS = [{ configPresetId: 'p2' }];

describe('groupPresets', () => {
  it('puts the default preset’s provider first and the default at its head', () => {
    const groups = groupPresets({ presets: PRESETS, defaultPresetId: 'p1' });
    expect(groups.map((g) => g.name)).toEqual(['DeepSeek', 'AI Horde', 'Anthropic']);
    expect(groups[0].items.map((i) => i.name)).toEqual(['Quick Draft', 'Another Draft']);
    expect(groups[0].items[0].isDefault).toBe(true);
  });

  it('counts the stories and chats that choose each preset', () => {
    const groups = groupPresets({ presets: PRESETS, stories: STORIES, chats: CHATS });
    const careful = groups.flatMap((g) => g.items).find((i) => i.id === 'p2');
    expect(careful).toMatchObject({ storyCount: 2, chatCount: 1 });
    expect(usageLine(careful)).toBe('Used by 2 stories and 1 chat');
  });
});

describe('modelLabel', () => {
  it('names the model, or says how one is chosen', () => {
    expect(modelLabel(PRESETS[0])).toBe('deepseek-v4-flash');
    expect(modelLabel({ provider: 'aihorde', models: ['Mistral-7B', 'Llama', 'Qwen'] })).toBe(
      'Mistral-7B +2',
    );
    expect(modelLabel(PRESETS[3])).toBe('Models picked automatically');
    expect(modelLabel({ provider: 'ollama' })).toBe('No model chosen');
  });
});

describe('settingsLine', () => {
  it('gives the length and temperature it has', () => {
    expect(settingsLine(PRESETS[0])).toBe('4,000 tokens · temperature 1');
    expect(settingsLine(PRESETS[1])).toBe('2,000 tokens');
    expect(settingsLine({})).toBe('');
  });
});

describe('buildPresetDeleteMessage', () => {
  it('says what goes back to the default', () => {
    expect(buildPresetDeleteMessage({ name: 'Careful', storyCount: 1, chatCount: 0 })).toContain(
      'Used by 1 story, which will use the default preset instead.',
    );
    expect(buildPresetDeleteMessage({ name: 'Free', storyCount: 0, chatCount: 0 })).toBe(
      'Delete preset "Free"?\n\nThis cannot be undone.',
    );
  });
});
