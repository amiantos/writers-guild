import { createRouter, createWebHistory } from 'vue-router'
import LandingPage from '../views/LandingPage.vue'
import StoryEditor from '../views/StoryEditor.vue'
import CharacterDetail from '../views/CharacterDetail.vue'
import LorebookDetail from '../views/LorebookDetail.vue'
import SettingsPage from '../views/SettingsPage.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: LandingPage,
    meta: { title: 'Úrscéal' }
  },
  {
    path: '/story/:storyId',
    name: 'story',
    component: StoryEditor,
    props: true,
    meta: { title: 'Story Editor - Úrscéal', dynamicTitle: true }
  },
  {
    path: '/characters/:characterId',
    name: 'character-detail',
    component: CharacterDetail,
    props: true,
    meta: { title: 'Character - Úrscéal', dynamicTitle: true }
  },
  {
    path: '/lorebooks/:lorebookId',
    name: 'lorebook-detail',
    component: LorebookDetail,
    props: true,
    meta: { title: 'Lorebook - Úrscéal', dynamicTitle: true }
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsPage,
    meta: { title: 'Settings - Úrscéal' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// Update page title on route change
router.afterEach((to) => {
  document.title = to.meta.title || 'Úrscéal'
})

// Helper function for components to update title dynamically
export function setPageTitle(title) {
  document.title = `${title} - Úrscéal`
}

export default router
