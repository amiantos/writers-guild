<template>
  <div class="character-detail-page">
    <!-- Header -->
    <header class="detail-header">
      <div class="header-left">
        <button class="btn btn-secondary btn-small" @click="goBack()">
          <i class="fas fa-arrow-left"></i> Back
        </button>
        <h1 class="character-title">{{ character?.name || 'Loading...' }}</h1>
      </div>
      <div class="header-right">
        <button class="btn btn-danger btn-small" @click="deleteCharacter">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </header>

    <!-- Loading State -->
    <div v-if="loading" class="loading-container">
      <div class="spinner"></div>
      <p>Loading character...</p>
    </div>

    <!-- Main Content -->
    <div v-else-if="character" class="detail-content">
      <div class="detail-layout">
        <!-- Left Column: Character Card -->
        <div class="card-column">
          <CharacterCard :character="character" />

          <!-- Action Buttons -->
          <div class="card-actions">
            <button class="btn btn-primary btn-block" @click="createNewStory">
              <i class="fas fa-plus"></i> New Story
            </button>
            <button class="btn btn-secondary btn-block" @click="setAsDefaultPersona">
              <i class="fas fa-user-check"></i> Set as Default Persona
            </button>
          </div>

          <div class="info-note">
            <i class="fas fa-info-circle"></i>
            <p>Úrscéal uses Name, Description, and Personality by default for character response generation. Scenario is used if the story has only one character in it. Example messages can be included optionally from the settings menu.</p>
          </div>
        </div>

        <!-- Right Column: Editable Sections -->
        <div class="sections-column">
          <!-- Image Section -->
          <section class="edit-section">
            <div class="section-header">
              <h2>Character Image</h2>
              <button
                v-if="!editingImage"
                class="btn btn-small btn-secondary"
                @click="editingImage = true"
              >
                <i class="fas fa-edit"></i> Change
              </button>
            </div>
            <div v-if="editingImage" class="section-content editing">
              <div class="image-upload">
                <input
                  type="file"
                  ref="imageInput"
                  accept="image/*"
                  @change="handleImageChange"
                />
                <div v-if="imagePreview" class="image-preview">
                  <img :src="imagePreview" alt="Preview" />
                </div>
              </div>
              <div class="section-actions">
                <button class="btn btn-secondary" @click="cancelImageEdit">
                  Cancel
                </button>
                <button
                  class="btn btn-primary"
                  :disabled="!newImage"
                  @click="saveImage"
                >
                  <i class="fas fa-save"></i> Save
                </button>
              </div>
            </div>
            <div v-else class="section-content">
              <p class="section-display">
                {{ character.hasImage ? 'Image uploaded' : 'No image uploaded' }}
              </p>
            </div>
          </section>

          <!-- Name Section -->
          <section class="edit-section">
            <div class="section-header">
              <h2>Name</h2>
              <button
                v-if="!editingName"
                class="btn btn-small btn-secondary"
                @click="startEdit('name')"
              >
                <i class="fas fa-edit"></i> Edit
              </button>
            </div>
            <div v-if="editingName" class="section-content editing">
              <input
                v-model="editedName"
                type="text"
                class="text-input"
                placeholder="Character name..."
              />
              <div class="section-actions">
                <button class="btn btn-secondary" @click="cancelEdit('name')">
                  Cancel
                </button>
                <button
                  class="btn btn-primary"
                  :disabled="!editedName.trim()"
                  @click="saveName"
                >
                  <i class="fas fa-save"></i> Save
                </button>
              </div>
            </div>
            <div v-else class="section-content">
              <p class="section-display">{{ character.name || 'No name set' }}</p>
            </div>
          </section>

          <!-- Description Section -->
          <section class="edit-section">
            <div class="section-header">
              <h2>Description</h2>
              <button
                v-if="!editingDescription"
                class="btn btn-small btn-secondary"
                @click="startEdit('description')"
              >
                <i class="fas fa-edit"></i> Edit
              </button>
            </div>
            <div v-if="editingDescription" class="section-content editing">
              <textarea
                v-model="editedDescription"
                class="textarea-input"
                placeholder="Physical appearance, background, biography..."
                rows="8"
              ></textarea>
              <div class="section-actions">
                <button class="btn btn-secondary" @click="cancelEdit('description')">
                  Cancel
                </button>
                <button class="btn btn-primary" @click="saveDescription">
                  <i class="fas fa-save"></i> Save
                </button>
              </div>
            </div>
            <div v-else class="section-content">
              <p class="section-display">
                {{ character.description || 'No description set' }}
              </p>
            </div>
          </section>

          <!-- Lorebook Association Section -->
          <section class="edit-section">
            <div class="section-header">
              <h2>Associated Lorebook</h2>
              <button
                v-if="!editingLorebook"
                class="btn btn-small btn-secondary"
                @click="startEdit('lorebook')"
              >
                <i class="fas fa-edit"></i> Edit
              </button>
            </div>
            <div v-if="editingLorebook" class="section-content editing">
              <p class="help-text">
                Auto-add this lorebook when using the character in stories
              </p>
              <select
                v-model="editedLorebookId"
                class="select-input"
              >
                <option :value="null">No lorebook</option>
                <option
                  v-for="lorebook in availableLorebooks"
                  :key="lorebook.id"
                  :value="lorebook.id"
                >
                  {{ lorebook.name }}
                </option>
              </select>
              <div class="section-actions">
                <button class="btn btn-secondary" @click="cancelEdit('lorebook')">
                  Cancel
                </button>
                <button class="btn btn-primary" @click="saveLorebook">
                  <i class="fas fa-save"></i> Save
                </button>
              </div>
            </div>
            <div v-else class="section-content">
              <p class="section-display">
                {{ getLorebookName(character.ursceal_lorebook_id) || 'No lorebook associated' }}
              </p>
            </div>
          </section>

          <!-- Personality Section -->
          <section class="edit-section">
            <div class="section-header">
              <h2>Personality</h2>
              <button
                v-if="!editingPersonality"
                class="btn btn-small btn-secondary"
                @click="startEdit('personality')"
              >
                <i class="fas fa-edit"></i> Edit
              </button>
            </div>
            <div v-if="editingPersonality" class="section-content editing">
              <textarea
                v-model="editedPersonality"
                class="textarea-input"
                placeholder="Personality traits, mannerisms, speech patterns..."
                rows="8"
              ></textarea>
              <div class="section-actions">
                <button class="btn btn-secondary" @click="cancelEdit('personality')">
                  Cancel
                </button>
                <button class="btn btn-primary" @click="savePersonality">
                  <i class="fas fa-save"></i> Save
                </button>
              </div>
            </div>
            <div v-else class="section-content">
              <p class="section-display">
                {{ character.personality || 'No personality set' }}
              </p>
            </div>
          </section>

          <!-- Scenario Section -->
          <section class="edit-section">
            <div class="section-header">
              <h2>Scenario</h2>
              <button
                v-if="!editingScenario"
                class="btn btn-small btn-secondary"
                @click="startEdit('scenario')"
              >
                <i class="fas fa-edit"></i> Edit
              </button>
            </div>
            <div v-if="editingScenario" class="section-content editing">
              <textarea
                v-model="editedScenario"
                class="textarea-input"
                placeholder="Current situation, setting, context..."
                rows="6"
              ></textarea>
              <div class="section-actions">
                <button class="btn btn-secondary" @click="cancelEdit('scenario')">
                  Cancel
                </button>
                <button class="btn btn-primary" @click="saveScenario">
                  <i class="fas fa-save"></i> Save
                </button>
              </div>
            </div>
            <div v-else class="section-content">
              <p class="section-display">
                {{ character.scenario || 'No scenario set' }}
              </p>
            </div>
          </section>

          <!-- Dialogue Examples Section -->
          <section class="edit-section">
            <div class="section-header">
              <h2>Dialogue Examples</h2>
              <button
                v-if="!editingDialogueExamples"
                class="btn btn-small btn-secondary"
                @click="startEdit('dialogueExamples')"
              >
                <i class="fas fa-edit"></i> Edit
              </button>
            </div>
            <div v-if="editingDialogueExamples" class="section-content editing">
              <textarea
                v-model="editedDialogueExamples"
                class="textarea-input"
                placeholder="Example dialogue that shows the character's speaking style..."
                rows="8"
              ></textarea>
              <div class="section-actions">
                <button class="btn btn-secondary" @click="cancelEdit('dialogueExamples')">
                  Cancel
                </button>
                <button class="btn btn-primary" @click="saveDialogueExamples">
                  <i class="fas fa-save"></i> Save
                </button>
              </div>
            </div>
            <div v-else class="section-content">
              <p class="section-display">
                {{ character.mes_example || 'No dialogue examples set' }}
              </p>
            </div>
          </section>

          <!-- First Message Section -->
          <section class="edit-section">
            <div class="section-header">
              <h2>First Message</h2>
              <button
                v-if="!editingFirstMessage"
                class="btn btn-small btn-secondary"
                @click="startEdit('firstMessage')"
              >
                <i class="fas fa-edit"></i> Edit
              </button>
            </div>
            <div v-if="editingFirstMessage" class="section-content editing">
              <textarea
                v-model="editedFirstMessage"
                class="textarea-input"
                placeholder="Initial greeting or opening scene..."
                rows="8"
              ></textarea>
              <div class="section-actions">
                <button class="btn btn-secondary" @click="cancelEdit('firstMessage')">
                  Cancel
                </button>
                <button class="btn btn-primary" @click="saveFirstMessage">
                  <i class="fas fa-save"></i> Save
                </button>
              </div>
            </div>
            <div v-else class="section-content">
              <p class="section-display">
                {{ character.first_mes || 'No first message set' }}
              </p>
            </div>
          </section>

          <!-- Alternate Greetings Section -->
          <section class="edit-section">
            <div class="section-header">
              <h2>Alternate Greetings</h2>
              <button
                class="btn btn-small btn-primary"
                @click="addAlternateGreeting"
              >
                <i class="fas fa-plus"></i> Add
              </button>
            </div>
            <div class="section-content">
              <p class="help-text">
                Alternate greetings provide different starting points when adding this character to a story.
              </p>

              <div v-if="!character.alternate_greetings || character.alternate_greetings.length === 0" class="empty-greetings">
                <p>No alternate greetings yet. Add one to get started!</p>
              </div>

              <div v-else class="greetings-list">
                <div
                  v-for="(greeting, index) in character.alternate_greetings"
                  :key="index"
                  :ref="el => { if (el) greetingRefs[index] = el }"
                  class="greeting-item"
                >
                  <div class="greeting-header">
                    <span class="greeting-label">Alternate Greeting {{ index + 1 }}</span>
                    <div class="greeting-actions">
                      <button
                        v-if="editingGreetingIndex !== index"
                        class="btn btn-small btn-secondary"
                        @click="startEditGreeting(index)"
                      >
                        <i class="fas fa-edit"></i> Edit
                      </button>
                      <button
                        v-if="editingGreetingIndex !== index"
                        class="btn btn-small btn-secondary"
                        @click="deleteAlternateGreeting(index)"
                      >
                        <i class="fas fa-trash"></i> Delete
                      </button>
                    </div>
                  </div>

                  <div v-if="editingGreetingIndex === index" class="greeting-edit">
                    <textarea
                      ref="greetingTextarea"
                      v-model="editedGreeting"
                      class="textarea-input"
                      placeholder="Alternate greeting text..."
                      rows="6"
                    ></textarea>
                    <div class="greeting-edit-actions">
                      <button class="btn btn-secondary" @click="cancelEditGreeting">
                        Cancel
                      </button>
                      <button class="btn btn-primary" @click="saveAlternateGreeting">
                        <i class="fas fa-save"></i> Save
                      </button>
                    </div>
                  </div>

                  <div v-else class="greeting-content">
                    {{ greeting }}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- Error State -->
    <div v-else class="error-container">
      <i class="fas fa-exclamation-triangle"></i>
      <p>Failed to load character</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { charactersAPI, lorebooksAPI, storiesAPI, settingsAPI } from '../services/api'
import { useToast } from '../composables/useToast'
import { useNavigation } from '../composables/useNavigation'
import { useConfirm } from '../composables/useConfirm'
import { setPageTitle } from '../router'
import CharacterCard from '../components/CharacterCard.vue'

const props = defineProps({
  characterId: {
    type: String,
    required: true
  }
})

const router = useRouter()
const toast = useToast()
const { goBack } = useNavigation()
const { confirm } = useConfirm()

// State
const loading = ref(true)
const character = ref(null)
const availableLorebooks = ref([])

// Editing states
const editingName = ref(false)
const editingDescription = ref(false)
const editingLorebook = ref(false)
const editingPersonality = ref(false)
const editingScenario = ref(false)
const editingDialogueExamples = ref(false)
const editingFirstMessage = ref(false)
const editingImage = ref(false)

// Edited values
const editedName = ref('')
const editedDescription = ref('')
const editedLorebookId = ref(null)
const editedPersonality = ref('')
const editedScenario = ref('')
const editedDialogueExamples = ref('')
const editedFirstMessage = ref('')
const newImage = ref(null)
const imagePreview = ref(null)
const imageInput = ref(null)

// Alternate greetings editing
const editingGreetingIndex = ref(null)
const editedGreeting = ref('')
const greetingRefs = ref({})
const greetingTextarea = ref(null)

// Load character data
onMounted(async () => {
  await Promise.all([loadCharacter(), loadLorebooks()])
})

async function loadLorebooks() {
  try {
    const { lorebooks } = await lorebooksAPI.list()
    availableLorebooks.value = lorebooks || []
  } catch (error) {
    console.error('Failed to load lorebooks:', error)
  }
}

async function loadCharacter() {
  try {
    loading.value = true
    const response = await charactersAPI.get(props.characterId)
    // API returns { character: { data: {...}, spec: ..., metadata: ... } }
    // We need to flatten this for easier access

    // Always set image URL - CharacterCard will handle if it doesn't exist
    const imageUrl = `/api/characters/${props.characterId}/image?t=${Date.now()}`

    character.value = {
      id: props.characterId,
      name: response.character.data.name,
      description: response.character.data.description,
      personality: response.character.data.personality,
      scenario: response.character.data.scenario,
      mes_example: response.character.data.mes_example,
      first_mes: response.character.data.first_mes,
      alternate_greetings: response.character.data.alternate_greetings || [],
      ursceal_lorebook_id: response.character.data.extensions?.ursceal_lorebook_id || null,
      imageUrl: imageUrl,
      hasImage: false, // Will be set by checkImageExists
      // Store the full data in case we need it
      _fullData: response.character
    }

    // Check if image actually exists by trying to load it
    await checkImageExists()

    // Update page title with character name
    setPageTitle(character.value.name || 'Character')
  } catch (error) {
    console.error('Failed to load character:', error)
    toast.error('Failed to load character: ' + error.message)
  } finally {
    loading.value = false
  }
}

async function checkImageExists() {
  try {
    const response = await fetch(`/api/characters/${props.characterId}/image`, {
      method: 'HEAD'
    })
    character.value.hasImage = response.ok
  } catch (error) {
    character.value.hasImage = false
  }
}

function startEdit(section) {
  if (section === 'name') {
    editedName.value = character.value.name || ''
    editingName.value = true
  } else if (section === 'description') {
    editedDescription.value = character.value.description || ''
    editingDescription.value = true
  } else if (section === 'lorebook') {
    editedLorebookId.value = character.value.ursceal_lorebook_id
    editingLorebook.value = true
  } else if (section === 'personality') {
    editedPersonality.value = character.value.personality || ''
    editingPersonality.value = true
  } else if (section === 'scenario') {
    editedScenario.value = character.value.scenario || ''
    editingScenario.value = true
  } else if (section === 'dialogueExamples') {
    editedDialogueExamples.value = character.value.mes_example || ''
    editingDialogueExamples.value = true
  } else if (section === 'firstMessage') {
    editedFirstMessage.value = character.value.first_mes || ''
    editingFirstMessage.value = true
  }
}

function cancelEdit(section) {
  if (section === 'name') {
    editingName.value = false
    editedName.value = ''
  } else if (section === 'description') {
    editingDescription.value = false
    editedDescription.value = ''
  } else if (section === 'lorebook') {
    editingLorebook.value = false
    editedLorebookId.value = null
  } else if (section === 'personality') {
    editingPersonality.value = false
    editedPersonality.value = ''
  } else if (section === 'scenario') {
    editingScenario.value = false
    editedScenario.value = ''
  } else if (section === 'dialogueExamples') {
    editingDialogueExamples.value = false
    editedDialogueExamples.value = ''
  } else if (section === 'firstMessage') {
    editingFirstMessage.value = false
    editedFirstMessage.value = ''
  }
}

async function saveName() {
  try {
    await charactersAPI.update(props.characterId, {
      name: editedName.value.trim()
    })
    character.value.name = editedName.value.trim()
    editingName.value = false
    editedName.value = ''
    // Update page title with new name
    setPageTitle(character.value.name)
  } catch (error) {
    console.error('Failed to update name:', error)
    toast.error('Failed to update name: ' + error.message)
  }
}

async function saveDescription() {
  try {
    await charactersAPI.update(props.characterId, {
      description: editedDescription.value
    })
    character.value.description = editedDescription.value
    editingDescription.value = false
    editedDescription.value = ''
  } catch (error) {
    console.error('Failed to update description:', error)
    toast.error('Failed to update description: ' + error.message)
  }
}

async function saveLorebook() {
  try {
    await charactersAPI.update(props.characterId, {
      ursceal_lorebook_id: editedLorebookId.value
    })
    character.value.ursceal_lorebook_id = editedLorebookId.value
    editingLorebook.value = false
    editedLorebookId.value = null
  } catch (error) {
    console.error('Failed to update lorebook association:', error)
    toast.error('Failed to update lorebook association: ' + error.message)
  }
}

async function savePersonality() {
  try {
    await charactersAPI.update(props.characterId, {
      personality: editedPersonality.value
    })
    character.value.personality = editedPersonality.value
    editingPersonality.value = false
    editedPersonality.value = ''
  } catch (error) {
    console.error('Failed to update personality:', error)
    toast.error('Failed to update personality: ' + error.message)
  }
}

async function saveScenario() {
  try {
    await charactersAPI.update(props.characterId, {
      scenario: editedScenario.value
    })
    character.value.scenario = editedScenario.value
    editingScenario.value = false
    editedScenario.value = ''
  } catch (error) {
    console.error('Failed to update scenario:', error)
    toast.error('Failed to update scenario: ' + error.message)
  }
}

async function saveDialogueExamples() {
  try {
    await charactersAPI.update(props.characterId, {
      mes_example: editedDialogueExamples.value
    })
    character.value.mes_example = editedDialogueExamples.value
    editingDialogueExamples.value = false
    editedDialogueExamples.value = ''
  } catch (error) {
    console.error('Failed to update dialogue examples:', error)
    toast.error('Failed to update dialogue examples: ' + error.message)
  }
}

async function saveFirstMessage() {
  try {
    await charactersAPI.update(props.characterId, {
      first_mes: editedFirstMessage.value
    })
    character.value.first_mes = editedFirstMessage.value
    editingFirstMessage.value = false
    editedFirstMessage.value = ''
  } catch (error) {
    console.error('Failed to update first message:', error)
    toast.error('Failed to update first message: ' + error.message)
  }
}

function handleImageChange(event) {
  const file = event.target.files[0]
  if (file) {
    newImage.value = file
    const reader = new FileReader()
    reader.onload = (e) => {
      imagePreview.value = e.target.result
    }
    reader.readAsDataURL(file)
  }
}

async function saveImage() {
  if (!newImage.value) return

  try {
    const formData = new FormData()
    formData.append('image', newImage.value)

    // The server expects characterData as a JSON string
    formData.append('characterData', JSON.stringify({
      name: character.value.name,
      description: character.value.description || '',
      personality: character.value.personality || '',
      scenario: character.value.scenario || '',
      mes_example: character.value.mes_example || '',
      first_mes: character.value.first_mes || '',
      alternate_greetings: character.value.alternate_greetings || [],
      ursceal_lorebook_id: character.value.ursceal_lorebook_id || null
    }))

    const updated = await charactersAPI.updateWithImage(props.characterId, formData)

    // Update character with new image URL - add cache buster to force reload
    character.value.imageUrl = updated.imageUrl + '?t=' + Date.now()
    character.value.hasImage = true

    // Reset image editing state
    editingImage.value = false
    newImage.value = null
    imagePreview.value = null
    if (imageInput.value) {
      imageInput.value.value = ''
    }
  } catch (error) {
    console.error('Failed to update image:', error)
    toast.error('Failed to update image: ' + error.message)
  }
}

function cancelImageEdit() {
  editingImage.value = false
  newImage.value = null
  imagePreview.value = null
  if (imageInput.value) {
    imageInput.value.value = ''
  }
}

async function deleteCharacter() {
  const confirmed = await confirm({
    message: `Are you sure you want to delete "${character.value.name}"? This cannot be undone.`,
    confirmText: 'Delete Character',
    variant: 'danger'
  })

  if (!confirmed) return

  try {
    await charactersAPI.delete(props.characterId)
    toast.success('Character deleted successfully')
    router.push('/')
  } catch (error) {
    console.error('Failed to delete character:', error)
    toast.error('Failed to delete character: ' + error.message)
  }
}

function getLorebookName(lorebookId) {
  if (!lorebookId) return null
  const lorebook = availableLorebooks.value.find(lb => lb.id === lorebookId)
  return lorebook?.name || null
}

// Alternate greetings management
async function addAlternateGreeting() {
  if (!character.value.alternate_greetings) {
    character.value.alternate_greetings = []
  }
  character.value.alternate_greetings.push('')
  const newIndex = character.value.alternate_greetings.length - 1
  startEditGreeting(newIndex)

  // Wait for DOM to update, then scroll to the new greeting and focus textarea
  await nextTick()
  const newGreetingElement = greetingRefs.value[newIndex]
  if (newGreetingElement) {
    newGreetingElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    })
  }

  // Wait another tick and focus the textarea
  await nextTick()
  if (greetingTextarea.value && typeof greetingTextarea.value.focus === 'function') {
    greetingTextarea.value.focus()
  } else {
    // Fallback: query the textarea directly
    const textarea = newGreetingElement?.querySelector('textarea')
    if (textarea) {
      textarea.focus()
    }
  }
}

function startEditGreeting(index) {
  editingGreetingIndex.value = index
  editedGreeting.value = character.value.alternate_greetings[index]
}

function cancelEditGreeting() {
  // If this was a newly added empty greeting, remove it
  if (editedGreeting.value === '' && character.value.alternate_greetings[editingGreetingIndex.value] === '') {
    character.value.alternate_greetings.splice(editingGreetingIndex.value, 1)
  }
  editingGreetingIndex.value = null
  editedGreeting.value = ''
}

async function saveAlternateGreeting() {
  try {
    // Update the greeting in the array
    character.value.alternate_greetings[editingGreetingIndex.value] = editedGreeting.value

    // Save to server
    await charactersAPI.update(props.characterId, {
      alternate_greetings: character.value.alternate_greetings
    })

    // Reset editing state
    editingGreetingIndex.value = null
    editedGreeting.value = ''
  } catch (error) {
    console.error('Failed to save alternate greeting:', error)
    toast.error('Failed to save alternate greeting: ' + error.message)
  }
}

async function deleteAlternateGreeting(index) {
  const confirmed = await confirm({
    message: 'Delete this alternate greeting?',
    confirmText: 'Delete',
    variant: 'danger'
  })

  if (!confirmed) return

  try {
    // Remove from array
    character.value.alternate_greetings.splice(index, 1)

    // Save to server
    await charactersAPI.update(props.characterId, {
      alternate_greetings: character.value.alternate_greetings
    })
  } catch (error) {
    console.error('Failed to delete alternate greeting:', error)
    toast.error('Failed to delete alternate greeting: ' + error.message)
  }
}

async function createNewStory() {
  try {
    // Create new story
    const { story } = await storiesAPI.create(`Story with ${character.value.name}`)

    // Add character to story
    const response = await charactersAPI.addToStory(story.id, props.characterId)

    // Add first message if available
    if (response.processedFirstMessage) {
      await storiesAPI.updateContent(story.id, response.processedFirstMessage + '\n\n')
    }

    toast.success('Story created!')

    // Navigate to the new story
    router.push(`/story/${story.id}`)
  } catch (error) {
    console.error('Failed to create story:', error)
    toast.error('Failed to create story: ' + error.message)
  }
}

async function setAsDefaultPersona() {
  try {
    await settingsAPI.update({ defaultPersonaId: props.characterId })
    toast.success(`${character.value.name} set as default persona`)
  } catch (error) {
    console.error('Failed to set default persona:', error)
    toast.error('Failed to set default persona: ' + error.message)
  }
}
</script>

<style scoped>
.character-detail-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
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
}

.header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.character-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.loading-container,
.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary);
  gap: 1rem;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid var(--border-color);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-container i {
  font-size: 3rem;
  color: var(--danger);
}

.detail-content {
  flex: 1;
  overflow-y: auto;
  padding: 2rem;
}

.detail-layout {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 2rem;
  max-width: 1400px;
  margin: 0 auto;
}

.card-column {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.card-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.btn-block {
  width: 100%;
}

.info-note {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

.info-note i {
  color: var(--accent-primary);
  flex-shrink: 0;
  margin-top: 0.125rem;
}

.info-note p {
  margin: 0;
}

.sections-column {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.edit-section {
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.edit-section.readonly {
  opacity: 0.8;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background-color: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}

.section-header h2 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.readonly-badge {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
  background-color: var(--bg-secondary);
  color: var(--text-secondary);
  border-radius: 4px;
  font-weight: 500;
}

.section-content {
  padding: 1.5rem;
}

.section-content.editing {
  background-color: var(--bg-primary);
}

.section-display {
  margin: 0;
  color: var(--text-primary);
  white-space: pre-wrap;
  line-height: 1.6;
}

.help-text {
  margin: 0 0 1rem 0;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  border-left: 3px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 0.875rem;
  line-height: 1.5;
}

.text-input,
.textarea-input,
.select-input {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  font-family: inherit;
  font-size: 1rem;
  line-height: 1.5;
  outline: none;
  margin-bottom: 1rem;
}

.text-input:focus,
.textarea-input:focus,
.select-input:focus {
  border-color: var(--accent-primary);
}

.select-input {
  cursor: pointer;
}

.textarea-input {
  resize: vertical;
  min-height: 100px;
}

.section-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.image-upload {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 1rem;
}

.image-upload input[type="file"] {
  padding: 0.5rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
}

.image-preview {
  width: 200px;
  height: 300px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--border-color);
}

.image-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
}

@media (max-width: 1024px) {
  .detail-layout {
    grid-template-columns: 1fr;
  }

  .card-column {
    max-width: 300px;
    margin: 0 auto;
  }
}

/* Alternate Greetings Styles */
.empty-greetings {
  text-align: center;
  padding: 2rem;
  color: var(--text-secondary);
  font-style: italic;
}

.empty-greetings p {
  margin: 0;
}

.greetings-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.greeting-item {
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  overflow: hidden;
}

.greeting-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  background-color: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
}

.greeting-label {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.greeting-actions {
  display: flex;
  gap: 0.5rem;
}

.greeting-content {
  padding: 1rem;
  color: var(--text-primary);
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: 0.9rem;
}

.greeting-edit {
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.greeting-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}
</style>
