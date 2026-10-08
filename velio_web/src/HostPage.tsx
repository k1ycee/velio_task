import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Activity } from './api';
import { useLiveCounts } from './live';
import { SpotsLeft } from './SpotsLeft';
import { Skeleton } from './Skeleton';
import { formatWhen } from './time';

export function HostPage({ userId }: { userId: string }) {
  const [activities, setActivities] = useState<Activity[] | null>(null); // null until the first load
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { counts, seed, resyncKey } = useLiveCounts(userId);

  const load = useCallback(() => {
    api<Activity[]>('/activities').then((all) => {
      const mine = all.filter((a) => a.hostId === userId);
      setActivities(mine);
      seed(mine);
    }, (err: Error) => setError(err.message));
  }, [userId, seed]);
  useEffect(load, [load, resyncKey]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setCreating(true);
    try {
      setError(null);
      await api('/activities', {
        userId,
        body: {
          title: form.get('title'),
          startsAt: new Date(String(form.get('startsAt'))).toISOString(),
          capacity: Number(form.get('capacity')),
        },
      });
      formEl.reset();
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h1>Create an activity</h1>
        <form className="grid-form" onSubmit={create}>
          <label>
            Title
            <input name="title" required placeholder="Sunset Kayaking" />
          </label>
          <label>
            Starts
            <input name="startsAt" type="datetime-local" required />
          </label>
          <label>
            Spots
            <input name="capacity" type="number" min={1} defaultValue={10} required />
          </label>
          <button type="submit" disabled={creating} aria-busy={creating}>
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      <section>
        <h2>Your activities</h2>
        {activities === null ? (
          !error && <Skeleton heights={[64, 64]} label="Loading your activities" />
        ) : activities.length === 0 ? (
          <p className="empty">No upcoming activities yet.</p>
        ) : (
          <ul className="list">
            {activities.map((a) => (
              <li key={a.id} className="row">
                <div>
                  <strong>{a.title}</strong>
                  <span className="muted">{formatWhen(a.startsAt)}</span>
                </div>
                <SpotsLeft activity={a} counts={counts} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
