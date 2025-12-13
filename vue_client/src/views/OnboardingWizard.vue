<template>
  <div class="onboarding-container">
    <div class="onboarding-card">
      <!-- Progress indicator -->
      <div class="progress-bar">
        <div
          class="progress-fill"
          :style="{ width: `${(currentStep / totalSteps) * 100}%` }"
        ></div>
      </div>

      <!-- Step 1: Welcome -->
      <div v-if="currentStep === 1" class="step">
        <div class="step-icon">
          <i class="fas fa-book-open"></i>
        </div>
        <h1>Welcome to Writers Guild</h1>
        <p class="description">
          Writers Guild is an AI-powered creative writing application that helps you
          craft immersive stories with rich characters and dynamic worlds.
        </p>
        <ul class="feature-list">
          <li><i class="fas fa-users"></i> Create and manage character cards with detailed personalities</li>
          <li><i class="fas fa-book"></i> Build interactive lorebooks for rich world-building</li>
          <li><i class="fas fa-magic"></i> Generate story content with various AI providers</li>
          <li><i class="fas fa-edit"></i> Write collaborative fiction with AI assistance</li>
        </ul>
        <p class="description">
          Let's get you set up in just a few steps.
        </p>
        <div class="button-group">
          <button class="btn btn-secondary" @click="skipOnboarding">Skip Setup</button>
          <button class="btn btn-primary" @click="nextStep">Get Started</button>
        </div>
      </div>

      <!-- Step 2: Create Persona -->
      <div v-if="currentStep === 2" class="step">
        <div class="step-icon">
          <i class="fas fa-user-circle"></i>
        </div>
        <h1>Create Your Persona</h1>
        <p class="description">
          Your persona represents you in the stories you write. It helps the AI understand
          your role in the narrative.
        </p>
        <div class="form-group">
          <label for="firstName">What's your first name?</label>
          <input
            id="firstName"
            v-model="persona.firstName"
            type="text"
            placeholder="Enter your first name"
            @keyup.enter="nextStep"
          />
        </div>
        <div class="form-group">
          <label for="description">How would you describe yourself? (optional)</label>
          <textarea
            id="description"
            v-model="persona.description"
            placeholder="e.g., A curious adventurer with a love for mystery and ancient lore..."
            rows="3"
          ></textarea>
          <p class="help-text">
            This helps the AI write you into stories more naturally.
          </p>
        </div>
        <div class="button-group">
          <button class="btn btn-secondary" @click="prevStep">Back</button>
          <button
            class="btn btn-primary"
            :disabled="!persona.firstName.trim()"
            @click="createPersona"
          >
            Continue
          </button>
        </div>
      </div>

      <!-- Step 3: AI Provider Setup -->
      <div v-if="currentStep === 3" class="step">
        <div class="step-icon">
          <i class="fas fa-robot"></i>
        </div>
        <h1>Configure AI Provider</h1>
        <p class="description">
          Writers Guild uses AI to help generate story content. Choose a provider and enter your API key.
        </p>

        <div class="provider-selection">
          <div
            v-for="provider in providers"
            :key="provider.id"
            class="provider-option"
            :class="{ selected: selectedProvider === provider.id, recommended: provider.recommended }"
            @click="selectedProvider = provider.id"
          >
            <div class="provider-header">
              <span class="provider-name">{{ provider.name }}</span>
              <span v-if="provider.recommended" class="recommended-badge">Recommended</span>
            </div>
            <p class="provider-description">{{ provider.description }}</p>
          </div>
        </div>

        <div v-if="selectedProvider && selectedProvider !== 'aihorde'" class="form-group">
          <label :for="'apiKey-' + selectedProvider">
            {{ getProviderName(selectedProvider) }} API Key
          </label>
          <input
            :id="'apiKey-' + selectedProvider"
            v-model="apiKey"
            type="password"
            :placeholder="`Enter your ${getProviderName(selectedProvider)} API key`"
          />
          <p class="help-text">
            <template v-if="selectedProvider === 'deepseek'">
              Get your API key from <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener">platform.deepseek.com</a>
            </template>
            <template v-else-if="selectedProvider === 'openai'">
              Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>
            </template>
            <template v-else-if="selectedProvider === 'anthropic'">
              Get your API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>
            </template>
            <template v-else-if="selectedProvider === 'openrouter'">
              Get your API key from <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai</a>
            </template>
          </p>
        </div>

        <div v-if="selectedProvider === 'aihorde'" class="info-box">
          <i class="fas fa-info-circle"></i>
          <p>
            AI Horde is a free, community-powered option. No API key required,
            but generation may be slower during peak times.
          </p>
        </div>

        <div class="button-group">
          <button class="btn btn-secondary" @click="prevStep">Back</button>
          <button
            class="btn btn-primary"
            :disabled="!canProceedFromProvider"
            @click="createPreset"
          >
            Continue
          </button>
        </div>
      </div>

      <!-- Step 4: Import Defaults -->
      <div v-if="currentStep === 4" class="step">
        <div class="step-icon">
          <i class="fas fa-download"></i>
        </div>
        <h1>Import Sample Content</h1>
        <p class="description">
          Would you like to populate your library with sample characters and stories?
          This is a great way to explore the app's features.
        </p>

        <div class="import-options">
          <div
            class="import-option"
            :class="{ selected: importDefaults }"
            @click="importDefaults = true"
          >
            <i class="fas fa-check-circle"></i>
            <div>
              <strong>Yes, import samples</strong>
              <p>Get started with pre-made characters and stories</p>
            </div>
          </div>
          <div
            class="import-option"
            :class="{ selected: !importDefaults }"
            @click="importDefaults = false"
          >
            <i class="fas fa-times-circle"></i>
            <div>
              <strong>No, start fresh</strong>
              <p>I'll create my own characters and stories</p>
            </div>
          </div>
        </div>

        <div class="button-group">
          <button class="btn btn-secondary" @click="prevStep">Back</button>
          <button class="btn btn-primary" @click="handleImportChoice">
            {{ importDefaults ? 'Import & Finish' : 'Finish Setup' }}
          </button>
        </div>
      </div>

      <!-- Step 5: Complete -->
      <div v-if="currentStep === 5" class="step">
        <div class="step-icon success">
          <i class="fas fa-check"></i>
        </div>
        <h1>You're All Set!</h1>
        <p class="description">
          Your Writers Guild is ready to use. Start creating amazing stories!
        </p>

        <div v-if="setupSummary" class="summary">
          <div class="summary-item" v-if="setupSummary.persona">
            <i class="fas fa-user"></i>
            <span>Persona created: <strong>{{ setupSummary.persona }}</strong></span>
          </div>
          <div class="summary-item" v-if="setupSummary.provider">
            <i class="fas fa-robot"></i>
            <span>AI Provider: <strong>{{ setupSummary.provider }}</strong></span>
          </div>
          <div class="summary-item" v-if="setupSummary.importedCharacters">
            <i class="fas fa-users"></i>
            <span>Imported <strong>{{ setupSummary.importedCharacters }}</strong> characters</span>
          </div>
          <div class="summary-item" v-if="setupSummary.createdStories">
            <i class="fas fa-book"></i>
            <span>Created <strong>{{ setupSummary.createdStories }}</strong> sample stories</span>
          </div>
        </div>

        <div class="button-group">
          <button class="btn btn-primary btn-large" @click="finishOnboarding">
            Start Writing
          </button>
        </div>
      </div>

      <!-- Loading overlay -->
      <div v-if="isLoading" class="loading-overlay">
        <div class="spinner"></div>
        <p>{{ loadingMessage }}</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { onboardingAPI } from '../services/api'
import { useToast } from '../composables/useToast'
import { markOnboardingComplete } from '../router'

const router = useRouter()
const { showToast } = useToast()

const currentStep = ref(1)
const totalSteps = 5
const isLoading = ref(false)
const loadingMessage = ref('')

// Step 2: Persona
const persona = ref({
  firstName: '',
  description: ''
})

// Step 3: Provider
const selectedProvider = ref('deepseek')
const apiKey = ref('')

const providers = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'High-quality reasoning model with excellent creative writing capabilities. Very affordable.',
    recommended: true
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o and other models. Reliable and well-established.'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models known for nuanced, thoughtful responses.'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access to multiple AI models through a unified API.'
  },
  {
    id: 'aihorde',
    name: 'AI Horde',
    description: 'Free, community-powered AI. No API key required.'
  }
]

// Step 4: Import defaults
const importDefaults = ref(true)

// Setup summary for final step
const setupSummary = ref(null)

const canProceedFromProvider = computed(() => {
  if (!selectedProvider.value) return false
  if (selectedProvider.value === 'aihorde') return true
  return apiKey.value.trim().length > 0
})

function getProviderName(providerId) {
  const provider = providers.find(p => p.id === providerId)
  return provider?.name || providerId
}

function nextStep() {
  if (currentStep.value < totalSteps) {
    currentStep.value++
  }
}

function prevStep() {
  if (currentStep.value > 1) {
    currentStep.value--
  }
}

async function skipOnboarding() {
  isLoading.value = true
  loadingMessage.value = 'Setting up defaults...'

  try {
    await onboardingAPI.skip()
    markOnboardingComplete()
    router.push('/')
  } catch (error) {
    showToast('Failed to skip onboarding: ' + error.message, 'error')
  } finally {
    isLoading.value = false
  }
}

async function createPersona() {
  if (!persona.value.firstName.trim()) {
    showToast('Please enter your first name', 'error')
    return
  }

  isLoading.value = true
  loadingMessage.value = 'Creating your persona...'

  try {
    const result = await onboardingAPI.createPersona(
      persona.value.firstName.trim(),
      persona.value.description.trim()
    )
    setupSummary.value = {
      ...setupSummary.value,
      persona: result.name
    }
    nextStep()
  } catch (error) {
    showToast('Failed to create persona: ' + error.message, 'error')
  } finally {
    isLoading.value = false
  }
}

async function createPreset() {
  if (!selectedProvider.value) {
    showToast('Please select a provider', 'error')
    return
  }

  if (selectedProvider.value !== 'aihorde' && !apiKey.value.trim()) {
    showToast('Please enter your API key', 'error')
    return
  }

  isLoading.value = true
  loadingMessage.value = 'Configuring AI provider...'

  try {
    const result = await onboardingAPI.createPreset(
      selectedProvider.value,
      apiKey.value.trim()
    )
    setupSummary.value = {
      ...setupSummary.value,
      provider: result.name
    }
    nextStep()
  } catch (error) {
    showToast('Failed to create preset: ' + error.message, 'error')
  } finally {
    isLoading.value = false
  }
}

async function handleImportChoice() {
  isLoading.value = true

  try {
    if (importDefaults.value) {
      loadingMessage.value = 'Importing sample content...'
      const result = await onboardingAPI.importDefaults()
      setupSummary.value = {
        ...setupSummary.value,
        importedCharacters: result.importedCharacters,
        createdStories: result.createdStories
      }
    }

    loadingMessage.value = 'Completing setup...'
    await onboardingAPI.complete()
    nextStep()
  } catch (error) {
    showToast('Failed to complete setup: ' + error.message, 'error')
  } finally {
    isLoading.value = false
  }
}

function finishOnboarding() {
  markOnboardingComplete()
  router.push('/')
}
</script>

<style scoped>
.onboarding-container {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-secondary) 100%);
  padding: 2rem;
}

.onboarding-card {
  background: var(--bg-secondary);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  max-width: 600px;
  width: 100%;
  position: relative;
  overflow: hidden;
}

.progress-bar {
  height: 4px;
  background: var(--bg-tertiary);
}

.progress-fill {
  height: 100%;
  background: var(--accent-color);
  transition: width 0.3s ease;
}

.step {
  padding: 2.5rem;
  text-align: center;
}

.step-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: var(--accent-color);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1.5rem;
  font-size: 2rem;
  color: white;
}

.step-icon.success {
  background: #10b981;
}

h1 {
  margin: 0 0 1rem;
  font-size: 1.75rem;
  color: var(--text-primary);
}

.description {
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 1.5rem;
}

.feature-list {
  list-style: none;
  padding: 0;
  margin: 1.5rem 0;
  text-align: left;
}

.feature-list li {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border-radius: 8px;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}

.feature-list li i {
  color: var(--accent-color);
  width: 20px;
  text-align: center;
}

.form-group {
  text-align: left;
  margin-bottom: 1.5rem;
}

.form-group label {
  display: block;
  margin-bottom: 0.5rem;
  font-weight: 500;
  color: var(--text-primary);
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 1rem;
  font-family: inherit;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: var(--accent-color);
  box-shadow: 0 0 0 3px rgba(var(--accent-color-rgb), 0.1);
}

.form-group textarea {
  resize: vertical;
  min-height: 80px;
}

.help-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-top: 0.5rem;
}

.help-text a {
  color: var(--accent-color);
}

.provider-selection {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
  text-align: left;
}

.provider-option {
  padding: 1rem;
  border: 2px solid var(--border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.provider-option:hover {
  border-color: var(--accent-color);
  background: var(--bg-tertiary);
}

.provider-option.selected {
  border-color: var(--accent-color);
  background: rgba(var(--accent-color-rgb), 0.1);
}

.provider-option.recommended {
  position: relative;
}

.provider-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.provider-name {
  font-weight: 600;
  color: var(--text-primary);
}

.recommended-badge {
  background: var(--accent-color);
  color: white;
  font-size: 0.7rem;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  text-transform: uppercase;
  font-weight: 600;
}

.provider-description {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
}

.info-box {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(var(--accent-color-rgb), 0.1);
  border-radius: 8px;
  margin-bottom: 1.5rem;
  text-align: left;
}

.info-box i {
  color: var(--accent-color);
  flex-shrink: 0;
  margin-top: 0.2rem;
}

.info-box p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.875rem;
}

.import-options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.import-option {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border: 2px solid var(--border-color);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.import-option:hover {
  border-color: var(--accent-color);
  background: var(--bg-tertiary);
}

.import-option.selected {
  border-color: var(--accent-color);
  background: rgba(var(--accent-color-rgb), 0.1);
}

.import-option i {
  font-size: 1.5rem;
  color: var(--text-secondary);
}

.import-option.selected i {
  color: var(--accent-color);
}

.import-option strong {
  display: block;
  color: var(--text-primary);
  margin-bottom: 0.25rem;
}

.import-option p {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.summary {
  background: var(--bg-tertiary);
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  text-align: left;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  color: var(--text-secondary);
}

.summary-item i {
  width: 20px;
  text-align: center;
  color: var(--accent-color);
}

.summary-item strong {
  color: var(--text-primary);
}

.button-group {
  display: flex;
  gap: 1rem;
  justify-content: center;
  margin-top: 1.5rem;
}

.btn {
  padding: 0.75rem 1.5rem;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 120px;
}

.btn-primary {
  background: var(--accent-color);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--border-color);
}

.btn-large {
  padding: 1rem 2rem;
  font-size: 1.125rem;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(var(--bg-secondary-rgb), 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.loading-overlay p {
  color: var(--text-secondary);
  margin: 0;
}
</style>
