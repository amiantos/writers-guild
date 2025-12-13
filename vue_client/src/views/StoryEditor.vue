<template>
  <div class="story-editor-page">
    <!-- Header -->
    <header class="editor-header">
      <div class="header-left">
        <button class="btn btn-secondary btn-small" @click="goBack()">
          <i class="fas fa-arrow-left"></i> Back
        </button>
        <h1 class="story-title">{{ story?.title || 'Loading...' }}</h1>
      </div>
      <div class="header-right">
        <button
          class="icon-btn"
          @click="showManageCharacters = true"
          title="Manage Characters"
        >
          <i class="fas fa-user"></i>
        </button>
        <button
          class="icon-btn"
          @click="showManageLorebooks = true"
          title="Manage Lorebooks"
        >
          <i class="fas fa-book"></i>
        </button>
        <button
          class="icon-btn"
          @click="showRenameStory = true"
          title="Rename Story"
        >
          <i class="fas fa-pencil"></i>
        </button>
        <button
          class="icon-btn"
          @click="showPresetSelector = true"
          title="Configuration Preset"
        >
          <i class="fas fa-sliders"></i>
        </button>
        <button
          class="icon-btn"
          @click="deleteStory"
          title="Delete Story"
        >
          <i class="fas fa-trash"></i>
        </button>
        <button
          class="icon-btn"
          @click="goToSettings"
          title="Settings"
        >
          <i class="fas fa-cog"></i>
        </button>
      </div>
    </header>

    <!-- Main Content -->
    <div class="editor-content">
      <!-- Reasoning Panel -->
      <ReasoningPanel
        v-if="showReasoningPanel"
        :reasoning="reasoning"
        @close="showReasoningPanel = false"
      />

      <!-- Text Editor -->
      <div class="editor-container">
        <textarea
          ref="editorRef"
          v-model="content"
          class="story-editor"
          placeholder="Start writing your story here..."
          spellcheck="true"
          @input="handleInput"
        ></textarea>
      </div>

      <!-- Bottom Toolbar -->
      <div class="bottom-toolbar">
        <!-- Generation Status Overlay -->
        <div v-if="generating" class="generating-status">
          <div class="spinner"></div>
          <span>{{ generationStatus }}</span>
          <button
            class="btn btn-danger btn-sm stop-button"
            @click="cancelGeneration"
            title="Stop generation"
          >
            <i class="fas fa-stop"></i> Stop
          </button>
        </div>

        <!-- Toolbar Buttons -->
        <div v-else class="toolbar-main-buttons">
          <button
            class="btn btn-secondary icon-btn"
            @click="saveStory"
            :title="hasUnsavedChanges ? 'Save changes' : 'All changes saved'"
          >
            <i v-if="hasUnsavedChanges" class="fas fa-floppy-disk"></i>
            <i v-else class="fas fa-check"></i>
          </button>
          <button
            class="btn btn-secondary"
            :disabled="!story || storyCharacters.length === 0"
            @click="handleCharacterResponse"
          >
            <i class="fas fa-comments"></i> Continue for Character
          </button>
          <button
            class="btn btn-primary"
            :disabled="!story"
            @click="handleContinue"
          >
            <i class="fas fa-play"></i> Continue
          </button>
          <button
            class="btn btn-secondary"
            :disabled="!story"
            @click="showCustomPromptModal = true"
          >
            <i class="fas fa-wand-magic-sparkles"></i> Continue with Instruction
          </button>
          <button
            class="btn btn-secondary icon-btn"
            @click="showOverflowMenu = !showOverflowMenu"
          >
            <i class="fas fa-ellipsis-vertical"></i>
          </button>

          <!-- Overflow Menu -->
          <div v-if="showOverflowMenu" class="overflow-menu" @click="showOverflowMenu = false">
            <button class="overflow-menu-item" @click="showGreetingSelector = true">
              <i class="fas fa-message"></i>
              <span>Select Greeting</span>
            </button>
            <button
              class="overflow-menu-item"
              :disabled="storyCharacters.length === 0"
              @click="handleAddAvatarWindow"
            >
              <i class="fas fa-image"></i>
              <span>Add Character Avatar</span>
            </button>
            <button class="overflow-menu-item" @click="handleIdeate">
              <i class="fas fa-lightbulb"></i>
              <span>Ideate</span>
            </button>
            <button class="overflow-menu-item" @click="rewriteToThirdPerson">
              <i class="fas fa-repeat"></i>
              <span>Rewrite to Third Person</span>
            </button>
            <button class="overflow-menu-item" @click="clearStory">
              <i class="fas fa-eraser"></i>
              <span>Clear Story</span>
            </button>
            <button class="overflow-menu-item" @click="exportStory">
              <i class="fas fa-download"></i>
              <span>Export TXT</span>
            </button>
            <button
              v-if="lastPrompts.system || lastPrompts.user"
              class="overflow-menu-item"
              @click="showViewPromptModal = true"
            >
              <i class="fas fa-eye"></i>
              <span>View Last Prompt</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modals -->
    <CharacterResponseModal
      v-if="showCharacterSelector"
      :characters="storyCharacters"
      @close="showCharacterSelector = false"
      @select="handleCharacterSelected"
    />

    <GreetingSelectorModal
      v-if="showGreetingSelector"
      :story="story"
      @close="showGreetingSelector = false"
      @select="selectGreeting"
    />

    <ViewPromptModal
      v-if="showViewPromptModal"
      :system-prompt="lastPrompts.system"
      :user-prompt="lastPrompts.user"
      @close="showViewPromptModal = false"
    />

    <CustomPromptModal
      v-if="showCustomPromptModal"
      @close="showCustomPromptModal = false"
      @generate="handleCustomPrompt"
    />

    <ManageCharactersModal
      v-if="showManageCharacters"
      :story="story"
      @close="showManageCharacters = false"
      @updated="handleStoryUpdated"
    />

    <ManageLorebooksModal
      v-if="showManageLorebooks"
      :story="story"
      @close="showManageLorebooks = false"
      @updated="handleStoryUpdated"
    />

    <RenameStoryModal
      v-if="showRenameStory"
      :story="story"
      @close="showRenameStory = false"
      @updated="handleStoryUpdated"
    />

    <StoryPresetModal
      v-if="showPresetSelector"
      :story-id="props.storyId"
      :current-preset-id="story?.configPresetId"
      @close="showPresetSelector = false"
      @updated="handleStoryUpdated"
    />

    <IdeateModal
      v-if="showIdeateModal"
      :response="ideateResponse"
      :loading="ideateLoading"
      :status="ideateStatus"
      @close="showIdeateModal = false"
    />

    <!-- Floating Avatar Windows -->
    <FloatingAvatarWindow
      v-for="win in avatarWindows"
      :key="win.id"
      :window-id="win.id"
      :characters="storyCharacters"
      :initial-character-id="win.characterId"
      :initial-position="{ x: win.x, y: win.y }"
      :initial-size="{ width: win.width, height: win.height }"
      @close="handleAvatarWindowClose(win.id)"
      @update="handleAvatarWindowUpdate"
    />

    <!-- Third Person Prompt Modal -->
    <ThirdPersonPromptModal
      v-if="showThirdPersonPrompt"
      @close="showThirdPersonPrompt = false"
      @rewrite="handleThirdPersonRewrite"
      @skip="showThirdPersonPrompt = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { storiesAPI, charactersAPI, settingsAPI } from '../services/api'
import { useToast } from '../composables/useToast'
import { useNavigation } from '../composables/useNavigation'
import { useConfirm } from '../composables/useConfirm'
import { setPageTitle } from '../router'
import ReasoningPanel from '../components/ReasoningPanel.vue'
import CharacterResponseModal from '../components/CharacterResponseModal.vue'
import GreetingSelectorModal from '../components/GreetingSelectorModal.vue'
import ViewPromptModal from '../components/ViewPromptModal.vue'
import CustomPromptModal from '../components/CustomPromptModal.vue'
import ManageCharactersModal from '../components/ManageCharactersModal.vue'
import ManageLorebooksModal from '../components/ManageLorebooksModal.vue'
import RenameStoryModal from '../components/RenameStoryModal.vue'
import StoryPresetModal from '../components/StoryPresetModal.vue'
import IdeateModal from '../components/IdeateModal.vue'
import FloatingAvatarWindow from '../components/FloatingAvatarWindow.vue'
import ThirdPersonPromptModal from '../components/ThirdPersonPromptModal.vue'
import { SKIP_THIRD_PERSON_PROMPT_KEY } from '../config/storageKeys'

const props = defineProps({
  storyId: {
    type: String,
    required: true
  }
})

const router = useRouter()
const route = useRoute()
const toast = useToast()
const { goBack } = useNavigation()
const { confirm } = useConfirm()

// State
const story = ref(null)
const content = ref('')
const originalContent = ref('')
const editorRef = ref(null)
const generating = ref(false)
const generationStatus = ref('Thinking...')
const reasoning = ref('')
const showReasoningPanel = ref(false)
const lastPrompts = ref({ system: '', user: '' })
const showOverflowMenu = ref(false)
const showCharacterSelector = ref(false)
const showGreetingSelector = ref(false)
const showViewPromptModal = ref(false)
const showCustomPromptModal = ref(false)
const showManageCharacters = ref(false)
const showManageLorebooks = ref(false)
const showRenameStory = ref(false)
const showPresetSelector = ref(false)
const showIdeateModal = ref(false)
const ideateResponse = ref('')
const ideateLoading = ref(false)
const ideateStatus = ref('Thinking...')
const showThirdPersonPrompt = ref(false)
let abortController = null

// Avatar windows (stored on server per-story)
const avatarWindows = ref([])

const storyCharacters = ref([])
const shouldShowReasoning = ref(false) // Setting from server

// Computed
const hasUnsavedChanges = computed(() => {
  return content.value !== originalContent.value
})

// Auto-save
let autoSaveTimeout = null

// Normalize trailing line breaks to exactly 2
function normalizeTrailingLineBreaks() {
  const trimmed = content.value.replace(/\n+$/, '')
  content.value = trimmed + '\n\n'
}

// Keyboard shortcut handler for quick paragraph generation and modal opening
function handleKeyboardShortcut(event) {
  // Check for Cmd (Mac) or Ctrl (Windows/Linux) modifier
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
  const modifierKey = isMac ? event.metaKey : event.ctrlKey

  if (!modifierKey) return

  // Cmd/Ctrl+Enter opens the Continue with Instruction modal
  if (event.key === 'Enter' && !event.shiftKey) {
    // Don't trigger if a modal is already open or if generating
    if (showCustomPromptModal.value || generating.value || !story.value) return

    event.preventDefault()
    showCustomPromptModal.value = true
  }
}

// Check if we should show the third person prompt (respects "don't ask again" preference)
function shouldShowThirdPersonPrompt() {
  return localStorage.getItem(SKIP_THIRD_PERSON_PROMPT_KEY) !== 'true'
}

onMounted(async () => {
  await loadStory()
  await Promise.all([loadCharacters(), loadSettings()])
  startAutoSave()

  // Load avatar windows from story
  if (story.value?.avatarWindows) {
    avatarWindows.value = story.value.avatarWindows
  }

  // Add keyboard shortcut listener
  window.addEventListener('keydown', handleKeyboardShortcut)

  // Check if we should prompt for third-person rewrite (from story creation with first message)
  if (story.value?.needsRewritePrompt) {
    // Clear the flag on the server
    try {
      await storiesAPI.setRewritePrompt(props.storyId, false)
    } catch (error) {
      console.error('Failed to clear rewrite prompt flag:', error)
    }
    if (shouldShowThirdPersonPrompt()) {
      // Show the prompt after a short delay to let the UI settle
      await nextTick()
      showThirdPersonPrompt.value = true
    }
  }
})

onUnmounted(() => {
  stopAutoSave()
  // Clear avatar window save timeout to prevent memory leaks
  if (saveAvatarTimeout) {
    clearTimeout(saveAvatarTimeout)
  }
  // Remove keyboard shortcut listener
  window.removeEventListener('keydown', handleKeyboardShortcut)
})

// Watch content changes for auto-save
watch(content, () => {
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout)
  }
  autoSaveTimeout = setTimeout(() => {
    saveStory(true) // silent save
  }, 2000) // Save 2 seconds after last edit
})

// Watch reasoning panel opening to scroll textarea to bottom
watch(showReasoningPanel, async (isOpen) => {
  if (isOpen) {
    await nextTick()
    if (editorRef.value) {
      editorRef.value.scrollTop = editorRef.value.scrollHeight
      editorRef.value.focus()
    }
  }
})

async function loadStory() {
  try {
    const { story: loadedStory } = await storiesAPI.get(props.storyId)
    story.value = loadedStory
    content.value = loadedStory.content || ''
    originalContent.value = content.value
    // Update page title with story name
    setPageTitle(loadedStory.title || 'Untitled Story')
  } catch (error) {
    console.error('Failed to load story:', error)
    toast.error('Failed to load story: ' + error.message)
  }
}

async function loadCharacters() {
  try {
    if (!story.value || !story.value.characterIds || story.value.characterIds.length === 0) {
      storyCharacters.value = []
      return
    }

    // Load all characters and filter to story's characters
    const { characters: allChars } = await charactersAPI.list()
    storyCharacters.value = allChars.filter(c => story.value.characterIds.includes(c.id))
  } catch (error) {
    console.error('Failed to load characters:', error)
  }
}

async function loadSettings() {
  try {
    const response = await settingsAPI.get()
    const serverSettings = response.settings || response
    shouldShowReasoning.value = serverSettings.showReasoning ?? false
  } catch (error) {
    console.error('Failed to load settings:', error)
    // Default to false if settings can't be loaded
    shouldShowReasoning.value = false
  }
}

async function saveStory(silent = false) {
  if (content.value === originalContent.value) {
    return // No changes
  }

  try {
    await storiesAPI.updateContent(props.storyId, content.value)
    originalContent.value = content.value
    if (!silent) {
      toast.success('Story saved')
    }
  } catch (error) {
    console.error('Failed to save story:', error)
    if (!silent) {
      toast.error('Failed to save story: ' + error.message)
    }
  }
}

function startAutoSave() {
  // Auto-save handled by watch
}

function stopAutoSave() {
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout)
  }
}

function handleInput() {
  // Handled by watch
}

async function handleContinue() {
  await generate(false, null, null)
}

function handleCharacterResponse() {
  if (storyCharacters.value.length === 0) {
    toast.info('No characters in this story')
    return
  } else if (storyCharacters.value.length === 1) {
    // Only one character, generate directly
    generate(false, null, storyCharacters.value[0].id)
  } else {
    // Multiple characters, show selector
    showCharacterSelector.value = true
  }
}

function handleCharacterSelected(characterId) {
  showCharacterSelector.value = false
  generate(false, null, characterId)
}

async function handleCustomPrompt(instruction) {
  await generate(true, instruction, null)
}

async function generate(isCustom, instruction, characterId) {
  if (generating.value) return

  // Save before generating
  await saveStory(true)

  // Create abort controller for cancellation
  abortController = new AbortController()

  try {
    generating.value = true
    generationStatus.value = 'Thinking...'
    reasoning.value = ''
    showReasoningPanel.value = false  // Only open when reasoning is actually received

    // Track cursor position
    const cursorPos = editorRef.value.selectionStart
    const textBefore = content.value.substring(0, cursorPos)
    const textAfter = content.value.substring(cursorPos)

    let generatedContent = ''
    let reasoningText = ''

    // Stream generation with abort signal
    const stream = isCustom
      ? storiesAPI.continueWithInstruction(props.storyId, instruction, abortController.signal)
      : storiesAPI.continueStory(props.storyId, characterId, abortController.signal)

    for await (const chunk of stream) {
      // Capture prompts
      if (chunk.prompts) {
        lastPrompts.value = {
          system: chunk.prompts.system || '',
          user: chunk.prompts.user || ''
        }
      }

      // Handle queue status (AI Horde)
      if (chunk.queueStatus) {
        const { position, waitTime, finished, faulted } = chunk.queueStatus
        if (faulted) {
          generationStatus.value = 'Queue error'
        } else if (finished) {
          generationStatus.value = 'Processing...'
        } else if (position === 0) {
          generationStatus.value = `Generating... (ETA: ${waitTime}s)`
        } else {
          generationStatus.value = `In queue: position ${position} (ETA: ${waitTime}s)`
        }
      }

      // Handle reasoning
      if (chunk.reasoning) {
        // Only open panel on first reasoning data if setting is enabled
        if (!showReasoningPanel.value && shouldShowReasoning.value) {
          showReasoningPanel.value = true
        }
        reasoningText += chunk.reasoning
        reasoning.value = reasoningText
      }

      // Handle content
      if (chunk.content) {
        if (generationStatus.value === 'Thinking...' || generationStatus.value.includes('queue') || generationStatus.value.includes('Processing')) {
          generationStatus.value = 'Writing...'
        }

        generatedContent += chunk.content
        content.value = textBefore + generatedContent + textAfter

        // Auto-scroll editor
        await nextTick()
        if (editorRef.value) {
          editorRef.value.scrollTop = editorRef.value.scrollHeight
        }
      }

      if (chunk.finished) {
        break
      }
    }

    // Add two line breaks and position cursor
    if (generatedContent) {
      generatedContent += '\n\n'
      content.value = textBefore + generatedContent + textAfter

      // Normalize trailing line breaks to prevent accumulation
      normalizeTrailingLineBreaks()

      // Position cursor after generated content
      const newCursorPos = textBefore.length + generatedContent.length
      await nextTick()
      if (editorRef.value) {
        editorRef.value.selectionStart = newCursorPos
        editorRef.value.selectionEnd = newCursorPos
        editorRef.value.scrollTop = editorRef.value.scrollHeight
        editorRef.value.focus()
      }
    }

    // Save
    await saveStory(true)
    toast.success('Generation complete')
  } catch (error) {
    // Check if it was a cancellation
    if (error.name === 'AbortError' || error.message === 'Generation cancelled') {
      console.log('Generation was cancelled by user')
      toast.info('Generation cancelled')
    } else {
      console.error('Generation error:', error)

      // Show error dialog
      const errorMessage = error.message || 'Unknown error occurred'
      await confirm({
        message: `Generation Failed\n\n${errorMessage}`,
        confirmText: 'OK',
        cancelText: 'Dismiss',
        variant: 'danger'
      })
    }
  } finally {
    generating.value = false
    abortController = null
  }
}

function cancelGeneration() {
  if (abortController) {
    console.log('Cancelling generation...')
    abortController.abort()
  }
}

async function selectGreeting(greeting) {
  content.value = greeting + '\n\n'
  await saveStory()
  showGreetingSelector.value = false
  toast.success('Greeting selected')

  // Prompt user to rewrite to third person if they haven't opted out
  if (shouldShowThirdPersonPrompt()) {
    await nextTick()
    showThirdPersonPrompt.value = true
  }
}

// Handler for when user accepts the third-person prompt
function handleThirdPersonRewrite() {
  // Call with skipConfirm=true since user already confirmed via the prompt modal
  rewriteToThirdPerson(true)
}

async function rewriteToThirdPerson(skipConfirm = false) {
  if (!skipConfirm) {
    const confirmed = await confirm({
      message: 'This will replace the entire document with a rewritten version in third-person past tense. Continue?',
      confirmText: 'Rewrite',
      variant: 'warning'
    })

    if (!confirmed) return
  }

  // Save before rewriting
  await saveStory(true)

  // Create abort controller for cancellation
  abortController = new AbortController()

  try {
    generating.value = true
    generationStatus.value = 'Thinking...'
    reasoning.value = ''
    showReasoningPanel.value = false  // Only open when reasoning is actually received

    // Clear editor for rewrite
    content.value = ''

    let rewrittenContent = ''
    let reasoningText = ''

    // Stream rewrite with abort signal
    const stream = storiesAPI.rewriteThirdPerson(props.storyId, abortController.signal)

    for await (const chunk of stream) {
      // Capture prompts
      if (chunk.prompts) {
        lastPrompts.value = {
          system: chunk.prompts.system || '',
          user: chunk.prompts.user || ''
        }
      }

      // Handle queue status (AI Horde)
      if (chunk.queueStatus) {
        const { position, waitTime, finished, faulted } = chunk.queueStatus
        if (faulted) {
          generationStatus.value = 'Queue error'
        } else if (finished) {
          generationStatus.value = 'Processing...'
        } else if (position === 0) {
          generationStatus.value = `Generating... (ETA: ${waitTime}s)`
        } else {
          generationStatus.value = `In queue: position ${position} (ETA: ${waitTime}s)`
        }
      }

      // Handle reasoning
      if (chunk.reasoning) {
        // Only open panel on first reasoning data if setting is enabled
        if (!showReasoningPanel.value && shouldShowReasoning.value) {
          showReasoningPanel.value = true
        }
        reasoningText += chunk.reasoning
        reasoning.value = reasoningText
      }

      // Handle content
      if (chunk.content) {
        if (generationStatus.value === 'Thinking...' || generationStatus.value.includes('queue') || generationStatus.value.includes('Processing')) {
          generationStatus.value = 'Rewriting...'
        }

        rewrittenContent += chunk.content
        content.value = rewrittenContent

        // Auto-scroll editor
        await nextTick()
        if (editorRef.value) {
          editorRef.value.scrollTop = editorRef.value.scrollHeight
        }
      }

      if (chunk.finished) {
        break
      }
    }

    // Add two line breaks and position cursor at end
    if (rewrittenContent) {
      rewrittenContent += '\n\n'
      content.value = rewrittenContent

      // Normalize trailing line breaks to prevent accumulation
      normalizeTrailingLineBreaks()

      // Position cursor at end
      const cursorPos = rewrittenContent.length
      await nextTick()
      if (editorRef.value) {
        editorRef.value.selectionStart = cursorPos
        editorRef.value.selectionEnd = cursorPos
        editorRef.value.scrollTop = editorRef.value.scrollHeight
        editorRef.value.focus()
      }
    }

    // Save
    await saveStory(true)
    toast.success('Rewrite complete')
  } catch (error) {
    // Check if it was a cancellation
    if (error.name === 'AbortError' || error.message === 'Generation cancelled') {
      console.log('Rewrite was cancelled by user')
      toast.info('Rewrite cancelled')
    } else {
      console.error('Rewrite error:', error)

      // Show error dialog
      const errorMessage = error.message || 'Unknown error occurred'
      await confirm({
        message: `Rewrite Failed\n\n${errorMessage}`,
        confirmText: 'OK',
        cancelText: 'Dismiss',
        variant: 'danger'
      })
    }
  } finally {
    generating.value = false
    abortController = null
  }
}

async function clearStory() {
  const confirmed = await confirm({
    message: 'Clear all story content? This cannot be undone.',
    confirmText: 'Clear Content',
    variant: 'warning'
  })

  if (!confirmed) return

  content.value = ''
  await saveStory()
  toast.success('Story cleared')
}

function exportStory() {
  const blob = new Blob([content.value], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${story.value?.title || 'story'}.txt`
  a.click()
  URL.revokeObjectURL(url)
  toast.success('Story exported')
}

function goToSettings() {
  router.push('/settings')
}

async function handleStoryUpdated() {
  // Reload story data after changes from modals
  await loadStory()
  await loadCharacters()
  // Title will be updated by loadStory()
}

async function deleteStory() {
  const confirmed = await confirm({
    message: `Are you sure you want to delete "${story.value?.title}"? This cannot be undone.`,
    confirmText: 'Delete Story',
    variant: 'danger'
  })

  if (!confirmed) return

  try {
    await storiesAPI.delete(props.storyId)
    toast.success('Story deleted successfully')
    router.push('/')
  } catch (error) {
    console.error('Failed to delete story:', error)
    toast.error('Failed to delete story: ' + error.message)
  }
}

async function handleIdeate() {
  if (generating.value || ideateLoading.value) return

  // Open modal immediately
  showIdeateModal.value = true
  ideateLoading.value = true
  ideateStatus.value = 'Thinking...'
  ideateResponse.value = ''

  // Create abort controller for cancellation
  const ideateAbortController = new AbortController()

  try {
    let responseText = ''

    // Stream ideation with abort signal
    const stream = storiesAPI.ideate(props.storyId, ideateAbortController.signal)

    for await (const chunk of stream) {
      // Handle queue status (AI Horde)
      if (chunk.queueStatus) {
        const { position, waitTime, finished, faulted } = chunk.queueStatus
        if (faulted) {
          ideateStatus.value = 'Queue error'
        } else if (finished) {
          ideateStatus.value = 'Processing...'
        } else if (position === 0) {
          ideateStatus.value = `Generating... (ETA: ${waitTime}s)`
        } else {
          ideateStatus.value = `In queue: position ${position} (ETA: ${waitTime}s)`
        }
      }

      // Handle content
      if (chunk.content) {
        if (ideateStatus.value === 'Thinking...' || ideateStatus.value.includes('queue') || ideateStatus.value.includes('Processing')) {
          ideateStatus.value = 'Writing...'
        }

        responseText += chunk.content
        ideateResponse.value = responseText
      }

      if (chunk.finished) {
        break
      }
    }

    ideateLoading.value = false
  } catch (error) {
    // Check if it was a cancellation
    if (error.name === 'AbortError' || error.message === 'Generation cancelled') {
      console.log('Ideation was cancelled')
      toast.info('Ideation cancelled')
      showIdeateModal.value = false
    } else {
      console.error('Ideation error:', error)
      ideateLoading.value = false
      ideateResponse.value = `Error: ${error.message}`
    }
  }
}

// Generate a unique ID for avatar windows
function generateWindowId() {
  return `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

// Find next available position that doesn't overlap with existing windows
function findNextWindowPosition() {
  const baseX = 20
  const baseY = 100
  const offset = 30

  // Find the maximum offset index used by existing windows
  let maxOffsetIndex = -1
  for (const win of avatarWindows.value) {
    // Calculate which offset index this window might be at
    const offsetIndex = Math.round((win.x - baseX) / offset)
    if (offsetIndex > maxOffsetIndex) {
      maxOffsetIndex = offsetIndex
    }
  }

  // Use the next offset index
  const nextIndex = maxOffsetIndex + 1
  return {
    x: baseX + (nextIndex * offset),
    y: baseY + (nextIndex * offset)
  }
}

// Add a new avatar window
function handleAddAvatarWindow() {
  if (storyCharacters.value.length === 0) return

  const position = findNextWindowPosition()
  const newWindow = {
    id: generateWindowId(),
    characterId: storyCharacters.value[0].id,
    x: position.x,
    y: position.y,
    width: 300,
    height: 400
  }

  avatarWindows.value.push(newWindow)
  saveAvatarWindows()
}

// Handle window close
function handleAvatarWindowClose(windowId) {
  avatarWindows.value = avatarWindows.value.filter(w => w.id !== windowId)
  saveAvatarWindows()
}

// Handle window update (position, size, or character change)
function handleAvatarWindowUpdate(update) {
  const index = avatarWindows.value.findIndex(w => w.id === update.windowId)
  if (index >= 0) {
    avatarWindows.value[index] = {
      id: update.windowId,
      characterId: update.characterId,
      x: update.x,
      y: update.y,
      width: update.width,
      height: update.height
    }
    saveAvatarWindows()
  }
}

// Debounced save to server
let saveAvatarTimeout = null
function saveAvatarWindows() {
  if (saveAvatarTimeout) {
    clearTimeout(saveAvatarTimeout)
  }
  saveAvatarTimeout = setTimeout(async () => {
    try {
      await storiesAPI.updateAvatarWindows(props.storyId, avatarWindows.value)
    } catch (error) {
      console.error('Failed to save avatar windows:', error)
    }
  }, 500) // Debounce 500ms
}
</script>

<style scoped>
.story-editor-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background-color: var(--bg-secondary);
}

.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  background-color: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
  box-shadow: var(--shadow);
  position: relative;
  z-index: 200;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
  min-width: 0;
}

.header-left .btn {
  flex-shrink: 0;
}

.story-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--primary-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.header-right {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

.editor-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-container {
  flex: 1;
  overflow: hidden;
  display: flex;
}

.story-editor {
  width: 100%;
  height: 100%;
  padding-top: 2rem;
  padding-bottom: 2rem;
  padding-left: max(2rem, calc((100% - 700px) / 2));
  padding-right: max(2rem, calc((100% - 700px) / 2));
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 1rem;
  line-height: 1.8;
  border: 0;
  resize: none;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: var(--shadow);
}

.story-editor:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.1);
}

.bottom-toolbar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 2rem;
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  position: relative;
}

.toolbar-main-buttons {
  display: flex;
  gap: 0.75rem;
  flex: 1;
  align-items: center;
  position: relative;
}

.toolbar-main-buttons .btn:not(.icon-btn) {
  flex: 1;
}

.overflow-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 0.5rem;
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  min-width: 200px;
}

.overflow-menu-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: background-color 0.2s;
}

.overflow-menu-item:hover {
  background-color: var(--bg-secondary);
}

.overflow-menu-item i {
  width: 1.25rem;
  text-align: center;
}

.generating-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  color: var(--text-secondary);
  width: 100%;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 3px solid var(--border-color);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.stop-button {
  margin-left: auto;
  white-space: nowrap;
}
</style>
