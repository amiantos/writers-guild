import { computed } from 'vue'
import { useRouter } from 'vue-router'

/**
 * Navigation composable for handling back button behavior
 *
 * Provides a smart goBack function that:
 * - Goes back in history if user navigated within the app
 * - Falls back to a specified route if no history exists
 * - Handles edge cases like direct URL access and page refresh
 */
export function useNavigation() {
  const router = useRouter()

  /**
   * Check if there's a valid previous page in the router history
   * Uses Vue Router's internal history state
   */
  const hasPreviousPage = computed(() => {
    // Check if history.state.back exists (Vue Router tracks this)
    return router.options.history.state.back !== null
  })

  /**
   * Smart back navigation function
   * @param {string|object} fallback - Fallback route (default: '/')
   *   Examples:
   *     - 'home' (route name)
   *     - '/' (path)
   *     - { name: 'home' } (route object)
   */
  function goBack(fallback = '/') {
    if (hasPreviousPage.value) {
      // There's history, go back
      router.back()
    } else {
      // No history, use fallback
      // Handle both string and object formats
      if (typeof fallback === 'string') {
        // If it starts with '/', treat as path, otherwise as route name
        if (fallback.startsWith('/')) {
          router.push(fallback)
        } else {
          router.push({ name: fallback })
        }
      } else {
        router.push(fallback)
      }
    }
  }

  /**
   * Get the URL of the previous page if available
   * Useful for conditional UI or logging
   */
  const previousRoute = computed(() => {
    return router.options.history.state.back || null
  })

  return {
    goBack,
    hasPreviousPage,
    previousRoute
  }
}
