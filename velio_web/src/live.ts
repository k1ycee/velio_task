import { useCallback, useEffect, useState } from 'react';
import { API_URL, api, type Activity } from './api';

export type Counts = Record<string, { spotsLeft: number; version: number }>;

export interface Update {
  activityId: string;
  spotsLeft: number;
  version: number;
  committedAt?: string | null;
}

/** Keeps the newest version per activity; stale or out-of-order messages are dropped. */
export function applyUpdate(counts: Counts, u: Update): Counts {
  const current = counts[u.activityId];
  if (current && u.version <= current.version) return counts;
  return { ...counts, [u.activityId]: { spotsLeft: u.spotsLeft, version: u.version } };
}

/** Whichever is newer: the loaded activity or the stream. */
export function currentSpotsLeft(activity: Activity, counts: Counts): number {
  const live = counts[activity.id];
  return live && live.version >= activity.version ? live.spotsLeft : activity.spotsLeft;
}

function reportLatency(u: Update, receivedAt: Date, userId: string | null) {
  api('/events', {
    userId,
    body: {
      name: 'availability_received',
      activityId: u.activityId,
      props: {
        version: u.version,
        committedAt: u.committedAt,
        clientReceivedAt: receivedAt.toISOString(),
        clientSentAt: new Date().toISOString(),
      },
    },
  }).catch(() => undefined); // metrics must never break the page
}

/**
 * Live spot counts for every activity over one SSE connection.
 * `resyncKey` changes whenever the stream (re)connects or the tab becomes visible again — pages
 * reload their data on it, so a sleeping laptop or dropped connection never leaves stale counts.
 * Call `seed` with freshly loaded activities; higher versions win either way.
 */
export function useLiveCounts(userId: string | null) {
  const [counts, setCounts] = useState<Counts>({});
  const [resyncKey, setResyncKey] = useState(0);

  useEffect(() => {
    const resync = () => setResyncKey((k) => k + 1);
    const source = new EventSource(`${API_URL}/activities/stream`);
    source.onopen = resync;
    source.onmessage = (e) => {
      const u = JSON.parse(e.data) as Update;
      setCounts((c) => applyUpdate(c, u));
      if (u.committedAt) reportLatency(u, new Date(), userId);
    };
    const onVisible = () => document.visibilityState === 'visible' && resync();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      source.close();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);

  const seed = useCallback(
    (activities: Activity[]) =>
      setCounts((c) => activities.reduce((acc, a) => applyUpdate(acc, { activityId: a.id, ...a }), c)),
    [],
  );

  return { counts, seed, resyncKey };
}
