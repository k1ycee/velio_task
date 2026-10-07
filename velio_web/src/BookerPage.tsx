import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type Activity, type PlanSummary } from './api';
import { currentSpotsLeft, useLiveCounts } from './live';
import { SpotsLeft } from './SpotsLeft';
import { formatWhen } from './time';

export function BookerPage({ userId }: { userId: string }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { counts, seed, resyncKey } = useLiveCounts(userId);

  const load = useCallback(() => {
    api<Activity[]>('/activities').then((all) => {
      setActivities(all);
      seed(all);
    }, (err: Error) => setError(err.message));
    api<PlanSummary[]>('/plans', { userId }).then(setPlans, () => setPlans([]));
  }, [userId, seed]);
  useEffect(load, [load, resyncKey]);

  const bookedActivityIds = new Set(plans.map((p) => p.activity.id));

  return (
    <div className="stack">
      {plans.length > 0 && (
        <section>
          <h2>Your plans</h2>
          <ul className="list">
            {plans.map((p) => (
              <li key={p.id}>
                <a className="row link" href={`#/plan/${p.id}`}>
                  <div>
                    <strong>{p.activity.title}</strong>
                    <span className="muted">{formatWhen(p.activity.startsAt)}</span>
                  </div>
                  <span aria-hidden>→</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h1>Book an activity</h1>
        {error && <p className="error">{error}</p>}
        {activities.length === 0 ? (
          <p className="empty">No upcoming activities. Switch to Host to create one.</p>
        ) : (
          <ul className="list">
            {activities.map((a) => (
              <li key={a.id} className="row wrap">
                <div>
                  <strong>{a.title}</strong>
                  <span className="muted">{formatWhen(a.startsAt)}</span>
                </div>
                <SpotsLeft activity={a} counts={counts} />
                {a.hostId === userId ? (
                  <span className="muted">You're hosting</span>
                ) : bookedActivityIds.has(a.id) ? (
                  <span className="muted">Booked</span>
                ) : (
                  <BookForm userId={userId} activity={a} spotsLeft={currentSpotsLeft(a, counts)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BookForm({ userId, activity, spotsLeft }: { userId: string; activity: Activity; spotsLeft: number }) {
  const [held, setHeld] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function book(heldSpots: number) {
    setBusy(true);
    setMessage(null);
    try {
      const { planId } = await api<{ planId: string }>('/bookings', {
        userId,
        body: { activityId: activity.id, heldSpots },
      });
      window.location.hash = `#/plan/${planId}`;
    } catch (err) {
      if (!(err instanceof ApiError)) return setMessage((err as Error).message);
      const body = err.body ?? {};
      if (err.status === 422) {
        setMessage(`You can hold up to ${body.cap} spots for friends.`);
      } else if (err.status === 409 && body.reason === 'race_lost') {
        const available = Number(body.available);
        // Never book fewer than asked without the booker saying so.
        if (available > 0 && window.confirm(`Only ${available} left. Book ${available} (you + ${available - 1})?`)) {
          return book(available - 1);
        }
        setMessage(available > 0 ? `Only ${available} left.` : 'Just sold out.');
      } else if (err.status === 409) {
        setMessage("You've already booked this activity.");
      } else {
        setMessage(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="book">
      <label>
        Friends
        <select value={held} onChange={(e) => setHeld(Number(e.target.value))} disabled={busy}>
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              +{n}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => book(held)} disabled={busy || spotsLeft === 0}>
        {spotsLeft === 0 ? 'Sold out' : `Book ${held + 1}`}
      </button>
      {message && <p className="error">{message}</p>}
    </div>
  );
}
