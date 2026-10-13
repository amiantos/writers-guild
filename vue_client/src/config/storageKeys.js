import { useAuth } from '../composables/useAuth';
import { ADMIN_USER_ID } from '../../../shared/users.js';

// Shared localStorage keys used across components
export const SKIP_THIRD_PERSON_PROMPT_KEY = 'writers-guild-skip-third-person-prompt';

/**
 * A localStorage key of the signed-in user's own, so people sharing a browser each keep their
 * preferences. The admin keeps the bare key, as preferences were saved before there were users.
 */
export function userStorageKey(key) {
  const userId = useAuth().user.value?.id;
  return !userId || userId === ADMIN_USER_ID ? key : `${key}:${userId}`;
}
