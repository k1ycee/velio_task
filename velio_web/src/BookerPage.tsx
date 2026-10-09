import { useCallback, useEffect, useState } from 'react';
import { ApiError, api, type Activity, type PlanSummary } from './api';
import { currentSpotsLeft, useLiveCounts } from './live';
import { SpotsLeft } from './SpotsLeft';
import { Skeleton } from './Skeleton';
import { formatWhen, useNow } from './time';
import { TABS, bookLabel, coverFor, filterActivities, friendsLabel, type Tab } from './discover';

export function BookerPage({ userId }: { userId: string }) {
  const [activities, setActivities] = useState<Activity[] | null>(null); // null until the first load
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const { counts, seed, resyncKey } = useLiveCounts(userId);
  const now = useNow(60_000); // tab boundaries only need minute precision

  const load = useCallback(() => {
    api<Activity[]>('/activities').then((all) => {
      setActivities(all);
      seed(all);
    }, (err: Error) => setError(err.message));
    api<PlanSummary[]>('/plans', { userId }).then(setPlans, () => setPlans([]));
  }, [userId, seed]);
  useEffect(load, [load, resyncKey]);

  const bookedActivityIds = new Set(plans.map((p) => p.activity.id));
  const shown = activities && filterActivities(activities, query, tab, counts, now);

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
        <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="2" />
            <path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search activities"
            aria-label="Search activities"
          />
          <button type="submit" aria-label="Search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="2.4" />
              <path d="M15.5 15.5 20 20" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </button>
        </form>
        <div className="tabs" role="tablist" aria-label="When">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        {shown === null ? (
          !error && <Skeleton heights={[220, 220]} label="Loading activities" />
        ) : activities!.length === 0 ? (
          <p className="empty">No upcoming activities. Switch to Host to create one.</p>
        ) : shown.length === 0 ? (
          <p className="empty">No activities match. Try another search or tab.</p>
        ) : (
          <ul className="cards">
            {shown.map((a) => (
              <li key={a.id} className="event">
                <div className="event-cover" style={{ background: coverFor(a.id) }} aria-hidden>
                  {a.title}
                </div>
                <h3>{a.title}</h3>
                <span className="muted small">{formatWhen(a.startsAt)}</span>
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
        setMessage(`You can hold up to ${body.cap} spot${body.cap === 1 ? '' : 's'} for friends.`);
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
      {spotsLeft > 0 &&
        (held === 0 ? (
          <button type="button" className="add-friend" onClick={() => setHeld(1)} disabled={busy}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
              <path d="M3 7h8M7 3v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Bring a friend
          </button>
        ) : (
          <span className="stepper" role="group" aria-label="Friends">
            <button type="button" onClick={() => setHeld(held - 1)} disabled={busy} aria-label="One fewer friend">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path d="M3 7h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <output aria-live="polite">{friendsLabel(held)}</output>
            <button
              type="button"
              onClick={() => setHeld(held + 1)}
              disabled={busy || held === 5}
              aria-label="One more friend"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                <path d="M3 7h8M7 3v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </span>
        ))}
      <button
        type="button"
        className="book-button"
        onClick={() => book(held)}
        disabled={busy || spotsLeft === 0}
        aria-busy={busy}
      >
        {spotsLeft === 0 ? 'Sold out' : busy ? 'Booking…' : bookLabel(held)}
      </button>
      {message && <p className="error">{message}</p>}
    </div>
  );
}
