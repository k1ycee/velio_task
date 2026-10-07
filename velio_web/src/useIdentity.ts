import { useState } from 'react';
import type { User } from './api';

const STORAGE_KEY = 'velio.user';

function load(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function save(user: User | null) {
  try {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode / blocked storage: identity just won't persist across reloads.
  }
}

export function useIdentity() {
  const [user, setUserState] = useState<User | null>(load);
  const setUser = (u: User | null) => {
    save(u);
    setUserState(u);
  };
  return { user, setUser };
}
