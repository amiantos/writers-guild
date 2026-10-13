/**
 * Auth API Client
 *
 * Signing in and out, the links that invite someone or reset a password, and the admin's list of
 * users. Signing in is off until the admin turns it on in Settings; until then everything runs as
 * the admin and none of this shows.
 */

const REQUESTED_WITH = 'WritersGuild';

async function request(path, { method = 'GET', body } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`/api${path}`, init);
  const data = await response.json().catch(() => ({ error: response.statusText }));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed: ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export const authAPI = {
  /** @returns {Promise<{authEnabled: boolean, user: Object|null}>} */
  status: () => request('/auth/status'),
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword, newPassword) =>
    request('/auth/password', { method: 'PUT', body: { currentPassword, newPassword } }),
  enable: (username, password) =>
    request('/auth/enable', { method: 'POST', body: { username, password } }),
  disable: (password) => request('/auth/disable', { method: 'POST', body: { password } }),
  getLink: (token) => request(`/auth/links/${encodeURIComponent(token)}`),
  useLink: (token, { username, password }) =>
    request(`/auth/links/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: { username, password },
    }),
};

export const usersAPI = {
  list: () => request('/users'),
  delete: (userId) => request(`/users/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  resetLink: (userId) =>
    request(`/users/${encodeURIComponent(userId)}/reset-link`, { method: 'POST' }),
  listInvitations: () => request('/users/invitations'),
  invite: () => request('/users/invitations', { method: 'POST' }),
  deleteInvitation: (linkId) =>
    request(`/users/invitations/${encodeURIComponent(linkId)}`, { method: 'DELETE' }),
};

/** A link's full URL, from the path the server gives, for copying to someone. */
export function linkURL(path) {
  return new URL(path, window.location.origin).href;
}

function isApiRequest(input) {
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  return url.origin === window.location.origin && url.pathname.startsWith('/api/');
}

/**
 * Have every request to the API carry the header it wants on writes once signing in is on, and
 * go to the sign in page when a session has ended. Covers each fetch() in the app, so none of
 * them needs to know about signing in.
 *
 * @param {(response: Response) => void} onSignInRequired
 */
export function installAuthFetch(onSignInRequired) {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    if (!isApiRequest(input)) return nativeFetch(input, init);

    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : {}));
    if (!headers.has('X-Requested-With')) headers.set('X-Requested-With', REQUESTED_WITH);
    const response = await nativeFetch(input, { ...init, headers });

    if (response.status === 401) {
      const body = await response
        .clone()
        .json()
        .catch(() => ({}));
      if (body.signInRequired) onSignInRequired(response);
    }
    return response;
  };
}
