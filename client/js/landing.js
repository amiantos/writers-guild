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
        this.storySortBy = 'modified'; // 'name', 'created', 'modified'
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
        this.renderAllStoriesTable();
        this.renderCharacterLibrary();
    }

    /**
     * Render recent stories section
     */
    renderRecentStories() {
        const container = document.getElementById('recent-stories-container');
        if (!container) return;

        const recentStories = this.stories.slice(0, 3);

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
     * Render all stories table
     */
    renderAllStoriesTable() {
        const container = document.getElementById('all-stories-container');
        if (!container) return;

        if (this.stories.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-book"></i>
                    <p>No stories yet.</p>
                </div>
            `;
            return;
        }

        // Sort stories based on current sort setting
        const sortedStories = this.getSortedStories();

        container.innerHTML = `
            <table class="stories-table">
                <thead>
                    <tr>
                        <th class="story-avatar-header"></th>
                        <th>
                            <button class="sort-btn ${this.storySortBy === 'name' ? 'active' : ''}" data-sort="name">
                                Title ${this.storySortBy === 'name' ? (this.sortAscending ? '▲' : '▼') : ''}
                            </button>
                        </th>
                        <th>
                            <button class="sort-btn ${this.storySortBy === 'created' ? 'active' : ''}" data-sort="created">
                                Created ${this.storySortBy === 'created' ? (this.sortAscending ? '▲' : '▼') : ''}
                            </button>
                        </th>
                        <th>
                            <button class="sort-btn ${this.storySortBy === 'modified' ? 'active' : ''}" data-sort="modified">
                                Modified ${this.storySortBy === 'modified' ? (this.sortAscending ? '▲' : '▼') : ''}
                            </button>
                        </th>
                        <th>Words</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${sortedStories.map(story => {
                        const firstCharacter = this.getFirstCharacter(story.characterIds);
                        const avatarHtml = firstCharacter?.imageUrl
                            ? `<div class="story-avatar" style="background-image: url('${firstCharacter.imageUrl}'); background-position: center top;"></div>`
                            : `<div class="story-avatar story-avatar-empty"><i class="fas fa-user"></i></div>`;

                        return `
                        <tr>
                            <td class="story-avatar-cell">${avatarHtml}</td>
                            <td class="story-title-cell">${this.escapeHtml(story.title || 'Untitled Story')}</td>
                            <td class="story-date-cell">${new Date(story.created).toLocaleDateString()}</td>
                            <td class="story-date-cell">${new Date(story.modified || story.created).toLocaleDateString()}</td>
                            <td class="story-wordcount-cell">${(story.wordCount || 0).toLocaleString()}</td>
                            <td class="story-actions-cell">
                                <button class="btn btn-small btn-primary table-open-btn" data-story-id="${story.id}">
                                    <i class="fas fa-folder-open"></i> Open
                                </button>
                                <button class="btn btn-small btn-secondary table-delete-btn" data-story-id="${story.id}" data-story-title="${this.escapeHtml(story.title || 'Untitled Story')}">
                                    <i class="fas fa-trash"></i> Delete
                                </button>
                            </td>
                        </tr>
                    `;
                    }).join('')}
                </tbody>
            </table>
        `;
    }

    /**
     * Get sorted stories based on current sort setting
     */
    getSortedStories() {
        const sorted = [...this.stories];

        sorted.sort((a, b) => {
            let aVal, bVal;

            switch (this.storySortBy) {
                case 'name':
                    aVal = (a.title || 'Untitled Story').toLowerCase();
                    bVal = (b.title || 'Untitled Story').toLowerCase();
                    return aVal.localeCompare(bVal);

                case 'created':
                    aVal = new Date(a.created);
                    bVal = new Date(b.created);
                    return bVal - aVal; // Most recent first

                case 'modified':
                default:
                    aVal = new Date(a.modified || a.created);
                    bVal = new Date(b.modified || b.created);
                    return bVal - aVal; // Most recent first
            }
        });

        return sorted;
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

        // Table sort buttons
        document.querySelectorAll('.sort-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const sortBy = e.currentTarget.dataset.sort;
                this.storySortBy = sortBy;
                this.renderAllStoriesTable();
                this.attachEventListeners(); // Re-attach listeners after re-render
            });
        });

        // Table open buttons
        document.querySelectorAll('.table-open-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const storyId = e.currentTarget.dataset.storyId;
                this.openStory(storyId);
            });
        });

        // Table delete buttons
        document.querySelectorAll('.table-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const storyId = e.currentTarget.dataset.storyId;
                const storyTitle = e.currentTarget.dataset.storyTitle;
                await this.deleteStory(storyId, storyTitle);
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
     * Get first character object for story
     * @param {Array} characterIds
     * @returns {Object|null}
     */
    getFirstCharacter(characterIds) {
        if (!characterIds || characterIds.length === 0) return null;

        // Find the first character ID that actually exists in the character library
        for (const charId of characterIds) {
            const character = this.characters.find(c => c.id === charId);
            if (character) {
                return character;
            }
        }

        return null;
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
     * Delete a story
     * @param {string} storyId
     * @param {string} storyTitle
     */
    async deleteStory(storyId, storyTitle) {
        const confirmMsg = `Delete story "${storyTitle}"? This cannot be undone.`;
        if (!confirm(confirmMsg)) return;

        try {
            await this.apiClient.deleteStory(storyId);

            // Remove from local stories list
            this.stories = this.stories.filter(s => s.id !== storyId);

            // Re-render the stories table and reattach listeners
            this.renderAllStoriesTable();
            this.attachEventListeners();

            alert('Story deleted successfully');
        } catch (error) {
            console.error('Error deleting story:', error);
            alert('Failed to delete story. Please try again.');
        }
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
