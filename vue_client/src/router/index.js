import { createRouter, createWebHistory } from 'vue-router'
import LandingPage from '../views/LandingPage.vue'
import StoryEditor from '../views/StoryEditor.vue'

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
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
