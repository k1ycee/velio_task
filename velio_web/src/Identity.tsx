import { useEffect, useState, type FormEvent } from 'react';
import { api, type User } from './api';
import type { useIdentity } from './useIdentity';

// ponytail: simple identity toggle — auth is out of scope. Pick an existing user or create one.
export function IdentityBar({ identity }: { identity: ReturnType<typeof useIdentity> }) {
  const [users, setUsers] = useState<User[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<User[]>('/users').then(setUsers, () => setUsers([]));
  }, [creating]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body = { name: form.get('name'), phone: form.get('phone'), email: form.get('email') };
    try {
      setError(null);
      const { id } = await api<{ id: string }>('/users', { body });
      identity.setUser({ id, name: String(body.name) });
      setCreating(false);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (creating) {
    return (
      <form className="identity create" onSubmit={create}>
        <input name="name" placeholder="Name" required aria-label="Name" />
        <input name="phone" placeholder="Phone" required aria-label="Phone" inputMode="tel" />
        <input name="email" placeholder="Email" required aria-label="Email" type="email" />
        <button type="submit">Save</button>
        <button type="button" className="ghost" onClick={() => setCreating(false)}>
          Cancel
        </button>
        {error && <span className="error">{error}</span>}
      </form>
    );
  }

  const options = identity.user && !users.some((u) => u.id === identity.user!.id) ? [identity.user, ...users] : users;
  return (
    <div className="identity">
      <label>
        <span className="sr-only">Acting as</span>
        <select
          value={identity.user?.id ?? ''}
          onChange={(e) => identity.setUser(options.find((u) => u.id === e.target.value) ?? null)}
        >
          <option value="">Choose user…</option>
          {options.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} (#{u.id})
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="ghost" onClick={() => setCreating(true)}>
        New user
      </button>
    </div>
  );
}
