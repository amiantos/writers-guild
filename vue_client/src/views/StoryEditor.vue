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
        <!-- Enhanced Story Mode is its own view, with nothing to switch to -->
        <button
          v-if="!enhancedEnabled"
          class="icon-btn"
          :class="{ 'icon-btn-active': showPreview }"
          @click="showPreview = !showPreview"
          :title="showPreview ? 'Switch to editor' : 'Preview rendered content'"
        >
          <i class="fas fa-eye"></i>
        </button>
        <button class="icon-btn" @click="showManageCharacters = true" title="Manage Characters">
          <i class="fas fa-user"></i>
        </button>
        <button class="icon-btn" @click="showManageLorebooks = true" title="Manage Lorebooks">
          <i class="fas fa-book"></i>
        </button>
        <button class="icon-btn" @click="showRenameStory = true" title="Edit Story">
          <i class="fas fa-pencil"></i>
        </button>
        <button class="icon-btn" @click="showPresetSelector = true" title="Configuration Preset">
          <i class="fas fa-sliders"></i>
        </button>
        <button class="icon-btn" @click="deleteStory" title="Delete Story">
          <i class="fas fa-trash"></i>
        </button>
        <button class="icon-btn" @click="goToSettings" title="Settings">
          <i class="fas fa-cog"></i>
        </button>
      </div>
    </header>

    <!-- Main Content -->
    <div class="editor-content">
      <!-- Reasoning Panel -->
      <!-- Enhanced Story Mode shows reasoning in the seam above each passage instead -->
      <ReasoningPanel
        v-if="showReasoningPanel && !enhancedEnabled"
        :reasoning="reasoning"
        @close="showReasoningPanel = false"
      />

      <!-- Text Editor / Preview -->
      <div v-if="viewReady" class="editor-container">
        <EnhancedStoryView
          v-if="enhancedEnabled"
          ref="enhancedRef"
          :content="content"
          :passages="passages"
          :pending="livePassage"
          :reasoning="reasoning"
          :show-reasoning="shouldShowReasoning"
          :busy="generating || undoRedoInProgress"
          @save="handlePassageSave"
          @delete="handlePassageDelete"
          @regenerate="handlePassageRegenerate"
        />
        <textarea
          v-else-if="!showPreview"
          ref="editorRef"
          v-model="content"
          class="story-editor"
          placeholder="Start writing your story here..."
          spellcheck="true"
          @input="handleInput"
        ></textarea>
        <div v-else ref="previewRef" class="story-preview" v-html="renderedContent"></div>

        <!-- Bottom input bar for preview mode -->
        <div v-if="showPreview && !enhancedEnabled" class="preview-input-bar">
          <input
            ref="bottomInputRef"
            v-model="bottomInput"
            type="text"
            class="preview-input"
            placeholder="Write more here..."
            @keydown.enter="handleBottomInputSend"
          />
          <button
            class="btn btn-primary btn-send"
            :disabled="!bottomInput.trim()"
            @click="handleBottomInputSend"
          >
            <i class="fas fa-paper-plane"></i> Send
          </button>
        </div>
      </div>

      <!-- Enhanced Story Mode's composer, in place of the toolbar -->
      <StoryModeComposer
        v-if="viewReady && enhancedEnabled"
        ref="composerRef"
        :generating="generating"
        :status="generationStatus"
        :ready="Boolean(story)"
        :empty="isStoryEmpty"
        :can-continue-for-character="storyCharacters.length > 0"
        @send="handleComposerSend"
        @add="handleComposerAdd"
        @instruct="handleComposerInstruct"
        @continue="handleContinue"
        @character="handleCharacterResponse"
        @start="handleStoryStarter"
        @greeting="showGreetingSelector = true"
        @stop="cancelGeneration"
      >
        <template #tools>
          <div class="toolbar-icon-group">
            <button
              class="btn btn-secondary icon-btn"
              @click="handleUndo"
              :disabled="!canUndo"
              title="Undo (Ctrl/Cmd+Z)"
              aria-label="Undo"
            >
              <i class="fas fa-rotate-left" aria-hidden="true"></i>
            </button>
            <button
              class="btn btn-secondary icon-btn"
              @click="handleRedo"
              :disabled="!canRedo"
              title="Redo (Ctrl/Cmd+Shift+Z)"
              aria-label="Redo"
            >
              <i class="fas fa-rotate-right" aria-hidden="true"></i>
            </button>
            <button
              class="btn btn-secondary icon-btn"
              @click="showOverflowMenu = !showOverflowMenu"
              aria-label="More options"
            >
              <i class="fas fa-ellipsis-vertical" aria-hidden="true"></i>
            </button>
          </div>
          <StoryOverflowMenu
            v-if="showOverflowMenu"
            align="left"
            :can-add-avatar="storyCharacters.length > 0"
            :can-view-prompt="Boolean(lastPrompts.system || lastPrompts.user)"
            @close="showOverflowMenu = false"
            @greeting="showGreetingSelector = true"
            @avatar="handleAddAvatarWindow"
            @ideate="handleIdeate"
            @rewrite="rewriteToThirdPerson()"
            @clear="clearStory"
            @export="exportStory"
            @view-prompt="showViewPromptModal = true"
          />
        </template>
      </StoryModeComposer>

      <!-- Bottom Toolbar -->
      <div v-else-if="viewReady" class="bottom-toolbar">
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
          <!-- Show Story Starter when content is empty -->
          <template v-if="isStoryEmpty">
            <button class="btn btn-primary" :disabled="!story" @click="handleStoryStarter">
              <i class="fas fa-rocket"></i> Start Story
            </button>
            <button
              class="btn btn-secondary"
              :disabled="!story"
              @click="showGreetingSelector = true"
            >
              <i class="fas fa-message"></i> Select Greeting
            </button>
          </template>

          <!-- Show regular continue buttons when content exists -->
          <template v-else>
            <button
              class="btn btn-secondary"
              :disabled="!story || storyCharacters.length === 0"
              @click="handleCharacterResponse"
            >
              <i class="fas fa-comments"></i> Continue for Character
            </button>
            <button class="btn btn-primary" :disabled="!story" @click="handleContinue">
              <i class="fas fa-play"></i> Continue
            </button>
            <button
              class="btn btn-secondary"
              :disabled="!story"
              @click="showCustomPromptModal = true"
            >
              <i class="fas fa-wand-magic-sparkles"></i> Continue with Instruction
            </button>
          </template>
          <div class="toolbar-icon-group">
            <button
              class="btn btn-secondary icon-btn"
              @click="handleUndo"
              :disabled="!canUndo"
              title="Undo (Ctrl/Cmd+Z)"
              aria-label="Undo"
            >
              <i class="fas fa-rotate-left" aria-hidden="true"></i>
            </button>
            <button
              class="btn btn-secondary icon-btn"
              @click="handleRedo"
              :disabled="!canRedo"
              title="Redo (Ctrl/Cmd+Shift+Z)"
              aria-label="Redo"
            >
              <i class="fas fa-rotate-right" aria-hidden="true"></i>
            </button>
            <button
              class="btn btn-secondary icon-btn"
              @click="showOverflowMenu = !showOverflowMenu"
              aria-label="More options"
            >
              <i class="fas fa-ellipsis-vertical" aria-hidden="true"></i>
            </button>
          </div>

          <!-- Overflow Menu -->
          <StoryOverflowMenu
            v-if="showOverflowMenu"
            :can-add-avatar="storyCharacters.length > 0"
            :can-view-prompt="Boolean(lastPrompts.system || lastPrompts.user)"
            @close="showOverflowMenu = false"
            @greeting="showGreetingSelector = true"
            @avatar="handleAddAvatarWindow"
            @ideate="handleIdeate"
            @rewrite="rewriteToThirdPerson()"
            @clear="clearStory"
            @export="exportStory"
            @view-prompt="showViewPromptModal = true"
          />
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
      @close="handleCloseGreeting"
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
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { storiesAPI, charactersAPI, settingsAPI } from '../services/api';
import { useToast } from '../composables/useToast';
import { useNavigation } from '../composables/useNavigation';
import { useConfirm } from '../composables/useConfirm';
import { setPageTitle } from '../router';
import {
  MARKDOWN_IMAGE_RE,
  MARKDOWN_IMAGE_NORMALIZE_RE,
  HTML_IMAGE_RE,
} from '../../../shared/regex-patterns.js';
import DOMPurify from 'dompurify';
import ReasoningPanel from '../components/ReasoningPanel.vue';
import CharacterResponseModal from '../components/CharacterResponseModal.vue';
import GreetingSelectorModal from '../components/GreetingSelectorModal.vue';
import ViewPromptModal from '../components/ViewPromptModal.vue';
import CustomPromptModal from '../components/CustomPromptModal.vue';
import ManageCharactersModal from '../components/ManageCharactersModal.vue';
import ManageLorebooksModal from '../components/ManageLorebooksModal.vue';
import RenameStoryModal from '../components/RenameStoryModal.vue';
import StoryPresetModal from '../components/StoryPresetModal.vue';
import IdeateModal from '../components/IdeateModal.vue';
import FloatingAvatarWindow from '../components/FloatingAvatarWindow.vue';
import ThirdPersonPromptModal from '../components/ThirdPersonPromptModal.vue';
import EnhancedStoryView from '../components/story/EnhancedStoryView.vue';
import StoryModeComposer from '../components/story/StoryModeComposer.vue';
import StoryOverflowMenu from '../components/story/StoryOverflowMenu.vue';
import { SKIP_THIRD_PERSON_PROMPT_KEY } from '../config/storageKeys';
import {
  appendText,
  newPassageId,
  pruneRecords,
  removeBlock,
  replaceBlock,
} from '../composables/storyPassages';

const props = defineProps({
  storyId: {
    type: String,
    required: true,
  },
});

const router = useRouter();
const route = useRoute();
const toast = useToast();
const { goBack } = useNavigation();
const { confirm } = useConfirm();

// State
const story = ref(null);
const content = ref('');
const originalContent = ref('');
const editorRef = ref(null);
const previewRef = ref(null);
const generating = ref(false);
const generationStatus = ref('Thinking...');
const reasoning = ref('');
const showReasoningPanel = ref(false);
const lastPrompts = ref({ system: '', user: '' });
const showOverflowMenu = ref(false);
const showCharacterSelector = ref(false);
const showGreetingSelector = ref(false);
const showViewPromptModal = ref(false);
const showCustomPromptModal = ref(false);
const showManageCharacters = ref(false);
const showManageLorebooks = ref(false);
const showRenameStory = ref(false);
const showPresetSelector = ref(false);
const showIdeateModal = ref(false);
const ideateResponse = ref('');
const ideateLoading = ref(false);
const ideateStatus = ref('Thinking...');
const showThirdPersonPrompt = ref(false);
const showPreview = ref(false);
let abortController = null;

// Bottom input for preview mode
const bottomInput = ref('');
const bottomInputRef = ref(null);

// Enhanced Story Mode (experimental): in place of the editor and preview, the story as passages,
// with how each was written between them. It changes how the story is shown and edited, never
// what's sent to the model.
const enhancedEnabled = ref(false);
// The story and settings have loaded, so it's known which view to show.
const viewReady = ref(false);
const enhancedRef = ref(null);
const composerRef = ref(null);
// The record of the story's passages (see storyPassages.js), kept while Enhanced Story Mode is on.
const passages = ref([]);
// The record changed since it was last saved.
let passagesDirty = false;
// The passage being written: where it starts in the content, what it is, and its text so far.
const pending = ref(null);
const livePassage = computed(() =>
  pending.value ? { ...pending.value, status: generationStatus.value } : null,
);

// Check if story has images
const hasImages = computed(() => {
  if (!content.value) return false;
  return MARKDOWN_IMAGE_RE.test(content.value) || HTML_IMAGE_RE.test(content.value);
});

// Avatar windows (stored on server per-story)
const avatarWindows = ref([]);

const storyCharacters = ref([]);
const shouldShowReasoning = ref(false); // Setting from server

// Computed: is story content empty?
const isStoryEmpty = computed(() => {
  return !content.value || content.value.trim().length === 0;
});

// Throttled rendered content — updated at most once per animation frame
// to avoid tearing down/recreating <img> elements on every streaming token.
function renderContent(text) {
  if (!text) return '';
  let html = text;

  // 1. Extract HTML <img> tags before escaping so they survive the pipeline
  const savedImgs = [];
  HTML_IMAGE_RE.lastIndex = 0;
  html = html.replace(HTML_IMAGE_RE, (match) => {
    const marker = `\x00IMG_MARKER_${savedImgs.length}\x00`;
    savedImgs.push({ marker, original: match });
    // Inject loading=lazy and class=story-image into the saved tag
    const enhanced = match.replace('<img', '<img loading="lazy" class="story-image"');
    savedImgs[savedImgs.length - 1].original = enhanced;
    return marker;
  });

  // 2. Escape HTML special chars including quotes (defense before markdown img injection)
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // 3. Convert markdown images: ![alt](url) and ![alt] (url)
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  html = html.replace(
    MARKDOWN_IMAGE_RE,
    '<img src="$2" alt="$1" class="story-image" loading="lazy">',
  );

  // 4. Convert double newlines to paragraphs
  html = '<p>' + html.replace(/\n\n/g, '</p><p>') + '</p>';
  // Convert single newlines to <br>
  html = html.replace(/\n/g, '<br>');
  // Remove empty paragraphs
  html = html.replace(/<p><\/p>/g, '');

  // 5. Restore saved HTML <img> tags (reinserted after all transformations)
  for (const { marker, original } of savedImgs) {
    html = html.replace(marker, original);
  }

  // 6. Sanitize final HTML against any remaining XSS vectors (event handlers, javascript: URLs, etc.)
  html = DOMPurify.sanitize(html);
  return html;
}

const renderedContent = ref('');
let renderRAF = null;

function scheduleRender() {
  if (renderRAF) return;
  renderRAF = requestAnimationFrame(() => {
    renderRAF = null;
    renderedContent.value = renderContent(content.value);
  });
}

watch(content, scheduleRender, { immediate: true });

// Auto-save
let autoSaveTimeout = null;

// Undo/Redo state
const canUndo = ref(false);
const canRedo = ref(false);
let isUndoRedoOperation = false; // Flag to skip auto-save during undo/redo
const undoRedoInProgress = ref(false); // Prevents rapid concurrent undo/redo operations

// Normalize trailing line breaks to exactly 2
function normalizeTrailingLineBreaks() {
  const trimmed = content.value.replace(/\n+$/, '');
  content.value = trimmed + '\n\n';
}

// Normalize markdown image syntax spacing: ![alt] (url) -> ![alt](url)
function normalizeMarkdownImageSpacing(text) {
  if (!text) return text;
  MARKDOWN_IMAGE_NORMALIZE_RE.lastIndex = 0;
  return text.replace(MARKDOWN_IMAGE_NORMALIZE_RE, '![$1]($2)');
}

// Keyboard shortcut handler for quick paragraph generation, modal opening, and undo/redo
function handleKeyboardShortcut(event) {
  // Check for Cmd (Mac) or Ctrl (Windows/Linux) modifier
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modifierKey = isMac ? event.metaKey : event.ctrlKey;

  if (!modifierKey) return;

  // In Enhanced Story Mode, text boxes keep their own shortcuts: the composer sends with
  // Cmd/Ctrl+Enter, and undo stays inside the box being typed in.
  if (
    enhancedEnabled.value &&
    event.target instanceof Element &&
    event.target.closest('textarea')
  ) {
    return;
  }

  // Cmd/Ctrl+Enter opens the Continue with Instruction modal
  if (event.key === 'Enter' && !event.shiftKey) {
    // Don't trigger if a modal is already open or if generating
    if (showCustomPromptModal.value || generating.value || !story.value) return;

    event.preventDefault();
    showCustomPromptModal.value = true;
    return;
  }

  // Cmd/Ctrl+Z for undo, Cmd/Ctrl+Shift+Z for redo
  if (event.key === 'z') {
    // Don't trigger if generating
    if (generating.value || !story.value) return;

    if (event.shiftKey) {
      // Redo
      event.preventDefault();
      handleRedo();
    } else {
      // Undo
      event.preventDefault();
      handleUndo();
    }
  }
}

// Check if we should show the third person prompt (respects "don't ask again" preference)
function shouldShowThirdPersonPrompt() {
  return localStorage.getItem(SKIP_THIRD_PERSON_PROMPT_KEY) !== 'true';
}

onMounted(async () => {
  await Promise.all([loadStory(), loadSettings()]);
  viewReady.value = true;
  await loadCharacters();
  startAutoSave();

  // Load avatar windows from story
  if (story.value?.avatarWindows) {
    avatarWindows.value = story.value.avatarWindows;
  }

  // Set preview mode as default if story has images
  if (hasImages.value) {
    showPreview.value = true;
  }

  // Add keyboard shortcut listener
  window.addEventListener('keydown', handleKeyboardShortcut);

  // Check if we should show greeting selector first (for newly created stories with characters)
  if (story.value?.needsRewritePrompt && story.value?.characterIds?.length > 0) {
    // Clear the flag on the server
    try {
      await storiesAPI.setRewritePrompt(props.storyId, false);
    } catch (error) {
      console.error('Failed to clear rewrite prompt flag:', error);
    }

    // Show greeting selector FIRST before rewrite dialog
    showGreetingSelector.value = true;
    return;
  }

  // If we don't need to show greeting selector, check if we should show rewrite dialog
  if (story.value?.needsRewritePrompt) {
    // Clear the flag on the server
    try {
      await storiesAPI.setRewritePrompt(props.storyId, false);
    } catch (error) {
      console.error('Failed to clear rewrite prompt flag:', error);
    }
    if (shouldShowThirdPersonPrompt()) {
      // Show the prompt after a short delay to let the UI settle
      await nextTick();
      showThirdPersonPrompt.value = true;
    }
  }
});

onUnmounted(() => {
  stopAutoSave();
  // Mark component as unmounted to prevent API calls after destruction
  isMounted.value = false;
  // Clear avatar window save timeout to prevent memory leaks
  if (saveAvatarTimeoutRef.value) {
    clearTimeout(saveAvatarTimeoutRef.value);
  }
  // Remove keyboard shortcut listener
  window.removeEventListener('keydown', handleKeyboardShortcut);
  // Cancel pending render to prevent updating after unmount
  if (renderRAF) {
    cancelAnimationFrame(renderRAF);
    renderRAF = null;
  }
});

// Watch content changes for auto-save
watch(content, () => {
  // Skip auto-save if this is an undo/redo operation
  if (isUndoRedoOperation) {
    return;
  }

  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
  }
  autoSaveTimeout = setTimeout(() => {
    saveStory(true); // silent save
  }, 2000); // Save 2 seconds after last edit
});

// Watch reasoning panel opening to scroll textarea to bottom
watch(showReasoningPanel, async (isOpen) => {
  if (isOpen) {
    await nextTick();
    if (editorRef.value) {
      editorRef.value.scrollTop = editorRef.value.scrollHeight;
      editorRef.value.focus();
    }
  }
});

// Scroll to end when toggling preview or back to editor
watch(showPreview, async (isPreview) => {
  await nextTick();
  if (isPreview && previewRef.value) {
    previewRef.value.scrollTop = previewRef.value.scrollHeight;
  } else if (!isPreview && editorRef.value) {
    editorRef.value.scrollTop = editorRef.value.scrollHeight;
    editorRef.value.focus();
  }
});

// Close all avatar windows when characters are removed from story
watch(storyCharacters, (characters) => {
  if (characters.length === 0 && avatarWindows.value.length > 0) {
    avatarWindows.value = [];
    saveAvatarWindows();
  }
});

async function loadStory() {
  try {
    const { story: loadedStory } = await storiesAPI.get(props.storyId);
    story.value = loadedStory;
    content.value = loadedStory.content || '';
    originalContent.value = content.value;
    passages.value = loadedStory.passages ?? [];
    passagesDirty = false;
    // Update page title with story name
    setPageTitle(loadedStory.title || 'Untitled Story');

    // Fetch initial history status
    try {
      const historyStatus = await storiesAPI.getHistoryStatus(props.storyId);
      canUndo.value = historyStatus.canUndo;
      canRedo.value = historyStatus.canRedo;
    } catch (err) {
      console.error('Failed to load history status:', err);
    }
  } catch (error) {
    console.error('Failed to load story:', error);
    toast.error('Failed to load story: ' + error.message);
  }
}

async function loadCharacters() {
  try {
    if (!story.value || !story.value.characterIds || story.value.characterIds.length === 0) {
      storyCharacters.value = [];
      return;
    }

    // Load all characters and filter to story's characters
    const { characters: allChars } = await charactersAPI.list();
    storyCharacters.value = allChars.filter((c) => story.value.characterIds.includes(c.id));
  } catch (error) {
    console.error('Failed to load characters:', error);
  }
}

async function loadSettings() {
  try {
    const response = await settingsAPI.get();
    const serverSettings = response.settings || response;
    shouldShowReasoning.value = serverSettings.showReasoning ?? false;
    enhancedEnabled.value = serverSettings.experimentalEnhancedStory ?? false;
  } catch (error) {
    console.error('Failed to load settings:', error);
    // Default to false if settings can't be loaded
    shouldShowReasoning.value = false;
  }
}

async function saveStory(silent = false) {
  const normalizedContent = normalizeMarkdownImageSpacing(content.value);
  const normalizedOriginal = normalizeMarkdownImageSpacing(originalContent.value);

  // Check if normalization changed the editor content (e.g., image spacing)
  const wasNormalized = normalizedContent !== content.value;

  // Keep editor content canonical when save is triggered
  if (wasNormalized) {
    content.value = normalizedContent;
  }

  // Only skip save if there are no semantic changes AND no formatting normalization
  if (!wasNormalized && normalizedContent === normalizedOriginal && !passagesDirty) {
    return; // No changes
  }

  // The record of passages goes along only when it changed, since it carries their reasoning.
  const sendPassages = passagesDirty;
  if (sendPassages) {
    passages.value = pruneRecords(passages.value, normalizedContent);
    passagesDirty = false;
  }

  try {
    const result = await storiesAPI.updateContent(
      props.storyId,
      normalizedContent,
      sendPassages ? passages.value : undefined,
    );
    originalContent.value = normalizedContent;

    // Update history status from response
    if (result.canUndo !== undefined) {
      canUndo.value = result.canUndo;
    }
    if (result.canRedo !== undefined) {
      canRedo.value = result.canRedo;
    }

    if (!silent) {
      toast.success('Story saved');
    }
  } catch (error) {
    console.error('Failed to save story:', error);
    if (sendPassages) passagesDirty = true;
    if (!silent) {
      toast.error('Failed to save story: ' + error.message);
    }
  }
}

function startAutoSave() {
  // Auto-save handled by watch
}

function stopAutoSave() {
  if (autoSaveTimeout) {
    clearTimeout(autoSaveTimeout);
  }
}

function handleInput() {
  // Handled by watch
}

async function handleUndo() {
  if (!canUndo.value || generating.value || undoRedoInProgress.value) return;

  undoRedoInProgress.value = true;
  isUndoRedoOperation = true;

  try {
    const result = await storiesAPI.undo(props.storyId);

    // Update content
    content.value = result.content;
    originalContent.value = result.content;

    // Update history status
    canUndo.value = result.canUndo;
    canRedo.value = result.canRedo;

    // Scroll to bottom after content update
    await nextTick();
    if (editorRef.value) {
      editorRef.value.scrollTop = editorRef.value.scrollHeight;
    }
  } catch (error) {
    console.error('Failed to undo:', error);
    if (error.message !== 'Nothing to undo') {
      toast.error('Failed to undo: ' + error.message);
    }
  } finally {
    // Always clear flags, even on error
    await nextTick();
    isUndoRedoOperation = false;
    undoRedoInProgress.value = false;
  }
}

async function handleRedo() {
  if (!canRedo.value || generating.value || undoRedoInProgress.value) return;

  undoRedoInProgress.value = true;
  isUndoRedoOperation = true;

  try {
    const result = await storiesAPI.redo(props.storyId);

    // Update content
    content.value = result.content;
    originalContent.value = result.content;

    // Update history status
    canUndo.value = result.canUndo;
    canRedo.value = result.canRedo;

    // Scroll to bottom after content update
    await nextTick();
    if (editorRef.value) {
      editorRef.value.scrollTop = editorRef.value.scrollHeight;
    }
  } catch (error) {
    console.error('Failed to redo:', error);
    if (error.message !== 'Nothing to redo') {
      toast.error('Failed to redo: ' + error.message);
    }
  } finally {
    // Always clear flags, even on error
    await nextTick();
    isUndoRedoOperation = false;
    undoRedoInProgress.value = false;
  }
}

async function handleBottomInputSend() {
  if (!bottomInput.value.trim() || generating.value) return;

  try {
    // Add user message to content with newline before and after
    const userMessage = bottomInput.value.trim();
    const trimmed = content.value.replace(/\n+$/, '');
    content.value = trimmed + '\n\n' + userMessage + '\n\n';

    bottomInput.value = '';

    // Save the story
    await saveStory(true);

    // Trigger character response
    await handleCharacterResponse();
  } catch (error) {
    console.error('Failed to send message:', error);
    toast.error('Failed to send message: ' + error.message);
  }
}

async function handleContinue() {
  await generate(false, null, null);
}

function handleCharacterResponse() {
  if (storyCharacters.value.length === 0) {
    toast.info('No characters in this story');
    return;
  } else if (storyCharacters.value.length === 1) {
    // Only one character, generate directly
    generate(false, null, storyCharacters.value[0].id);
  } else {
    // Multiple characters, show selector
    showCharacterSelector.value = true;
  }
}

function handleCharacterSelected(characterId) {
  showCharacterSelector.value = false;
  generate(false, null, characterId);
}

async function handleCustomPrompt(instruction) {
  await generate(true, instruction, null);
}

async function handleStoryStarter() {
  if (generating.value) return;

  // Create abort controller for cancellation
  abortController = new AbortController();

  let generatedContent = '';
  let reasoningText = '';
  const passage = { source: 'generated', action: 'starter' };

  try {
    generating.value = true;
    generationStatus.value = 'Thinking...';
    reasoning.value = '';
    showReasoningPanel.value = false;
    pending.value = { start: 0, text: '', ...passage };

    // Stream generation with abort signal
    const stream = storiesAPI.storyStarter(props.storyId, abortController.signal);

    for await (const chunk of stream) {
      // Capture prompts
      if (chunk.prompts) {
        lastPrompts.value = {
          system: chunk.prompts.system || '',
          user: chunk.prompts.user || '',
        };
      }

      // Handle queue status (AI Horde)
      if (chunk.queueStatus) {
        const { position, waitTime, finished, faulted } = chunk.queueStatus;
        if (faulted) {
          generationStatus.value = 'Queue error';
        } else if (finished) {
          generationStatus.value = 'Processing...';
        } else if (position === 0) {
          generationStatus.value = `Generating... (ETA: ${waitTime}s)`;
        } else {
          generationStatus.value = `In queue: position ${position} (ETA: ${waitTime}s)`;
        }
      }

      // Handle reasoning
      if (chunk.reasoning) {
        if (!showReasoningPanel.value && shouldShowReasoning.value) {
          showReasoningPanel.value = true;
        }
        reasoningText += chunk.reasoning;
        reasoning.value = reasoningText;
      }

      // Handle content
      if (chunk.content) {
        if (
          generationStatus.value === 'Thinking...' ||
          generationStatus.value.includes('queue') ||
          generationStatus.value.includes('Processing')
        ) {
          generationStatus.value = 'Writing...';
        }

        generatedContent += chunk.content;
        content.value = generatedContent;
        if (pending.value) pending.value.text = generatedContent;

        // Auto-scroll editor
        await nextTick();
        if (editorRef.value) {
          editorRef.value.scrollTop = editorRef.value.scrollHeight;
        }
      }

      // Server restores [WG_IMAGE_n] markers back to image markup on the final
      // chunk. Without this the placeholder stays visible in the story.
      if (chunk.imagesRestored && chunk.finalContent !== undefined) {
        generatedContent = chunk.finalContent;
        content.value = generatedContent;
        if (pending.value) pending.value.text = generatedContent;
        await nextTick();
        if (editorRef.value) {
          editorRef.value.scrollTop = editorRef.value.scrollHeight;
        }
      }

      if (chunk.finished) {
        break;
      }
    }

    // Add two line breaks
    if (generatedContent) {
      recordPassage(generatedContent, passage, reasoningText);
      generatedContent += '\n\n';
      content.value = generatedContent;
      normalizeTrailingLineBreaks();

      await nextTick();
      if (editorRef.value) {
        editorRef.value.selectionStart = generatedContent.length;
        editorRef.value.selectionEnd = generatedContent.length;
        editorRef.value.scrollTop = editorRef.value.scrollHeight;
        editorRef.value.focus();
      }
    }

    // Save
    await saveStory(true);
    toast.success('Story started!');
  } catch (error) {
    if (recordPassage(generatedContent, passage, reasoningText)) {
      await saveStory(true);
    }
    if (error.name === 'AbortError' || error.message === 'Generation cancelled') {
      console.log('Story starter was cancelled by user');
      toast.info('Generation cancelled');
    } else {
      console.error('Story starter error:', error);
      const errorMessage = error.message || 'Unknown error occurred';
      await confirm({
        message: `Story Starter Failed\n\n${errorMessage}`,
        confirmText: 'OK',
        cancelText: 'Dismiss',
        variant: 'danger',
      });
    }
  } finally {
    generating.value = false;
    pending.value = null;
    abortController = null;
  }
}

/**
 * Generate at the cursor, or at the end outside the editor. Returns whether anything was written.
 */
async function generate(isCustom, instruction, characterId) {
  if (generating.value) return;

  // Save before generating
  await saveStory(true);

  // Create abort controller for cancellation
  abortController = new AbortController();

  let generatedContent = '';
  let reasoningText = '';
  const passage = {
    source: 'generated',
    action: isCustom ? 'instruction' : characterId ? 'character' : 'continue',
    ...(isCustom && { instruction }),
    ...(characterId && {
      characterId,
      characterName: storyCharacters.value.find((c) => c.id === characterId)?.name,
    }),
  };

  try {
    generating.value = true;
    generationStatus.value = 'Thinking...';
    reasoning.value = '';
    showReasoningPanel.value = false; // Only open when reasoning is actually received

    // Track cursor position (only if editor is visible)
    const cursorPos = editorRef.value ? editorRef.value.selectionStart : content.value.length;
    const textBefore = content.value.substring(0, cursorPos);
    const textAfter = content.value.substring(cursorPos);
    pending.value = { start: textBefore.length, text: '', ...passage };

    // Stream generation with abort signal
    const stream = isCustom
      ? storiesAPI.continueWithInstruction(props.storyId, instruction, abortController.signal)
      : storiesAPI.continueStory(props.storyId, characterId, abortController.signal);

    for await (const chunk of stream) {
      // Capture prompts
      if (chunk.prompts) {
        lastPrompts.value = {
          system: chunk.prompts.system || '',
          user: chunk.prompts.user || '',
        };
      }

      // Handle queue status (AI Horde)
      if (chunk.queueStatus) {
        const { position, waitTime, finished, faulted } = chunk.queueStatus;
        if (faulted) {
          generationStatus.value = 'Queue error';
        } else if (finished) {
          generationStatus.value = 'Processing...';
        } else if (position === 0) {
          generationStatus.value = `Generating... (ETA: ${waitTime}s)`;
        } else {
          generationStatus.value = `In queue: position ${position} (ETA: ${waitTime}s)`;
        }
      }

      // Handle reasoning
      if (chunk.reasoning) {
        // Only open panel on first reasoning data if setting is enabled
        if (!showReasoningPanel.value && shouldShowReasoning.value) {
          showReasoningPanel.value = true;
        }
        reasoningText += chunk.reasoning;
        reasoning.value = reasoningText;
      }

      // Handle content
      if (chunk.content) {
        if (
          generationStatus.value === 'Thinking...' ||
          generationStatus.value.includes('queue') ||
          generationStatus.value.includes('Processing')
        ) {
          generationStatus.value = 'Writing...';
        }

        generatedContent += chunk.content;
        content.value = textBefore + generatedContent + textAfter;
        if (pending.value) pending.value.text = generatedContent;

        // Auto-scroll editor
        await nextTick();
        if (editorRef.value) {
          editorRef.value.scrollTop = editorRef.value.scrollHeight;
        }
      }

      // Server restores [WG_IMAGE_n] markers back to image markup on the final
      // chunk. Without this the placeholder stays visible in the story.
      if (chunk.imagesRestored && chunk.finalContent !== undefined) {
        generatedContent = chunk.finalContent;
        content.value = textBefore + generatedContent + textAfter;
        if (pending.value) pending.value.text = generatedContent;
        await nextTick();
        if (editorRef.value) {
          editorRef.value.scrollTop = editorRef.value.scrollHeight;
        }
      }

      if (chunk.finished) {
        break;
      }
    }

    // Add two line breaks and position cursor
    if (generatedContent) {
      recordPassage(generatedContent, passage, reasoningText);
      generatedContent += '\n\n';
      content.value = textBefore + generatedContent + textAfter;

      // Normalize trailing line breaks to prevent accumulation
      normalizeTrailingLineBreaks();

      // Position cursor after generated content
      const newCursorPos = textBefore.length + generatedContent.length;
      await nextTick();
      if (editorRef.value) {
        editorRef.value.selectionStart = newCursorPos;
        editorRef.value.selectionEnd = newCursorPos;
        editorRef.value.scrollTop = editorRef.value.scrollHeight;
        editorRef.value.focus();
      }
    }

    // Save
    await saveStory(true);
    toast.success('Generation complete');
  } catch (error) {
    if (recordPassage(generatedContent, passage, reasoningText)) {
      await saveStory(true);
    }
    // Check if it was a cancellation
    if (error.name === 'AbortError' || error.message === 'Generation cancelled') {
      console.log('Generation was cancelled by user');
      toast.info('Generation cancelled');
    } else {
      console.error('Generation error:', error);

      // Show error dialog
      const errorMessage = error.message || 'Unknown error occurred';
      await confirm({
        message: `Generation Failed\n\n${errorMessage}`,
        confirmText: 'OK',
        cancelText: 'Dismiss',
        variant: 'danger',
      });
    }
  } finally {
    generating.value = false;
    pending.value = null;
    abortController = null;
  }
  return Boolean(generatedContent.trim());
}

function cancelGeneration() {
  if (abortController) {
    console.log('Cancelling generation...');
    abortController.abort();
  }
}

// ==================== Enhanced Story Mode ====================

// What's been recorded, so a failure after recording a passage doesn't record it twice.
const recordedPassages = new WeakSet();

/**
 * Add a passage to the record, while Enhanced Story Mode is on. Returns whether it was added, so
 * the caller knows to save it.
 */
function recordPassage(text, passage, reasoningText = '') {
  const trimmed = normalizeMarkdownImageSpacing(text.trim());
  if (!enhancedEnabled.value || !trimmed || recordedPassages.has(passage)) return false;
  recordedPassages.add(passage);
  passages.value = [
    ...passages.value,
    {
      id: newPassageId(),
      text: trimmed,
      ...passage,
      ...(reasoningText && { reasoning: reasoningText }),
      created: new Date().toISOString(),
    },
  ];
  passagesDirty = true;
  return true;
}

async function handlePassageSave(block, text) {
  const trimmed = normalizeMarkdownImageSpacing(text.trim());
  content.value = replaceBlock(content.value, block, trimmed);
  if (block.record) {
    passages.value = passages.value.map((record) =>
      record.id === block.record.id ? { ...record, text: trimmed, edited: true } : record,
    );
    passagesDirty = true;
  }
  await saveStory(true);
}

// No confirmation, since Undo brings a deleted passage back, along with how it was written.
async function handlePassageDelete(block) {
  content.value = removeBlock(content.value, block);
  await saveStory(true);
}

/** Write the last passage again: remove it, then send what wrote it once more. */
async function handlePassageRegenerate(block) {
  const record = block.record;
  if (generating.value || !record) return;
  content.value = removeBlock(content.value, block);

  if (record.action === 'starter') {
    await saveStory(true);
    await handleStoryStarter();
  } else if (record.action === 'instruction') {
    await generate(true, record.instruction, null);
  } else if (record.action === 'character') {
    if (storyCharacters.value.some((character) => character.id === record.characterId)) {
      await generate(false, null, record.characterId);
    } else {
      await saveStory(true);
      handleCharacterResponse();
    }
  } else {
    await generate(false, null, null);
  }
}

/** Add the reader's text as a passage of its own, at the end. */
async function addWrittenPassage(text) {
  content.value = appendText(content.value, text);
  recordPassage(text, { source: 'user', action: 'write' });
  await saveStory(true);
  enhancedRef.value?.scrollToEnd();
}

async function handleComposerAdd(text) {
  await addWrittenPassage(text);
}

// As the preview's input bar: add the text, then continue for a character, or just continue in a
// story without characters.
async function handleComposerSend(text) {
  await addWrittenPassage(text);
  if (storyCharacters.value.length > 0) {
    handleCharacterResponse();
  } else {
    await handleContinue();
  }
}

async function handleComposerInstruct(instruction) {
  // Nothing was written, so give the instruction back.
  if (!(await generate(true, instruction, null))) {
    composerRef.value?.restore(instruction);
  }
}

async function selectGreeting(greeting) {
  content.value = greeting + '\n\n';
  recordPassage(greeting, { source: 'user', action: 'greeting' });
  // Switch to preview mode if the greeting contains images
  if (hasImages.value) {
    showPreview.value = true;
  }
  await saveStory();
  showGreetingSelector.value = false;
  toast.success('Greeting selected');

  // Prompt user to rewrite to third person if they haven't opted out
  if (shouldShowThirdPersonPrompt()) {
    await nextTick();
    showThirdPersonPrompt.value = true;
  }
}

/**
 * Called when the greeting selector is dismissed without selecting a greeting.
 * Still shows the third-person rewrite prompt so it isn't silently skipped.
 */
function handleCloseGreeting() {
  showGreetingSelector.value = false;
  nextTick().then(() => {
    if (shouldShowThirdPersonPrompt()) {
      showThirdPersonPrompt.value = true;
    }
  });
}

// Handler for when user accepts the third-person prompt
function handleThirdPersonRewrite() {
  // Call with skipConfirm=true since user already confirmed via the prompt modal
  rewriteToThirdPerson(true);
}

async function rewriteToThirdPerson(skipConfirm = false) {
  if (!skipConfirm) {
    const confirmed = await confirm({
      message:
        'This will replace the entire document with a rewritten version in third-person past tense. Continue?',
      confirmText: 'Rewrite',
      variant: 'warning',
    });

    if (!confirmed) return;
  }

  // Save the current content (with any embedded images) before rewriting
  // The server-side ImagePreserver handles image extraction/restoration
  await saveStory(true);

  // Create abort controller for cancellation
  abortController = new AbortController();

  let rewrittenContent = '';
  let reasoningText = '';
  const passage = { source: 'generated', action: 'rewrite' };

  try {
    generating.value = true;
    generationStatus.value = 'Thinking...';
    reasoning.value = '';
    showReasoningPanel.value = false; // Only open when reasoning is actually received

    // Clear editor for rewrite
    content.value = '';
    pending.value = { start: 0, text: '', ...passage };

    // Stream rewrite with abort signal
    const stream = storiesAPI.rewriteThirdPerson(props.storyId, abortController.signal);

    for await (const chunk of stream) {
      // Capture prompts
      if (chunk.prompts) {
        lastPrompts.value = {
          system: chunk.prompts.system || '',
          user: chunk.prompts.user || '',
        };
      }

      // Handle queue status (AI Horde)
      if (chunk.queueStatus) {
        const { position, waitTime, finished, faulted } = chunk.queueStatus;
        if (faulted) {
          generationStatus.value = 'Queue error';
        } else if (finished) {
          generationStatus.value = 'Processing...';
        } else if (position === 0) {
          generationStatus.value = `Generating... (ETA: ${waitTime}s)`;
        } else {
          generationStatus.value = `In queue: position ${position} (ETA: ${waitTime}s)`;
        }
      }

      // Handle reasoning
      if (chunk.reasoning) {
        // Only open panel on first reasoning data if setting is enabled
        if (!showReasoningPanel.value && shouldShowReasoning.value) {
          showReasoningPanel.value = true;
        }
        reasoningText += chunk.reasoning;
        reasoning.value = reasoningText;
      }

      // Handle content
      if (chunk.content) {
        if (
          generationStatus.value === 'Thinking...' ||
          generationStatus.value.includes('queue') ||
          generationStatus.value.includes('Processing')
        ) {
          generationStatus.value = 'Rewriting...';
        }

        rewrittenContent += chunk.content;
        content.value = rewrittenContent;
        if (pending.value) pending.value.text = rewrittenContent;

        // Auto-scroll editor
        await nextTick();
        if (editorRef.value) {
          editorRef.value.scrollTop = editorRef.value.scrollHeight;
        }
      }

      // Handle server-side image restoration event
      if (chunk.imagesRestored && chunk.finalContent !== undefined) {
        // Server already restored images; use its final content directly
        rewrittenContent = chunk.finalContent;
        content.value = rewrittenContent;
        if (pending.value) pending.value.text = rewrittenContent;
        await nextTick();
        if (editorRef.value) {
          editorRef.value.scrollTop = editorRef.value.scrollHeight;
        }
      }

      if (chunk.finished) {
        break;
      }
    }

    // Add two line breaks and position cursor at end
    if (rewrittenContent) {
      recordPassage(rewrittenContent, passage, reasoningText);
      rewrittenContent += '\n\n';
      content.value = rewrittenContent;

      // Normalize trailing line breaks to prevent accumulation
      normalizeTrailingLineBreaks();

      // Position cursor at end
      const cursorPos = rewrittenContent.length;
      await nextTick();
      if (editorRef.value) {
        editorRef.value.selectionStart = cursorPos;
        editorRef.value.selectionEnd = cursorPos;
        editorRef.value.scrollTop = editorRef.value.scrollHeight;
        editorRef.value.focus();
      }
    }

    // Save
    await saveStory(true);
    toast.success('Rewrite complete');

    // Scroll preview to end now that renderedContent has updated via RAF
    await nextTick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (previewRef.value) {
      previewRef.value.scrollTop = previewRef.value.scrollHeight;
    }
  } catch (error) {
    if (recordPassage(rewrittenContent, passage, reasoningText)) {
      await saveStory(true);
    }
    // Check if it was a cancellation
    if (error.name === 'AbortError' || error.message === 'Generation cancelled') {
      console.log('Rewrite was cancelled by user');
      toast.info('Rewrite cancelled');
    } else {
      console.error('Rewrite error:', error);

      // Show error dialog
      const errorMessage = error.message || 'Unknown error occurred';
      await confirm({
        message: `Rewrite Failed\n\n${errorMessage}`,
        confirmText: 'OK',
        cancelText: 'Dismiss',
        variant: 'danger',
      });
    }
  } finally {
    generating.value = false;
    pending.value = null;
    abortController = null;
  }
}

async function clearStory() {
  const confirmed = await confirm({
    message: 'Clear all story content? This cannot be undone.',
    confirmText: 'Clear Content',
    variant: 'warning',
  });

  if (!confirmed) return;

  content.value = '';
  await saveStory();
  toast.success('Story cleared');
}

function exportStory() {
  const blob = new Blob([content.value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${story.value?.title || 'story'}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  toast.success('Story exported');
}

function goToSettings() {
  router.push('/settings');
}

async function handleStoryUpdated() {
  // Reload story data after changes from modals
  await loadStory();
  await loadCharacters();
  // Title will be updated by loadStory()
}

async function deleteStory() {
  const confirmed = await confirm({
    message: `Are you sure you want to delete "${story.value?.title}"? This cannot be undone.`,
    confirmText: 'Delete Story',
    variant: 'danger',
  });

  if (!confirmed) return;

  try {
    await storiesAPI.delete(props.storyId);
    toast.success('Story deleted successfully');
    router.push('/');
  } catch (error) {
    console.error('Failed to delete story:', error);
    toast.error('Failed to delete story: ' + error.message);
  }
}

async function handleIdeate() {
  if (generating.value || ideateLoading.value) return;

  // Open modal immediately
  showIdeateModal.value = true;
  ideateLoading.value = true;
  ideateStatus.value = 'Thinking...';
  ideateResponse.value = '';

  // Create abort controller for cancellation
  const ideateAbortController = new AbortController();

  try {
    let responseText = '';

    // Stream ideation with abort signal
    const stream = storiesAPI.ideate(props.storyId, ideateAbortController.signal);

    for await (const chunk of stream) {
      // Handle queue status (AI Horde)
      if (chunk.queueStatus) {
        const { position, waitTime, finished, faulted } = chunk.queueStatus;
        if (faulted) {
          ideateStatus.value = 'Queue error';
        } else if (finished) {
          ideateStatus.value = 'Processing...';
        } else if (position === 0) {
          ideateStatus.value = `Generating... (ETA: ${waitTime}s)`;
        } else {
          ideateStatus.value = `In queue: position ${position} (ETA: ${waitTime}s)`;
        }
      }

      // Handle content
      if (chunk.content) {
        if (
          ideateStatus.value === 'Thinking...' ||
          ideateStatus.value.includes('queue') ||
          ideateStatus.value.includes('Processing')
        ) {
          ideateStatus.value = 'Writing...';
        }

        responseText += chunk.content;
        ideateResponse.value = responseText;
      }

      // Server restores [WG_IMAGE_n] markers back to image markup on the final
      // chunk. Without this the placeholder stays visible in the response.
      if (chunk.imagesRestored && chunk.finalContent !== undefined) {
        responseText = chunk.finalContent;
        ideateResponse.value = responseText;
      }

      if (chunk.finished) {
        break;
      }
    }

    ideateLoading.value = false;
  } catch (error) {
    // Check if it was a cancellation
    if (error.name === 'AbortError' || error.message === 'Generation cancelled') {
      console.log('Ideation was cancelled');
      toast.info('Ideation cancelled');
      showIdeateModal.value = false;
    } else {
      console.error('Ideation error:', error);
      ideateLoading.value = false;
      ideateResponse.value = `Error: ${error.message}`;
    }
  }
}

// Generate a unique ID for avatar windows
function generateWindowId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `avatar-${crypto.randomUUID()}`;
  }
  return `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Find next available position that doesn't overlap with existing windows
function findNextWindowPosition() {
  const baseX = 20;
  const baseY = 100;
  const offset = 30;

  // Find the maximum offset index used by existing windows
  let maxOffsetIndex = -1;
  for (const win of avatarWindows.value) {
    // Calculate which offset index this window might be at
    const offsetIndex = Math.round((win.x - baseX) / offset);
    if (offsetIndex > maxOffsetIndex) {
      maxOffsetIndex = offsetIndex;
    }
  }

  // Use the next offset index
  const nextIndex = maxOffsetIndex + 1;
  return {
    x: baseX + nextIndex * offset,
    y: baseY + nextIndex * offset,
  };
}

// Add a new avatar window
function handleAddAvatarWindow() {
  if (storyCharacters.value.length === 0) return;

  const position = findNextWindowPosition();
  const newWindow = {
    id: generateWindowId(),
    characterId: storyCharacters.value[0].id,
    x: position.x,
    y: position.y,
    width: 300,
    height: 400,
  };

  avatarWindows.value.push(newWindow);
  saveAvatarWindows();
}

// Handle window close
function handleAvatarWindowClose(windowId) {
  avatarWindows.value = avatarWindows.value.filter((w) => w.id !== windowId);
  saveAvatarWindows();
}

// Handle window update (position, size, or character change)
function handleAvatarWindowUpdate(update) {
  const index = avatarWindows.value.findIndex((w) => w.id === update.windowId);
  if (index >= 0) {
    avatarWindows.value[index] = {
      id: update.windowId,
      characterId: update.characterId,
      x: update.x,
      y: update.y,
      width: update.width,
      height: update.height,
    };
    saveAvatarWindows();
  }
}

// Debounced save to server - use ref to avoid race conditions
const isMounted = ref(true);
const saveAvatarTimeoutRef = ref(null);

function saveAvatarWindows() {
  if (saveAvatarTimeoutRef.value) {
    clearTimeout(saveAvatarTimeoutRef.value);
  }
  saveAvatarTimeoutRef.value = setTimeout(async () => {
    // Check if component is still mounted before making API call
    if (!isMounted.value) return;
    try {
      await storiesAPI.updateAvatarWindows(props.storyId, avatarWindows.value);
    } catch (error) {
      console.error('Failed to save avatar windows:', error);
      if (isMounted.value) {
        toast.error('Failed to save avatar window positions');
      }
    }
  }, 500); // Debounce 500ms
}
</script>

<style scoped>
.story-editor-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
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
  flex-direction: column;
  position: relative;
}

.story-editor {
  width: 100%;
  height: 100%;
  padding-top: 2rem;
  padding-bottom: 2rem;
  padding-left: max(2rem, calc((100% - 700px) / 2));
  padding-right: max(2rem, calc((100% - 700px) / 2));
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
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

.toolbar-icon-group {
  display: flex;
  gap: 0.25rem;
  align-items: center;
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
  to {
    transform: rotate(360deg);
  }
}

.stop-button {
  margin-left: auto;
  white-space: nowrap;
}

.icon-btn-active {
  color: var(--accent-primary) !important;
}

.icon-btn-active i {
  color: var(--accent-primary) !important;
}

.story-preview {
  width: 100%;
  flex: 1;
  overflow-y: auto;
  padding-top: 2rem;
  padding-bottom: 2rem;
  padding-left: max(2rem, calc((100% - 700px) / 2));
  padding-right: max(2rem, calc((100% - 700px) / 2));
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 1rem;
  line-height: 1.8;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: var(--shadow);
}

.story-preview p {
  margin: 0 0 1em 0;
}

:deep(.story-preview .story-image) {
  /* Responsive: scale image to viewport with adaptive margins */
  width: auto;
  height: auto;
  display: block;
  margin: 1rem auto;
  border-radius: 8px;
  object-fit: contain;
}

/* Small screens (phones) — keep some edge padding */
@media (max-width: 480px) {
  :deep(.story-preview .story-image) {
    max-width: calc(100vw - 2rem);
    max-height: 70vh;
  }
}

/* Medium screens (tablets) */
@media (min-width: 481px) and (max-width: 1024px) {
  :deep(.story-preview .story-image) {
    max-width: calc(100vw - 4rem);
    max-height: 70vh;
  }
}

/* Large screens (desktop) — cap width so images don't span edge-to-edge */
@media (min-width: 1025px) {
  :deep(.story-preview .story-image) {
    max-width: min(100%, calc(100vw - 8rem), 800px);
    max-height: calc(100vh - 10rem);
  }
}

/* Preview input bar at bottom of editor when in preview mode */
.editor-container {
  position: relative;
}

.preview-input-bar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 2rem;
  background-color: var(--bg-secondary);
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.preview-input {
  flex: 1;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 1rem;
  background-color: var(--bg-primary);
  color: var(--text-primary);
}

.preview-input:focus {
  outline: none;
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 3px rgba(139, 90, 43, 0.1);
}

.btn-send {
  padding: 0.75rem 1.5rem;
  white-space: nowrap;
}
</style>
