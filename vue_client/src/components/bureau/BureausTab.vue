<template>
  <div class="bureaus-tab">
    <div class="tab-header">
      <h2><i class="fas fa-landmark"></i> Bureaus</h2>
      <button class="btn btn-primary" @click="showCreate = true">
        <i class="fas fa-plus"></i> New Bureau
      </button>
    </div>

    <p class="tab-intro">
      <span class="experimental-badge">Experimental</span>
      A Bureau holds a cast and a connected series of stories. Each character keeps their own copy
      of their card, and each Bureau uses its own DeepSeek API key.
    </p>

    <div v-if="loading" class="loading">Loading Bureaus...</div>

    <div v-else-if="bureaus.length === 0" class="empty-state">
      <i class="fas fa-landmark"></i>
      <p>No Bureaus yet. Create one to start a series of connected stories.</p>
    </div>

    <div v-else class="bureau-grid">
      <button
        v-for="bureau in bureaus"
        :key="bureau.id"
        class="bureau-card"
        @click="openBureau(bureau)"
      >
        <h3>{{ bureau.name }}</h3>
        <p v-if="bureau.description" class="bureau-description">{{ bureau.description }}</p>
        <div class="bureau-meta">
          <span><i class="fas fa-users"></i> {{ bureau.castCount }} in the cast</span>
          <span v-if="!bureau.hasApiKey" class="needs-key">
            <i class="fas fa-key"></i> No API key
          </span>
        </div>
      </button>
    </div>

    <CreateBureauModal v-if="showCreate" @close="showCreate = false" @created="handleCreated" />
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import CreateBureauModal from './CreateBureauModal.vue';

const router = useRouter();
const toast = useToast();

const bureaus = ref([]);
const loading = ref(true);
const showCreate = ref(false);

async function loadBureaus() {
  loading.value = true;
  try {
    const data = await bureausAPI.list();
    bureaus.value = data.bureaus;
  } catch (error) {
    console.error('Failed to load Bureaus:', error);
    toast.error('Failed to load Bureaus: ' + error.message);
  } finally {
    loading.value = false;
  }
}

function openBureau(bureau) {
  router.push({ name: 'bureau', params: { bureauId: bureau.id } });
}

function handleCreated(bureau) {
  showCreate.value = false;
  openBureau(bureau);
}

onMounted(loadBureaus);
</script>

<style scoped src="./bureau-ui.css"></style>

<style scoped>
.tab-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.tab-header h2 {
  margin: 0;
  font-size: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.tab-intro {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0 0 1.5rem;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.bureau-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}

.bureau-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem 1.25rem;
  text-align: left;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: var(--shadow);
  transition: border-color 0.2s;
}

.bureau-card:hover,
.bureau-card:focus-visible {
  border-color: var(--accent-primary);
  outline: none;
}

.bureau-card h3 {
  margin: 0;
  font-size: 1.1rem;
  color: var(--primary-color);
}

.bureau-description {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.bureau-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  margin-top: auto;
  color: var(--text-secondary);
  font-size: 0.8rem;
}

.needs-key {
  color: var(--warning);
}
</style>
