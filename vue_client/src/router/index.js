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
    component: LandingPage
  },
  {
    path: '/story/:storyId',
    name: 'story',
    component: StoryEditor,
    props: true
  },
  {
    path: '/characters/:characterId',
    name: 'character-detail',
    component: CharacterDetail,
    props: true
  },
  {
    path: '/lorebooks/:lorebookId',
    name: 'lorebook-detail',
    component: LorebookDetail,
    props: true
  },
  {
    path: '/settings',
    name: 'settings',
    component: SettingsPage
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
