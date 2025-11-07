/**
 * Novel Writer - Main Application
 */

class NovelWriterApp {
  constructor() {
    // State
    this.characterCard = null;
    this.persona = null;
    this.settings = {
      apiKey: '',
      maxTokens: 4000,
      showReasoning: false,
      autoSave: true,
      showPrompt: false,
      firstPerson: true,
      filterAsterisks: true
    };
    this.deepSeekAPI = null;
    this.autoSaveInterval = null;
    this.characterImageURL = null;
    this.lastSystemPrompt = '';
    this.lastUserPrompt = '';

    // DOM Elements
    this.initializeElements();

    // Initialize
    this.loadFromLocalStorage();
    this.setupEventListeners();
    this.updateUI();

    // Start auto-save if enabled
    if (this.settings.autoSave) {
      this.startAutoSave();
    }
  }

  initializeElements() {
    // Editor
    this.editor = document.getElementById('storyEditor');

    // Character
    this.characterInfo = document.getElementById('characterInfo');
    this.noCharacter = document.getElementById('noCharacter');
    this.characterName = document.getElementById('characterName');
    this.characterDesc = document.getElementById('characterDesc');
    this.characterAvatar = document.getElementById('characterAvatar');
    this.characterUpload = document.getElementById('characterUpload');
    this.editCharacterBtn = document.getElementById('editCharacterBtn');
    this.clearCharacterBtn = document.getElementById('clearCharacterBtn');

    // Character modal
    this.characterModal = document.getElementById('characterModal');
    this.charNameInput = document.getElementById('charNameInput');
    this.charDescInput = document.getElementById('charDescInput');
    this.charPersonalityInput = document.getElementById('charPersonalityInput');
    this.charScenarioInput = document.getElementById('charScenarioInput');
    this.charFirstMesInput = document.getElementById('charFirstMesInput');
    this.charMesExampleInput = document.getElementById('charMesExampleInput');
    this.charSystemPromptInput = document.getElementById('charSystemPromptInput');
    this.charPostHistoryInput = document.getElementById('charPostHistoryInput');
    this.saveCharacterBtn = document.getElementById('saveCharacterBtn');

    // Persona
    this.personaSummary = document.getElementById('personaSummary');
    this.personaName = document.getElementById('personaName');
    this.editPersonaBtn = document.getElementById('editPersonaBtn');

    // Generation
    this.continueStoryBtn = document.getElementById('continueStoryBtn');
    this.characterResponseBtn = document.getElementById('characterResponseBtn');
    this.customPromptBtn = document.getElementById('customPromptBtn');
    this.rewriteFirstPersonBtn = document.getElementById('rewriteFirstPersonBtn');
    this.generationStatus = document.getElementById('generationStatus');
    this.statusText = document.getElementById('statusText');

    // Document controls
    this.saveBtn = document.getElementById('saveBtn');
    this.loadBtn = document.getElementById('loadBtn');
    this.clearBtn = document.getElementById('clearBtn');
    this.exportBtn = document.getElementById('exportBtn');

    // Settings
    this.settingsBtn = document.getElementById('settingsBtn');
    this.settingsModal = document.getElementById('settingsModal');
    this.apiKeyInput = document.getElementById('apiKeyInput');
    this.maxTokensInput = document.getElementById('maxTokensInput');
    this.showReasoningToggle = document.getElementById('showReasoningToggle');
    this.autoSaveToggle = document.getElementById('autoSaveToggle');
    this.showPromptToggle = document.getElementById('showPromptToggle');
    this.firstPersonToggle = document.getElementById('firstPersonToggle');
    this.filterAsterisksToggle = document.getElementById('filterAsterisksToggle');
    this.saveSettingsBtn = document.getElementById('saveSettingsBtn');

    // Persona modal
    this.personaModal = document.getElementById('personaModal');
    this.personaNameInput = document.getElementById('personaNameInput');
    this.personaDescInput = document.getElementById('personaDescInput');
    this.personaStyleInput = document.getElementById('personaStyleInput');
    this.savePersonaBtn = document.getElementById('savePersonaBtn');

    // Custom prompt modal
    this.customPromptModal = document.getElementById('customPromptModal');
    this.customPromptInput = document.getElementById('customPromptInput');
    this.generateCustomBtn = document.getElementById('generateCustomBtn');

    // Reasoning panel
    this.reasoningPanel = document.getElementById('reasoningPanel');
    this.reasoningContent = document.getElementById('reasoningContent');
    this.closeReasoningBtn = document.getElementById('closeReasoningBtn');

    // Prompt viewer
    this.viewPromptBtn = document.getElementById('viewPromptBtn');
    this.promptViewerModal = document.getElementById('promptViewerModal');
    this.systemPromptDisplay = document.getElementById('systemPromptDisplay');
    this.userPromptDisplay = document.getElementById('userPromptDisplay');

    // Toast container
    this.toastContainer = document.getElementById('toastContainer');
  }

  setupEventListeners() {
    // Character upload
    this.characterUpload.addEventListener('change', (e) => this.handleCharacterUpload(e));
    this.editCharacterBtn.addEventListener('click', () => this.openCharacterModal());
    this.clearCharacterBtn.addEventListener('click', () => this.clearCharacter());
    this.saveCharacterBtn.addEventListener('click', () => this.saveCharacter());

    // Persona
    this.editPersonaBtn.addEventListener('click', () => this.openPersonaModal());
    this.savePersonaBtn.addEventListener('click', () => this.savePersona());

    // Generation
    this.continueStoryBtn.addEventListener('click', () => this.generate('continue'));
    this.characterResponseBtn.addEventListener('click', () => this.generate('character'));
    this.customPromptBtn.addEventListener('click', () => this.openCustomPromptModal());
    this.rewriteFirstPersonBtn.addEventListener('click', () => this.rewriteToFirstPerson());
    this.generateCustomBtn.addEventListener('click', () => this.generateCustom());

    // Document controls
    this.saveBtn.addEventListener('click', () => this.saveDocument());
    this.loadBtn.addEventListener('click', () => this.loadDocument());
    this.clearBtn.addEventListener('click', () => this.clearDocument());
    this.exportBtn.addEventListener('click', () => this.exportDocument());

    // Settings
    this.settingsBtn.addEventListener('click', () => this.openSettingsModal());
    this.saveSettingsBtn.addEventListener('click', () => this.saveSettings());

    // Reasoning panel
    this.closeReasoningBtn.addEventListener('click', () => this.hideReasoning());

    // Prompt viewer
    this.viewPromptBtn.addEventListener('click', () => this.openPromptViewer());

    // Modal close buttons
    document.querySelectorAll('.close-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal');
        if (modal) this.closeModal(modal);
      });
    });

    // Click outside modal to close
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) this.closeModal(modal);
      });
    });

    // Editor changes
    this.editor.addEventListener('input', () => {
      if (this.settings.autoSave) {
        this.debouncedSave();
      }
    });
  }

  // Template Replacement
  replacePlaceholders(text) {
    if (!text) return text;

    let result = text;

    // Replace {{user}} with persona name
    const userName = this.persona?.name || 'User';
    result = result.replace(/\{\{user\}\}/gi, userName);

    // Replace {{char}} and {{character}} with character name
    const charName = this.characterCard?.data?.name || 'Character';
    result = result.replace(/\{\{char\}\}/gi, charName);
    result = result.replace(/\{\{character\}\}/gi, charName);

    return result;
  }

  // Filter asterisks from text
  filterAsterisks(text) {
    if (!text || !this.settings.filterAsterisks) return text;

    // Remove asterisks entirely
    return text.replace(/\*/g, '');
  }

  // Character Management
  async handleCharacterUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      this.showToast('Loading character card...', 'info');

      // Parse the character card
      this.characterCard = await TavernCardParser.parseCard(file);

      // Convert image to base64 data URL for persistence
      this.characterImageURL = await this.fileToDataURL(file);

      // Save to localStorage
      this.saveToLocalStorage();

      // Initialize content with first message if editor is empty
      if (!this.editor.value.trim() && this.characterCard.data.first_mes) {
        this.editor.value = this.replacePlaceholders(this.characterCard.data.first_mes) + '\n\n';
      }

      this.updateUI();
      this.showToast(`Loaded character: ${this.characterCard.data.name}`, 'success');

    } catch (error) {
      console.error('Error loading character:', error);
      this.showToast(error.message, 'error');
    }

    // Clear input
    event.target.value = '';
  }

  // Convert File to data URL for storage
  fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  clearCharacter() {
    if (confirm('Are you sure you want to clear the character card?')) {
      this.characterCard = null;
      this.characterImageURL = null;
      this.saveToLocalStorage();
      this.updateUI();
      this.showToast('Character cleared', 'info');
    }
  }

  openCharacterModal() {
    if (!this.characterCard) return;

    const char = this.characterCard.data;

    // Populate fields with current character data
    this.charNameInput.value = char.name || '';
    this.charDescInput.value = char.description || '';
    this.charPersonalityInput.value = char.personality || '';
    this.charScenarioInput.value = char.scenario || '';
    this.charFirstMesInput.value = char.first_mes || '';
    this.charMesExampleInput.value = char.mes_example || '';
    this.charSystemPromptInput.value = char.system_prompt || '';
    this.charPostHistoryInput.value = char.post_history_instructions || '';

    this.openModal(this.characterModal);
  }

  saveCharacter() {
    if (!this.characterCard) return;

    // Update character card data
    this.characterCard.data.name = this.charNameInput.value.trim();
    this.characterCard.data.description = this.charDescInput.value.trim();
    this.characterCard.data.personality = this.charPersonalityInput.value.trim();
    this.characterCard.data.scenario = this.charScenarioInput.value.trim();
    this.characterCard.data.first_mes = this.charFirstMesInput.value.trim();
    this.characterCard.data.mes_example = this.charMesExampleInput.value.trim();
    this.characterCard.data.system_prompt = this.charSystemPromptInput.value.trim();
    this.characterCard.data.post_history_instructions = this.charPostHistoryInput.value.trim();

    this.saveToLocalStorage();
    this.updateUI();
    this.closeModal(this.characterModal);
    this.showToast('Character updated', 'success');
  }

  // Persona Management
  openPersonaModal() {
    if (this.persona) {
      this.personaNameInput.value = this.persona.name || '';
      this.personaDescInput.value = this.persona.description || '';
      this.personaStyleInput.value = this.persona.writingStyle || '';
    }
    this.openModal(this.personaModal);
  }

  savePersona() {
    this.persona = {
      name: this.personaNameInput.value.trim(),
      description: this.personaDescInput.value.trim(),
      writingStyle: this.personaStyleInput.value.trim()
    };

    this.saveToLocalStorage();
    this.updateUI();
    this.closeModal(this.personaModal);
    this.showToast('Persona saved', 'success');
  }

  // Settings Management
  openSettingsModal() {
    this.apiKeyInput.value = this.settings.apiKey;
    this.maxTokensInput.value = this.settings.maxTokens;
    this.showReasoningToggle.checked = this.settings.showReasoning;
    this.autoSaveToggle.checked = this.settings.autoSave;
    this.showPromptToggle.checked = this.settings.showPrompt;
    this.firstPersonToggle.checked = this.settings.firstPerson;
    this.filterAsterisksToggle.checked = this.settings.filterAsterisks;
    this.openModal(this.settingsModal);
  }

  saveSettings() {
    const oldAutoSave = this.settings.autoSave;

    this.settings.apiKey = this.apiKeyInput.value.trim();
    this.settings.maxTokens = parseInt(this.maxTokensInput.value) || 4000;
    this.settings.showReasoning = this.showReasoningToggle.checked;
    this.settings.autoSave = this.autoSaveToggle.checked;
    this.settings.showPrompt = this.showPromptToggle.checked;
    this.settings.firstPerson = this.firstPersonToggle.checked;
    this.settings.filterAsterisks = this.filterAsterisksToggle.checked;

    // Initialize DeepSeek API with new key
    if (this.settings.apiKey) {
      this.deepSeekAPI = new DeepSeekAPI(this.settings.apiKey);
    }

    // Update auto-save
    if (this.settings.autoSave && !oldAutoSave) {
      this.startAutoSave();
    } else if (!this.settings.autoSave && oldAutoSave) {
      this.stopAutoSave();
    }

    this.saveToLocalStorage();
    this.updateUI();
    this.closeModal(this.settingsModal);
    this.showToast('Settings saved', 'success');
  }

  // Generation
  async generate(type) {
    if (!this.settings.apiKey) {
      this.showToast('Please set your DeepSeek API key in settings', 'error');
      this.openSettingsModal();
      return;
    }

    if (!this.deepSeekAPI) {
      this.deepSeekAPI = new DeepSeekAPI(this.settings.apiKey);
    }

    // Build prompt
    const { fullPrompt, instruction } = this.deepSeekAPI.buildGenerationPrompt(type, {
      characterCard: this.characterCard,
      currentContent: this.editor.value,
      customPrompt: null,
      persona: this.persona
    });

    await this.generateWithPrompt(fullPrompt, instruction);
  }

  openCustomPromptModal() {
    this.customPromptInput.value = '';
    this.openModal(this.customPromptModal);
  }

  async generateCustom() {
    const customPrompt = this.customPromptInput.value.trim();

    if (!customPrompt) {
      this.showToast('Please enter a prompt', 'error');
      return;
    }

    this.closeModal(this.customPromptModal);

    // Build prompt with custom type
    const { fullPrompt, instruction } = this.deepSeekAPI.buildGenerationPrompt('custom', {
      characterCard: this.characterCard,
      currentContent: this.editor.value,
      customPrompt: customPrompt,
      persona: this.persona
    });

    await this.generateWithPrompt(fullPrompt, instruction);
  }

  async rewriteToFirstPerson() {
    if (!this.settings.apiKey) {
      this.showToast('Please set your DeepSeek API key in settings', 'error');
      this.openSettingsModal();
      return;
    }

    if (!this.editor.value.trim()) {
      this.showToast('No content to rewrite', 'error');
      return;
    }

    if (!confirm('This will replace the entire document with a rewritten version in first-person omniscient perspective. Continue?')) {
      return;
    }

    if (!this.deepSeekAPI) {
      this.deepSeekAPI = new DeepSeekAPI(this.settings.apiKey);
    }

    const personaName = this.persona?.name || 'the narrator';

    const rewritePrompt = `Rewrite the following story in first-person omniscient perspective, where "I" is ${personaName}.

The narrator (${personaName}) should observe and describe the events, including the thoughts and feelings of other characters, but should not take actions or speak dialogue unless it makes sense for them to be part of the scene.

Maintain the plot, events, and character interactions, but shift the narrative voice to first-person omniscient.

Remove any asterisks (*) used for actions - write everything as prose.

Here is the story to rewrite:

${this.editor.value}

---

Rewritten version:`;

    try {
      // Clear editor and prepare for rewrite
      this.editor.value = '';

      // For rewrite, use the prompt as both full and instruction (special case)
      await this.generateWithPrompt(rewritePrompt, 'Rewrite to first-person omniscient');
    } catch (error) {
      console.error('Rewrite error:', error);
      this.showToast(`Rewrite failed: ${error.message}`, 'error');
    }
  }

  async generateWithPrompt(prompt, instruction = null) {
    try {
      // Disable generation buttons
      this.setGenerationEnabled(false);
      this.generationStatus.classList.remove('hidden');
      this.statusText.textContent = 'Generating...';

      // Clear previous reasoning
      if (this.settings.showReasoning) {
        this.reasoningContent.innerHTML = '<div class="reasoning-empty">Thinking...</div>';
        this.showReasoning();
      }

      // Capture prompts for debugging
      this.lastSystemPrompt = this.deepSeekAPI.buildSystemPrompt(this.characterCard, this.persona, this.settings);
      this.lastUserPrompt = prompt;

      // Start generation
      const { stream, abort } = await this.deepSeekAPI.generateStreaming(prompt, {
        characterCard: this.characterCard,
        persona: this.persona,
        maxTokens: this.settings.maxTokens,
        settings: this.settings
      });

      let generatedContent = '';
      let reasoningText = '';
      let hasContent = false;

      // Track cursor position and capture text before/after once
      const cursorPos = this.editor.selectionStart;
      const textBefore = this.editor.value.substring(0, cursorPos);
      const textAfter = this.editor.value.substring(cursorPos);

      for await (const chunk of stream) {
        if (chunk.reasoning && this.settings.showReasoning) {
          reasoningText += chunk.reasoning;
          this.reasoningContent.innerHTML = this.formatReasoning(reasoningText);
          // Auto-scroll reasoning
          this.reasoningContent.scrollTop = this.reasoningContent.scrollHeight;
        }

        if (chunk.content) {
          if (!hasContent) {
            hasContent = true;
            this.statusText.textContent = 'Writing...';
          }

          // Filter asterisks from generated content
          const filteredContent = this.filterAsterisks(chunk.content);
          generatedContent += filteredContent;

          // Insert accumulated content at cursor position
          this.editor.value = textBefore + generatedContent + textAfter;

          // Auto-scroll editor
          this.editor.scrollTop = this.editor.scrollHeight;
        }

        if (chunk.finished) {
          break;
        }
      }

      // Add to conversation history (instruction only, not the full story content)
      // This prevents the story from being duplicated in history
      const historyPrompt = instruction || prompt;
      this.deepSeekAPI.addToHistory(historyPrompt, generatedContent);

      // Save document
      this.saveDocument();

      this.showToast('Generation complete', 'success');

    } catch (error) {
      console.error('Generation error:', error);
      this.showToast(`Generation failed: ${error.message}`, 'error');
    } finally {
      this.setGenerationEnabled(true);
      this.generationStatus.classList.add('hidden');
    }
  }

  formatReasoning(text) {
    // Simple formatting - replace newlines with <br> and escape HTML
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    return escaped;
  }

  // Reasoning Panel
  showReasoning() {
    // Check if we're scrolled to the bottom before opening
    const wasAtBottom = this.editor.scrollHeight - this.editor.scrollTop <= this.editor.clientHeight + 10;

    this.reasoningPanel.classList.remove('hidden');

    // If we were at the bottom, scroll back to bottom after panel opens
    if (wasAtBottom) {
      // Wait for CSS transition to complete
      setTimeout(() => {
        this.editor.scrollTop = this.editor.scrollHeight;
      }, 350); // 300ms transition + 50ms buffer
    }
  }

  hideReasoning() {
    this.reasoningPanel.classList.add('hidden');
  }

  // Prompt Viewer
  openPromptViewer() {
    this.systemPromptDisplay.value = this.lastSystemPrompt || 'No prompt captured yet. Generate content first.';
    this.userPromptDisplay.value = this.lastUserPrompt || 'No prompt captured yet. Generate content first.';
    this.openModal(this.promptViewerModal);
  }

  // Document Management
  saveDocument() {
    localStorage.setItem('novelwriter-document', this.editor.value);
    this.showToast('Document saved', 'success');
  }

  loadDocument() {
    const content = localStorage.getItem('novelwriter-document');
    if (content) {
      this.editor.value = content;
      // Clear conversation history when loading a document
      if (this.deepSeekAPI) {
        this.deepSeekAPI.clearHistory();
      }
      this.showToast('Document loaded', 'success');
    } else {
      this.showToast('No saved document found', 'info');
    }
  }

  clearDocument() {
    if (confirm('Are you sure you want to clear the entire document? This cannot be undone.')) {
      this.editor.value = '';
      // Clear conversation history since document is the source of truth
      if (this.deepSeekAPI) {
        this.deepSeekAPI.clearHistory();
      }
      this.saveDocument();
      this.showToast('Document cleared', 'info');
    }
  }

  exportDocument() {
    const content = this.editor.value;
    if (!content.trim()) {
      this.showToast('Document is empty', 'error');
      return;
    }

    // Create blob and download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `novel-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.showToast('Document exported', 'success');
  }

  // Auto-save
  startAutoSave() {
    this.autoSaveInterval = setInterval(() => {
      if (this.editor.value.trim()) {
        localStorage.setItem('novelwriter-document', this.editor.value);
      }
    }, 30000); // Every 30 seconds
  }

  stopAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  debouncedSave = this.debounce(() => {
    localStorage.setItem('novelwriter-document', this.editor.value);
  }, 1000);

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // UI Updates
  updateUI() {
    // Update character display
    if (this.characterCard) {
      this.characterInfo.classList.remove('hidden');
      this.noCharacter.classList.add('hidden');

      const summary = TavernCardParser.getSummary(this.characterCard);
      this.characterName.textContent = summary.name;
      this.characterDesc.textContent = summary.description || summary.personality || 'No description available';

      // Set avatar
      if (this.characterImageURL) {
        this.characterAvatar.style.backgroundImage = `url(${this.characterImageURL})`;
        this.characterAvatar.textContent = '';
      } else {
        this.characterAvatar.style.backgroundImage = 'none';
        this.characterAvatar.textContent = summary.name.charAt(0).toUpperCase();
      }
    } else {
      this.characterInfo.classList.add('hidden');
      this.noCharacter.classList.remove('hidden');
    }

    // Update persona display
    if (this.persona && this.persona.name) {
      this.personaName.textContent = this.persona.name;
    } else {
      this.personaName.textContent = 'Not set';
    }

    // Enable/disable generation buttons
    const hasApiKey = !!this.settings.apiKey;
    this.setGenerationEnabled(hasApiKey);

    // Update reasoning panel visibility
    if (this.settings.showReasoning) {
      // Don't automatically show, just make it available
    } else {
      this.hideReasoning();
    }

    // Update prompt viewer button visibility
    if (this.settings.showPrompt) {
      this.viewPromptBtn.classList.remove('hidden');
    } else {
      this.viewPromptBtn.classList.add('hidden');
    }
  }

  setGenerationEnabled(enabled) {
    this.continueStoryBtn.disabled = !enabled;
    this.characterResponseBtn.disabled = !enabled;
    this.customPromptBtn.disabled = !enabled;
    this.rewriteFirstPersonBtn.disabled = !enabled;
  }

  // Modal Management
  openModal(modal) {
    modal.classList.remove('hidden');
  }

  closeModal(modal) {
    modal.classList.add('hidden');
  }

  // Toast Notifications
  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    this.toastContainer.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(400px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Local Storage
  saveToLocalStorage() {
    // Save character card
    if (this.characterCard) {
      localStorage.setItem('novelwriter-character', JSON.stringify(this.characterCard));
    } else {
      localStorage.removeItem('novelwriter-character');
    }

    // Save character image (base64 data URL)
    if (this.characterImageURL) {
      localStorage.setItem('novelwriter-character-image', this.characterImageURL);
    } else {
      localStorage.removeItem('novelwriter-character-image');
    }

    // Save persona
    if (this.persona) {
      localStorage.setItem('novelwriter-persona', JSON.stringify(this.persona));
    }

    // Save settings
    localStorage.setItem('novelwriter-settings', JSON.stringify(this.settings));

    // Save conversation history
    if (this.deepSeekAPI) {
      localStorage.setItem('novelwriter-history', JSON.stringify(this.deepSeekAPI.getHistory()));
    }
  }

  loadFromLocalStorage() {
    // Load character card
    const charData = localStorage.getItem('novelwriter-character');
    if (charData) {
      try {
        this.characterCard = JSON.parse(charData);
      } catch (e) {
        console.error('Failed to load character card:', e);
      }
    }

    // Load character image
    const charImage = localStorage.getItem('novelwriter-character-image');
    if (charImage) {
      this.characterImageURL = charImage;
    }

    // Load persona
    const personaData = localStorage.getItem('novelwriter-persona');
    if (personaData) {
      try {
        this.persona = JSON.parse(personaData);
      } catch (e) {
        console.error('Failed to load persona:', e);
      }
    }

    // Load settings
    const settingsData = localStorage.getItem('novelwriter-settings');
    if (settingsData) {
      try {
        this.settings = { ...this.settings, ...JSON.parse(settingsData) };
      } catch (e) {
        console.error('Failed to load settings:', e);
      }
    }

    // Load document
    const docData = localStorage.getItem('novelwriter-document');
    if (docData) {
      this.editor.value = docData;
    }

    // Initialize API if key exists
    if (this.settings.apiKey) {
      this.deepSeekAPI = new DeepSeekAPI(this.settings.apiKey);

      // Load conversation history
      const historyData = localStorage.getItem('novelwriter-history');
      if (historyData) {
        try {
          const history = JSON.parse(historyData);
          this.deepSeekAPI.setHistory(history);
        } catch (e) {
          console.error('Failed to load conversation history:', e);
        }
      }
    }
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new NovelWriterApp();
});
