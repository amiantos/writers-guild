/**
 * Client-side router using History API
 * Handles navigation between landing page and story editor
 */
class Router {
    constructor() {
        this.routes = {
            landing: null,
            editor: null
        };
        this.currentRoute = null;
        this.currentStoryId = null;
    }

    /**
     * Initialize the router and set up event listeners
     */
    init() {
        // Listen for browser back/forward navigation
        window.addEventListener('popstate', () => this.handleRoute());

        // Intercept link clicks for client-side navigation
        document.addEventListener('click', (e) => {
            const link = e.target.closest('a[data-route]');
            if (link) {
                e.preventDefault();
                const path = link.getAttribute('href');
                this.navigate(path);
            }
        });

        // Handle initial route
        this.handleRoute();
    }

    /**
     * Register view controllers
     * @param {Object} landing - Landing page controller
     * @param {Object} editor - Story editor controller
     */
    register(landing, editor) {
        this.routes.landing = landing;
        this.routes.editor = editor;
    }

    /**
     * Navigate to a new path
     * @param {string} path - The path to navigate to
     */
    navigate(path) {
        if (window.location.pathname !== path) {
            window.history.pushState({}, '', path);
        }
        this.handleRoute();
    }

    /**
     * Handle route changes
     */
    handleRoute() {
        const path = window.location.pathname;

        if (path === '/') {
            this.showLanding();
        } else if (path.match(/^\/story\/(.+)$/)) {
            const storyId = path.match(/^\/story\/(.+)$/)[1];
            this.showStoryEditor(storyId);
        } else {
            // Unknown route, redirect to landing
            this.navigate('/');
        }
    }

    /**
     * Show landing page view
     */
    showLanding() {
        this.currentRoute = 'landing';
        this.currentStoryId = null;

        // Hide editor, show landing
        const landingView = document.getElementById('landing-view');
        const editorView = document.getElementById('editor-view');

        if (landingView && editorView) {
            landingView.style.display = 'flex';
            editorView.style.display = 'none';
        }

        // Initialize landing page
        if (this.routes.landing) {
            this.routes.landing.show();
        }
    }

    /**
     * Show story editor view
     * @param {string} storyId - The ID of the story to load
     */
    showStoryEditor(storyId) {
        this.currentRoute = 'editor';
        this.currentStoryId = storyId;

        // Hide landing, show editor
        const landingView = document.getElementById('landing-view');
        const editorView = document.getElementById('editor-view');

        if (landingView && editorView) {
            landingView.style.display = 'none';
            editorView.style.display = 'flex';
        }

        // Initialize editor with story
        if (this.routes.editor) {
            this.routes.editor.loadStory(storyId);
        }
    }

    /**
     * Get current story ID if on editor route
     * @returns {string|null}
     */
    getCurrentStoryId() {
        return this.currentStoryId;
    }

    /**
     * Check if currently on landing page
     * @returns {boolean}
     */
    isOnLanding() {
        return this.currentRoute === 'landing';
    }

    /**
     * Check if currently on editor page
     * @returns {boolean}
     */
    isOnEditor() {
        return this.currentRoute === 'editor';
    }
}

// Export singleton instance
window.router = new Router();
