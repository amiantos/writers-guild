import { describe, it, expect } from 'vitest';
import { userStorageKey } from '../storageKeys.js';
import { useAuth } from '../../composables/useAuth';

describe('userStorageKey', () => {
  it('keeps the bare key for the admin, so preferences saved before users are kept', () => {
    useAuth().setStatus({ authEnabled: false, user: { id: 'admin', role: 'admin' } });

    expect(userStorageKey('writers-guild-library')).toBe('writers-guild-library');
  });

  it('gives anyone else a key of their own', () => {
    useAuth().setStatus({ authEnabled: true, user: { id: 'u1', role: 'user' } });

    expect(userStorageKey('writers-guild-library')).toBe('writers-guild-library:u1');
  });

  it('keeps the bare key before anyone is known', () => {
    useAuth().setStatus({ authEnabled: true, user: null });

    expect(userStorageKey('writers-guild-library')).toBe('writers-guild-library');
  });
});
