import { createRouter, createWebHistory } from 'vue-router'
import { onboardingAPI } from '../services/api'

// Eager load landing page for fast initial load
import LandingPage from '../views/LandingPage.vue'

// Lazy load heavy views for better performance
const StoryEditor = () => import('../views/StoryEditor.vue')
const CharacterDetail = () => import('../views/CharacterDetail.vue')
const LorebookDetail = () => import('../views/LorebookDetail.vue')
const SettingsPage = () => import('../views/SettingsPage.vue')
const OnboardingWizard = () => import('../views/OnboardingWizard.vue')

const routes = [
  {
    path: '/onboarding',
    name: 'onboarding',
    component: OnboardingWizard,
    meta: { title: 'Welcome - Writers Guild', skipOnboardingCheck: true }
  },
  {
    path: '/',
    name: 'home',
    component: LandingPage,
    meta: { title: 'Writers Guild' }
  },
  {
    path: '/story/:storyId',
    name: 'story',
    component: StoryEditor,
    props: true,
    meta: { title: 'Story Editor - Writers Guild', dynamicTitle: true }
  },
  {
    path: '/characters/:characterId',
    name: 'character-detail',
    component: CharacterDetail,
    props: true,
    meta: { title: 'Character - Writers Guild', dynamicTitle: true }
  },
  {
    path: '/lorebooks/:lorebookId',
    name: 'lorebook-detail',
    component: LorebookDetail,
    props: true,
    meta: { title: 'Lorebook - Writers Guild', dynamicTitle: true }
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsPage,
    meta: { title: 'Settings - Writers Guild' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Track onboarding status to avoid repeated API calls
let onboardingChecked = false
let onboardingCompleted = false

// Navigation guard to check onboarding status
router.beforeEach(async (to, from, next) => {
  // Skip check for onboarding page itself
  if (to.meta.skipOnboardingCheck) {
    return next()
  }

  // If we've already checked and onboarding is complete, proceed
  if (onboardingChecked && onboardingCompleted) {
    return next()
  }

  // Check onboarding status from the API
  if (!onboardingChecked) {
    try {
      const status = await onboardingAPI.getStatus()
      onboardingChecked = true
      onboardingCompleted = status.onboardingCompleted
    } catch (error) {
      console.error('Failed to check onboarding status:', error)
      // On error, proceed to app (don't block user)
      onboardingChecked = true
      onboardingCompleted = true
      return next()
    }
  }

  // Redirect to onboarding if not completed
  if (!onboardingCompleted) {
    return next({ name: 'onboarding' })
  }

  next()
})

// Update page title on route change
router.afterEach((to) => {
  document.title = to.meta.title || 'Writers Guild'
})

// Helper function for components to update title dynamically
export function setPageTitle(title) {
  document.title = `${title} - Writers Guild`
}

// Helper function to mark onboarding as complete (called after onboarding wizard finishes)
export function markOnboardingComplete() {
  onboardingCompleted = true
  onboardingChecked = true
}

// Helper function to reset onboarding cache (for testing)
export function resetOnboardingCache() {
  onboardingCompleted = false
  onboardingChecked = false
}

export default router
