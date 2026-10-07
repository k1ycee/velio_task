import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, api, type Invite, type Plan } from './api';
import { useLiveCounts } from './live';
import { SpotsLeft } from './SpotsLeft';
import { formatCountdown, formatWhen, holdProgress, useNow } from './time';

// ponytail: membership refreshes by polling every 5s; only spot counts are pushed live.
const POLL_MS = 5000;

export function PlanPage({ userId, planId }: { userId: string; planId: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { counts, seed, resyncKey } = useLiveCounts(userId);
  const now = useNow();

  const load = useCallback(() => {
    api<Plan>(`/plans/${planId}`, { userId }).then(
      (p) => {
        setPlan(p);
        seed([p.activity]);
        setError(null);
      },
      (err: Error) => setError(err.message),
    );
  }, [planId, userId, seed]);
  useEffect(load, [load, resyncKey]);
  useEffect(() => {
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (error && !plan) return <p className="error">{error}</p>;
  if (!plan) return <p className="empty">Loading…</p>;

  const start = new Date(plan.holdStartedAt);
  const end = new Date(plan.holdExpiresAt);
  const progress = holdProgress(start, end, now);
  const remaining = end.getTime() - now.getTime();
  const holding = plan.heldSpotsLeft > 0 && remaining > 0;

  return (
    <div className="stack">
      <a href="#/book" className="muted">
        ← All activities
      </a>
      <section className="card">
        <div className="row">
          <div>
            <h1>{plan.activity.title}</h1>
            <span className="muted">{formatWhen(plan.activity.startsAt)}</span>
          </div>
          <SpotsLeft activity={plan.activity} counts={counts} />
        </div>

        {plan.heldSpotsLeft > 0 && (
          <div className={`hold ${progress >= 0.9 ? 'urgent' : progress >= 0.5 ? 'warn' : ''}`}>
            <div className="row">
              <strong>
                {holding
                  ? `${plan.heldSpotsLeft} held spot${plan.heldSpotsLeft === 1 ? '' : 's'} to fill`
                  : 'Your held spots have been released'}
              </strong>
              <span className="countdown">{holding ? formatCountdown(remaining) : 'expired'}</span>
            </div>
            <div className="bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div style={{ width: `${progress * 100}%` }} />
            </div>
            {holding && progress >= 0.5 && (
              <p>
                {progress >= 0.9 ? 'Almost out of time.' : 'Halfway through your hold.'} Unfilled spots go back to
                everyone when the timer ends.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Who's going</h2>
        <ul className="members">
          {plan.members.map((m) => (
            <li key={m.userId}>
              {m.name}
              {m.role === 'booker' ? (
                <span className="badge">booker</span>
              ) : (
                m.inviteType && <span className={`badge ${m.inviteType}`}>{m.inviteType}</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <InviteSection userId={userId} plan={plan} onChange={load} canVouch={holding} />
    </div>
  );
}

function InviteSection({
  userId,
  plan,
  onChange,
  canVouch,
}: {
  userId: string;
  plan: Plan;
  onChange: () => void;
  canVouch: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const hasPublic = plan.invites.some((i) => i.type === 'public');

  async function create(type: Invite['type'], label?: string) {
    setMessage(null);
    try {
      await api(`/plans/${plan.id}/invites`, { userId, body: { type, label } });
      onChange();
    } catch (err) {
      const reason = err instanceof ApiError ? err.body?.reason : null;
      setMessage(reason === 'no_held_spot' ? 'Every held spot already has a vouch link.' : (err as Error).message);
    }
  }

  function vouch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const label = String(new FormData(formEl).get('label') ?? '').trim();
    create('vouch', label || undefined).then(() => formEl.reset());
  }

  return (
    <section className="card">
      <h2>Invite friends</h2>
      <div className="invite-actions">
        <form onSubmit={vouch} className="inline">
          <input name="label" placeholder="Who are you vouching for?" aria-label="Friend's name" disabled={!canVouch} />
          <button type="submit" disabled={!canVouch} title="I stand behind this person — one link per friend">
            Create vouch link
          </button>
        </form>
        {!hasPublic && (
          <button type="button" className="ghost" onClick={() => create('public')}>
            Get public link
          </button>
        )}
      </div>
      <p className="muted small">
        A vouch link is for one friend you stand behind and saves them a held spot. The public link is for sharing
        anywhere — it fills unvouched held spots first, then open spots.
      </p>
      {message && <p className="error">{message}</p>}

      {plan.invites.length > 0 && (
        <ul className="list">
          {plan.invites.map((i) => (
            <li key={i.inviteId} className="row wrap">
              <div>
                <span className={`badge ${i.type}`}>{i.type}</span> {i.label ?? (i.type === 'public' ? 'Anyone' : 'Friend')}
                {i.used && <span className="muted"> · claimed</span>}
              </div>
              <code className="link-text">{i.url}</code>
              <CopyButton text={i.url} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="ghost"
      onClick={() =>
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
      }
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
