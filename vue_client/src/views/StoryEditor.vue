<template>
  <div class="story-editor-page">
    <!-- Header -->
    <header class="editor-header">
      <div class="header-left">
        <button class="btn btn-secondary btn-small" @click="goBack">
          <i class="fas fa-arrow-left"></i> Back
        </button>
        <h1 class="story-title">{{ story?.title || 'Loading...' }}</h1>
      </div>
      <div class="header-right">
        <button
          class="icon-btn"
          @click="saveStory"
          :title="hasUnsavedChanges ? 'Save changes' : 'All changes saved'"
        >
          <i v-if="hasUnsavedChanges" class="fas fa-floppy-disk"></i>
          <i v-else class="fas fa-check"></i>
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
        </div>

        <!-- Toolbar Buttons -->
        <div v-else class="toolbar-main-buttons">
          <button
            class="btn btn-primary"
            :disabled="!story || storyCharacters.length === 0"
            @click="handleCharacterResponse"
          >
            <i class="fas fa-comments"></i> Continue for Character
          </button>
          <button
            class="btn btn-secondary"
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
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { storiesAPI, charactersAPI, settingsAPI } from '../services/api'
import ReasoningPanel from '../components/ReasoningPanel.vue'
import CharacterResponseModal from '../components/CharacterResponseModal.vue'
import GreetingSelectorModal from '../components/GreetingSelectorModal.vue'
import ViewPromptModal from '../components/ViewPromptModal.vue'
import CustomPromptModal from '../components/CustomPromptModal.vue'

const props = defineProps({
  storyId: {
    type: String,
    required: true
  }
})

const router = useRouter()

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
const storyCharacters = ref([])
const shouldShowReasoning = ref(false) // Setting from server

// Computed
const hasUnsavedChanges = computed(() => {
  return content.value !== originalContent.value
})

// Auto-save
let autoSaveTimeout = null

onMounted(async () => {
  await Promise.all([loadStory(), loadCharacters(), loadSettings()])
  startAutoSave()
})

onUnmounted(() => {
  stopAutoSave()
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
  } catch (error) {
    console.error('Failed to load story:', error)
    alert('Failed to load story: ' + error.message)
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
      showToast('Story saved')
    }
  } catch (error) {
    console.error('Failed to save story:', error)
    if (!silent) {
      alert('Failed to save story: ' + error.message)
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
    showToast('No characters in this story')
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

  try {
    generating.value = true
    generationStatus.value = 'Thinking...'
    reasoning.value = ''
    showReasoningPanel.value = shouldShowReasoning.value

    // Track cursor position
    const cursorPos = editorRef.value.selectionStart
    const textBefore = content.value.substring(0, cursorPos)
    const textAfter = content.value.substring(cursorPos)

    let generatedContent = ''
    let reasoningText = ''

    // Stream generation
    const stream = isCustom
      ? storiesAPI.continueWithInstruction(props.storyId, instruction)
      : storiesAPI.continueStory(props.storyId, characterId)

    for await (const chunk of stream) {
      // Capture prompts
      if (chunk.prompts) {
        lastPrompts.value = {
          system: chunk.prompts.system || '',
          user: chunk.prompts.user || ''
        }
      }

      // Handle reasoning
      if (chunk.reasoning) {
        reasoningText += chunk.reasoning
        reasoning.value = reasoningText
      }

      // Handle content
      if (chunk.content) {
        if (generationStatus.value === 'Thinking...') {
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
    showToast('Generation complete')
  } catch (error) {
    console.error('Generation error:', error)
    alert('Generation failed: ' + error.message)
  } finally {
    generating.value = false
  }
}

async function selectGreeting(greeting) {
  content.value = greeting + '\n\n'
  await saveStory()
  showGreetingSelector.value = false
  showToast('Greeting selected')
}

async function rewriteToThirdPerson() {
  if (!confirm('This will replace the entire document with a rewritten version in third-person past tense. Continue?')) {
    return
  }

  // Save before rewriting
  await saveStory(true)

  try {
    generating.value = true
    generationStatus.value = 'Thinking...'
    reasoning.value = ''
    showReasoningPanel.value = shouldShowReasoning.value

    // Clear editor for rewrite
    content.value = ''

    let rewrittenContent = ''
    let reasoningText = ''

    // Stream rewrite
    const stream = storiesAPI.rewriteThirdPerson(props.storyId)

    for await (const chunk of stream) {
      // Capture prompts
      if (chunk.prompts) {
        lastPrompts.value = {
          system: chunk.prompts.system || '',
          user: chunk.prompts.user || ''
        }
      }

      // Handle reasoning
      if (chunk.reasoning) {
        reasoningText += chunk.reasoning
        reasoning.value = reasoningText
      }

      // Handle content
      if (chunk.content) {
        if (generationStatus.value === 'Thinking...') {
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
    showToast('Rewrite complete')
  } catch (error) {
    console.error('Rewrite error:', error)
    alert('Rewrite failed: ' + error.message)
  } finally {
    generating.value = false
  }
}

async function clearStory() {
  if (!confirm('Clear all story content? This cannot be undone.')) {
    return
  }
  content.value = ''
  await saveStory()
  showToast('Story cleared')
}

function exportStory() {
  const blob = new Blob([content.value], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${story.value?.title || 'story'}.txt`
  a.click()
  URL.revokeObjectURL(url)
  showToast('Story exported')
}

function showToast(message) {
  // Simple toast - could be enhanced with a proper toast component
  console.log('Toast:', message)
}

function goBack() {
  router.push({ name: 'home' })
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
</style>
