<template>
  <div class="facts">
    <h3 class="subsection-title">Established facts</h3>
    <p class="help-text">
      What's true in this Bureau, such as who lives where and with whom. Every agent keeps to these
      facts, and they win over what a character remembers. When a chapter or messages change one,
      the Archivist proposes the change here.
    </p>

    <form class="add-fact" @submit.prevent="add">
      <textarea
        v-model="draft"
        class="textarea-input"
        rows="2"
        placeholder="Something that's true, such as who lives where"
        aria-label="New fact"
        @keydown.meta.enter.prevent="add"
        @keydown.ctrl.enter.prevent="add"
      ></textarea>
      <div class="add-row">
        <button type="submit" class="btn btn-primary btn-small" :disabled="!draft.trim() || adding">
          <i class="fas fa-plus"></i> {{ adding ? 'Adding...' : 'Add fact' }}
        </button>
      </div>
    </form>

    <div v-if="loading" class="loading">Loading facts...</div>
    <template v-else>
      <p v-if="shown.length === 0" class="empty-hint">No facts yet.</p>
      <ul v-else class="fact-list">
        <FactItem
          v-for="fact in shown"
          :key="fact.id"
          :fact="fact"
          :bureau-id="bureauId"
          :busy="busyId === fact.id"
          @update="update"
          @remove="remove"
        />
      </ul>
      <button
        v-if="history.length > 0"
        class="btn btn-secondary btn-small history-toggle"
        @click="showHistory = !showHistory"
      >
        {{ showHistory ? 'Hide' : 'Show' }} {{ history.length }} replaced or rejected
      </button>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import FactItem from './FactItem.vue';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import { useConfirm } from '../../composables/useConfirm';

const props = defineProps({
  bureauId: { type: String, required: true },
});

const toast = useToast();
const { confirm } = useConfirm();

const facts = ref([]);
const loading = ref(true);
const draft = ref('');
const adding = ref(false);
const busyId = ref(null);
const showHistory = ref(false);

const isReplaced = (fact) => fact.status === 'accepted' && fact.replacedBy !== null;

// Replaced and rejected facts shape nothing, so they wait behind a toggle.
const history = computed(() =>
  facts.value.filter((fact) => fact.status === 'rejected' || isReplaced(fact)),
);

// Proposals first, newest first; then the facts that stand, in the order they were established.
const shown = computed(() => [
  ...facts.value.filter((fact) => fact.status === 'proposed').toReversed(),
  ...facts.value.filter((fact) => fact.status === 'accepted' && !isReplaced(fact)),
  ...(showHistory.value ? history.value : []),
]);

async function load() {
  const data = await bureausAPI.listFacts(props.bureauId);
  facts.value = data.facts;
}

async function add() {
  const content = draft.value.trim();
  if (!content || adding.value) return;
  adding.value = true;
  try {
    await bureausAPI.addFact(props.bureauId, content);
    draft.value = '';
    await load();
  } catch (error) {
    toast.error('Failed to add the fact: ' + error.message);
  } finally {
    adding.value = false;
  }
}

async function update(fact, updates) {
  busyId.value = fact.id;
  try {
    await bureausAPI.updateFact(props.bureauId, fact.id, updates);
    await load();
  } catch (error) {
    toast.error('Failed to update the fact: ' + error.message);
  } finally {
    busyId.value = null;
  }
}

async function remove(fact) {
  const confirmed = await confirm({
    message:
      fact.sourceType === 'manual'
        ? 'Delete this fact for good?'
        : 'Delete this fact for good?\n\nIf it replaced an older fact, the older one stands again. To keep a record of it without using it, reject it instead.',
    confirmText: 'Delete',
    variant: 'danger',
  });
  if (!confirmed) return;

  busyId.value = fact.id;
  try {
    await bureausAPI.removeFact(props.bureauId, fact.id);
    await load();
  } catch (error) {
    toast.error('Failed to delete the fact: ' + error.message);
  } finally {
    busyId.value = null;
  }
}

onMounted(async () => {
  try {
    await load();
  } catch (error) {
    toast.error('Failed to load facts: ' + error.message);
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.facts {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.subsection-title {
  margin: 0;
  font-size: 1rem;
}

.add-fact {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.add-row {
  display: flex;
  justify-content: flex-end;
}

.fact-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.history-toggle {
  align-self: flex-start;
}
</style>
