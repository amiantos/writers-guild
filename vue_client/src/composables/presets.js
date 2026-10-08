/**
 * The Presets section: the presets as a list grouped by provider, the default first. Plain
 * functions over the lists the API returns, like the home page's library (./library.js).
 */
import { getProviderInfo } from '../config/providerDefaults.js';

/** The model a preset writes with, briefly: "deepseek-v4-flash", "Mistral-7B +2". */
export function modelLabel({ provider, model, models = [] }) {
  if (model) return model;
  if (models.length) return models.length > 1 ? `${models[0]} +${models.length - 1}` : models[0];
  return provider === 'aihorde' ? 'Models picked automatically' : 'No model chosen';
}

/** How long and how freely it writes: "4,000 tokens · temperature 0.8". */
export function settingsLine({ maxTokens, temperature }) {
  return [
    maxTokens != null && `${maxTokens.toLocaleString()} tokens`,
    temperature != null && `temperature ${temperature}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
const hasDefault = (group) => group.items.some((item) => item.isDefault);

/**
 * The presets in groups by provider. The default preset's provider comes first and the default
 * leads it; the rest go by name.
 * @returns {Array<{provider: string, name: string, icon: string, items: Array}>}
 */
export function groupPresets({ presets = [], defaultPresetId = null, stories = [], chats = [] }) {
  const storyUses = countByPreset(stories);
  const chatUses = countByPreset(chats);

  const groups = new Map();
  for (const preset of presets) {
    const info = getProviderInfo(preset.provider);
    const group = groups.get(preset.provider) ?? {
      provider: preset.provider,
      name: info.name,
      icon: info.icon,
      items: [],
    };
    group.items.push({
      id: preset.id,
      name: preset.name || 'Untitled preset',
      provider: preset.provider,
      providerName: info.name,
      icon: info.icon,
      isDefault: preset.id === defaultPresetId,
      model: modelLabel(preset),
      settings: settingsLine(preset),
      storyCount: storyUses.get(preset.id) ?? 0,
      chatCount: chatUses.get(preset.id) ?? 0,
      source: preset,
    });
    groups.set(preset.provider, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: group.items.toSorted((a, b) => b.isDefault - a.isDefault || byName(a, b)),
    }))
    .toSorted((a, b) => hasDefault(b) - hasDefault(a) || byName(a, b));
}

/** How many of these stories or chats name each preset as their own. */
function countByPreset(list) {
  const counts = new Map();
  for (const { configPresetId } of list) {
    if (configPresetId) counts.set(configPresetId, (counts.get(configPresetId) ?? 0) + 1);
  }
  return counts;
}

/** "Used by 3 stories", "Used by 1 story and 2 chats", or "" when nothing names it. */
export function usageLine({ storyCount, chatCount }) {
  const parts = [];
  if (storyCount) parts.push(`${storyCount} ${storyCount === 1 ? 'story' : 'stories'}`);
  if (chatCount) parts.push(`${chatCount} ${chatCount === 1 ? 'chat' : 'chats'}`);
  return parts.length ? `Used by ${parts.join(' and ')}` : '';
}

/** The delete prompt, saying what goes back to the default preset. */
export function buildPresetDeleteMessage(item) {
  const lead = `Delete preset "${item.name}"?`;
  const used = usageLine(item);
  if (!used) return `${lead}\n\nThis cannot be undone.`;
  return `${lead}\n\n${used}, which will use the default preset instead.\n\nThis cannot be undone.`;
}
