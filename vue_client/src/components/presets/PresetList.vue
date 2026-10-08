<template>
  <div class="presets">
    <div v-if="loading" class="loading">Loading presets...</div>

    <div v-else-if="groups.length === 0" class="empty-state">
      <i class="fas fa-sliders"></i>
      <p>No presets yet. A preset picks the AI that writes with you, and how.</p>
      <button type="button" class="btn btn-primary" @click="$emit('create')">
        <i class="fas fa-plus"></i> New preset
      </button>
    </div>

    <section v-else class="shelf" aria-labelledby="presets-title">
      <div class="shelf-header">
        <h2 id="presets-title">
          <span class="shelf-name">Presets</span> <span class="shelf-count">{{ countLabel }}</span>
        </h2>
      </div>
      <p class="intro">
        A story uses the default preset unless you choose another for it in Edit Story.
      </p>

      <div v-for="group in groups" :key="group.provider" class="group">
        <h3 class="group-head">
          <span class="provider-icon"><i :class="['fas', group.icon]"></i></span>
          {{ group.name }}
          <span class="group-count">{{ group.items.length }}</span>
        </h3>
        <ul class="rows">
          <li
            v-for="item in group.items"
            :key="item.id"
            class="row"
            :class="{ 'is-default': item.isDefault }"
          >
            <button
              type="button"
              class="row-main"
              :aria-label="`Edit ${item.name}`"
              @click="$emit('edit', item.id)"
            >
              <span class="row-name">
                <span class="ellipsis">{{ item.name }}</span>
                <span v-if="item.isDefault" class="default-pill">
                  <i class="fas fa-star"></i> Default
                </span>
              </span>
              <span class="row-model ellipsis">{{ item.model }}</span>
              <span v-if="detailLine(item)" class="row-meta">{{ detailLine(item) }}</span>
            </button>
            <button
              type="button"
              class="row-icon row-star"
              :aria-pressed="item.isDefault"
              :aria-label="
                item.isDefault
                  ? `${item.name} is the default preset`
                  : `Make ${item.name} the default preset`
              "
              :title="item.isDefault ? 'The default preset' : 'Make this the default preset'"
              @click="item.isDefault || $emit('set-default', item.id)"
            >
              <i :class="item.isDefault ? 'fas fa-star' : 'far fa-star'"></i>
            </button>
            <button
              type="button"
              class="row-icon"
              :aria-label="`More actions for ${item.name}`"
              @click="menuId = item.id"
            >
              <i class="fas fa-ellipsis"></i>
            </button>
          </li>
        </ul>
      </div>

      <button type="button" class="new-row" @click="$emit('create')">
        <span class="new-row-icon"><i class="fas fa-plus"></i></span>
        <span class="new-row-text">
          <span class="new-row-title">New preset</span>
          <span class="new-row-sub">Pick a provider, then its model and settings</span>
        </span>
      </button>
    </section>

    <PresetSheet
      v-if="menuItem"
      :item="menuItem"
      @close="menuId = null"
      @edit="runAction('edit')"
      @set-default="runAction('set-default')"
      @duplicate="runAction('duplicate')"
      @delete="runAction('delete')"
    />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import PresetSheet from './PresetSheet.vue';
import { groupPresets, usageLine } from '../../composables/presets.js';

const props = defineProps({
  presets: { type: Array, default: () => [] },
  defaultPresetId: { type: String, default: null },
  stories: { type: Array, default: () => [] },
  chats: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
});

const emit = defineEmits(['edit', 'set-default', 'duplicate', 'delete', 'create']);

const menuId = ref(null);

const groups = computed(() =>
  groupPresets({
    presets: props.presets,
    defaultPresetId: props.defaultPresetId,
    stories: props.stories,
    chats: props.chats,
  }),
);

// Looked up by id, so the open sheet follows its preset through a reload
const menuItem = computed(
  () =>
    groups.value.flatMap((group) => group.items).find((item) => item.id === menuId.value) ?? null,
);

const countLabel = computed(() => {
  const n = props.presets.length;
  return `${n} ${n === 1 ? 'preset' : 'presets'}`;
});

function detailLine(item) {
  return [item.settings, usageLine(item)].filter(Boolean).join(' · ');
}

function runAction(action) {
  const item = menuItem.value;
  menuId.value = null;
  emit(action, action === 'delete' ? item : item.id);
}
</script>

<style scoped src="../library/shelf.css"></style>

<style scoped>
.presets {
  max-width: 880px;
}

.intro {
  margin: -0.25rem 0 0.5rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.group-head {
  margin: 0.75rem 0 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.9375rem;
  font-weight: 600;
}

.provider-icon {
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 8px;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.group-count {
  font-size: 0.8125rem;
  font-weight: 400;
  color: var(--text-secondary);
}

.rows {
  margin: 0;
  padding: 0;
  list-style: none;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-primary);
  overflow: hidden;
}

.row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 6px;
}

.row + .row {
  border-top: 1px solid var(--border-color);
}

.row.is-default {
  box-shadow: inset 3px 0 0 var(--accent-primary);
}

.row-main {
  flex: 1;
  min-width: 0;
  min-height: 72px;
  padding: 12px 8px 12px 16px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}

.row-main:hover .row-name > .ellipsis {
  color: var(--accent-primary);
}

.row-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 0.9375rem;
  font-weight: 600;
}

.default-pill {
  flex: none;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent-primary) 16%, transparent);
  color: var(--accent-primary);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.default-pill i {
  font-size: 0.65rem;
}

.row-model {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.8125rem;
  color: var(--text-primary);
}

.row-meta {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.ellipsis {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-icon {
  width: 44px;
  height: 44px;
  flex: none;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  font-size: 1rem;
}

.row-icon:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.row-star[aria-pressed='true'] {
  color: var(--accent-primary);
  cursor: default;
}

.row-star[aria-pressed='true']:hover {
  background: transparent;
}

.new-row {
  margin-top: 1rem;
  min-height: 64px;
  padding: 10px 16px;
  border: 2px dashed var(--border-color);
  border-radius: 12px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  display: flex;
  align-items: center;
  gap: 14px;
}

.new-row:hover {
  border-color: var(--accent-primary);
}

.new-row-icon {
  width: 40px;
  height: 40px;
  flex: none;
  border-radius: 50%;
  background: var(--bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.new-row-text {
  display: flex;
  flex-direction: column;
}

.new-row-title {
  font-size: 0.9375rem;
  font-weight: 600;
}

.new-row-sub {
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

/* The New button floats over the list on phones instead */
@media (max-width: 900px) {
  .new-row {
    display: none;
  }
}
</style>
