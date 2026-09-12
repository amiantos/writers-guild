<template>
  <div class="bureau-page">
    <header class="detail-header">
      <div class="header-left">
        <button class="btn btn-secondary btn-small" @click="goHome">
          <i class="fas fa-arrow-left"></i> Back
        </button>
        <h1 class="page-title">{{ bureau?.name || 'Bureau' }}</h1>
        <span class="experimental-badge">Experimental</span>
      </div>
    </header>

    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>Loading Bureau...</p>
    </div>

    <div v-else-if="loadError" class="loading-container">
      <p>{{ loadError }}</p>
      <button class="btn btn-secondary" @click="goHome">Back to Writers Guild</button>
    </div>

    <div v-else class="detail-content">
      <div class="sections-container">
        <div v-if="!bureau.hasApiKey" class="notice">
          <i class="fas fa-key"></i>
          Add a DeepSeek API key in Settings below to generate stories.
        </div>

        <BureauStoriesSection :bureau="bureau" :cast="cast" @open="openStory" />
        <BureauMessagesSection :bureau="bureau" :cast="cast" @open="openThread" />
        <BureauCastSection
          :bureau-id="bureauId"
          :cast="cast"
          :memory-counts="memoryCounts"
          :arc-note-counts="arcNoteCounts"
          :has-api-key="bureau.hasApiKey"
          @changed="loadCast"
          @lorebook-attached="worldVersion++"
        />
        <BureauWorldSection :key="worldVersion" :bureau-id="bureauId" />
        <BureauSettingsSection :bureau="bureau" @updated="handleUpdated" @deleted="goHome" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { bureausAPI } from '../../services/bureauApi';
import { useToast } from '../../composables/useToast';
import { setPageTitle } from '../../router';
import BureauStoriesSection from '../../components/bureau/BureauStoriesSection.vue';
import BureauMessagesSection from '../../components/bureau/BureauMessagesSection.vue';
import BureauCastSection from '../../components/bureau/BureauCastSection.vue';
import BureauWorldSection from '../../components/bureau/BureauWorldSection.vue';
import BureauSettingsSection from '../../components/bureau/BureauSettingsSection.vue';

const props = defineProps({
  bureauId: { type: String, required: true },
});

const router = useRouter();
const toast = useToast();

const bureau = ref(null);
const cast = ref([]);
const memoryCounts = ref({});
const arcNoteCounts = ref({});
const loading = ref(true);
const loadError = ref('');
const worldVersion = ref(0);

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const [bureauData, castData] = await Promise.all([
      bureausAPI.get(props.bureauId),
      bureausAPI.listCast(props.bureauId),
    ]);
    bureau.value = bureauData.bureau;
    cast.value = castData.cast;
    memoryCounts.value = castData.memoryCounts ?? {};
    arcNoteCounts.value = castData.arcNoteCounts ?? {};
    setPageTitle(bureau.value.name);
  } catch (error) {
    console.error('Failed to load Bureau:', error);
    loadError.value =
      error.status === 404 ? 'This Bureau no longer exists.' : `Failed to load: ${error.message}`;
  } finally {
    loading.value = false;
  }
}

async function loadCast() {
  try {
    const [bureauData, castData] = await Promise.all([
      bureausAPI.get(props.bureauId),
      bureausAPI.listCast(props.bureauId),
    ]);
    bureau.value = bureauData.bureau;
    cast.value = castData.cast;
    memoryCounts.value = castData.memoryCounts ?? {};
    arcNoteCounts.value = castData.arcNoteCounts ?? {};
  } catch (error) {
    toast.error('Failed to refresh the cast: ' + error.message);
  }
}

function handleUpdated(updated) {
  bureau.value = updated;
  setPageTitle(updated.name);
}

function openStory(story) {
  router.push({
    name: 'bureau-story',
    params: { bureauId: props.bureauId, storyId: story.id },
  });
}

function openThread(member) {
  router.push({
    name: 'bureau-thread',
    params: { bureauId: props.bureauId, castId: member.id },
  });
}

function goHome() {
  router.push('/');
}

onMounted(load);
</script>

<style scoped src="../../components/bureau/bureau-ui.css"></style>

<style scoped>
.bureau-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background-color: var(--bg-primary);
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background-color: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 0;
}

.page-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--primary-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 1rem;
  color: var(--text-secondary);
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
}

.sections-container {
  max-width: 860px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

@media (max-width: 600px) {
  .detail-header {
    padding: 0.75rem 1rem;
  }

  .detail-content {
    padding: 1rem;
  }
}
</style>
