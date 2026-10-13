import { createRouter, createWebHistory } from 'vue-router';
import { onboardingAPI } from '../services/api';
import { useAuth } from '../composables/useAuth';

// Eager load landing page for fast initial load
import LandingPage from '../views/LandingPage.vue';

// Lazy load heavy views for better performance
const StoryEditor = () => import('../views/StoryEditor.vue');
const ChatView = () => import('../views/ChatView.vue');
const CharacterDetail = () => import('../views/CharacterDetail.vue');
const LorebookDetail = () => import('../views/LorebookDetail.vue');
const SettingsPage = () => import('../views/SettingsPage.vue');
const OnboardingWizard = () => import('../views/OnboardingWizard.vue');
const LoginPage = () => import('../views/LoginPage.vue');
const LinkPage = () => import('../views/LinkPage.vue');

const routes = [
  // Open without signing in, once signing in is on
  {
    path: '/login',
    name: 'login',
    component: LoginPage,
    meta: { title: 'Sign In - Writers Guild', public: true, skipOnboardingCheck: true },
  },
  {
    path: '/invite/:token',
    name: 'invite',
    component: LinkPage,
    props: true,
    meta: { title: 'Join - Writers Guild', public: true, skipOnboardingCheck: true },
  },
  {
    path: '/reset-password/:token',
    name: 'reset-password',
    component: LinkPage,
    props: true,
    meta: { title: 'Reset Password - Writers Guild', public: true, skipOnboardingCheck: true },
  },
  {
    path: '/onboarding',
    name: 'onboarding',
    component: OnboardingWizard,
    meta: { title: 'Welcome - Writers Guild', skipOnboardingCheck: true },
  },
  {
    path: '/',
    name: 'home',
    component: LandingPage,
    meta: { title: 'Writers Guild' },
  },
  {
    path: '/story/:storyId',
    name: 'story',
    component: StoryEditor,
    props: true,
    meta: { title: 'Story Editor - Writers Guild', dynamicTitle: true },
  },
  {
    path: '/chats/:chatId',
    name: 'chat',
    component: ChatView,
    props: true,
    meta: { title: 'Chat - Writers Guild', dynamicTitle: true },
  },
  {
    path: '/characters/:characterId',
    name: 'character-detail',
    component: CharacterDetail,
    props: true,
    meta: { title: 'Character - Writers Guild', dynamicTitle: true },
  },
  {
    path: '/lorebooks/:lorebookId',
    name: 'lorebook-detail',
    component: LorebookDetail,
    props: true,
    meta: { title: 'Lorebook - Writers Guild', dynamicTitle: true },
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsPage,
    meta: { title: 'Settings - Writers Guild' },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Once signing in is on, send anyone not signed in to sign in, then back where they were going.
router.beforeEach(async (to) => {
  const auth = useAuth();
  try {
    await auth.load();
  } catch (error) {
    // Leave it to the page to show the server isn't answering
    console.error('Failed to check whether signing in is on:', error);
    return true;
  }

  const signedOut = auth.authEnabled.value && !auth.user.value;
  if (to.name === 'login') return signedOut || { name: 'home' };
  if (to.meta.public || !signedOut) return true;
  return { name: 'login', query: to.fullPath === '/' ? {} : { redirect: to.fullPath } };
});

/** Go to sign in, as when a session ends while the app is open. */
export function goToSignIn() {
  const current = router.currentRoute.value;
  if (current.meta.public) return;
  useAuth().setStatus({ authEnabled: true, user: null });
  router.push({ name: 'login', query: { redirect: current.fullPath } });
}

// Track onboarding status to avoid repeated API calls
let onboardingChecked = false;
let onboardingCompleted = false;

// Navigation guard to check onboarding status
router.beforeEach(async (to, from, next) => {
  // Skip check for onboarding page itself
  if (to.meta.skipOnboardingCheck) {
    return next();
  }

  // If we've already checked and onboarding is complete, proceed
  if (onboardingChecked && onboardingCompleted) {
    return next();
  }

  // Check onboarding status from the API
  if (!onboardingChecked) {
    try {
      const status = await onboardingAPI.getStatus();
      onboardingChecked = true;
      onboardingCompleted = status.onboardingCompleted;
    } catch (error) {
      console.error('Failed to check onboarding status:', error);
      // On error, proceed to app (don't block user)
      onboardingChecked = true;
      onboardingCompleted = true;
      return next();
    }
  }

  // Redirect to onboarding if not completed, unless already navigating to onboarding
  if (!onboardingCompleted && to.name !== 'onboarding') {
    return next({ name: 'onboarding' });
  }

  next();
});

// Update page title on route change
router.afterEach((to) => {
  document.title = to.meta.title || 'Writers Guild';
});

// Helper function for components to update title dynamically
export function setPageTitle(title) {
  document.title = `${title} - Writers Guild`;
}

// Helper function to mark onboarding as complete (called after onboarding wizard finishes)
export function markOnboardingComplete() {
  onboardingCompleted = true;
  onboardingChecked = true;
}

// Helper function to reset onboarding cache (for testing)
export function resetOnboardingCache() {
  onboardingCompleted = false;
  onboardingChecked = false;
}

export default router;
