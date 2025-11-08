/**
 * Úrscéal - Main Application (Client-side)
 * Refactored to use server API
 */

class NovelWriterApp {
  constructor() {
    // State
    this.currentStoryId = null;
    this.currentStory = null; // Track full story metadata
    this.stories = [];
    this.characters = [];
    this.settings = null;
    this.autoSaveInterval = null;
    this.lastSystemPrompt = "";
    this.lastUserPrompt = "";

    // DOM Elements
    this.initializeElements();

    // Initialize
    this.init();
  }

  async init() {
    try {
      // Load settings first
      await this.loadSettings();

      // Load stories list
      await this.loadStories();

      // Setup event listeners
      this.setupEventListeners();

      // Update UI
      this.updateUI();

      // Start auto-save if enabled
      if (this.settings?.autoSave) {
        this.startAutoSave();
      }
    } catch (error) {
      console.error('Initialization error:', error);
      this.showToast('Failed to initialize app: ' + error.message, 'error');
    }
  }

  initializeElements() {
    // Story selector
    this.storySelector = document.getElementById('storySelector');
    this.newStoryBtn = document.getElementById('newStoryBtn');

    // Editor
    this.editor = document.getElementById('storyEditor');

    // Character library
    this.characterLibraryBtn = document.getElementById('characterLibraryBtn');
    this.characterLibraryModal = document.getElementById('characterLibraryModal');
    this.characterLibraryGrid = document.getElementById('characterLibraryGrid');
    this.characterUploadLibrary = document.getElementById('characterUploadLibrary');
    this.createCharacterBtn = document.getElementById('createCharacterBtn');

    // Character editor state
    this.editingCharacterId = null;

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
    this.charImageInput = document.getElementById('charImageInput');
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
    this.personaType = document.getElementById('personaType');
    this.selectPersonaBtn = document.getElementById('selectPersonaBtn');
    this.editPersonaBtn = document.getElementById('editPersonaBtn');

    // Persona selector modal
    this.personaSelectorModal = document.getElementById('personaSelectorModal');
    this.personaSelectorGrid = document.getElementById('personaSelectorGrid');
    this.clearPersonaBtn = document.getElementById('clearPersonaBtn');


    // Generation
    this.continueStoryBtn = document.getElementById('continueStoryBtn');
    this.characterResponseBtn = document.getElementById('characterResponseBtn');
    this.customPromptBtn = document.getElementById('customPromptBtn');
    this.rewriteThirdPersonBtn = document.getElementById('rewriteThirdPersonBtn');
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
    this.thirdPersonToggle = document.getElementById('thirdPersonToggle');
    this.filterAsterisksToggle = document.getElementById('filterAsterisksToggle');
    this.saveSettingsBtn = document.getElementById('saveSettingsBtn');

    // Custom prompt modal
    this.customPromptModal = document.getElementById('customPromptModal');
    this.customPromptInput = document.getElementById('customPromptInput');
    this.generateCustomBtn = document.getElementById('generateCustomBtn');

    // Prompt viewer modal
    this.promptViewerModal = document.getElementById('promptViewerModal');
    this.systemPromptDisplay = document.getElementById('systemPromptDisplay');
    this.userPromptDisplay = document.getElementById('userPromptDisplay');
    this.viewPromptBtn = document.getElementById('viewPromptBtn');

    // Reasoning panel
    this.reasoningPanel = document.getElementById('reasoningPanel');
    this.reasoningContent = document.getElementById('reasoningContent');
    this.closeReasoningBtn = document.getElementById('closeReasoningBtn');

    // Toast container
    this.toastContainer = document.getElementById('toastContainer');
  }

  setupEventListeners() {
    // Story selector
    if (this.storySelector) {
      this.storySelector.addEventListener('change', () => this.switchStory());
    }
    if (this.newStoryBtn) {
      this.newStoryBtn.addEventListener('click', () => this.createNewStory());
    }

    // Character library
    if (this.characterLibraryBtn) {
      this.characterLibraryBtn.addEventListener('click', () => this.openCharacterLibrary());
    }
    if (this.createCharacterBtn) {
      this.createCharacterBtn.addEventListener('click', () => this.openCharacterCreator());
    }
    if (this.characterUploadLibrary) {
      this.characterUploadLibrary.addEventListener('change', (e) => this.handleLibraryCharacterUpload(e));
    }

    // Character
    if (this.characterUpload) {
      this.characterUpload.addEventListener('change', (e) => this.handleCharacterUpload(e));
    }
    if (this.editCharacterBtn) {
      this.editCharacterBtn.addEventListener('click', () => this.openCharacterModal());
    }
    if (this.clearCharacterBtn) {
      this.clearCharacterBtn.addEventListener('click', () => this.clearCharacter());
    }
    if (this.saveCharacterBtn) {
      this.saveCharacterBtn.addEventListener('click', () => this.saveCharacter());
    }

    // Persona
    if (this.selectPersonaBtn) {
      this.selectPersonaBtn.addEventListener('click', () => this.openPersonaSelector());
    }
    if (this.clearPersonaBtn) {
      this.clearPersonaBtn.addEventListener('click', () => this.clearStoryPersona());
    }

    // Generation
    if (this.continueStoryBtn) {
      this.continueStoryBtn.addEventListener('click', () => this.generate('continue'));
    }
    if (this.characterResponseBtn) {
      this.characterResponseBtn.addEventListener('click', () => this.generate('character'));
    }
    if (this.customPromptBtn) {
      this.customPromptBtn.addEventListener('click', () => this.openCustomPromptModal());
    }
    if (this.generateCustomBtn) {
      this.generateCustomBtn.addEventListener('click', () => this.generateCustom());
    }
    if (this.rewriteThirdPersonBtn) {
      this.rewriteThirdPersonBtn.addEventListener('click', () => this.rewriteToThirdPerson());
    }

    // Document controls
    if (this.saveBtn) {
      this.saveBtn.addEventListener('click', () => this.saveDocument());
    }
    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => this.clearDocument());
    }
    if (this.exportBtn) {
      this.exportBtn.addEventListener('click', () => this.exportDocument());
    }

    // Settings
    if (this.settingsBtn) {
      this.settingsBtn.addEventListener('click', () => this.openSettingsModal());
    }
    if (this.saveSettingsBtn) {
      this.saveSettingsBtn.addEventListener('click', () => this.saveSettings());
    }

    // Prompt viewer
    if (this.viewPromptBtn) {
      this.viewPromptBtn.addEventListener('click', () => this.openPromptViewer());
    }

    // Reasoning panel
    if (this.closeReasoningBtn) {
      this.closeReasoningBtn.addEventListener('click', () => this.hideReasoning());
    }

    // Modal close buttons
    document.querySelectorAll('.close-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal');
        if (modal) this.closeModal(modal);
      });
    });

    // Close modals on outside click
    document.querySelectorAll('.modal').forEach((modal) => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          this.closeModal(modal);
        }
      });
    });

    // Editor auto-save trigger (debounced)
    if (this.editor) {
      let saveTimeout;
      this.editor.addEventListener('input', () => {
        if (!this.settings?.autoSave) return;
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => this.saveDocument(), 1000);
      });
    }
  }

  // ==================== API Methods ====================

  async loadSettings() {
    try {
      const { settings } = await apiClient.getSettings();
      this.settings = settings || {
        apiKey: '',
        maxTokens: 4000,
        showReasoning: false,
        autoSave: true,
        showPrompt: false,
        thirdPerson: true,
        filterAsterisks: true,
      };
    } catch (error) {
      console.error('Failed to load settings:', error);
      this.settings = {
        apiKey: '',
        maxTokens: 4000,
        showReasoning: false,
        autoSave: true,
        showPrompt: false,
        thirdPerson: true,
        filterAsterisks: true,
      };
    }
  }

  async loadStories() {
    try {
      const { stories } = await apiClient.listStories();
      this.stories = stories || [];

      // If no stories exist, create a default one
      if (this.stories.length === 0) {
        await this.createFirstStory();
      } else {
        // Load the most recent story
        this.currentStoryId = this.stories[0].id;
        await this.loadCurrentStory();
      }
    } catch (error) {
      console.error('Failed to load stories:', error);
      this.showToast('Failed to load stories', 'error');
    }
  }

  async createFirstStory() {
    try {
      const { story } = await apiClient.createStory('My First Story', 'Start writing your novel here');
      this.stories = [story];
      this.currentStoryId = story.id;
      await this.loadCurrentStory();
      this.showToast('Created your first story!', 'success');
    } catch (error) {
      console.error('Failed to create first story:', error);
      this.showToast('Failed to create story', 'error');
    }
  }

  async loadCurrentStory() {
    if (!this.currentStoryId) return;

    try {
      const { story } = await apiClient.getStory(this.currentStoryId);
      this.currentStory = story; // Save full story metadata
      this.editor.value = story.content || '';

      // Load characters for this story
      await this.loadCharacters();

      this.updateUI();
    } catch (error) {
      console.error('Failed to load story:', error);
      this.showToast('Failed to load story', 'error');
    }
  }

  async loadCharacters() {
    if (!this.currentStoryId) return;

    try {
      const { characters } = await apiClient.listStoryCharacters(this.currentStoryId);
      this.characters = characters || [];
      this.updateUI();
    } catch (error) {
      console.error('Failed to load characters:', error);
      this.characters = [];
    }
  }

  async saveDocument() {
    if (!this.currentStoryId) return;

    try {
      await apiClient.updateStoryContent(this.currentStoryId, this.editor.value);
      // Don't show toast on auto-save to avoid spam
    } catch (error) {
      console.error('Failed to save document:', error);
      this.showToast('Failed to save document', 'error');
    }
  }

  // ==================== Story Management ====================

  async createNewStory() {
    const title = prompt('Enter story title:');
    if (!title || !title.trim()) return;

    try {
      const { story } = await apiClient.createStory(title.trim(), '');
      this.stories.unshift(story); // Add to beginning
      this.currentStoryId = story.id;
      this.editor.value = '';
      this.characters = [];
      await this.loadCurrentStory();
      this.updateUI();
      this.showToast('Story created!', 'success');
    } catch (error) {
      console.error('Failed to create story:', error);
      this.showToast('Failed to create story', 'error');
    }
  }

  async switchStory() {
    const newStoryId = this.storySelector.value;
    if (!newStoryId || newStoryId === this.currentStoryId) return;

    // Save current story first
    await this.saveDocument();

    // Switch to new story
    this.currentStoryId = newStoryId;
    await this.loadCurrentStory();
  }

  // ==================== Character Management ====================

  async handleCharacterUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!this.currentStoryId) {
      this.showToast('Please create a story first', 'error');
      return;
    }

    try {
      // Step 1: Import PNG to global library
      const result = await apiClient.importCharacter(file);

      // Step 2: Add to current story
      await apiClient.addCharacterToStory(this.currentStoryId, result.id);

      // Step 3: If story is empty and character has first message, populate it
      if (!this.editor.value.trim() && result.firstMessage) {
        this.editor.value = result.firstMessage + '\n\n';
        await this.saveDocument();
      }

      // Reload characters
      await this.loadCharacters();
      this.showToast(`Character "${result.name}" added to story!`, 'success');
    } catch (error) {
      console.error('Failed to import character:', error);
      this.showToast('Failed to import character: ' + error.message, 'error');
    }

    // Reset file input
    event.target.value = '';
  }

  async clearCharacter() {
    if (!this.characters || this.characters.length === 0) return;

    if (!confirm('Remove all characters from this story? (They will remain in your character library)')) return;

    try {
      // Remove all characters from story (doesn't delete from library)
      for (const char of this.characters) {
        await apiClient.removeCharacterFromStory(this.currentStoryId, char.id);
      }
      this.characters = [];
      this.updateUI();
      this.showToast('Characters removed from story', 'success');
    } catch (error) {
      console.error('Failed to clear characters:', error);
      this.showToast('Failed to remove characters', 'error');
    }
  }

  openCharacterCreator() {
    this.editingCharacterId = null;
    document.getElementById('characterModalTitle').textContent = 'Create New Character';

    // Clear all fields
    if (this.charImageInput) this.charImageInput.value = '';
    this.charNameInput.value = '';
    this.charDescInput.value = '';
    this.charPersonalityInput.value = '';
    this.charScenarioInput.value = '';
    this.charFirstMesInput.value = '';
    this.charMesExampleInput.value = '';
    this.charSystemPromptInput.value = '';
    this.charPostHistoryInput.value = '';

    // Close library modal to prevent overlap
    this.closeModal(this.characterLibraryModal);

    this.openModal(this.characterModal);
  }

  async openCharacterEditor(characterId) {
    this.editingCharacterId = characterId;
    document.getElementById('characterModalTitle').textContent = 'Edit Character';

    try {
      const { character } = await apiClient.getCharacterData(characterId);
      const data = character.data;

      if (this.charImageInput) this.charImageInput.value = '';
      this.charNameInput.value = data.name || '';
      this.charDescInput.value = data.description || '';
      this.charPersonalityInput.value = data.personality || '';
      this.charScenarioInput.value = data.scenario || '';
      this.charFirstMesInput.value = data.first_mes || '';
      this.charMesExampleInput.value = data.mes_example || '';
      this.charSystemPromptInput.value = data.system_prompt || '';
      this.charPostHistoryInput.value = data.post_history_instructions || '';

      // Close library modal to prevent overlap
      this.closeModal(this.characterLibraryModal);

      this.openModal(this.characterModal);
    } catch (error) {
      console.error('Failed to load character for editing:', error);
      this.showToast('Failed to load character', 'error');
    }
  }

  async saveCharacter() {
    const characterData = {
      name: this.charNameInput.value.trim(),
      description: this.charDescInput.value.trim(),
      personality: this.charPersonalityInput.value.trim(),
      scenario: this.charScenarioInput.value.trim(),
      first_mes: this.charFirstMesInput.value.trim(),
      mes_example: this.charMesExampleInput.value.trim(),
      system_prompt: this.charSystemPromptInput.value.trim(),
    };

    if (!characterData.name) {
      this.showToast('Character name is required', 'error');
      return;
    }

    // Get image file if selected
    const imageFile = this.charImageInput && this.charImageInput.files[0];

    try {
      if (this.editingCharacterId) {
        // Update existing character
        if (imageFile) {
          await apiClient.updateCharacterWithImage(this.editingCharacterId, characterData, imageFile);
        } else {
          await apiClient.updateCharacter(this.editingCharacterId, characterData);
        }
        this.showToast('Character updated!', 'success');
      } else {
        // Create new character
        const result = await apiClient.createCharacterWithImage(characterData, imageFile);
        this.showToast(`Character "${result.name}" created!`, 'success');
      }

      this.closeModal(this.characterModal);

      // Re-open library to show updates
      await this.openCharacterLibrary();

      // Reload story characters in case we edited one in use
      await this.loadCharacters();
    } catch (error) {
      console.error('Failed to save character:', error);
      this.showToast('Failed to save character: ' + error.message, 'error');
    }
  }

  // ==================== Character Library ====================

  async openCharacterLibrary() {
    this.openModal(this.characterLibraryModal);

    try {
      const { characters } = await apiClient.listAllCharacters();
      this.renderCharacterLibrary(characters || []);
    } catch (error) {
      console.error('Failed to load character library:', error);
      this.characterLibraryGrid.innerHTML = '<p class="text-secondary">Failed to load characters</p>';
    }
  }

  renderCharacterLibrary(characters) {
    if (characters.length === 0) {
      this.characterLibraryGrid.innerHTML = '<p class="text-secondary">No characters in library. Import one to get started!</p>';
      return;
    }

    this.characterLibraryGrid.innerHTML = '';

    characters.forEach(char => {
      const card = document.createElement('div');
      card.className = 'character-card';

      // Avatar
      const avatar = document.createElement('div');
      avatar.className = 'character-card-avatar';
      if (char.imageUrl) {
        avatar.style.backgroundImage = `url(${char.imageUrl})`;
      } else {
        avatar.textContent = char.name.charAt(0).toUpperCase();
      }

      // Name
      const name = document.createElement('div');
      name.className = 'character-card-name';
      name.textContent = char.name;

      // Description
      const desc = document.createElement('div');
      desc.className = 'character-card-desc';
      desc.textContent = char.description || 'No description';

      // Actions
      const actions = document.createElement('div');
      actions.className = 'character-card-actions';
      actions.style.display = 'grid';
      actions.style.gridTemplateColumns = '1fr 1fr';
      actions.style.gap = '0.5rem';

      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-small btn-primary';
      addBtn.textContent = 'Add';
      addBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.addExistingCharacterToStory(char.id);
      };

      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-small btn-secondary';
      editBtn.textContent = 'Edit';
      editBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.openCharacterEditor(char.id);
      };

      actions.appendChild(addBtn);
      actions.appendChild(editBtn);

      // Delete button (full width, below other buttons)
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn btn-small btn-secondary';
      deleteBtn.textContent = 'Delete';
      deleteBtn.style.gridColumn = '1 / -1';
      deleteBtn.style.marginTop = '0.25rem';
      deleteBtn.onclick = async (e) => {
        e.stopPropagation();
        await this.deleteCharacterFromLibrary(char.id);
      };

      card.appendChild(avatar);
      card.appendChild(name);
      card.appendChild(desc);
      card.appendChild(actions);
      card.appendChild(deleteBtn);

      this.characterLibraryGrid.appendChild(card);
    });
  }

  async handleLibraryCharacterUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const result = await apiClient.importCharacter(file);
      this.showToast(`Character "${result.name}" imported to library!`, 'success');

      // Refresh library view
      const { characters } = await apiClient.listAllCharacters();
      this.renderCharacterLibrary(characters || []);
    } catch (error) {
      console.error('Failed to import character:', error);
      this.showToast('Failed to import character: ' + error.message, 'error');
    }

    // Reset file input
    event.target.value = '';
  }

  async addExistingCharacterToStory(characterId) {
    if (!this.currentStoryId) {
      this.showToast('Please create a story first', 'error');
      return;
    }

    try {
      await apiClient.addCharacterToStory(this.currentStoryId, characterId);
      await this.loadCharacters();
      this.showToast('Character added to story!', 'success');
    } catch (error) {
      console.error('Failed to add character to story:', error);
      this.showToast('Failed to add character: ' + error.message, 'error');
    }
  }

  async deleteCharacterFromLibrary(characterId) {
    if (!confirm('Permanently delete this character from your library? This cannot be undone.')) {
      return;
    }

    try {
      await apiClient.deleteCharacter(characterId);
      this.showToast('Character deleted from library', 'success');

      // Refresh library view
      const { characters } = await apiClient.listAllCharacters();
      this.renderCharacterLibrary(characters || []);

      // Reload current story characters in case it was removed
      await this.loadCharacters();
    } catch (error) {
      console.error('Failed to delete character:', error);
      this.showToast('Failed to delete character: ' + error.message, 'error');
    }
  }

  // ==================== Persona Management (Character-Only) ====================

  async openPersonaSelector() {
    if (!this.currentStoryId) {
      this.showToast('Please create a story first', 'error');
      return;
    }

    this.openModal(this.personaSelectorModal);

    try {
      const { characters } = await apiClient.listAllCharacters();
      this.renderPersonaSelector(characters || []);
    } catch (error) {
      console.error('Failed to load characters for persona:', error);
      this.personaSelectorGrid.innerHTML = '<p class="text-secondary">Failed to load characters</p>';
    }
  }

  renderPersonaSelector(characters) {
    if (characters.length === 0) {
      this.personaSelectorGrid.innerHTML = '<p class="text-secondary">No characters in library. Import one first!</p>';
      return;
    }

    this.personaSelectorGrid.innerHTML = '';

    characters.forEach(char => {
      const card = document.createElement('div');
      card.className = 'character-card';

      // Avatar
      const avatar = document.createElement('div');
      avatar.className = 'character-card-avatar';
      if (char.imageUrl) {
        avatar.style.backgroundImage = `url(${char.imageUrl})`;
      } else {
        avatar.textContent = char.name.charAt(0).toUpperCase();
      }

      // Name
      const name = document.createElement('div');
      name.className = 'character-card-name';
      name.textContent = char.name;

      // Description
      const desc = document.createElement('div');
      desc.className = 'character-card-desc';
      desc.textContent = char.description || 'No description';

      // Use as Persona button
      const useBtn = document.createElement('button');
      useBtn.className = 'btn btn-small btn-primary';
      useBtn.textContent = 'Use as Persona';
      useBtn.style.width = '100%';
      useBtn.onclick = async () => {
        await this.setCharacterAsPersona(char.id);
      };

      card.appendChild(avatar);
      card.appendChild(name);
      card.appendChild(desc);
      card.appendChild(useBtn);

      this.personaSelectorGrid.appendChild(card);
    });
  }

  async setCharacterAsPersona(characterId) {
    if (!this.currentStoryId) return;

    try {
      await apiClient.setStoryPersona(this.currentStoryId, characterId);
      await this.loadCurrentStory(); // Reload to update personaCharacterId
      this.updateUI();
      this.closeModal(this.personaSelectorModal);
      this.showToast('Character set as persona for this story!', 'success');
    } catch (error) {
      console.error('Failed to set persona:', error);
      this.showToast('Failed to set persona: ' + error.message, 'error');
    }
  }

  async clearStoryPersona() {
    if (!this.currentStoryId) return;

    try {
      await apiClient.setStoryPersona(this.currentStoryId, null);
      await this.loadCurrentStory(); // Reload to update personaCharacterId
      this.updateUI();
      this.closeModal(this.personaSelectorModal);
      this.showToast('Persona cleared', 'success');
    } catch (error) {
      console.error('Failed to clear persona:', error);
      this.showToast('Failed to clear persona: ' + error.message, 'error');
    }
  }

  // ==================== Settings Management ====================

  openSettingsModal() {
    if (this.settings) {
      this.apiKeyInput.value = this.settings.apiKey || '';
      this.maxTokensInput.value = this.settings.maxTokens || 4000;
      this.showReasoningToggle.checked = this.settings.showReasoning || false;
      this.autoSaveToggle.checked = this.settings.autoSave !== false;
      this.showPromptToggle.checked = this.settings.showPrompt || false;
      this.thirdPersonToggle.checked = this.settings.thirdPerson !== false;
      this.filterAsterisksToggle.checked = this.settings.filterAsterisks !== false;
    }
    this.openModal(this.settingsModal);
  }

  async saveSettings() {
    const oldAutoSave = this.settings?.autoSave;

    const settings = {
      apiKey: this.apiKeyInput.value.trim(),
      maxTokens: parseInt(this.maxTokensInput.value) || 4000,
      showReasoning: this.showReasoningToggle.checked,
      autoSave: this.autoSaveToggle.checked,
      showPrompt: this.showPromptToggle.checked,
      thirdPerson: this.thirdPersonToggle.checked,
      filterAsterisks: this.filterAsterisksToggle.checked,
    };

    try {
      const { settings: saved } = await apiClient.updateSettings(settings);
      this.settings = saved;

      // Update auto-save
      if (this.settings.autoSave && !oldAutoSave) {
        this.startAutoSave();
      } else if (!this.settings.autoSave && oldAutoSave) {
        this.stopAutoSave();
      }

      this.updateUI();
      this.closeModal(this.settingsModal);
      this.showToast('Settings saved', 'success');
    } catch (error) {
      console.error('Failed to save settings:', error);
      this.showToast('Failed to save settings', 'error');
    }
  }

  // ==================== Generation ====================

  async generate(type) {
    console.log('[App] Generate called with type:', type);

    if (!this.currentStoryId) {
      this.showToast('Please create a story first', 'error');
      return;
    }

    if (!this.settings?.apiKey) {
      this.showToast('Please set your DeepSeek API key in settings', 'error');
      this.openSettingsModal();
      return;
    }

    // Save before generating
    await this.saveDocument();

    try {
      console.log('[App] Starting generation UI updates');

      // Disable generation buttons
      this.setGenerationEnabled(false);
      this.generationStatus.classList.remove('hidden');
      this.statusText.textContent = 'Generating...';

      // Clear previous reasoning
      if (this.settings.showReasoning) {
        console.log('[App] Showing reasoning panel');
        this.reasoningContent.innerHTML = '<div class="reasoning-empty">Thinking...</div>';
        this.showReasoning();
      }

      let generatedContent = '';
      let reasoningText = '';
      let hasContent = false;

      // Track cursor position and capture text before/after once
      const cursorPos = this.editor.selectionStart;
      const textBefore = this.editor.value.substring(0, cursorPos);
      const textAfter = this.editor.value.substring(cursorPos);

      console.log('[App] Starting stream consumption...');

      // Stream generation from server
      for await (const chunk of apiClient.generateStream(this.currentStoryId, type)) {
        console.log('[App] Received chunk:', chunk);
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

      // Add two line breaks and position cursor for user to write
      if (generatedContent) {
        generatedContent += '\n\n';
        this.editor.value = textBefore + generatedContent + textAfter;

        // Position cursor after the generated content and line breaks
        const newCursorPos = textBefore.length + generatedContent.length;
        this.editor.selectionStart = newCursorPos;
        this.editor.selectionEnd = newCursorPos;
        this.editor.focus();
      }

      // Save document
      await this.saveDocument();

      console.log('[App] Generation complete!');
      this.showToast('Generation complete', 'success');
    } catch (error) {
      console.error('[App] Generation error:', error);
      this.showToast(`Generation failed: ${error.message}`, 'error');
    } finally {
      console.log('[App] Cleaning up generation UI');
      this.setGenerationEnabled(true);
      this.generationStatus.classList.add('hidden');
    }
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

      // Save before generating
      await this.saveDocument();

      let generatedContent = '';
      let reasoningText = '';
      let hasContent = false;

      // Track cursor position
      const cursorPos = this.editor.selectionStart;
      const textBefore = this.editor.value.substring(0, cursorPos);
      const textAfter = this.editor.value.substring(cursorPos);

      // Stream generation
      for await (const chunk of apiClient.generateStream(this.currentStoryId, 'custom', customPrompt)) {
        if (chunk.reasoning && this.settings.showReasoning) {
          reasoningText += chunk.reasoning;
          this.reasoningContent.innerHTML = this.formatReasoning(reasoningText);
          this.reasoningContent.scrollTop = this.reasoningContent.scrollHeight;
        }

        if (chunk.content) {
          if (!hasContent) {
            hasContent = true;
            this.statusText.textContent = 'Writing...';
          }

          const filteredContent = this.filterAsterisks(chunk.content);
          generatedContent += filteredContent;
          this.editor.value = textBefore + generatedContent + textAfter;
          this.editor.scrollTop = this.editor.scrollHeight;
        }

        if (chunk.finished) {
          break;
        }
      }

      // Add line breaks and position cursor
      if (generatedContent) {
        generatedContent += '\n\n';
        this.editor.value = textBefore + generatedContent + textAfter;
        const newCursorPos = textBefore.length + generatedContent.length;
        this.editor.selectionStart = newCursorPos;
        this.editor.selectionEnd = newCursorPos;
        this.editor.focus();
      }

      await this.saveDocument();
      this.showToast('Generation complete', 'success');
    } catch (error) {
      console.error('Generation error:', error);
      this.showToast(`Generation failed: ${error.message}`, 'error');
    } finally {
      this.setGenerationEnabled(true);
      this.generationStatus.classList.add('hidden');
    }
  }

  async rewriteToThirdPerson() {
    if (!this.currentStoryId) {
      this.showToast('Please create a story first', 'error');
      return;
    }

    if (!this.settings?.apiKey) {
      this.showToast('Please set your DeepSeek API key in settings', 'error');
      this.openSettingsModal();
      return;
    }

    if (!this.editor.value.trim()) {
      this.showToast('No content to rewrite', 'error');
      return;
    }

    if (
      !confirm(
        'This will replace the entire document with a rewritten version in third-person past tense. Continue?'
      )
    ) {
      return;
    }

    // For rewrite, we'll use custom prompt with special instructions
    const rewritePrompt = `Rewrite the following story in third-person past tense perspective.

Use he/she/they pronouns and past tense verbs throughout (said, walked, thought, etc.).

Maintain the plot, events, and character interactions, but ensure all narrative and dialogue tags use third-person past tense.

Remove any asterisks (*) used for actions - write everything as prose.

Do NOT use first-person (I, me, my) or present tense.`;

    try {
      this.setGenerationEnabled(false);
      this.generationStatus.classList.remove('hidden');
      this.statusText.textContent = 'Rewriting...';

      // Clear previous reasoning
      if (this.settings.showReasoning) {
        this.reasoningContent.innerHTML = '<div class="reasoning-empty">Thinking...</div>';
        this.showReasoning();
      }

      // Clear editor for rewrite
      this.editor.value = '';

      let rewrittenContent = '';
      let reasoningText = '';
      let hasContent = false;

      // Stream rewrite
      for await (const chunk of apiClient.generateStream(this.currentStoryId, 'custom', rewritePrompt)) {
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

          const filteredContent = this.filterAsterisks(chunk.content);
          rewrittenContent += filteredContent;
          this.editor.value = rewrittenContent;
          this.editor.scrollTop = this.editor.scrollHeight;
        }

        if (chunk.finished) {
          break;
        }
      }

      await this.saveDocument();
      this.showToast('Rewrite complete', 'success');
    } catch (error) {
      console.error('Rewrite error:', error);
      this.showToast(`Rewrite failed: ${error.message}`, 'error');
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

  filterAsterisks(text) {
    if (!text || !this.settings?.filterAsterisks) return text;
    return text.replace(/\*/g, '');
  }

  // ==================== Document Operations ====================

  clearDocument() {
    if (!confirm('Clear the entire document? This cannot be undone.')) {
      return;
    }

    this.editor.value = '';
    this.saveDocument();
  }

  exportDocument() {
    const content = this.editor.value;
    if (!content) {
      this.showToast('No content to export', 'error');
      return;
    }

    const currentStory = this.stories.find(s => s.id === this.currentStoryId);
    const filename = currentStory ? `${currentStory.title}.txt` : 'story.txt';

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    this.showToast('Story exported!', 'success');
  }

  // ==================== UI Management ====================

  updateUI() {
    // Update story selector
    this.updateStorySelector();

    // Update character display
    this.updateCharacterDisplay();

    // Update persona display
    this.updatePersonaDisplay();

    // Update generation buttons
    this.updateGenerationButtons();

    // Update prompt viewer button
    if (this.viewPromptBtn && this.settings) {
      this.viewPromptBtn.classList.toggle('hidden', !this.settings.showPrompt);
    }
  }

  updateStorySelector() {
    if (!this.storySelector) return;

    // Clear existing options
    this.storySelector.innerHTML = '';

    // Add stories
    this.stories.forEach((story) => {
      const option = document.createElement('option');
      option.value = story.id;
      option.textContent = story.title;
      if (story.id === this.currentStoryId) {
        option.selected = true;
      }
      this.storySelector.appendChild(option);
    });
  }

  updateCharacterDisplay() {
    const hasCharacters = this.characters && this.characters.length > 0;

    if (hasCharacters) {
      this.noCharacter.classList.add('hidden');
      this.characterInfo.classList.remove('hidden');

      // Show first character info
      const char = this.characters[0];
      this.characterName.textContent = char.name;

      // Build description showing all characters
      if (this.characters.length === 1) {
        this.characterDesc.textContent = char.description || 'No description';
      } else {
        // Show all character names
        const allNames = this.characters.map(c => c.name).join(', ');
        this.characterDesc.textContent = `${this.characters.length} characters: ${allNames}`;
      }

      // Display character avatar image
      if (char.imageUrl) {
        this.characterAvatar.style.backgroundImage = `url(${char.imageUrl})`;
        this.characterAvatar.style.backgroundSize = 'cover';
        this.characterAvatar.style.backgroundPosition = 'center';
        this.characterAvatar.textContent = '';
      } else {
        this.characterAvatar.style.backgroundImage = '';
        this.characterAvatar.textContent = char.name.charAt(0).toUpperCase();
      }
    } else {
      this.characterInfo.classList.add('hidden');
      this.noCharacter.classList.remove('hidden');
    }
  }

  async updatePersonaDisplay() {
    // Check if current story has a persona character set
    if (this.currentStory && this.currentStory.personaCharacterId) {
      // Using a character as persona
      try {
        const { character } = await apiClient.getCharacterData(this.currentStory.personaCharacterId);
        this.personaName.textContent = character.data?.name || 'Unknown';
        if (this.personaType) {
          this.personaType.textContent = 'Selected for this story';
        }
      } catch (error) {
        console.error('Failed to load persona character:', error);
        this.personaName.textContent = 'Error loading';
        if (this.personaType) {
          this.personaType.textContent = '';
        }
      }
    } else {
      this.personaName.textContent = 'Not set';
      if (this.personaType) {
        this.personaType.textContent = 'Click "Select Character" to set';
      }
    }
  }

  updateGenerationButtons() {
    const hasApiKey = this.settings && this.settings.apiKey;
    const hasStory = this.currentStoryId !== null;

    this.continueStoryBtn.disabled = !hasApiKey || !hasStory;
    this.characterResponseBtn.disabled = !hasApiKey || !hasStory || this.characters.length === 0;
    this.customPromptBtn.disabled = !hasApiKey || !hasStory;
    this.rewriteThirdPersonBtn.disabled = !hasApiKey || !hasStory;
  }

  setGenerationEnabled(enabled) {
    this.continueStoryBtn.disabled = !enabled;
    this.characterResponseBtn.disabled = !enabled;
    this.customPromptBtn.disabled = !enabled;
    this.rewriteThirdPersonBtn.disabled = !enabled;
  }

  // ==================== Auto-save ====================

  startAutoSave() {
    if (this.autoSaveInterval) return;
    this.autoSaveInterval = setInterval(() => {
      if (this.currentStoryId) {
        this.saveDocument();
      }
    }, 30000); // 30 seconds
  }

  stopAutoSave() {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  // ==================== Reasoning Panel ====================

  showReasoning() {
    this.reasoningPanel.classList.remove('hidden');
  }

  hideReasoning() {
    this.reasoningPanel.classList.add('hidden');
  }

  // ==================== Prompt Viewer ====================

  openPromptViewer() {
    // TODO: Implement prompt viewer with actual prompts from generation
    this.showToast('Prompt viewer: Coming soon', 'info');
  }

  // ==================== Modal Management ====================

  openModal(modal) {
    modal.classList.remove('hidden');
  }

  closeModal(modal) {
    modal.classList.add('hidden');
  }

  // ==================== Toast Notifications ====================

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    this.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new NovelWriterApp();
});
