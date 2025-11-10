/**
 * Landing page controller
 * Handles displaying recent stories and character library
 */
class LandingPage {
    constructor(apiClient, router) {
        this.apiClient = apiClient;
        this.router = router;
        this.stories = [];
        this.characters = [];
        this.settings = null;
        this.staticListenersAttached = false;
    }

    /**
     * Initialize and show the landing page
     */
    async show() {
        await this.loadData();
        this.render();
        this.attachEventListeners();
    }

    /**
     * Load stories, characters, and settings from API
     */
    async loadData() {
        try {
            const [storiesResponse, charactersResponse, settings] = await Promise.all([
                this.apiClient.listStories(),
                this.apiClient.listAllCharacters(),
                this.apiClient.getSettings()
            ]);

            this.stories = storiesResponse.stories || [];
            this.characters = charactersResponse.characters || [];
            this.settings = settings;

            // Sort stories by modified date (most recent first)
            this.stories.sort((a, b) => {
                const dateA = new Date(a.modified || a.created);
                const dateB = new Date(b.modified || b.created);
                return dateB - dateA;
            });
        } catch (error) {
            console.error('Error loading landing page data:', error);
        }
    }

    /**
     * Render the landing page
     */
    render() {
        this.renderRecentStories();
        this.renderCharacterLibrary();
    }

    /**
     * Render recent stories section
     */
    renderRecentStories() {
        const container = document.getElementById('recent-stories-container');
        if (!container) return;

        const recentStories = this.stories.slice(0, 10);

        if (recentStories.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-book"></i>
                    <p>No stories yet. Create your first story to get started!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = recentStories.map(story => {
            const modifiedDate = new Date(story.modified || story.created);
            const relativeTime = this.getRelativeTime(modifiedDate);
            const characterNames = this.getCharacterNames(story.characterIds);

            return `
                <div class="story-card" data-story-id="${story.id}">
                    <div class="story-card-header">
                        <h3 class="story-title">${this.escapeHtml(story.title || 'Untitled Story')}</h3>
                        <span class="story-date">${relativeTime}</span>
                    </div>
                    ${story.description ? `<p class="story-description">${this.escapeHtml(story.description)}</p>` : ''}
                    ${characterNames.length > 0 ? `
                        <div class="story-characters">
                            <i class="fas fa-users"></i>
                            <span>${characterNames.join(', ')}</span>
                        </div>
                    ` : ''}
                    <button class="btn btn-primary open-story-btn" data-story-id="${story.id}">
                        <i class="fas fa-book-open"></i> Open Story
                    </button>
                </div>
            `;
        }).join('');
    }

    /**
     * Render character library section
     */
    renderCharacterLibrary() {
        const container = document.getElementById('character-library-container');
        if (!container) return;

        if (this.characters.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-user"></i>
                    <p>No characters yet. Import a character to get started!</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.characters.map(character => {
            const characterName = character.name || 'Unknown';
            const avatarUrl = character.imageUrl || '';
            const lastStory = this.findLastStoryWithCharacter(character.id);

            return `
                <div class="character-card" data-character-id="${character.id}">
                    <div class="character-avatar">
                        ${avatarUrl ?
                            `<img src="${avatarUrl}" alt="${this.escapeHtml(characterName)}" onerror="this.style.display='none'">` :
                            `<i class="fas fa-user"></i>`
                        }
                    </div>
                    <div class="character-info">
                        <h4 class="character-name">${this.escapeHtml(characterName)}</h4>
                        ${lastStory ?
                            `<p class="character-last-story">Last in: ${this.escapeHtml(lastStory.title || 'Untitled')}</p>` :
                            `<p class="character-last-story">No stories yet</p>`
                        }
                    </div>
                    <div class="character-actions">
                        ${lastStory ? `
                            <button class="btn btn-secondary continue-story-btn" data-character-id="${character.id}" data-story-id="${lastStory.id}">
                                <i class="fas fa-play"></i> Continue
                            </button>
                        ` : ''}
                        <button class="btn btn-primary new-story-btn" data-character-id="${character.id}">
                            <i class="fas fa-plus"></i> New Story
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    /**
     * Attach event listeners
     */
    attachEventListeners() {
        // New story button (global) - only attach once
        if (!this.staticListenersAttached) {
            const newStoryBtn = document.getElementById('new-story-btn');
            if (newStoryBtn) {
                newStoryBtn.addEventListener('click', () => this.createNewStory());
            }
            this.staticListenersAttached = true;
        }

        // Open story buttons (dynamically rendered, re-attach each time)
        document.querySelectorAll('.open-story-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const storyId = e.currentTarget.dataset.storyId;
                this.openStory(storyId);
            });
        });

        // Story cards (click anywhere to open)
        document.querySelectorAll('.story-card').forEach(card => {
            card.addEventListener('click', (e) => {
                // Don't trigger if clicking the button
                if (e.target.closest('.open-story-btn')) return;
                const storyId = card.dataset.storyId;
                this.openStory(storyId);
            });
        });

        // Continue story buttons
        document.querySelectorAll('.continue-story-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const storyId = e.currentTarget.dataset.storyId;
                this.openStory(storyId);
            });
        });

        // New story with character buttons
        document.querySelectorAll('.new-story-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const characterId = e.currentTarget.dataset.characterId;
                this.createNewStoryWithCharacter(characterId);
            });
        });
    }

    /**
     * Find the most recent story that includes a character
     * @param {string} characterId
     * @returns {Object|null}
     */
    findLastStoryWithCharacter(characterId) {
        return this.stories.find(story =>
            story.characterIds && story.characterIds.includes(characterId)
        );
    }

    /**
     * Get character names for story
     * @param {Array} characterIds
     * @returns {Array}
     */
    getCharacterNames(characterIds) {
        if (!characterIds || characterIds.length === 0) return [];

        return characterIds
            .map(id => {
                const char = this.characters.find(c => c.id === id);
                return char?.name;
            })
            .filter(name => name);
    }

    /**
     * Create a new blank story
     */
    async createNewStory() {
        try {
            const { story } = await this.apiClient.createStory('Untitled Story');
            this.router.navigate(`/story/${story.id}`);
        } catch (error) {
            console.error('Error creating story:', error);
            alert('Failed to create story. Please try again.');
        }
    }

    /**
     * Create a new story with a specific character
     * @param {string} characterId
     */
    async createNewStoryWithCharacter(characterId) {
        try {
            const character = this.characters.find(c => c.id === characterId);
            const characterName = character?.name || 'Character';

            const { story } = await this.apiClient.createStory(`Story with ${characterName}`);

            // Add character to the story
            await this.apiClient.addCharacterToStory(story.id, characterId);

            this.router.navigate(`/story/${story.id}`);
        } catch (error) {
            console.error('Error creating story with character:', error);
            alert('Failed to create story. Please try again.');
        }
    }

    /**
     * Open an existing story
     * @param {string} storyId
     */
    openStory(storyId) {
        this.router.navigate(`/story/${storyId}`);
    }

    /**
     * Get relative time string
     * @param {Date} date
     * @returns {string}
     */
    getRelativeTime(date) {
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
        if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
        if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

        return date.toLocaleDateString();
    }

    /**
     * Escape HTML to prevent XSS
     * @param {string} str
     * @returns {string}
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}
